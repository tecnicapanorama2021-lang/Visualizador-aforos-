-- Campo opcional para rastrear proceso/origen externo (ej. SECOP id_proceso o URL).
-- Ejecutar después de 003 (npm run db:migrate).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'origen_id'
  ) THEN
    ALTER TABLE archivos_fuente ADD COLUMN origen_id TEXT NULL;
    CREATE INDEX IF NOT EXISTS idx_archivos_fuente_origen_id ON archivos_fuente (origen_id) WHERE origen_id IS NOT NULL;
    COMMENT ON COLUMN archivos_fuente.origen_id IS 'Identificador externo (ej. id_proceso SECOP, URL del proceso) para rastrear procedencia.';
  END IF;
END $$;
