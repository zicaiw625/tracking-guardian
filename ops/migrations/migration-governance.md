# Migration Governance

## Rules

1. `prisma/schema.prisma` is the single source of truth.
2. Never edit historical migration SQL that has already been applied.
3. New migrations must be forward-only and safe to re-run where possible.
4. For production fixes, prefer additive/idempotent SQL over destructive changes.
5. Destructive drops/renames require a separate change window and rollback plan.

## Required Pipeline

1. Rehearse on a production clone:
   - `CLONE_DATABASE_URL=... bash scripts/db-rehearse-reconcile.sh`
2. Validate no blocking errors (`P30xx`, `42P01`, `42P07`).
3. Capture before/after migration state artifacts.
4. Execute on production with:
   - `MAINTENANCE_CONFIRMED=true DATABASE_URL=... bash scripts/db-run-prod-reconcile.sh`

## Drift Detection Cadence

- On each release:
  - `pnpm prisma migrate status`
  - `pnpm prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma`
- Any non-approved drift must be reconciled in the next migration.

## Legacy Tables Policy

- Do not hard-drop unknown legacy objects immediately.
- Rename to `__legacy_<date>` first and observe for at least one release cycle.
- Drop only after no reads/writes are observed.
