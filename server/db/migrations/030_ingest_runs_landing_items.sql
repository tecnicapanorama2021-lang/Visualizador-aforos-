-- 030: Observabilidad de jobs (ingest_runs) y landing raw para noticias (landing_items).
-- Idempotente.

-- ---------------------------------------------------------------------------
-- ingest_runs: registro de cada ejecución de job para observabilidad
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingest_runs (
  id                BIGSERIAL PRIMARY KEY,
  job_name          TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ NULL,
  status            TEXT NOT NULL DEFAULT 'running',
  items_in          INTEGER NULL,
  items_upserted    INTEGER NULL,
  errors_count      INTEGER NULL DEFAULT 0,
  error_sample      TEXT NULL,
  meta              JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_ingest_runs_status CHECK (status IN ('running', 'ok', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_job_name ON ingest_runs (job_name);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_started_at ON ingest_runs (started_at DESC);

COMMENT ON TABLE ingest_runs IS 'Registro de ejecuciones de jobs de ingesta (BullMQ u otros) para observabilidad.';

-- ---------------------------------------------------------------------------
-- landing_items: raw por fuente (ej. RSS noticias) antes de normalizar a incidentes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS landing_items (
  id             BIGSERIAL PRIMARY KEY,
  entity_type    TEXT NOT NULL,
  source_system  TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  url            TEXT NULL,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at   TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_landing_items_source UNIQUE (source_system, source_id)
);

CREATE INDEX IF NOT EXISTS idx_landing_items_entity_type ON landing_items (entity_type);
CREATE INDEX IF NOT EXISTS idx_landing_items_processed_at ON landing_items (processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_landing_items_fetched_at ON landing_items (fetched_at DESC);

COMMENT ON TABLE landing_items IS 'Items raw por fuente (RSS, etc.); source_id estable para upsert; processed_at marca cuando se normalizó a incidentes u otra entidad.';
