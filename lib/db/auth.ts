// GoTrue-compatible auth against plain Postgres auth.users (bcrypt hashes).
//
// Mirrors how this store's hosted Supabase project behaved: one-hour access
// tokens, email confirmation required before a customer can sign in, banned
// accounts locked out, and the PKCE email-link flow supabase-js uses for
// signup confirmation and password recovery (the emailed link carries a
// one-time token; /auth/v1/verify turns it into an auth code that only the
// browser holding the code verifier can exchange for a session).

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes, randomUUID } from "crypto";
import { query } from "./pool";
import { authJwtSecret } from "./mode";

const ACCESS_TTL_SEC = 60 * 60; // the Supabase project's jwt_exp
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30;
const CONFIRM_TTL_HOURS = 24;
const RECOVERY_TTL_MINUTES = 60;
const AUTH_CODE_TTL_MINUTES = 10;
const MIN_PASSWORD_LENGTH = 6; // the Supabase project's password_min_length

const USER_COLUMNS = `id, email, phone, encrypted_password, email_confirmed_at,
  phone_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, banned_until, confirmation_sent_at, recovery_sent_at`;

export interface AuthUser {
  id: string;
  aud: string;
  role: string;
  email: string;
  phone: string;
  email_confirmed_at: string | null;
  phone_confirmed_at: string | null;
  confirmed_at: string | null;
  confirmation_sent_at?: string | null;
  recovery_sent_at?: string | null;
  last_sign_in_at: string | null;
  banned_until?: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  created_at: string;
  updated_at: string;
}

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: "bearer";
  user: AuthUser;
}

/** Error with the GoTrue error code supabase-js surfaces to the app. */
export interface AuthFailure {
  message: string;
  code: string;
  status: number;
}

function fail(message: string, code: string, status = 400): AuthFailure {
  return { message, code, status };
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(authJwtSecret());
}

function parseJson(value: unknown): Record<string, any> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value || "{}");
    } catch {
      return {};
    }
  }
  return (value as Record<string, any>) || {};
}

function rowToUser(row: Record<string, any>, appRole?: string | null): AuthUser {
  const appMeta = parseJson(row.raw_app_meta_data);
  if (appRole) appMeta.role = appRole;
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email || "",
    phone: row.phone || "",
    email_confirmed_at: row.email_confirmed_at || null,
    phone_confirmed_at: row.phone_confirmed_at || null,
    confirmed_at: row.email_confirmed_at || row.phone_confirmed_at || null,
    confirmation_sent_at: row.confirmation_sent_at || null,
    recovery_sent_at: row.recovery_sent_at || null,
    last_sign_in_at: row.last_sign_in_at || null,
    banned_until: row.banned_until || null,
    app_metadata: appMeta,
    user_metadata: parseJson(row.raw_user_meta_data),
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

function isBanned(row: Record<string, any>): boolean {
  return !!row.banned_until && new Date(row.banned_until).getTime() > Date.now();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

async function loadAppRole(userId: string): Promise<string | null> {
  try {
    const { rows } = await query<{ role: string }>(
      `SELECT role::text AS role FROM profiles WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return rows[0]?.role ?? null;
  } catch {
    return null;
  }
}

async function userRowById(userId: string): Promise<Record<string, any> | null> {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM auth.users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

async function userRowByEmail(email: string): Promise<Record<string, any> | null> {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM auth.users WHERE lower(email) = $1 AND deleted_at IS NULL LIMIT 1`,
    [email.trim().toLowerCase()]
  );
  return rows[0] ?? null;
}

async function mintSession(userRow: Record<string, any>): Promise<SessionTokens> {
  const appRole = await loadAppRole(userRow.id);
  const user = rowToUser(userRow, appRole);
  const now = Math.floor(Date.now() / 1000);
  const sessionId = randomUUID();

  const access_token = await new SignJWT({
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    phone: user.phone,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    session_id: sessionId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL_SEC)
    .sign(secretKey());

  const refresh_token = await new SignJWT({
    typ: "refresh",
    session_id: sessionId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_TTL_SEC)
    .sign(secretKey());

  return {
    access_token,
    refresh_token,
    expires_in: ACCESS_TTL_SEC,
    expires_at: now + ACCESS_TTL_SEC,
    token_type: "bearer",
    user,
  };
}

export async function verifyAccessToken(
  token: string
): Promise<{ userId: string; payload: Record<string, any> } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.typ === "refresh") return null;
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) return null;
    return { userId, payload: payload as Record<string, any> };
  } catch {
    return null;
  }
}

/** The account behind an id, banned or not (the admin API shows bans). */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const row = await userRowById(userId);
  if (!row) return null;
  return rowToUser(row, await loadAppRole(userId));
}

