-- Run this script connected to asistia_back when migrating an existing DB.
-- The daemon now reads these values from .env as global config:
--   DAEMON_MAX_EMAILS (applies per company in each cycle)
--   DAEMON_INTERVAL_SECONDS

ALTER TABLE companies
  DROP COLUMN IF EXISTS daemon_max_emails,
  DROP COLUMN IF EXISTS daemon_interval_seconds;
