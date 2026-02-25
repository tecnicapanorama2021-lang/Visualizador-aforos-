-- Tarea 1: Esquema inicial PostgreSQL + PostGIS
-- Nodos, estudios y conteos_resumen para aforos DIM.
-- Ejecutar con: psql $DATABASE_URL -f server/db/migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- nodos: puntos de medición (intersecciones, sensores, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodos (
  id                SERIAL PRIMARY KEY,
  internal_id_dim   INTEGER NULL,
  node_id_externo   TEXT NOT NULL,
  nombre            TEXT,
  direccion         TEXT,
  geom              GEOMETRY(Point, 4326),
  fuente            TEXT NOT NULL DEFAULT 'DIM',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_nodos_node_id_externo UNIQUE (node_id_externo)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nodos_internal_id_dim ON nodos (internal_id_dim) WHERE internal_id_dim IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nodos_geom ON nodos USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_nodos_fuente ON nodos (fuente);

COMMENT ON TABLE nodos IS 'Puntos de medición (nodos); node_id_externo es la clave usada por el API (ej. 171, 136).';

-- ---------------------------------------------------------------------------
-- estudios: cada estudio de aforo asociado a un nodo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estudios (
  id             SERIAL PRIMARY KEY,
  nodo_id        INTEGER NOT NULL REFERENCES nodos(id) ON DELETE RESTRICT,
  file_id_dim    TEXT NULL,
  tipo_estudio   TEXT NOT NULL,
  fecha_inicio   TIMESTAMPTZ NOT NULL,
  fecha_fin      TIMESTAMPTZ NULL,
  download_url   TEXT,
  contratista    TEXT,
  total_records  INTEGER NULL,
  vehicle_types  TEXT[] NULL,
  fuente         TEXT NOT NULL DEFAULT 'DIM',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_estudios_nodo_file UNIQUE (nodo_id, file_id_dim)
);

CREATE INDEX IF NOT EXISTS idx_estudios_nodo_fecha ON estudios (nodo_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_estudios_file_id_dim ON estudios (file_id_dim) WHERE file_id_dim IS NOT NULL;

COMMENT ON TABLE estudios IS 'Estudios de aforo por nodo; file_id_dim es el ID del archivo en DIM.';

-- ---------------------------------------------------------------------------
-- conteos_resumen: resumen por sentido/intervalo (lo que hoy está en ia_historial)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conteos_resumen (
  id           SERIAL PRIMARY KEY,
  estudio_id   INTEGER NOT NULL REFERENCES estudios(id) ON DELETE CASCADE,
  sentido      TEXT NOT NULL,
  intervalo_ini TIMESTAMPTZ NOT NULL,
  intervalo_fin TIMESTAMPTZ NOT NULL,
  vol_total    INTEGER NOT NULL DEFAULT 0,
  vol_autos    INTEGER NULL DEFAULT 0,
  vol_motos    INTEGER NULL DEFAULT 0,
  vol_buses    INTEGER NULL DEFAULT 0,
  vol_pesados  INTEGER NULL DEFAULT 0,
  vol_bicis    INTEGER NULL DEFAULT 0,
  vol_otros    INTEGER NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_conteos_estudio_sentido_ini UNIQUE (estudio_id, sentido, intervalo_ini)
);

CREATE INDEX IF NOT EXISTS idx_conteos_estudio_intervalo ON conteos_resumen (estudio_id, intervalo_ini);

COMMENT ON TABLE conteos_resumen IS 'Resumen de conteos por estudio, sentido e intervalo (hora pico); mapeo desde ia_historial.';
