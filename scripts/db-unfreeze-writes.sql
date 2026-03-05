-- Disable database-level read-only mode after maintenance.
ALTER DATABASE tracking_guardian SET default_transaction_read_only = off;