/** The signed-in user for an access token: invalid, deleted or banned → null. */
export async function getUserForToken(token: string): Promise<AuthUser | null> {
  const verified = await verifyAccessToken(token);
  if (!verified) return null;
  const row = await userRowById(verified.userId);
  if (!row || isBanned(row)) return null;
  return rowToUser(row, await loadAppRole(row.id));
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ session: SessionTokens | null; error: AuthFailure | null; userId?: string }> {
  const row = await userRowByEmail(email);
  if (!row?.encrypted_password || !bcrypt.compareSync(password, row.encrypted_password)) {
    return { session: null, error: fail("Invalid login credentials", "invalid_credentials") };
  }
  if (isBanned(row)) {
    return { session: null, error: fail("User is banned", "user_banned") };
  }
  if (!row.email_confirmed_at) {
    return { session: null, error: fail("Email not confirmed", "email_not_confirmed"), userId: row.id };
  }

  await query(
    `UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1`,
    [row.id]
  ).catch(() => {});

  return { session: await mintSession(row), error: null };
}

/**
 * Create an unconfirmed customer and a confirmation token to email. Like
 * GoTrue with confirmations on, an existing address gets no error (so the
 * form does not reveal who has an account): a still-unconfirmed one gets a
 * fresh confirmation token, a confirmed one gets nothing.
 */
export async function signUpWithPassword(opts: {
  email: string;
  password: string;
  data?: Record<string, unknown>;
}): Promise<{ user: AuthUser | null; confirmationToken: string | null; error: AuthFailure | null }> {
  const email = opts.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { user: null, confirmationToken: null, error: fail("Unable to validate email address: invalid format", "validation_failed") };
  }
  if (!opts.password || opts.password.length < MIN_PASSWORD_LENGTH) {
    return {
      user: null,
      confirmationToken: null,
      error: fail(`Password should be at least ${MIN_PASSWORD_LENGTH} characters.`, "weak_password", 422),
    };
  }

  const existing = await userRowByEmail(email);
  if (existing) {
    if (existing.email_confirmed_at) {
      return { user: { ...rowToUser(existing), identities: [] }, confirmationToken: null, error: null };
    }
    const token = await createConfirmationToken(existing.id);
    return { user: rowToUser(existing), confirmationToken: token, error: null };
  }

  const id = randomUUID();
  const token = newToken();
  await query(
    `INSERT INTO auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, confirmation_token, confirmation_sent_at,
       recovery_token, email_change_token_new, email_change, email_change_token_current,
       reauthentication_token, phone_change, phone_change_token
     ) VALUES (
       $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       $2, $3, NULL, '{"provider":"email","providers":["email"]}'::jsonb, $4::jsonb,
       now(), now(), $5, now(), '', '', '', '', '', '', ''
     )`,
    [id, email, bcrypt.hashSync(opts.password, 10), JSON.stringify(opts.data || {}), hashToken(token)]
  );
  // GoTrue keeps an identity row per provider; the dashboard's user list and
  // any later Supabase tooling expect it.
  await query(
    `INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', false), 'email', now(), now())`,
    [id, email]
  ).catch((e) => console.warn("[auth] identity row not created:", e.message));
  // The on_auth_user_created trigger creates the customer profile.

  const row = await userRowById(id);
  return { user: row ? rowToUser(row) : null, confirmationToken: token, error: null };
}

