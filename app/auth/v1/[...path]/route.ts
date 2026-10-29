import { NextRequest, NextResponse } from "next/server";
import {
  consumeEmailToken,
  createConfirmationToken,
  createRecoveryToken,
  exchangeAuthCode,
  getUserForToken,
  issueAuthCode,
  refreshSession,
  saveFlowState,
  signInWithPassword,
  signUpWithPassword,
  updateUserMetadata,
  updateUserPassword,
  type AuthFailure,
  type EmailLinkType,
  type SessionTokens,
} from "@/lib/db/auth";
import { isPlainPostgres } from "@/lib/db/mode";
import { query } from "@/lib/db/pool";
import { sendPasswordResetEmail, sendSignupConfirmationEmail } from "@/lib/auth-emails";
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from "@/lib/rate-limit";
import { getPublicSiteUrl } from "@/lib/site-url";

// GoTrue replacement for the browser's supabase-js auth client. Covers what
// the store uses: password sign-in, refresh, sign-up with an emailed
// confirmation link, password recovery, the PKCE code exchange both links
// finish with, profile/password updates and sign-out.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cors(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  };
}

function gotrueError(message: string, status = 400, code = "invalid_request") {
  return NextResponse.json(
    { code: status, error_code: code, msg: message, error: code, error_description: message, message },
    { status, headers: cors() }
  );
}

function failure(err: AuthFailure) {
  return gotrueError(err.message, err.status, err.code);
}

function sessionResponse(session: SessionTokens) {
  return NextResponse.json(
    {
      access_token: session.access_token,
      token_type: session.token_type,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      refresh_token: session.refresh_token,
      user: session.user,
    },
    { status: 200, headers: cors() }
  );
}

function rateLimited(key: string) {
  const limit = checkRateLimit(key, RATE_LIMITS.auth);
  return limit.success
    ? null
    : gotrueError("Too many requests. Please wait a minute and try again.", 429, "over_request_rate_limit");
}

/** The site's own origin (live domain or staging host); emailed links never leave it. */
function siteOrigin(req: NextRequest): string {
  try {
    return new URL(getPublicSiteUrl()).origin;
  } catch {
    return req.nextUrl.origin;
  }
}

/** A redirect target on this site, or the given fallback path. */
function safeRedirect(req: NextRequest, raw: string | null | undefined, fallbackPath: string): string {
  const origin = siteOrigin(req);
  if (raw) {
    try {
      const url = new URL(raw, origin);
      if (url.origin === origin) return url.toString();
    } catch {
      // fall through to the default page
    }
  }
  return `${origin}${fallbackPath}`;
}

function verifyLink(req: NextRequest, type: EmailLinkType, token: string, redirectTo: string): string {
  const url = new URL("/auth/v1/verify", siteOrigin(req));
  url.searchParams.set("token", token);
  url.searchParams.set("type", type);
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

async function readBody(req: NextRequest): Promise<Record<string, any>> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(await req.text()));
  }
  const body = await req.json().catch(() => ({}));
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

