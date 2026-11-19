#!/usr/bin/env bash
# Pull a fresh copy of the live Supabase project onto big-vps.
#
#   1. per-table row count + checksum of the source, taken just before the dump
#   2. pg_dump (v17) of the public, auth and storage schemas
#   3. the grants Supabase gives anon / authenticated, as SQL for this store's
#      own roles (restore_to_fleet.sh replays them)
#   4. mirror every Storage object to STORAGE_DIR/<bucket>/<name> with a
#      .meta.json content-type sidecar (skips files already mirrored at the
#      same size, so a second run only fetches what changed)
#
# Runs on big-vps from /root/ddz-migration. Run supabase_login.sh on the
# operator machine first: it stores a short-lived login in supa.env and
# .supabase-db-pw (chmod 600). Usage: ./sync_from_supabase.sh <tag>
set -euo pipefail

cd /root/ddz-migration
TAG="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
DUMP_DIR=/root/ddz-migration/dumps
STORAGE_DIR=/data/coolify/departmentstore/storage
PROJECT_URL=https://tllsgclvhponhtgafjxt.supabase.co
ANON=departmentstore_anon
AUTHN=departmentstore_authenticated
mkdir -p "$DUMP_DIR" "$STORAGE_DIR"

# The temporary CLI login is a member of postgres; act as postgres so the
# auth and storage schemas are readable.
PG() { docker run --rm -i --env-file supa.env -e PGPASSWORD="$(cat .supabase-db-pw)" -e PGTZ=UTC \
  -v "$DUMP_DIR:/dumps" postgres:17 "$@"; }
# psql as postgres (the pooler drops startup options, so switch explicitly).
PSQ() { PG psql -qAtX -v ON_ERROR_STOP=1 -c "set role postgres" "$@"; }

CHECK_SQL="select string_agg(format('select %L as t, count(*) as n, md5(coalesce(string_agg(md5(x::text), %L order by md5(x::text) collate \"C\"), %L)) as h from %I.%I x', schemaname||'.'||tablename, '', '', schemaname, tablename), ' union all ') || ' order by 1;' from pg_tables where schemaname in ('public','auth','storage')"

echo "== source checksums before dump ($TAG)"
PSQ -c "$CHECK_SQL" | PSQ -F $'\t' -f - > "$DUMP_DIR/ddz_${TAG}.source_before.tsv"
wc -l < "$DUMP_DIR/ddz_${TAG}.source_before.tsv"

echo "== dumping database"
PG pg_dump -Fc --no-owner --no-privileges --role=postgres -n public -n auth -n storage -f "/dumps/ddz_${TAG}.dump"
date -u +%Y-%m-%dT%H:%M:%SZ > "$DUMP_DIR/ddz_${TAG}.dumped_at"
ls -la "$DUMP_DIR/ddz_${TAG}.dump"

echo "== source checksums after dump"
# A table identical before and after was static for the whole dump, so the
# restore must match it exactly. With the store in maintenance mode (final
# cutover) every table is static.
PSQ -c "$CHECK_SQL" | PSQ -F $'\t' -f - > "$DUMP_DIR/ddz_${TAG}.source_after.tsv"
changed=$(diff <(cut -f1,2,3 "$DUMP_DIR/ddz_${TAG}.source_before.tsv") <(cut -f1,2,3 "$DUMP_DIR/ddz_${TAG}.source_after.tsv") | grep -c '^>' || true)
echo "tables written to on Supabase during the dump: $changed"

