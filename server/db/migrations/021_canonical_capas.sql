-- 021: Tablas canónicas para capas (fuente única en BD). Geometría propia (estilo Waze).
-- No dependen de nodos.id para georreferenciar; tienen geom propia.

-- ---------------------------------------------------------------------------
-- A) Obras canónicas (fuente: calendario JSON + contexto_eventos tipo OBRA)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obras_canonica (
  id                SERIAL PRIMARY KEY,
  source_system      TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  titulo             TEXT NULL,
  descripcion        TEXT NULL,
  estado             TEXT NULL,
  entidad            TEXT NULL,
  fecha_ini          DATE NULL,
  fecha_fin          DATE NULL,
  fuente             TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  geom               GEOMETRY(Point, 4326),
  CONSTRAINT uq_obras_canonica_source UNIQUE (source_system, source_id)
);
CREATE INDEX IF NOT EXISTS idx_obras_canonica_geom ON obras_canonica USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_obras_canonica_estado ON obras_canonica (estado);
CREATE INDEX IF NOT EXISTS idx_obras_canonica_fechas ON obras_canonica (fecha_ini, fecha_fin);

-- ---------------------------------------------------------------------------
-- B) Eventos canónicos (fuente: contexto_eventos tipo EVENTO_CULTURAL, MANIFESTACION, CIERRE_VIA; eventos_urbanos CONCIERTO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos_canonica (
  id                SERIAL PRIMARY KEY,
  source_system      TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  tipo_evento        TEXT NOT NULL,
  titulo             TEXT NULL,
  descripcion        TEXT NULL,
  fecha_ini          TIMESTAMPTZ NULL,
  fecha_fin          TIMESTAMPTZ NULL,
  url                TEXT NULL,
  fuente             TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  geom               GEOMETRY(Geometry, 4326),
  CONSTRAINT uq_eventos_canonica_source UNIQUE (source_system, source_id)
);
CREATE INDEX IF NOT EXISTS idx_eventos_canonica_geom ON eventos_canonica USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_eventos_canonica_tipo ON eventos_canonica (tipo_evento);
CREATE INDEX IF NOT EXISTS idx_eventos_canonica_fechas ON eventos_canonica (fecha_ini, fecha_fin);

-- ---------------------------------------------------------------------------
-- C) Semáforos: preparar para ingesta futura (alterar tabla 020)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'semaforos' AND column_name = 'source_system') THEN
    ALTER TABLE semaforos ADD COLUMN source_system TEXT NULL;
    ALTER TABLE semaforos ADD COLUMN source_id TEXT NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_semaforos_source ON semaforos (source_system, source_id) WHERE source_system IS NOT NULL AND source_id IS NOT NULL;

COMMENT ON TABLE obras_canonica IS 'Obras con geometría propia; fuente única para capa OBRAS. Ingesta desde calendario_obras_eventos.json y contexto_eventos (tipo OBRA).';
COMMENT ON TABLE eventos_canonica IS 'Eventos con geometría propia; fuente única para capas EVENTOS/MANIFESTACIONES/CONCIERTOS/CIERRE. Ingesta desde contexto_eventos y eventos_urbanos.';
