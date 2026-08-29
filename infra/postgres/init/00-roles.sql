\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'learnspace_migrator') THEN
    CREATE ROLE learnspace_migrator LOGIN PASSWORD 'learnspace_migrator' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'learnspace_app') THEN
    CREATE ROLE learnspace_app LOGIN PASSWORD 'learnspace_app' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'learnspace_ai') THEN
    CREATE ROLE learnspace_ai LOGIN PASSWORD 'learnspace_ai' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'learnspace_worker') THEN
    CREATE ROLE learnspace_worker LOGIN PASSWORD 'learnspace_worker' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'learnspace_runner') THEN
    CREATE ROLE learnspace_runner LOGIN PASSWORD 'learnspace_runner' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'learnspace_readonly') THEN
    CREATE ROLE learnspace_readonly LOGIN PASSWORD 'learnspace_readonly' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER DATABASE learnspace OWNER TO learnspace_migrator;
GRANT CONNECT ON DATABASE learnspace TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

ALTER ROLE learnspace_app SET statement_timeout = '3s';
ALTER ROLE learnspace_app SET lock_timeout = '500ms';
ALTER ROLE learnspace_ai SET statement_timeout = '5s';
ALTER ROLE learnspace_worker SET statement_timeout = '30s';
ALTER ROLE learnspace_runner SET statement_timeout = '10s';
ALTER ROLE learnspace_readonly SET default_transaction_read_only = on;