/** A fresh one-time confirmation token for an unconfirmed account. */
export async function createConfirmationToken(userId: string): Promise<string> {
  const token = newToken();
  await query(
    `UPDATE auth.users SET confirmation_token = $1, confirmation_sent_at = now(), updated_at = now()
     WHERE id = $2 AND email_confirmed_at IS NULL`,
    [hashToken(token), userId]
  );
  return token;
}

/**
 * Start a password reset. Returns the account and a one-time token to email,
 * or null when no usable account exists (callers must not reveal which).
 */
export async function createRecoveryToken(
  email: string
): Promise<{ userId: string; email: string; token: string } | null> {
  const row = await userRowByEmail(email);
  if (!row || isBanned(row)) return null;
  const token = newToken();
  await query(
    `UPDATE auth.users SET recovery_token = $1, recovery_sent_at = now(), updated_at = now() WHERE id = $2`,
    [hashToken(token), row.id]
  );
  return { userId: row.id, email: row.email, token };
}

export type EmailLinkType = "signup" | "recovery";

/**
 * Consume an emailed one-time token. A signup token confirms the address; a
 * recovery token also confirms it (the person proved they read the inbox).
 * Returns the account id, or null when the link is invalid or expired.
 */
export async function consumeEmailToken(type: EmailLinkType, token: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const hashed = hashToken(token);
  const { rows } =
    type === "signup"
      ? await query<{ id: string }>(
          `UPDATE auth.users
              SET email_confirmed_at = coalesce(email_confirmed_at, now()), confirmation_token = '', updated_at = now()
            WHERE confirmation_token = $1
              AND confirmation_sent_at > now() - ($2 || ' hours')::interval
              AND deleted_at IS NULL
          RETURNING id`,
          [hashed, String(CONFIRM_TTL_HOURS)]
        )
      : await query<{ id: string }>(
          `UPDATE auth.users
              SET email_confirmed_at = coalesce(email_confirmed_at, now()), recovery_token = '', updated_at = now()
            WHERE recovery_token = $1
              AND recovery_sent_at > now() - ($2 || ' minutes')::interval
              AND deleted_at IS NULL
          RETURNING id`,
          [hashed, String(RECOVERY_TTL_MINUTES)]
        );
  const userId = rows[0]?.id ?? null;
  if (userId && type === "signup") {
    await query(
      `UPDATE auth.identities SET identity_data = identity_data || '{"email_verified": true}'::jsonb, updated_at = now()
       WHERE user_id = $1 AND provider = 'email'`,
      [userId]
    ).catch(() => {});
  }
  return userId;
}

// ---- PKCE ------------------------------------------------------------------

function flowMethod(type: EmailLinkType): string {
  return type === "signup" ? "email/signup" : "recovery";
}

/** Remember the browser's PKCE challenge for the emailed link it asked for. */
export async function saveFlowState(
  userId: string,
  type: EmailLinkType,
  codeChallenge: string,
  codeChallengeMethod: string
): Promise<void> {
  const method = codeChallengeMethod.toLowerCase() === "plain" ? "plain" : "s256";
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeChallenge)) return;
  await query(
    `INSERT INTO auth.flow_state
       (id, user_id, code_challenge, code_challenge_method, provider_type, authentication_method, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3::auth.code_challenge_method, 'email', $4, now(), now())`,
    [userId, codeChallenge, method, flowMethod(type)]
  );
}

