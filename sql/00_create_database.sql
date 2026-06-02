-- Run this script connected to a maintenance database, for example "postgres".
-- Example:
--   psql -U postgres -f sql/00_create_database.sql
--
-- This file uses psql's \gexec so it can be run more than once safely.

SELECT 'CREATE DATABASE asistia_back WITH ENCODING = ''UTF8'' TEMPLATE = template0'
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = 'asistia_back'
)\gexec
