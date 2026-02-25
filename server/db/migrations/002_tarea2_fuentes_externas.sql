-- Tarea 2: Fuentes externas (estudios de tránsito PDF/Excel/CSV).
-- Reutiliza nodos, estudios, conteos_resumen. Añade registro de archivos y opcionalmente vincula estudios a archivo.
-- Ejecutar después de 001_init.sql (o con npm run db:migrate que aplica todas las migraciones).

-- ---------------------------------------------------------------------------
-- archivos_fuente: registro de archivos subidos o procesados (PDF, XLSX, CSV)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS archivos_fuente (
  id             SERIAL PRIMARY KEY,
  tipo           TEXT NOT NULL,                    -- 'PDF', 'XLSX', 'CSV', 'JSON'
  origen         TEXT NOT NULL DEFAULT 'privado',  -- 'SDM', 'SECOP', 'privado', etc.
  nombre_archivo TEXT NOT NULL,                    -- nombre o ruta relativa del archivo
  hash           TEXT NULL,                        -- hash del contenido para evitar duplicados/reprocesar
  procesado      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archivos_fuente_procesado ON archivos_fuente (procesado);
CREATE INDEX IF NOT EXISTS idx_archivos_fuente_hash ON archivos_fuente (hash) WHERE hash IS NOT NULL;

COMMENT ON TABLE archivos_fuente IS 'Registro de archivos de estudios externos (PDF, Excel, CSV) para ingesta; procesado indica si ya se cargaron nodos/estudios/conteos.';

-- ---------------------------------------------------------------------------
-- estudios: vincular estudios externos al archivo que los generó (opcional)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'estudios' AND column_name = 'archivo_fuente_id'
  ) THEN
    ALTER TABLE estudios ADD COLUMN archivo_fuente_id INTEGER NULL REFERENCES archivos_fuente(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_estudios_archivo_fuente ON estudios (archivo_fuente_id) WHERE archivo_fuente_id IS NOT NULL;
    COMMENT ON COLUMN estudios.archivo_fuente_id IS 'Si el estudio viene de una fuente externa, referencia a archivos_fuente. NULL para estudios DIM.';
  END IF;
END $$;

-- estudios.fuente ya existe (DIM | EXTERNO): no se modifica.