/** After the link is verified: a one-time auth code for the newest pending flow. */
export async function issueAuthCode(userId: string, type: EmailLinkType): Promise<string | null> {
  const code = randomUUID();
  const { rows } = await query<{ id: string }>(
    `UPDATE auth.flow_state SET auth_code = $1, auth_code_issued_at = now(), updated_at = now()
      WHERE id = (
        SELECT id FROM auth.flow_state
         WHERE user_id = $2 AND authentication_method = $3 AND auth_code IS NULL
           AND created_at > now() - interval '24 hours'
         ORDER BY created_at DESC LIMIT 1)
    RETURNING id`,
    [code, userId, flowMethod(type)]
  );
  return rows[0] ? code : null;
}

/** grant_type=pkce: the auth code plus the verifier only the browser holds. */
export async function exchangeAuthCode(
  authCode: string,
  codeVerifier: string
): Promise<{ session: SessionTokens | null; error: AuthFailure | null }> {
  const invalid = { session: null, error: fail("invalid flow state, no valid flow state found", "flow_state_not_found", 404) };
  if (!authCode || !codeVerifier) return invalid;
  const { rows } = await query(
    `DELETE FROM auth.flow_state
      WHERE auth_code = $1 AND auth_code_issued_at > now() - ($2 || ' minutes')::interval
    RETURNING user_id, code_challenge, code_challenge_method::text AS method`,
    [authCode, String(AUTH_CODE_TTL_MINUTES)]
  );
  const flow = rows[0];
  if (!flow?.user_id) return invalid;
  const expected =
    flow.method === "plain"
      ? codeVerifier
      : createHash("sha256").update(codeVerifier).digest("base64url");
  if (expected !== flow.code_challenge) {
    return { session: null, error: fail("code challenge does not match previously saved code verifier", "bad_code_verifier") };
  }
  const row = await userRowById(flow.user_id);
  if (!row || isBanned(row)) return invalid;
  await query(`UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1`, [row.id]).catch(() => {});
  return { session: await mintSession(row), error: null };
}

export async function refreshSession(
  refreshToken: string
): Promise<{ session: SessionTokens | null; error: AuthFailure | null }> {
  const invalid = { session: null, error: fail("Invalid Refresh Token", "refresh_token_not_found") };
  try {
    const { payload } = await jwtVerify(refreshToken, secretKey());
    if (payload.typ !== "refresh" || typeof payload.sub !== "string") return invalid;
    const row = await userRowById(payload.sub);
    if (!row) return invalid;
    if (isBanned(row)) return { session: null, error: fail("User is banned", "user_banned") };
    return { session: await mintSession(row), error: null };
  } catch {
    return invalid;
  }
}

export async function updateUserPassword(
  userId: string,
  password: string
): Promise<{ user: AuthUser | null; error: AuthFailure | null }> {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return { user: null, error: fail(`Password should be at least ${MIN_PASSWORD_LENGTH} characters.`, "weak_password", 422) };
  }
  await query(
    `UPDATE auth.users SET encrypted_password = $1, updated_at = now() WHERE id = $2`,
    [bcrypt.hashSync(password, 10), userId]
  );
  return { user: await getUserById(userId), error: null };
}

