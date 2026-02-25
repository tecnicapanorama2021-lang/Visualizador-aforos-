-- 023: Normalizar incidentes_sources si existe con source_id NULL (022 antigua).
-- Idempotente: solo altera cuando source_id es nullable.
DO $$
DECLARE
  cname text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'incidentes_sources' AND column_name = 'source_id' AND is_nullable = 'YES'
  ) THEN
    DROP INDEX IF EXISTS uq_incidentes_sources_incidente_fuente_source;
    ALTER TABLE incidentes_sources ALTER COLUMN source_id SET DEFAULT '';
    UPDATE incidentes_sources SET source_id = '' WHERE source_id IS NULL;
    ALTER TABLE incidentes_sources ALTER COLUMN source_id SET NOT NULL;
    FOR cname IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.incidentes_sources'::regclass AND contype = 'u'
    LOOP
      EXECUTE format('ALTER TABLE incidentes_sources DROP CONSTRAINT IF EXISTS %I', cname);
    END LOOP;
    ALTER TABLE incidentes_sources ADD CONSTRAINT uq_incidentes_sources_inc_fuente_src UNIQUE (incidente_id, fuente, source_id);
  END IF;
END $$;
