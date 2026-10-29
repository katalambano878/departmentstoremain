// ============================================================================
// supabase-js compatibility layer over node-postgres.
//
// Goal: let the ~90 ported edge functions keep calling `supabase.from(...)...`
// unchanged while all data access runs against a plain Postgres database.
//
// Supported surface (exactly what the codebase uses — see migration recon):
//   .from(table)
//     .select(cols, { count, head })   -- incl. PostgREST embeds  fk:table(cols)
//     .insert(row|rows)                -- returning via .select().single()
//     .update(patch)
//     .upsert(row|rows, { onConflict })
//     .delete()
//     .eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/.in
//     .or('a.eq.x,b.ilike.%y%')
//     .not('col','in','(a,b)')  .not('col','is',null)
//     .filter(col, op, val)
//     .order(col, { ascending, nullsFirst })  .limit(n)  .range(a,b)
//     .single()  .maybeSingle()
//   await <builder>  ->  { data, error, count }
//
// Embeds are resolved with a second batched query per relationship (matching
// PostgREST's nested-object shape) using the app's FK map.
// ============================================================================

import {
  getExecutor,
  inRequestScope,
  withAuditActor,
  withRequestRole,
  type DbRole,
  type Queryable,
} from "./pool";
import { FK_MAP, JSONB_COLUMNS, type FkEdge } from "./fk-map";
import { createStorageClient, type StorageClient } from "./storage";

/** Reverse-embed tables that have a `position` column — safe to ORDER BY on `*`. */
const EMBED_TABLES_WITH_POSITION = new Set([
  "product_images",
  "review_images",
  "navigation_items",
  "banners",
  "categories",
]);

type Row = Record<string, any>;

/** Returns the signed-in staff member behind the current request, if any. */
export type AuditActorResolver = () => Promise<string | null>;

