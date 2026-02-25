-- URL remota del archivo (para anexos descubiertos por scraper sin descarga previa).
-- Ejecutar con: npm run db:migrate

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'url_remota'
  ) THEN
    ALTER TABLE archivos_fuente ADD COLUMN url_remota TEXT NULL;
    CREATE INDEX IF NOT EXISTS idx_archivos_fuente_url_remota ON archivos_fuente (url_remota) WHERE url_remota IS NOT NULL;
    COMMENT ON COLUMN archivos_fuente.url_remota IS 'URL desde la que se descubrió o descargó el archivo (scraper SDM/SDP, SECOP, etc.).';
  END IF;
END $$;
