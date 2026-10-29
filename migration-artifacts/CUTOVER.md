# Discount Discovery Zone: Supabase → plain Postgres cutover

The live site (`discountdiscoveryzone.com`, Coolify app `departmentstore-app`,
uuid `xhn9jas2bx1imhb49pidzs6f`, branch `main`) already runs on big-vps but
still reads hosted Supabase (`tllsgclvhponhtgafjxt`). This branch
(`staging/plain-postgres`) serves the data API from the app itself, backed by
`store_departmentstore` on `fleet-postgres`.

Staging: <https://departmentstore-staging.169-58-8-203.sslip.io>
(Coolify app `departmentstore-staging`, uuid `sirt1spj9nggfyjwvvxgb5e1`).

## What staging shares with the future production setup

Staging points at the **same** database name (`store_departmentstore`) and the
same image folder (`/data/coolify/departmentstore/storage`) that production
will use. Test writes made on staging live there until step 3 below replaces
the database with a fresh copy. Step 2 moves staging off both before the swap.

## Cutover steps

1. **Freeze writes on the live site.** Turn Maintenance Mode on in the live
   dashboard, and ask staff to stop using POS and the dashboard until the end.
   Storefront writes stop; Supabase auth tables may still tick (sessions),
   which the parity report shows as live writes.

2. **Move staging off the production database and images.** Stop the
   `departmentstore-staging` app in Coolify so nothing writes to
   `store_departmentstore`. Later, if staging is still wanted, restore a
   separate copy (e.g. `store_departmentstore_stg`) with its own image folder
   and point staging's `DATABASE_URL` and volume there.

3. **Fresh copy from Supabase, verified.** From the operator machine:
   ```bash
   cd migration-artifacts && ./supabase_login.sh
   ssh big-vps 'cd /root/ddz-migration && ./sync_from_supabase.sh final \
     && ./restore_to_fleet.sh final store_departmentstore_new https://www.discountdiscoveryzone.com'
   ```
   Required: `PARITY OK` (every table identical to Supabase, rows and
   checksum), `superuser-owned objects: 0`, `public tables WITHOUT row level
   security: none`, `SYNC OK` with 0 missing storage files. Any `MISMATCH`
   stops the cutover.

4. **Swap the databases** (staging is stopped, so nothing is connected):
   ```sql
   ALTER DATABASE store_departmentstore RENAME TO store_departmentstore_staging_<date>;
   ALTER DATABASE store_departmentstore_new RENAME TO store_departmentstore;
   ```
   Note: the staging QA accounts (`qa-admin@ddz-staging.test`,
   `qa-staff@ddz-staging.test`, `wepedam+ddzqa@gmail.com`) and test orders exist
   only in the staging copy and do not carry over.

5. **Production app settings** (`departmentstore-app`), all buildtime + runtime:
   - add `DATABASE_URL=postgresql://store_departmentstore:<pw>@fleet-postgres:5432/store_departmentstore`
     (password: `~/.config/coolify-vps/departmentstore-pg-pw`)
   - add `DB_ANON_ROLE=departmentstore_anon`, `DB_AUTHENTICATED_ROLE=departmentstore_authenticated`
   - add `AUTH_JWT_SECRET` and `STORAGE_SIGNING_SECRET`: a **new** production
     secret (`openssl rand -hex 32` → `~/.config/coolify-vps/departmentstore-jwt`),
     not the staging one
   - add `STORAGE_ROOT=/app/storage`, `STORAGE_PUBLIC_URL=https://www.discountdiscoveryzone.com`
   - keep `NEXT_PUBLIC_APP_URL=https://www.discountdiscoveryzone.com` and all
     payment / Postal / Taysend keys as they are
   - **do not** set `NOTIFY_ALLOWLIST` (it would stop customer emails and SMS)
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` are no longer read; leave them or delete them
   - add the volume: host `/data/coolify/departmentstore/storage` → `/app/storage`

6. **Ship the code:** merge `staging/plain-postgres` into `main`, push, and
   deploy `departmentstore-app` from Coolify.

7. **Verify on the live domain** before turning maintenance off:
   `node ~/Documents/Websites/Migration/scripts/diagnose-site.mjs --base https://www.discountdiscoveryzone.com --supabase-url https://www.discountdiscoveryzone.com --anon-key x`
   must PASS; admin login with a real staff password; one product page with
   images; `/api/payment/hubtel` returns a pay.hubtel.com link for a test order.

8. **Turn Maintenance Mode off.** Everyone signs in once more (sessions signed
   by Supabase are not valid on the new auth). Keep the Supabase project as
   the rollback copy; do not delete it.

## Rollback

Redeploy `departmentstore-app` from commit `598bbcd` (the last Supabase build)
with its old settings. Supabase still holds everything up to step 1; orders
taken after cutover exist only in `store_departmentstore` and would need to
be copied back by hand.