function bearer(req: NextRequest): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/** Email a fresh confirmation link, at most once every two minutes per account. */
async function resendConfirmation(req: NextRequest, userId: string, email: string, redirectTo: string) {
  const { rows } = await query<{ recent: boolean }>(
    `SELECT coalesce(confirmation_sent_at > now() - interval '2 minutes', false) AS recent
       FROM auth.users WHERE id = $1`,
    [userId]
  );
  if (rows[0]?.recent) return;
  const token = await createConfirmationToken(userId);
  await sendSignupConfirmationEmail(email, verifyLink(req, "signup", token, redirectTo));
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!isPlainPostgres()) return gotrueError("DATABASE_URL not set", 503);
  const slug = (await ctx.params).path.join("/");

  if (slug === "user") {
    const token = bearer(req);
    if (!token) return gotrueError("This endpoint requires a Bearer token", 401, "no_authorization");
    const user = await getUserForToken(token);
    if (!user) return gotrueError("invalid JWT: unable to parse or verify signature", 403, "bad_jwt");
    return NextResponse.json(user, { headers: cors() });
  }

  if (slug === "verify") {
    // The emailed link. Confirms the address (signup) or proves inbox access
    // (recovery), then hands the browser that asked for the link a one-time
    // auth code to exchange with its PKCE verifier.
    const sp = req.nextUrl.searchParams;
    const type: EmailLinkType = sp.get("type") === "recovery" ? "recovery" : "signup";
    const fallback = type === "recovery" ? "/auth/update-password" : "/auth/callback";
    const redirectTo = safeRedirect(req, sp.get("redirect_to"), fallback);
    const userId = await consumeEmailToken(type, sp.get("token") || "");
    if (!userId) {
      const target = new URL(redirectTo);
      target.hash = new URLSearchParams({
        error: "access_denied",
        error_code: "otp_expired",
        error_description: "Email link is invalid or has expired",
      }).toString();
      return NextResponse.redirect(target.toString(), 303);
    }
    const code = await issueAuthCode(userId, type);
    if (!code) {
      // Opened without a pending browser flow (e.g. a link resent at sign-in):
      // the address is confirmed, so send them to sign in. A reset needs the
      // browser that asked for it.
      const origin = siteOrigin(req);
      return NextResponse.redirect(
        type === "signup" ? `${origin}/auth/login?confirmed=1` : `${origin}/auth/forgot-password?expired=1`,
        303
      );
    }
    const target = new URL(redirectTo);
    target.searchParams.set("code", code);
    return NextResponse.redirect(target.toString(), 303);
  }

  if (slug === "settings" || slug === "health") {
    return NextResponse.json(
      { external: { email: true }, disable_signup: false, mailer_autoconfirm: false },
      { headers: cors() }
    );
  }

  return gotrueError(`Unknown auth path: ${slug}`, 404, "not_found");
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!isPlainPostgres()) return gotrueError("DATABASE_URL not set", 503);
  const slug = (await ctx.params).path.join("/");
  const sp = req.nextUrl.searchParams;
  const body = await readBody(req);
  const ip = getClientIdentifier(req);

  if (slug === "token") {
    const grant = sp.get("grant_type") || body.grant_type || "password";

    if (grant === "password") {
      const email = String(body.email || "").trim().toLowerCase();
      const limited = rateLimited(`auth-login:${ip}`) || rateLimited(`auth-login:${email}`);
      if (limited) return limited;
      const { session, error, userId } = await signInWithPassword(email, String(body.password || ""));
      if (error?.code === "email_not_confirmed" && userId) {
        await resendConfirmation(req, userId, email, safeRedirect(req, null, "/auth/callback")).catch((e) =>
          console.error("[auth] confirmation resend failed:", e.message)
        );
        return gotrueError(
          "Email not confirmed. We have emailed you a new confirmation link; open it, then sign in.",
          400,
          "email_not_confirmed"
        );
      }
      if (error || !session) return failure(error!);
      return sessionResponse(session);
    }

    if (grant === "refresh_token") {
      const { session, error } = await refreshSession(String(body.refresh_token || ""));
      if (error || !session) return failure(error!);
      return sessionResponse(session);
    }

    if (grant === "pkce") {
      const limited = rateLimited(`auth-pkce:${ip}`);
      if (limited) return limited;
      const { session, error } = await exchangeAuthCode(String(body.auth_code || ""), String(body.code_verifier || ""));
      if (error || !session) return failure(error!);
      return sessionResponse(session);
    }

    return gotrueError(`Unsupported grant_type: ${grant}`, 400, "unsupported_grant_type");
  }

  if (slug === "signup") {
    const limited = rateLimited(`auth-signup:${ip}`);
    if (limited) return limited;
    const { user, confirmationToken, error } = await signUpWithPassword({
      email: String(body.email || ""),
      password: String(body.password || ""),
      data: body.data || body.user_metadata || {},
    });
    if (error || !user) return failure(error!);
    if (confirmationToken) {
      if (body.code_challenge) {
        await saveFlowState(user.id, "signup", String(body.code_challenge), String(body.code_challenge_method || "s256"));
      }
      const redirectTo = safeRedirect(req, sp.get("redirect_to"), "/auth/callback");
      await sendSignupConfirmationEmail(user.email, verifyLink(req, "signup", confirmationToken, redirectTo)).catch(
        (e) => console.error("[auth] confirmation email failed:", e.message)
      );
    }
    // No session until the address is confirmed: supabase-js reads the body as the user.
    return NextResponse.json(user, { headers: cors() });
  }

  if (slug === "recover") {
    const email = String(body.email || "").trim().toLowerCase();
    const limited = rateLimited(`auth-recover:${ip}`) || rateLimited(`auth-recover:${email}`);
    if (limited) return limited;
    const recovery = await createRecoveryToken(email);
    if (recovery) {
      if (body.code_challenge) {
        await saveFlowState(recovery.userId, "recovery", String(body.code_challenge), String(body.code_challenge_method || "s256"));
      }
      const redirectTo = safeRedirect(req, sp.get("redirect_to"), "/auth/update-password");
      await sendPasswordResetEmail(recovery.email, verifyLink(req, "recovery", recovery.token, redirectTo)).catch((e) =>
        console.error("[auth] reset email failed:", e.message)
      );
    }
    // Same answer whether or not the account exists.
    return NextResponse.json({}, { headers: cors() });
  }

  if (slug === "resend") {
    const email = String(body.email || "").trim().toLowerCase();
    const limited = rateLimited(`auth-resend:${ip}`) || rateLimited(`auth-resend:${email}`);
    if (limited) return limited;
    if (body.type === "signup" && email) {
      const { rows } = await query<{ id: string; email: string }>(
        `SELECT id, email FROM auth.users WHERE lower(email) = $1 AND email_confirmed_at IS NULL AND deleted_at IS NULL LIMIT 1`,
        [email]
      );
      if (rows[0]) {
        await resendConfirmation(req, rows[0].id, rows[0].email, safeRedirect(req, sp.get("redirect_to"), "/auth/callback"));
      }
    }
    return NextResponse.json({}, { headers: cors() });
  }

  if (slug === "logout") {
    // Sessions are stateless JWTs; the client drops its tokens. GoTrue answers
    // 204 with no body, and supabase-js keeps the session if this errors.
    return new NextResponse(null, { status: 204, headers: cors() });
  }

  return gotrueError(`Unknown auth path: ${slug}`, 404, "not_found");
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!isPlainPostgres()) return gotrueError("DATABASE_URL not set", 503);
  const slug = (await ctx.params).path.join("/");
  if (slug !== "user") return gotrueError(`Unknown auth path: ${slug}`, 404, "not_found");

  const token = bearer(req);
  if (!token) return gotrueError("This endpoint requires a Bearer token", 401, "no_authorization");
  const current = await getUserForToken(token);
  if (!current) return gotrueError("invalid JWT: unable to parse or verify signature", 403, "bad_jwt");

  const body = await readBody(req);
  let user = current;

  if (body.password !== undefined) {
    const res = await updateUserPassword(current.id, String(body.password));
    if (res.error || !res.user) return failure(res.error!);
    user = res.user;
  }
  if (body.data || body.user_metadata) {
    const res = await updateUserMetadata(current.id, body.data || body.user_metadata);
    if (res.error || !res.user) return failure(res.error!);
    user = res.user;
  }
  if (body.email !== undefined && String(body.email).trim().toLowerCase() !== current.email.toLowerCase()) {
    return gotrueError("Changing the account email is not supported. Contact the store.", 422, "email_change_not_supported");
  }
  return NextResponse.json(user, { headers: cors() });
}
