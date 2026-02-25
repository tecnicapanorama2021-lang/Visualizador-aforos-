-- Metadatos o notas sobre el archivo (descartado, razón, etc.).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'datos_extra'
  ) THEN
    ALTER TABLE archivos_fuente ADD COLUMN datos_extra JSONB NULL;
    COMMENT ON COLUMN archivos_fuente.datos_extra IS 'Metadatos: descartado, razon, descartado_en, etc.';
  END IF;
END $$;
