CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO learnspace_migrator, learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;
GRANT USAGE ON TYPE public.vector TO learnspace_migrator, learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly;

DO $$
DECLARE
  vector_function record;
BEGIN
  FOR vector_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_depend AS d
      ON d.classid = 'pg_proc'::regclass
     AND d.objid = p.oid
     AND d.refclassid = 'pg_extension'::regclass
    JOIN pg_extension AS e ON e.oid = d.refobjid
    WHERE e.extname = 'vector'
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_runner, learnspace_readonly',
      vector_function.signature
    );
  END LOOP;
END;
$$;
