# DB Reconcile Runbook (2026-03)

## Scope

- Source of truth: `prisma/schema.prisma`
- Target migration: `20260306120000_reconcile_prod_schema_202603`
- Goal: reconcile additive drift safely without destructive drops.

## Maintenance Window Checklist

1. Confirm maintenance window and stakeholders.
2. Pause write-heavy jobs (webhook consumers, async workers).
3. Keep app readable if possible, but stop write traffic.
4. Confirm `DATABASE_URL` points to intended environment.

## Preflight

```bash
export DATABASE_URL='postgresql://...'
bash scripts/db-preflight-check.sh
```

## Backup and State Snapshot

```bash
bash scripts/db-export-migration-state.sh
bash scripts/db-backup.sh
```

Optional DB-level readonly mode:

```bash
psql "$DATABASE_URL" -f scripts/db-freeze-writes.sql
```

## Execute Reconcile

```bash
pnpm db:deploy
```

## Post-check

```bash
bash scripts/db-preflight-check.sh
bash scripts/e2e-test.sh --quick
```

App-level smoke path:

- Billing upgrade flow
- Webhook ingestion flow
- Audit log write path

## Rollback

If any critical check fails:

1. Keep writes paused.
2. Restore from latest dump:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" ops/migrations/backups/<file>.dump
```

3. Re-run `bash scripts/db-preflight-check.sh`.
4. Resume traffic only after checks pass.

## Re-enable Writes

```bash
psql "$DATABASE_URL" -f scripts/db-unfreeze-writes.sql
```