export async function updateUserMetadata(
  userId: string,
  data: Record<string, unknown>
): Promise<{ user: AuthUser | null; error: AuthFailure | null }> {
  await query(
    `UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(data), userId]
  );
  return { user: await getUserById(userId), error: null };
}

// ---- admin API (service role) -----------------------------------------------

/** Go duration as GoTrue's ban_duration accepts it: "876000h", "30m", "none". */
function banInterval(duration: string): string | null {
  if (duration === "none") return null;
  const m = /^(\d+(?:\.\d+)?)(h|m|s)$/.exec(duration.trim());
  if (!m) throw new Error(`invalid format for ban duration: ${duration}`);
  const unit = m[2] === "h" ? "hours" : m[2] === "m" ? "minutes" : "seconds";
  return `${m[1]} ${unit}`;
}

export async function adminCreateUser(attrs: {
  email: string;
  password?: string;
  email_confirm?: boolean;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}): Promise<{ user: AuthUser | null; error: AuthFailure | null }> {
  const email = String(attrs.email || "").trim().toLowerCase();
  if (!email.includes("@")) return { user: null, error: fail("Unable to validate email address: invalid format", "validation_failed") };
  if (await userRowByEmail(email)) {
    return { user: null, error: fail("A user with this email address has already been registered", "email_exists", 422) };
  }
  if (attrs.password !== undefined && attrs.password.length < MIN_PASSWORD_LENGTH) {
    return { user: null, error: fail(`Password should be at least ${MIN_PASSWORD_LENGTH} characters.`, "weak_password", 422) };
  }
  const id = randomUUID();
  const appMeta = { provider: "email", providers: ["email"], ...(attrs.app_metadata || {}) };
  await query(
    `INSERT INTO auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, confirmation_token, recovery_token,
       email_change_token_new, email_change, email_change_token_current,
       reauthentication_token, phone_change, phone_change_token
     ) VALUES (
       $1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       $2, $3, CASE WHEN $4 THEN now() END, $5::jsonb, $6::jsonb,
       now(), now(), '', '', '', '', '', '', '', ''
     )`,
    [
      id,
      email,
      attrs.password ? bcrypt.hashSync(attrs.password, 10) : "",
      !!attrs.email_confirm,
      JSON.stringify(appMeta),
      JSON.stringify(attrs.user_metadata || {}),
    ]
  );
  await query(
    `INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', $3::boolean), 'email', now(), now())`,
    [id, email, !!attrs.email_confirm]
  ).catch((e) => console.warn("[auth] identity row not created:", e.message));
  return { user: await getUserById(id), error: null };
}

export async function adminUpdateUserById(
  userId: string,
  attrs: {
    email?: string;
    password?: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
    ban_duration?: string;
  }
): Promise<{ user: AuthUser | null; error: AuthFailure | null }> {
  if (!(await userRowById(userId))) return { user: null, error: fail("User not found", "user_not_found", 404) };
  if (attrs.password !== undefined && attrs.password.length < MIN_PASSWORD_LENGTH) {
    return { user: null, error: fail(`Password should be at least ${MIN_PASSWORD_LENGTH} characters.`, "weak_password", 422) };
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    sets.push(sql.replace("?", `$${params.length}`));
  };
  if (attrs.email !== undefined) add("email = ?", attrs.email.trim().toLowerCase());
  if (attrs.password !== undefined) add("encrypted_password = ?", bcrypt.hashSync(attrs.password, 10));
  if (attrs.email_confirm === true) sets.push("email_confirmed_at = coalesce(email_confirmed_at, now())");
  if (attrs.user_metadata !== undefined) {
    add("raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || ?::jsonb", JSON.stringify(attrs.user_metadata));
  }
  if (attrs.app_metadata !== undefined) {
    add("raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || ?::jsonb", JSON.stringify(attrs.app_metadata));
  }
  if (attrs.ban_duration !== undefined) {
    let interval: string | null;
    try {
      interval = banInterval(attrs.ban_duration);
    } catch (e: any) {
      return { user: null, error: fail(e.message, "validation_failed") };
    }
    if (interval === null) sets.push("banned_until = NULL");
    else add("banned_until = now() + ?::interval", interval);
  }
  if (sets.length) {
    params.push(userId);
    await query(`UPDATE auth.users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params);
  }
  return { user: await getUserById(userId), error: null };
}

export async function adminListUsers(opts: { page?: number; perPage?: number } = {}): Promise<{
  users: AuthUser[];
  total: number;
}> {
  const perPage = Math.min(Math.max(Number(opts.perPage) || 50, 1), 1000);
  const page = Math.max(Number(opts.page) || 1, 1);
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, count(*) OVER () AS total_count
       FROM auth.users WHERE deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT $1 OFFSET $2`,
    [perPage, (page - 1) * perPage]
  );
  return { users: rows.map((r) => rowToUser(r)), total: Number(rows[0]?.total_count ?? 0) };
}
