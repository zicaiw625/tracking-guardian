DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ReportShareLink_scope_target_check'
      AND table_name = 'ReportShareLink'
  ) THEN
    ALTER TABLE "ReportShareLink"
      DROP CONSTRAINT "ReportShareLink_scope_target_check";
  END IF;
END $$;

ALTER TABLE "ReportShareLink"
  ADD CONSTRAINT "ReportShareLink_scope_target_check"
  CHECK (
    (
      scope = 'verification_report'
      AND "runId" IS NOT NULL
      AND "scanReportId" IS NULL
    )
    OR
    (
      scope = 'scan_report'
      AND "scanReportId" IS NOT NULL
      AND "runId" IS NULL
    )
  );
