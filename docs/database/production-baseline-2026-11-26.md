# Production database baseline (read-only snapshot)

- Snapshot date: 2026-11-26
- Supabase project: `zemrafvmhfxqdeqauejt`
- Purpose: document the observed production schema before introducing the cat-game schema.
- This is an observed-state inventory, **not** a reconstruction of historical migration SQL and **not** a migration to apply.
- No production DDL or data was changed to create this report.

## Migration history observed

The production migration ledger contains these nine entries:

| Version | Name | Source SQL in repository at snapshot |
|---|---|---|
| 20261124193648 | add_authoritative_work_session_sync | Not recovered |
| 20261124193805 | guard_against_stale_work_session_heartbeats | Not recovered |
| 20261124202902 | feedback_admin_password_exactly_8_digits | Not recovered |
| 20261124202942 | restore_postgrest_pre_request_hook_permissions | Not recovered |
| 20261124203406 | allow_api_roles_to_execute_pre_request_hook | Not recovered |
| 20261124211338 | optimize_user_record_rls_initplan | Not recovered |
| 20261125170033 | admin_record_entry_grants | Present |
| 20261125173100 | admin_record_daily_wage_limit_10000 | Present |
| 20261125173154 | records_daily_wage_ceiling_10000 | Present |

The first six SQL files were not found in the repository commit history/search during this audit. Their original contents must not be guessed from migration names. Do not edit the production migration ledger to make it appear that missing source files were recovered.

## Observed application tables

All eight observed application tables in `public` had Row Level Security enabled at snapshot time.

| Table | Columns (name and type) | RLS policies | Indexes | Constraints (PK / FK / UNIQUE / CHECK) |
|---|---|---:|---:|---|
| `feedback` | id bigint, created_at timestamptz, name text, content text, page text, hidden_at timestamptz, hidden_by uuid | 2 | 3 | 1 / 0 / 0 / 2 |
| `record_dels` | user_id uuid, id text, deleted_at bigint | 1 | 1 | 1 / 0 / 0 / 0 |
| `records` | user_id uuid, id text, date date, start_time text, end_time text, work text, paid text, unpaid text, duration text, wage numeric, hours numeric, pay numeric, started bigint, updated_at timestamptz | 1 | 1 | 1 / 0 / 0 / 1 |
| `work_sessions` | user_id uuid, session_id text, started_at bigint, status text, payload jsonb, updated_at timestamptz | 1 | 1 | 1 / 1 / 0 / 2 |

Four additional tables were observed in the non-exposed `private` schema. Their internal column names and contents are intentionally omitted from this repository-facing report.

## Security observations and follow-up

- RLS was enabled on every observed application table in `public`.
- SQL grants and RLS policies are separate controls. Some public tables have broad role-level table grants, so the effective access model must be evaluated together with each table's policies; do not infer row access from grants alone.
- Several privileged application functions are implemented in `private` with `SECURITY DEFINER` and an empty `search_path`. Their function bodies and per-function authorization checks require continued review.
- `public.stats_public()` is a public aggregate-statistics endpoint implemented as `SECURITY DEFINER`; its observed return shape is aggregate user, record, and feedback counts. Keep its output aggregate-only.
- `public.sync_work_session(...)` is a `SECURITY DEFINER` endpoint used by the existing timer synchronization flow. It requires a focused review of input validation, ownership checks, session state transitions, stale-heartbeat handling, and concurrency. Do not revoke its existing execute permission or change its implementation as part of the game rollout without regression tests.
- Supabase security advisors also reported that leaked-password protection is disabled. This is an Auth project setting, not a schema migration.

## Cat-game rollout gate

The cat-game migration is still a development artifact. Before applying it to production:

1. Resolve the six missing historical migration sources or approve a separately documented baseline/repair strategy that preserves the production ledger without fabricating history.
2. Complete the `sync_work_session` and existing privileged-function reviews.
3. Validate the game migration against a disposable database with the same relevant extensions, schemas, roles, and grants.
4. Run Supabase security advisors and application regression tests after any approved schema change.
5. Keep game writes server-authoritative, transactional, ownership-scoped, and idempotent. Do not trust client-supplied balances, combat outcomes, work rewards, or timer payloads.

## Scope and limitations

This snapshot records schema metadata and selected security configuration only. It contains no user records, credentials, password hashes, session tokens, API keys, or row contents. It is not a complete SQL dump, a proof of exploitability, or a certification that the existing application is secure.