echo "== source grants for anon / authenticated"
PSQ -f - <<SQL > "$DUMP_DIR/ddz_${TAG}.grants.sql"
-- tables
select format('GRANT %s ON public.%I TO %s;', string_agg(privilege_type, ', '), table_name,
              case grantee when 'anon' then '$ANON' else '$AUTHN' end)
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
group by grantee, table_name order by table_name, grantee;
-- sequences
select format('GRANT %s ON SEQUENCE public.%I TO %s;',
              concat_ws(', ', case when has_sequence_privilege(r.rolname, c.oid, 'USAGE') then 'USAGE' end,
                              case when has_sequence_privilege(r.rolname, c.oid, 'SELECT') then 'SELECT' end,
                              case when has_sequence_privilege(r.rolname, c.oid, 'UPDATE') then 'UPDATE' end),
              c.relname, case r.rolname when 'anon' then '$ANON' else '$AUTHN' end)
from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join pg_roles r
where n.nspname = 'public' and c.relkind = 'S' and r.rolname in ('anon','authenticated')
  and (has_sequence_privilege(r.rolname, c.oid, 'USAGE') or has_sequence_privilege(r.rolname, c.oid, 'SELECT'));
-- functions (only those granted directly or through PUBLIC)
select format('GRANT EXECUTE ON FUNCTION %s TO %s;', p.oid::regprocedure,
              case r.rolname when 'anon' then '$ANON' else '$AUTHN' end)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join pg_roles r
where n.nspname = 'public' and p.prokind = 'f' and r.rolname in ('anon','authenticated')
  and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
order by 1;
SQL
wc -l < "$DUMP_DIR/ddz_${TAG}.grants.sql"

echo "== mirroring storage"
PSQ -F $'\t' -c "
  select bucket_id, name, coalesce(metadata->>'mimetype','application/octet-stream'), coalesce(metadata->>'size','-1')
  from storage.objects where name not like '%.emptyFolderPlaceholder' order by 1,2" > "$DUMP_DIR/objects_${TAG}.tsv"
wc -l < "$DUMP_DIR/objects_${TAG}.tsv"

fetch_one() {
  local bucket="$1" name="$2" mime="$3" size="$4"
  local dest="$STORAGE_DIR/$bucket/$name"
  if [ -f "$dest" ] && [ "$size" != "-1" ] && [ "$(stat -c %s "$dest")" = "$size" ]; then
    [ -f "$dest.meta.json" ] || printf '{"contentType":"%s"}' "$mime" > "$dest.meta.json"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  local enc
  enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$name")
  if curl -fsS --retry 6 --retry-delay 5 --retry-all-errors -o "$dest.part" "$PROJECT_URL/storage/v1/object/public/$bucket/$enc"; then
    mv "$dest.part" "$dest"
    printf '{"contentType":"%s"}' "$mime" > "$dest.meta.json"
  else
    echo "FAILED $bucket/$name" >&2
    rm -f "$dest.part"
    return 1
  fi
}
export -f fetch_one
export STORAGE_DIR PROJECT_URL
fails=0
while IFS=$'\t' read -r b n m s; do printf '%s\0%s\0%s\0%s\0' "$b" "$n" "$m" "$s"; done < "$DUMP_DIR/objects_${TAG}.tsv" \
  | xargs -0 -n4 -P 6 bash -c 'fetch_one "$@"' _ || fails=1
chown -R 1001:1001 "$STORAGE_DIR"

# Every object Supabase lists must be on disk at its recorded size.
missing=0
while IFS=$'\t' read -r b n m s; do
  f="$STORAGE_DIR/$b/$n"
  if [ ! -f "$f" ] || { [ "$s" != "-1" ] && [ "$(stat -c %s "$f")" != "$s" ]; }; then
    echo "MISSING OR WRONG SIZE $b/$n" >&2; missing=$((missing+1))
  fi
done < "$DUMP_DIR/objects_${TAG}.tsv"
echo "storage objects listed: $(wc -l < "$DUMP_DIR/objects_${TAG}.tsv"), missing/wrong size on disk: $missing, size: $(du -sh "$STORAGE_DIR" | cut -f1)"
[ "$fails" = 0 ] && [ "$missing" = 0 ] && echo "SYNC OK $TAG" || { echo "SYNC HAD FAILURES $TAG"; exit 1; }