async function resolveAuditActor(resolver: AuditActorResolver | null): Promise<string | null> {
  // Inside a browser RLS scope auth.uid() already names the actor.
  if (!resolver || inRequestScope()) return null;
  try {
    const id = await resolver();
    return id && UUID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}
type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "is" | "in";

interface Filter {
  kind: "cmp" | "in" | "is" | "or" | "notIn" | "notIs" | "raw";
  col?: string;
  op?: string;
  value?: any;
  values?: any[];
  orParts?: string;
  sql?: string;
  params?: any[];
}

interface OrderSpec {
  col: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

interface ParsedSelect {
  columns: string[]; // scalar columns from this table ('*' allowed)
  star: boolean;
  embeds: EmbedSpec[];
}

interface EmbedSpec {
  alias: string; // property name on the result object
  table: string; // related table
  fkColumn?: string; // fk column on the owning row (forward embeds)
  inner?: boolean; // `table!inner(...)`: only parents that have a match
  select: ParsedSelect;
}

const PG_IDENT = /^[a-z_][a-z0-9_]*$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ident(name: string): string {
  if (!PG_IDENT.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

// PostgREST JSON path in a filter or order column: metadata->>visibility,
// metadata->a->>b. Keys are restricted to identifier characters, so they can
// be inlined as string literals.
const JSON_PATH_RE = /^([a-z_][a-z0-9_]*)((?:->>?[a-z0-9_]+)+)$/i;

/** SQL for a filter/order column: a plain column or a JSON path into one. */
function colExpr(col: string): string {
  if (PG_IDENT.test(col)) return ident(col);
  const m = JSON_PATH_RE.exec(col);
  if (!m) throw new Error(`Unsafe SQL identifier: ${col}`);
  const path = m[2].replace(/(->>?)([a-z0-9_]+)/gi, (_s, arrow, key) => `${arrow}'${key}'`);
  return `${ident(m[1])}${path}`;
}

/** Cast uuid-like columns to text when the filter value is not a UUID. */
function uuidSafeLeft(col: string, value: any): string {
  if (!PG_IDENT.test(col)) return colExpr(col);
  const looksUuidCol = col === "id" || col.endsWith("_id");
  if (
    looksUuidCol &&
    typeof value === "string" &&
    value.length > 0 &&
    !UUID_RE.test(value)
  ) {
    return `${ident(col)}::text`;
  }
  return ident(col);
}

function toNonNegativeInt(n: unknown, label: string): number {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0) throw new Error(`Invalid ${label}: ${String(n)}`);
  return v;
}

/**
 * Every (parent table -> embedded table) edge in a select string, nested
 * embeds included. The REST access policy uses this to stop anonymous
 * callers from pulling private tables in through an embed.
 */
export function listEmbedEdges(table: string, sel: string): Array<[string, string]> {
  const edges: Array<[string, string]> = [];
  const walk = (parent: string, parsed: ParsedSelect) => {
    for (const e of parsed.embeds) {
      edges.push([parent, e.table]);
      walk(e.table, e.select);
    }
  };
  walk(table, parseSelect(sel || "*"));
  return edges;
}

// ---- select-string parser (handles nested embeds with parentheses) ---------
function parseSelect(sel: string): ParsedSelect {
  const result: ParsedSelect = { columns: [], star: false, embeds: [] };
  const tokens = splitTopLevel(sel);
  for (const tokenRaw of tokens) {
    const token = tokenRaw.trim();
    if (!token) continue;
    const parenIdx = token.indexOf("(");
    if (parenIdx !== -1) {
      // Embed:  alias:table ( innerSelect )   OR   table ( innerSelect )
      const head = token.slice(0, parenIdx).trim();
      const inner = token.slice(parenIdx + 1, token.lastIndexOf(")"));
      let alias: string;
      let rhs: string;
      if (head.includes(":")) {
        const [a, t] = head.split(":");
        alias = a.trim();
        rhs = t.trim();
      } else {
        // bare form: `users(...)` or `users!constraint(...)` — key is the table name
        alias = head.split("!")[0].trim();
        rhs = head;
      }
      // Three supported PostgREST forms:
      //   alias:fk_column (cols)              e.g. groups:group_id(...)
      //   alias:table!fk_constraint (cols)    e.g. user:users!group_memberships_user_id_fkey(...)
      //   table!hint (cols)                   e.g. product_images!product_id(...) [reverse]
      //                                       or categories!inner(...) [join hint — ignore]
      //   table (cols)                        e.g. group_memberships(...)  [reverse]
      if (rhs.includes("!")) {
        const [tableNameRaw, constraintRaw] = rhs.split("!");
        const tableName = tableNameRaw.trim();
        const constraint = (constraintRaw || "").trim();
        // Join modifiers (!inner / !left) — treat as plain reverse/forward table embed
        if (constraint === "inner" || constraint === "left") {
          result.embeds.push({
            alias,
            table: tableName,
            inner: constraint === "inner",
            select: parseSelect(inner),
          });
        } else {
          // Prefer reverse-embed semantics when the hint is an FK column that
          // lives on the EMBEDDED table (e.g. product_images!product_id).
          // Only treat as forward (parent.fk → child.id) when the hint looks
          // like a full constraint name (..._fkey) pointing at a parent FK.
          const isFullConstraint = /_fkey$/i.test(constraint);
          const fkColumn = isFullConstraint
            ? deriveFkFromConstraint(constraint)
            : undefined;
          result.embeds.push({
            alias,
            table: tableName,
            fkColumn,
            select: parseSelect(inner),
          });
        }
      } else {
        const resolved = resolveEmbed(alias, rhs);
        result.embeds.push({
          alias,
          table: resolved.table,
          fkColumn: resolved.fkColumn,
          select: parseSelect(inner),
        });
      }
    } else if (token === "*") {
      result.star = true;
    } else {
      result.columns.push(token);
    }
  }
  return result;
}

// alias/head can be:  "groups:group_id"  ->  alias=groups, joined via fk column group_id
//                     "users:user_id"    ->  alias=users, fk user_id
//                     "group:groups"     ->  alias=group, TABLE groups (fk resolved at query time)
//                     "groups"           ->  alias/table groups
// We store alias as the PROPERTY name the code reads.
const ALL_FK_COLUMNS = new Set(
  Object.values(FK_MAP)
    .flat()
    .map((e) => e.column)
);

function resolveEmbed(alias: string, secondPart: string): { table: string; fkColumn?: string } {
  if (secondPart && secondPart !== alias && ALL_FK_COLUMNS.has(secondPart)) {
    // fk-column form (e.g. groups:group_id, users:user_id, template:template_id)
    const fkColumn = secondPart;
    const edge = Object.values(FK_MAP)
      .flat()
      .find((e) => e.column === fkColumn);
    return { table: edge?.foreignTable ?? guessTableFromFk(fkColumn), fkColumn };
  }
  // table form (e.g. group:groups, or bare group_memberships). FK direction is
  // resolved at query time when the owning table is known.
  return { table: secondPart || alias };
}

// "<owning_table>_<fk_column>_fkey" -> fk_column. The owning-table prefix can
// itself contain underscores, so match against known FK columns from the map.
function deriveFkFromConstraint(constraint: string): string | undefined {
  const base = constraint.replace(/_fkey$/, "");
  const allFkCols = new Set(
    Object.values(FK_MAP)
      .flat()
      .map((e) => e.column)
  );
  // longest matching suffix wins (approved_by vs user_id etc.)
  let best: string | undefined;
  for (const col of allFkCols) {
    if (base.endsWith(`_${col}`) || base === col) {
      if (!best || col.length > best.length) best = col;
    }
  }
  return best;
}

function guessTableFromFk(fkColumn: string): string {
  // group_id -> groups, user_id -> users, membership_id -> group_memberships,
  // template_id -> (sms|email)_templates, schedule_id -> contribution_schedules
  const map: Record<string, string> = {
    group_id: "groups",
    user_id: "users",
    membership_id: "group_memberships",
    schedule_id: "contribution_schedules",
    contribution_schedule_id: "contribution_schedules",
    payment_transaction_id: "payment_transactions",
    payment_intent_id: "payment_intents",
    payout_schedule_id: "payout_schedules",
    wallet_id: "wallets",
    wallet_transaction_id: "wallet_transactions",
    ticket_id: "support_tickets",
  };
  if (map[fkColumn]) return map[fkColumn];
  if (fkColumn.endsWith("_id")) return fkColumn.slice(0, -3) + "s";
  return fkColumn;
}

// split by commas that are NOT inside parentheses
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---- the chainable query builder -------------------------------------------
export class QueryBuilder implements PromiseLike<{ data: any; error: any; count: number | null }> {
  private table: string;
  private action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectStr = "*";
  private wantCount = false;
  private headOnly = false;
  private filters: Filter[] = [];
  private orders: OrderSpec[] = [];
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private payload: Row | Row[] | null = null;
  private onConflictCols: string[] | null = null;
  private returnRows = false;
  private singleMode: "none" | "single" | "maybe" = "none";
  private runAs: DbRole | null;
  private auditActor: AuditActorResolver | null;
  private ignoreDuplicates = false;

  constructor(table: string, runAs: DbRole | null = null, auditActor: AuditActorResolver | null = null) {
    this.table = table;
    this.runAs = runAs;
    this.auditActor = auditActor;
  }

  select(sel = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.action === "select") {
      this.selectStr = sel || "*";
    } else {
      // insert/update/upsert followed by .select() => RETURNING
      this.returnRows = true;
      this.selectStr = sel || "*";
    }
    if (opts?.count) this.wantCount = true;
    if (opts?.head) {
      this.headOnly = true;
      this.wantCount = true;
    }
    return this;
  }

  insert(payload: Row | Row[]) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }
  update(patch: Row) {
    this.action = "update";
    this.payload = patch;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.action = "upsert";
    this.payload = payload;
    this.ignoreDuplicates = !!opts?.ignoreDuplicates;
    this.onConflictCols = opts?.onConflict
      ? opts.onConflict.split(",").map((c) => c.trim())
      : null;
    return this;
  }
  delete() {
    this.action = "delete";
    return this;
  }

  eq(col: string, value: any) { return this.cmp(col, "eq", value); }
  neq(col: string, value: any) { return this.cmp(col, "neq", value); }
  gt(col: string, value: any) { return this.cmp(col, "gt", value); }
  gte(col: string, value: any) { return this.cmp(col, "gte", value); }
  lt(col: string, value: any) { return this.cmp(col, "lt", value); }
  lte(col: string, value: any) { return this.cmp(col, "lte", value); }
  like(col: string, value: any) { return this.cmp(col, "like", value); }
  ilike(col: string, value: any) { return this.cmp(col, "ilike", value); }

  is(col: string, value: any) {
    this.filters.push({ kind: "is", col, value });
    return this;
  }
  in(col: string, values: any[]) {
    this.filters.push({ kind: "in", col, values });
    return this;
  }
  or(parts: string) {
    this.filters.push({ kind: "or", orParts: parts });
    return this;
  }
  not(col: string, op: string, value: any) {
    if (op === "in") this.filters.push({ kind: "notIn", col, value });
    else if (op === "is") this.filters.push({ kind: "notIs", col, value });
    else this.filters.push({ kind: "cmp", col, op: `not_${op}`, value });
    return this;
  }
  filter(col: string, op: string, value: any) {
    // PostgREST-style textual op. Handle the ones the code uses.
    if (op === "in") {
      // value like "(a,b,c)"
      const vals = String(value).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim());
      this.filters.push({ kind: "in", col, values: vals });
    } else if (op === "is") {
      this.filters.push({ kind: "is", col, value: value === "null" ? null : value });
    } else {
      this.filters.push({ kind: "cmp", col, op, value });
    }
    return this;
  }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({
      col,
      ascending: opts?.ascending !== false,
      nullsFirst: opts?.nullsFirst,
    });
    return this;
  }
  limit(n: number) {
    this.limitN = toNonNegativeInt(n, "limit");
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = toNonNegativeInt(from, "range start");
    this.rangeTo = toNonNegativeInt(to, "range end");
    return this;
  }
  /** Server-only: AND a trusted SQL fragment (`?` placeholders) into WHERE. */
  whereRaw(sql: string, params: any[] = []) {
    this.filters.push({ kind: "raw", sql, params });
    return this;
  }
  /** The parsed select string, for callers that need to inspect embeds. */
  get selectString(): string {
    return this.selectStr;
  }
  get tableName(): string {
    return this.table;
  }
  single() {
    this.singleMode = "single";
    this.returnRows = true;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    this.returnRows = true;
    return this;
  }

  private cmp(col: string, op: Op, value: any) {
    this.filters.push({ kind: "cmp", col, op, value });
    return this;
  }

  // ---- WHERE construction ---------------------------------------------------
  private buildWhere(params: any[]): string {
    const clauses: string[] = [];
    const embedFilters = new Map<string, Filter[]>();
    for (const f of this.filters) {
      if (isEmbedFilter(f)) {
        const alias = f.col!.slice(0, f.col!.indexOf("."));
        embedFilters.set(alias, [...(embedFilters.get(alias) || []), f]);
      }
    }
    if (this.action === "select") {
      clauses.push(...this.innerEmbedClauses(embedFilters, params));
    } else if (embedFilters.size) {
      throw new Error("Embedded filters are only supported on reads");
    }
    for (const f of this.filters) {
      if (isEmbedFilter(f)) continue;
      if (f.kind === "cmp" || f.kind === "in" || f.kind === "notIn" || f.kind === "is" || f.kind === "notIs") {
        clauses.push(this.columnClause(f, f.col!, params));
      } else if (f.kind === "or") {
        clauses.push(this.orClause(f.orParts!, params));
      } else if (f.kind === "raw") {
        // Trusted server-side SQL with `?` placeholders (used by the REST
        // access policy, never by request input).
        let i = 0;
        const sql = f.sql!.replace(/\?/g, () => {
          params.push(f.params![i++]);
          return `$${params.length}`;
        });
        clauses.push(`(${sql})`);
      }
    }
    return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  }

  /**
   * PostgREST `alias!inner(...)` keeps only parent rows that have a matching
   * embedded row, and filters such as `alias.status=eq.paid` decide which
   * embedded rows match. Becomes `EXISTS (...)` on the related table.
   */
  private innerEmbedClauses(embedFilters: Map<string, Filter[]>, params: any[]): string[] {
    const parsed = parseSelect(this.selectStr);
    const out: string[] = [];
    for (const alias of embedFilters.keys()) {
      const e = parsed.embeds.find((x) => x.alias === alias);
      if (!e?.inner) {
        throw new Error(`Filtering on embedded "${alias}" needs ${alias}!inner(...) in the select`);
      }
    }
    for (const e of parsed.embeds) {
      if (!e.inner) continue;
      const conds: string[] = [];
      for (const f of embedFilters.get(e.alias) || []) {
        const col = f.col!.slice(f.col!.indexOf(".") + 1);
        conds.push(this.columnClause(f, col, params, "e"));
      }
      const fwd =
        e.fkColumn ?? (FK_MAP[this.table] || []).find((x) => x.foreignTable === e.table)?.column;
      if (fwd) {
        conds.unshift(`e."id" = ${ident(this.table)}.${ident(fwd)}`);
      } else {
        const rev = (FK_MAP[e.table] || []).find((x) => x.foreignTable === this.table);
        if (!rev) throw new Error(`No relationship between ${this.table} and ${e.table}`);
        conds.unshift(`e.${ident(rev.column)} = ${ident(this.table)}."id"`);
      }
      out.push(`EXISTS (SELECT 1 FROM ${ident(e.table)} e WHERE ${conds.join(" AND ")})`);
    }
    return out;
  }

  /**
   * One filter on one column (cmp, in, not in, is, not is). `tableAlias`
   * qualifies the column when it lives on an `!inner` embedded table.
   */
  private columnClause(f: Filter, col: string, params: any[], tableAlias?: string): string {
    const left = (tableAlias ? `${tableAlias}.` : "") + colExpr(col);
    if (f.kind === "cmp") return this.cmpClause(col, f.op!, f.value, params, tableAlias);
    if (f.kind === "in") {
      if (!f.values || f.values.length === 0) return "false";
      const ph = f.values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${left} IN (${ph.join(",")})`;
    }
    if (f.kind === "notIn") {
      const raw = String(f.value).replace(/^\(|\)$/g, "").trim();
      if (!raw) return "true";
      const ph = raw.split(",").map((v) => {
        params.push(v.trim());
        return `$${params.length}`;
      });
      return `(${left} IS NULL OR ${left} NOT IN (${ph.join(",")}))`;
    }
    if (f.kind === "is") return this.isClause(col, f.value, tableAlias);
    if (f.kind === "notIs") return `NOT (${this.isClause(col, f.value, tableAlias)})`;
    throw new Error(`Unsupported filter on ${col}`);
  }

  private isClause(col: string, value: any, tableAlias?: string): string {
    const left = (tableAlias ? `${tableAlias}.` : "") + colExpr(col);
    if (value === null || value === "null") return `${left} IS NULL`;
    if (value === true || value === "true") return `${left} IS TRUE`;
    if (value === false || value === "false") return `${left} IS FALSE`;
    if (value === "unknown") return `${left} IS UNKNOWN`;
    // PostgREST only accepts null/true/false/unknown here. Never splice the
    // raw value into SQL: it arrives straight from the request query string.
    throw new Error(`Unsupported is value: ${String(value)}`);
  }

  private cmpClause(col: string, op: string, value: any, params: any[], tableAlias?: string): string {
    const negate = op.startsWith("not_");
    const bare = negate ? op.slice(4) : op;
    const sqlOp: Record<string, string> = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
      like: "LIKE",
      ilike: "ILIKE",
    };
    const o = sqlOp[bare];
    if (!o) throw new Error(`Unsupported operator: ${op}`);
    params.push(likePattern(bare, value));
    // Avoid Postgres uuid cast errors for filters like id.eq.ORD-123
    // (PostgREST coerces; we compare as text when the value is not a UUID).
    const left = (tableAlias ? `${tableAlias}.` : "") + uuidSafeLeft(col, value);
    const clause = `${left} ${o} $${params.length}`;
    return negate ? `NOT (${clause})` : clause;
  }

  // parse "col.op.val,col2.op2.val2" (PostgREST or-filter). Supports
  // eq/ilike/like/gt/lt/gte/lte/is/neq, `in.(a,b,c)` lists, and nested
  // `and(...)` / `or(...)` groups, e.g.
  //   status.in.(approved,active),and(status.eq.pending,paid.gt.0)
  private orClause(parts: string, params: any[]): string {
    const segs = splitTopLevel(parts); // commas at top level separate OR terms
    const ors = segs.map((seg) => this.orTerm(seg.trim(), params));
    return `(${ors.join(" OR ")})`;
  }

  private orTerm(seg: string, params: any[]): string {
    // Nested logical group: and(...) / or(...)
    const grp = /^(and|or)\(([\s\S]*)\)$/.exec(seg);
    if (grp) {
      const joiner = grp[1] === "and" ? " AND " : " OR ";
      const inner = splitTopLevel(grp[2]).map((s) => this.orTerm(s.trim(), params));
      return `(${inner.join(joiner)})`;
    }

    const first = seg.indexOf(".");
    const col = seg.slice(0, first).trim();
    const rest = seg.slice(first + 1).trim();

    // in.(a,b,c) list membership
    if (rest.startsWith("in.(") && rest.endsWith(")")) {
      const vals = rest
        .slice(4, -1)
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      if (!vals.length) return "FALSE";
      const placeholders = vals.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${colExpr(col)} IN (${placeholders.join(", ")})`;
    }

    const second = rest.indexOf(".");
    const op = rest.slice(0, second).trim();
    const val = rest.slice(second + 1).trim();
    if (op === "is") {
      return this.isClause(col, val);
    }
    const sqlOp: Record<string, string> = {
      eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE",
    };
    const o = sqlOp[op];
    if (!o) throw new Error(`Unsupported or() operator: ${op}`);
    params.push(likePattern(op, val));
    return `${uuidSafeLeft(col, val)} ${o} $${params.length}`;
  }

  private buildOrderLimit(): string {
    let sql = "";
    if (this.orders.length) {
      const parts = this.orders.map((o) => {
        const dir = o.ascending ? "ASC" : "DESC";
        const nulls =
          o.nullsFirst === undefined
            ? o.ascending
              ? "NULLS LAST"
              : "NULLS FIRST"
            : o.nullsFirst
            ? "NULLS FIRST"
            : "NULLS LAST";
        return `${colExpr(o.col)} ${dir} ${nulls}`;
      });
      sql += ` ORDER BY ${parts.join(", ")}`;
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      const limit = this.rangeTo - this.rangeFrom + 1;
      sql += ` LIMIT ${limit} OFFSET ${this.rangeFrom}`;
    } else if (this.limitN !== null) {
      sql += ` LIMIT ${this.limitN}`;
    }
    return sql;
  }

  // ---- execution ------------------------------------------------------------
  async exec(): Promise<{ data: any; error: any; count: number | null }> {
    if (this.runAs) {
      const role = this.runAs;
      return withRequestRole({ role }, () => this.execDirect()).catch((err: any) => ({
        data: null,
        error: pgError(err),
        count: null,
      }));
    }
    if (this.action !== "select") {
      const actor = await resolveAuditActor(this.auditActor);
      if (actor) {
        return withAuditActor(actor, () => this.execDirect()).catch((err: any) => ({
          data: null,
          error: pgError(err),
          count: null,
        }));
      }
    }
    return this.execDirect();
  }

  private async execDirect(): Promise<{ data: any; error: any; count: number | null }> {
    try {
      const pool = getExecutor();
      let rows: Row[] = [];
      let count: number | null = null;

      if (this.action === "select") {
        const params: any[] = [];
        const where = this.buildWhere(params);
        if (this.wantCount) {
          const cRes = await pool.query(
            `SELECT count(*)::int AS c FROM ${ident(this.table)} ${where}`,
            params
          );
          count = cRes.rows[0]?.c ?? 0;
        }
        if (!this.headOnly) {
          const parsed = parseSelect(this.selectStr);
          const { sql: cols, helpers } = this.topLevelColumns(parsed);
          const orderLimit = this.buildOrderLimit();
          const res = await pool.query(
            `SELECT ${cols} FROM ${ident(this.table)} ${where}${orderLimit}`,
            params
          );
          rows = res.rows;
          await this.resolveEmbeds(rows, parsed);
          // PostgREST returns only the requested columns: drop join-only keys.
          for (const r of rows) for (const h of helpers) delete r[h];
        }
      } else if (this.action === "insert" || this.action === "upsert") {
        rows = await this.execInsert(pool);
      } else if (this.action === "update") {
        rows = await this.execUpdate(pool);
      } else if (this.action === "delete") {
        rows = await this.execDelete(pool);
      }

      // shape single/maybe
      if (this.singleMode === "single") {
        if (rows.length !== 1) {
          return {
            data: null,
            error: {
              message:
                rows.length === 0
                  ? "JSON object requested, multiple (or no) rows returned"
                  : "Results contain more than one row",
              code: rows.length === 0 ? "PGRST116" : "PGRST114",
            },
            count,
          };
        }
        return { data: rows[0], error: null, count };
      }
      if (this.singleMode === "maybe") {
        // PostgREST semantics: >1 row is an error even for maybeSingle().
        if (rows.length > 1) {
          return {
            data: null,
            error: { message: "Results contain more than one row", code: "PGRST116" },
            count,
          };
        }
        return { data: rows[0] ?? null, error: null, count };
      }
      return { data: this.headOnly ? null : rows, error: null, count };
    } catch (err: any) {
      return { data: null, error: pgError(err), count: null };
    }
  }

  /** Columns to fetch at the top level, and the join-only ones to strip afterwards. */
  private topLevelColumns(parsed: ParsedSelect): { sql: string; helpers: string[] } {
    if (parsed.star && parsed.columns.length === 0) return { sql: "*", helpers: [] };
    const cols = new Set<string>();
    const helpers: string[] = [];
    const want = (c: string) => {
      if (cols.has(ident(c))) return;
      cols.add(ident(c));
      if (!parsed.star && !parsed.columns.includes(c)) helpers.push(c);
    };
    if (parsed.star) cols.add("*");
    for (const c of parsed.columns) cols.add(ident(c));
    // ensure fk columns needed for embeds are fetched
    let hasReverse = false;
    for (const e of parsed.embeds) {
      let fk = e.fkColumn;
      if (!fk) {
        const fwd = (FK_MAP[this.table] || []).find((x) => x.foreignTable === e.table);
        if (fwd) fk = fwd.column;
        else hasReverse = true;
      }
      if (fk) want(fk);
    }
    // reverse embeds join on this table's id — only fetch it when needed
    // (some tables, e.g. settings, have no id column)
    if (!parsed.star && hasReverse) want("id");
    return { sql: Array.from(cols).join(", "), helpers };
  }

  /**
   * Attach embedded rows to `rows`, which belong to `table` (the queried
   * table at the top level, the embedded table when recursing).
   */
  private async resolveEmbeds(rows: Row[], parsed: ParsedSelect, table: string = this.table): Promise<void> {
    if (rows.length === 0 || parsed.embeds.length === 0) return;
    const pool = getExecutor();
    for (const embed of parsed.embeds) {
      // If no explicit FK column, decide direction from the FK map: an edge
      // from `table` to the embed table means forward (object); otherwise
      // it's a reverse has-many (array).
      let fk = embed.fkColumn;
      let embedTable = embed.table;
      if (fk) {
        // fk-column form: prefer the owning table's own FK edge to disambiguate
        // (template_id -> sms_templates vs email_templates depends on the table)
        const own = (FK_MAP[table] || []).find((e) => e.column === fk);
        if (own) embedTable = own.foreignTable;
      } else {
        const fwd = (FK_MAP[table] || []).find((e) => e.foreignTable === embed.table);
        if (fwd) fk = fwd.column;
      }
      if (fk) {
        // forward embed: current.fk -> related.id  (object)
        const ids = Array.from(
          new Set(rows.map((r) => r[fk]).filter((v) => v !== null && v !== undefined))
        );
        const wantId = embedWantsId(embed.select);
        const { sql: innerCols, helpers } = this.embedColumns(embed.select, embedTable);
        let related: Row[] = [];
        if (ids.length) {
          const ph = ids.map((_, i) => `$${i + 1}`).join(",");
          const res = await pool.query(
            `SELECT ${innerCols} FROM ${ident(embedTable)} WHERE ${ident("id")} IN (${ph})`,
            ids
          );
          related = res.rows;
        }
        const byId = new Map(related.map((r) => [r.id, r]));
        // resolve nested embeds
        await this.resolveEmbeds(related, embed.select, embedTable);
        // PostgREST only returns requested columns — drop join-only columns
        for (const r of related) {
          for (const h of helpers) delete r[h];
          if (!wantId) delete r.id;
        }
        for (const r of rows) {
          r[embed.alias] = byId.get(r[fk]) ?? null;
        }
      } else {
        // reverse embed (has-many): related.<table>_fk -> current.id (array)
        const edge = this.findReverseEdge(embedTable, table);
        const fkCol = edge?.column ?? `${singularize(table)}_id`;
        const parentIds = Array.from(new Set(rows.map((r) => r.id).filter(Boolean)));
        if (isCountOnly(embed.select)) {
          // PostgREST aggregate embed `table(count)`: [{ count: N }] per parent.
          const counts = new Map<any, number>();
          if (parentIds.length) {
            const ph = parentIds.map((_, i) => `$${i + 1}`).join(",");
            const res = await pool.query(
              `SELECT ${ident(fkCol)} AS k, count(*)::int AS n FROM ${ident(embedTable)} WHERE ${ident(fkCol)} IN (${ph}) GROUP BY 1`,
              parentIds
            );
            for (const r of res.rows) counts.set(r.k, r.n);
          }
          for (const r of rows) r[embed.alias] = [{ count: counts.get(r.id) ?? 0 }];
          continue;
        }
        const wantId = embedWantsId(embed.select);
        const wantFk = embed.select.star || embed.select.columns.includes(fkCol);
        const { sql: innerCols, helpers } = this.embedColumns(embed.select, embedTable, fkCol);
        let related: Row[] = [];
        if (parentIds.length) {
          const ph = parentIds.map((_, i) => `$${i + 1}`).join(",");
          // Prefer stable gallery order only when the embed table actually has
          // a position column. Ordering every `*` reverse-embed by position
          // breaks tables like product_variants (no position) and empties
          // homepage/shop product fetches that embed variants.
          const orderBy =
            embed.select.columns.includes("position") ||
            (embed.select.star && EMBED_TABLES_WITH_POSITION.has(embedTable))
              ? ` ORDER BY ${ident("position")} ASC NULLS LAST`
              : "";
          const res = await pool.query(
            `SELECT ${innerCols} FROM ${ident(embedTable)} WHERE ${ident(fkCol)} IN (${ph})${orderBy}`,
            parentIds
          );
          related = res.rows;
        }
        await this.resolveEmbeds(related, embed.select, embedTable);
        const grouped = new Map<any, Row[]>();
        for (const r of related) {
          const k = r[fkCol];
          if (!grouped.has(k)) grouped.set(k, []);
          for (const h of helpers) if (h !== fkCol) delete r[h];
          if (!wantFk) delete r[fkCol];
          if (!wantId) delete r.id;
          grouped.get(k)!.push(r);
        }
        for (const r of rows) r[embed.alias] = grouped.get(r.id) ?? [];
      }
    }
  }

  /**
   * Columns to fetch from an embedded `table`: the requested ones plus the
   * keys needed to join (id, the parent FK, FKs of nested forward embeds).
   * `helpers` lists the join-only columns to strip from the result.
   */
  private embedColumns(
    parsed: ParsedSelect,
    table: string,
    extraFk?: string
  ): { sql: string; helpers: string[] } {
    if (parsed.star && parsed.columns.length === 0) return { sql: "*", helpers: [] };
    const cols = new Set<string>();
    const helpers: string[] = [];
    const want = (c: string) => {
      if (cols.has(ident(c))) return;
      cols.add(ident(c));
      if (!parsed.star && !parsed.columns.includes(c) && c !== "id") helpers.push(c);
    };
    if (parsed.star) cols.add("*");
    for (const c of parsed.columns) cols.add(ident(c));
    cols.add(ident("id"));
    if (extraFk) want(extraFk);
    for (const e of parsed.embeds) {
      const fk =
        e.fkColumn ?? (FK_MAP[table] || []).find((x) => x.foreignTable === e.table)?.column;
      if (fk) want(fk);
    }
    return { sql: Array.from(cols).join(", "), helpers };
  }

  private findReverseEdge(relatedTable: string, table: string = this.table): FkEdge | undefined {
    return (FK_MAP[relatedTable] || []).find((e) => e.foreignTable === table);
  }

  private async execInsert(pool: Queryable): Promise<Row[]> {
    const rowsIn = Array.isArray(this.payload) ? this.payload : [this.payload!];
    if (rowsIn.length === 0) return [];
    const cols = Array.from(
      rowsIn.reduce<Set<string>>((set, r) => {
        Object.keys(r).forEach((k) => set.add(k));
        return set;
      }, new Set())
    );
    const params: any[] = [];
    const valuesSql = rowsIn
      .map((r) => {
        const ph = cols.map((c) => {
          params.push(normalizeValue(r[c], this.table, c));
          return `$${params.length}`;
        });
        return `(${ph.join(",")})`;
      })
      .join(", ");
    const colSql = cols.map(ident).join(", ");
    let sql = `INSERT INTO ${ident(this.table)} (${colSql}) VALUES ${valuesSql}`;
    if (this.action === "upsert") {
      const conflict = this.onConflictCols?.length
        ? this.onConflictCols.map(ident).join(", ")
        : "id";
      const updates = cols
        .filter((c) => !(this.onConflictCols || ["id"]).includes(c))
        .map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`);
      sql += ` ON CONFLICT (${conflict}) DO ${
        updates.length && !this.ignoreDuplicates ? `UPDATE SET ${updates.join(", ")}` : "NOTHING"
      }`;
    }
    if (this.returnRows) sql += " RETURNING *";
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private async execUpdate(pool: Queryable): Promise<Row[]> {
    const patch = this.payload as Row;
    const params: any[] = [];
    const sets = Object.keys(patch).map((c) => {
      params.push(normalizeValue(patch[c], this.table, c));
      return `${ident(c)} = $${params.length}`;
    });
    const where = this.buildWhere(params);
    let sql = `UPDATE ${ident(this.table)} SET ${sets.join(", ")} ${where}`;
    if (this.returnRows) sql += " RETURNING *";
    const res = await pool.query(sql, params);
    return res.rows;
  }

  private async execDelete(pool: Queryable): Promise<Row[]> {
    const params: any[] = [];
    const where = this.buildWhere(params);
    let sql = `DELETE FROM ${ident(this.table)} ${where}`;
    if (this.returnRows) sql += " RETURNING *";
    const res = await pool.query(sql, params);
    return res.rows;
  }

  // PromiseLike: allow `await builder`
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

/** PostgREST-shaped error body from a node-postgres error. */
export function pgError(err: any): { message: string; code: string | null; details: string | null; hint: string | null } {
  return {
    message: err?.message || String(err),
    code: err?.code ?? null,
    details: err?.detail ?? null,
    hint: err?.hint ?? null,
  };
}

/** PostgREST accepts `*` as the wildcard in like/ilike patterns (URL-safe `%`). */
function likePattern(op: string, value: any): any {
  return (op === "like" || op === "ilike") && typeof value === "string" ? value.replace(/\*/g, "%") : value;
}

/** A filter on a column of an embedded table, e.g. `categories.slug` (not a JSON path). */
function isEmbedFilter(f: Filter): boolean {
  return (
    (f.kind === "cmp" || f.kind === "in" || f.kind === "notIn" || f.kind === "is" || f.kind === "notIs") &&
    !!f.col && f.col.includes(".") && !f.col.includes("->")
  );
}

function isCountOnly(parsed: ParsedSelect): boolean {
  return !parsed.star && parsed.embeds.length === 0 && parsed.columns.length === 1 && parsed.columns[0] === "count";
}

function embedWantsId(parsed: ParsedSelect): boolean {
  return parsed.star || parsed.columns.includes("id");
}

function singularize(table: string): string {
  if (table.endsWith("ies")) return table.slice(0, -3) + "y";
  if (table.endsWith("s")) return table.slice(0, -1);
  return table;
}

// jsonb columns must be passed to pg as JSON text (PostgREST serializes ANY
// JS value — object, array, string, number, bool — as JSON for jsonb columns).
// Native arrays pass through only for genuine Postgres array columns
// (e.g. manual_payments.membership_ids).
function normalizeValue(v: any, table?: string, column?: string): any {
  if (v === undefined || v === null) return null;
  const isJsonbCol = !!(table && column && JSONB_COLUMNS[table]?.has(column));
  if (isJsonbCol) return JSON.stringify(v);
  if (Array.isArray(v)) return v;
  if (typeof v === "object" && !(v instanceof Date)) {
    return JSON.stringify(v);
  }
  return v;
}

interface FunctionShape {
  returnsSet: boolean;
  returnsVoid: boolean;
  jsonArgs: Set<string>;
}

const functionShapes = new Map<string, FunctionShape>();

/** How PostgREST would shape a function's result, and which args are json. */
async function functionShape(fn: string): Promise<FunctionShape> {
  const cached = functionShapes.get(fn);
  if (cached) return cached;
  const res = await getExecutor().query(
    `SELECT p.proretset AS returns_set,
            p.prorettype = 'void'::regtype AS returns_void,
            coalesce(array(
              SELECT n FROM unnest(p.proargnames, coalesce(p.proallargtypes, p.proargtypes::oid[])) AS a(n, t)
              WHERE t IN ('json'::regtype, 'jsonb'::regtype)
            ), '{}') AS json_args
       FROM pg_proc p
      WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace
      LIMIT 1`,
    [fn]
  );
  const row = res.rows[0];
  const shape: FunctionShape = {
    returnsSet: !!row?.returns_set,
    returnsVoid: !!row?.returns_void,
    jsonArgs: new Set<string>(row?.json_args ?? []),
  };
  if (row) functionShapes.set(fn, shape);
  return shape;
}

async function callRpc(
  fn: string,
  args: Record<string, any> = {}
): Promise<{ data: any; error: any }> {
  if (!PG_IDENT.test(fn)) {
    return { data: null, error: { message: `Unsafe function name: ${fn}` } };
  }
  try {
    const shape = await functionShape(fn);
    const keys = Object.keys(args);
    const pool = getExecutor();
    // Named-arg call: fn(a := $1, b := $2)
    const parts: string[] = [];
    const params: any[] = [];
    for (const key of keys) {
      if (!PG_IDENT.test(key)) {
        return { data: null, error: { message: `Unsafe arg name: ${key}` } };
      }
      const v = args[key];
      // node-postgres sends JS arrays as Postgres arrays; a json/jsonb
      // argument needs the JSON text instead (PostgREST passed JSON through).
      params.push(shape.jsonArgs.has(key) && v !== null && v !== undefined ? JSON.stringify(v) : v);
      parts.push(`${ident(key)} := $${params.length}`);
    }
    const call = `public.${ident(fn)}(${parts.join(", ")})`;
    if (shape.returnsSet) {
      // RETURNS TABLE / SETOF: PostgREST answers with an array of rows.
      const res = await pool.query(`SELECT * FROM ${call}`, params);
      return { data: res.rows, error: null };
    }
    const res = await pool.query(`SELECT ${call} AS result`, params);
    return { data: shape.returnsVoid ? null : res.rows[0]?.result ?? null, error: null };
  } catch (e: any) {
    return { data: null, error: pgError(e) };
  }
}

function createAuthApi() {
  // Lazy import so auth stays out of cold paths that only need .from()
  const loadAuth = () => import("./auth");

  const authError = (e: { message: string; code?: string; status?: number } | null | undefined) =>
    e ? { message: e.message, code: e.code ?? null, status: e.status ?? 400, name: "AuthApiError" } : null;

  return {
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const auth = await loadAuth();
      const { session, error } = await auth.signInWithPassword(email, password);
      if (error || !session) {
        return { data: { user: null, session: null }, error: authError(error) ?? { message: "Login failed" } };
      }
      return {
        data: {
          user: session.user,
          session: {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_in: session.expires_in,
            expires_at: session.expires_at,
            token_type: session.token_type,
            user: session.user,
          },
        },
        error: null,
      };
    },
    async signUp({
      email,
      password,
      options,
    }: {
      email: string;
      password: string;
      options?: { data?: Record<string, unknown> };
    }) {
      // Server-side sign-up has no inbox flow; the browser goes through /auth/v1/signup.
      const auth = await loadAuth();
      const { user, error } = await auth.signUpWithPassword({ email, password, data: options?.data });
      if (error) return { data: { user: null, session: null }, error: authError(error) };
      return { data: { user, session: null }, error: null };
    },
    async getUser(jwt?: string) {
      if (!jwt) {
        return { data: { user: null }, error: { message: "No JWT provided" } };
      }
      const auth = await loadAuth();
      const user = await auth.getUserForToken(jwt);
      if (!user) {
        return { data: { user: null }, error: { message: "Invalid JWT", status: 403 } };
      }
      return { data: { user }, error: null };
    },
    admin: {
      async getUserById(id: string) {
        const auth = await loadAuth();
        const user = UUID_RE.test(String(id)) ? await auth.getUserById(id) : null;
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: "User not found", status: 404 } };
      },
      async createUser(attrs: Parameters<Awaited<ReturnType<typeof loadAuth>>["adminCreateUser"]>[0]) {
        const auth = await loadAuth();
        const { user, error } = await auth.adminCreateUser(attrs);
        return { data: { user }, error: authError(error) };
      },
      async updateUserById(id: string, attrs: Parameters<Awaited<ReturnType<typeof loadAuth>>["adminUpdateUserById"]>[1]) {
        const auth = await loadAuth();
        const { user, error } = await auth.adminUpdateUserById(id, attrs);
        return { data: { user }, error: authError(error) };
      },
      async listUsers(opts?: { page?: number; perPage?: number }) {
        const auth = await loadAuth();
        try {
          const { users, total } = await auth.adminListUsers(opts);
          return { data: { users, aud: "authenticated", total }, error: null };
        } catch (e: any) {
          return { data: { users: [] }, error: { message: e.message || String(e) } };
        }
      },
    },
    async getSession() {
      return { data: { session: null }, error: null };
    },
    async signOut() {
      return { error: null };
    },
    async updateUser(_attrs: { password?: string; data?: Record<string, unknown> }) {
      return {
        data: { user: null },
        error: { message: "updateUser requires HTTP auth context; use /auth/v1/user" },
      };
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
  };
}

export interface SupabaseCompatClient {
  from(table: string): QueryBuilder;
  storage: StorageClient;
  auth: ReturnType<typeof createAuthApi>;
  rpc(fn: string, args?: Record<string, any>): Promise<{ data: any; error: any }>;
}

/**
 * `createClient()` is the service-role client: it runs as the database owner
 * and bypasses row-level security. `createClient({ role: "anon" })` runs every
 * query as the anonymous role instead, for server code that used the anon key.
 * `auditActor` names the signed-in staff member behind a service-role write,
 * for the activity log.
 */
export function createClient(opts?: { role?: DbRole; auditActor?: AuditActorResolver }): SupabaseCompatClient {
  const runAs = opts?.role ?? null;
  const auditActor = opts?.auditActor ?? null;
  return {
    from(table: string) {
      if (!PG_IDENT.test(table)) throw new Error(`Unsafe table name: ${table}`);
      return new QueryBuilder(table, runAs, auditActor);
    },
    storage: createStorageClient(),
    auth: createAuthApi(),
    rpc: runAs
      ? (fn, args) =>
          withRequestRole({ role: runAs }, () => callRpc(fn, args)).catch((e) => ({
            data: null,
            error: pgError(e),
          }))
      : async (fn, args) => {
          const actor = await resolveAuditActor(auditActor);
          if (!actor) return callRpc(fn, args);
          return withAuditActor(actor, () => callRpc(fn, args)).catch((e) => ({ data: null, error: pgError(e) }));
        },
  };
}

/** Apply PostgREST query-string filters onto a QueryBuilder (for /rest/v1 shim). */
export function applyPostgrestParams(
  qb: QueryBuilder,
  searchParams: URLSearchParams,
  opts?: { preferSingle?: boolean }
): QueryBuilder {
  for (const [key, raw] of searchParams.entries()) {
    // Nested embed modifiers from supabase-js, e.g.
    //   product_images.order=position.asc
    //   product_images.limit=10
    // Compat resolves embeds without these; skip so they aren't parsed as filters
    // ("Unsupported operator: position").
    if (key.includes(".")) {
      const nested = key.split(".").pop();
      if (nested === "order" || nested === "limit" || nested === "offset") {
        continue;
      }
    }
    if (key === "select") {
      qb.select(raw);
      continue;
    }
    if (key === "order") {
      for (const part of raw.split(",")) {
        const bits = part.trim().split(".");
        const col = bits[0];
        const ascending = bits[1] !== "desc";
        const nullsFirst = bits.includes("nullsfirst");
        qb.order(col, { ascending, nullsFirst });
      }
      continue;
    }
    if (key === "limit") {
      qb.limit(Number(raw));
      continue;
    }
    if (key === "offset") {
      const offset = Number(raw);
      const limit = Number(searchParams.get("limit") || 1000);
      qb.range(offset, offset + limit - 1);
      continue;
    }
    if (key === "or") {
      // PostgREST: or=(a.eq.x,b.eq.y)
      const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
      qb.or(inner);
      continue;
    }
    // column filter: col=op.value  (or col=not.op.value)
    const dot = raw.indexOf(".");
    if (dot === -1) continue;
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    if (op === "not") {
      const d2 = value.indexOf(".");
      if (d2 === -1) throw new Error(`Unsupported filter: ${key}=${raw}`);
      const innerOp = value.slice(0, d2);
      const innerVal = value.slice(d2 + 1);
      if (innerOp === "is") qb.not(key, "is", innerVal === "null" ? null : innerVal);
      else qb.not(key, innerOp, innerOp === "in" ? innerVal : coerce(innerVal));
      continue;
    }
    if (op === "cs" || op === "cd" || op === "ov" || op === "fts" || op === "plfts" || op === "phfts" || op === "wfts") {
      throw new Error(`Unsupported operator: ${op}`);
    }
    if (op === "eq") qb.eq(key, coerce(value));
    else if (op === "neq") qb.neq(key, coerce(value));
    else if (op === "gt") qb.gt(key, coerce(value));
    else if (op === "gte") qb.gte(key, coerce(value));
    else if (op === "lt") qb.lt(key, coerce(value));
    else if (op === "lte") qb.lte(key, coerce(value));
    else if (op === "like") qb.like(key, value);
    else if (op === "ilike") qb.ilike(key, value);
    else if (op === "is") qb.is(key, value === "null" ? null : coerce(value));
    else if (op === "in") {
      const inner = value.replace(/^\(/, "").replace(/\)$/, "");
      const vals = inner.split(",").map((s) => coerce(s.trim()));
      qb.in(key, vals);
    }     else {
      qb.filter(key, op, value);
    }
  }
  if (opts?.preferSingle) qb.single();
  return qb;
}

function coerce(v: string): any {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  // strip optional double-quotes used by PostgREST
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}
