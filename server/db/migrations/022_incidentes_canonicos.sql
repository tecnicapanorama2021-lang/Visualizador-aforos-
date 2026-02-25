-- 022: Tabla canónica "incidentes" (fuente única para obras/eventos/manifestaciones/cierres).
-- Sin TTL automático; estado ACTIVO/PROGRAMADO/FINALIZADO definido por datos.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- A) Tabla incidentes (una sola fuente para todas las capas de incidentes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidentes (
  id                BIGSERIAL PRIMARY KEY,
  tipo              TEXT NOT NULL,
  subtipo           TEXT NULL,
  titulo            TEXT NULL,
  descripcion       TEXT NULL,
  fuente_principal  TEXT NOT NULL DEFAULT 'CANON',
  source_id         TEXT NULL,
  url               TEXT NULL,
  estado            TEXT NOT NULL DEFAULT 'ACTIVO',
  start_at          TIMESTAMPTZ NULL,
  end_at            TIMESTAMPTZ NULL,
  geom              GEOMETRY(GEOMETRY, 4326) NULL,
  geom_kind         TEXT NOT NULL DEFAULT 'POINT',
  radio_m           INTEGER NULL,
  confidence_geo    INTEGER NOT NULL DEFAULT 50,
  confidence_tipo   INTEGER NOT NULL DEFAULT 70,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_confidence_geo CHECK (confidence_geo >= 0 AND confidence_geo <= 100),
  CONSTRAINT chk_confidence_tipo CHECK (confidence_tipo >= 0 AND confidence_tipo <= 100),
  CONSTRAINT chk_estado CHECK (estado IN ('ACTIVO', 'PROGRAMADO', 'FINALIZADO'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_incidentes_fuente_sourceid
  ON incidentes (fuente_principal, source_id) WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incidentes_tipo ON incidentes (tipo);
CREATE INDEX IF NOT EXISTS idx_incidentes_estado ON incidentes (estado);
CREATE INDEX IF NOT EXISTS idx_incidentes_fuente ON incidentes (fuente_principal);
CREATE INDEX IF NOT EXISTS idx_incidentes_start_at ON incidentes (start_at);
CREATE INDEX IF NOT EXISTS idx_incidentes_end_at ON incidentes (end_at);
CREATE INDEX IF NOT EXISTS idx_incidentes_geom ON incidentes USING GIST (geom);

COMMENT ON TABLE incidentes IS 'Fuente única canónica para obras, eventos, manifestaciones, cierres. Sin TTL; estado por datos.';

-- ---------------------------------------------------------------------------
-- B) Auditoría de fuentes (payload original por fuente)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidentes_sources (
  id           BIGSERIAL PRIMARY KEY,
  incidente_id BIGINT NOT NULL REFERENCES incidentes(id) ON DELETE CASCADE,
  fuente       TEXT NOT NULL,
  source_id    TEXT NOT NULL DEFAULT '',
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (incidente_id, fuente, source_id)
);

CREATE INDEX IF NOT EXISTS idx_incidentes_sources_incidente ON incidentes_sources (incidente_id);
CREATE INDEX IF NOT EXISTS idx_incidentes_sources_fuente ON incidentes_sources (fuente);
CREATE INDEX IF NOT EXISTS idx_incidentes_sources_source_id ON incidentes_sources (fuente, source_id);

COMMENT ON TABLE incidentes_sources IS 'Auditoría: payload original de cada fuente por incidente.';
