#!/usr/bin/env bash
# Fetch a short-lived Supabase database login (the same one `supabase db dump`
# uses) and store it on big-vps for sync_from_supabase.sh.
#
# Runs on the operator's machine, which holds the Supabase access token at
# ~/.config/supabase/crytoatm-access-token. The login expires after a few
# minutes, so run this right before each sync.
set -euo pipefail

REF=tllsgclvhponhtgafjxt
TOKEN=$(cat ~/.config/supabase/crytoatm-access-token)
RESP=$(curl -fsS -X POST "https://api.supabase.com/v1/projects/$REF/cli/login-role" \
  -H "Authorization: Bearer $TOKEN" -H "User-Agent: ddz-migration/1.0" \
  -H "Content-Type: application/json" -d '{"read_only":false}')
ROLE=$(printf '%s' "$RESP" | jq -r .role)
PW=$(printf '%s' "$RESP" | jq -r .password)
[ -n "$ROLE" ] && [ "$ROLE" != null ] || { echo "no login role returned"; exit 1; }

ssh big-vps "mkdir -p /root/ddz-migration && chmod 700 /root/ddz-migration && cd /root/ddz-migration && umask 077 \
  && printf 'PGHOST=aws-1-eu-west-1.pooler.supabase.com\nPGPORT=5432\nPGUSER=%s.$REF\nPGDATABASE=postgres\nPGSSLMODE=require\n' '$ROLE' > supa.env \
  && cat > .supabase-db-pw" <<<"$PW"
ssh big-vps "cd /root/ddz-migration && truncate -s -1 .supabase-db-pw"
echo "login stored on big-vps ($ROLE, $(printf '%s' "$RESP" | jq -r .ttl_seconds)s)"
