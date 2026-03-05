-- Enable database-level read-only mode for maintenance windows.
-- Requires owner privileges on the target database.
ALTER DATABASE tracking_guardian SET default_transaction_read_only = on;

-- Optional: terminate active write sessions so the change takes effect faster.
-- Uncomment if needed and you are sure this is a controlled maintenance window.
-- SELECT pg_terminate_backend(pid)
-- FROM pg_stat_activity
-- WHERE datname = 'tracking_guardian'
--   AND pid <> pg_backend_pid();
