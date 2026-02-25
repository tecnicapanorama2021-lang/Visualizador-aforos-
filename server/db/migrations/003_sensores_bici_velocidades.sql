-- Sensores de conteo bicicleta (SDM) y velocidades CGT.
-- Ejecutar después de 002 (npm run db:migrate).

-- ---------------------------------------------------------------------------
-- sensores_bici: ubicación de sensores de conteo de bicicletas (Datos Abiertos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensores_bici (
  id           SERIAL PRIMARY KEY,
  id_externo   TEXT NOT NULL,
  nombre       TEXT,
  direccion    TEXT,
  geom         GEOMETRY(Point, 4326),
  fuente       TEXT NOT NULL DEFAULT 'SDM_BICI',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sensores_bici_id_externo UNIQUE (id_externo)
);

CREATE INDEX IF NOT EXISTS idx_sensores_bici_geom ON sensores_bici USING GIST (geom);
COMMENT ON TABLE sensores_bici IS 'Sensores de conteo de bicicletas (SDM). Primera fase: solo ubicación.';

-- ---------------------------------------------------------------------------
-- velocidades: velocidad actual en vía (CGT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS velocidades (
  id                SERIAL PRIMARY KEY,
  tramo_id_externo   TEXT NOT NULL,
  fecha_hora        TIMESTAMPTZ NOT NULL,
  vel_media_kmh      NUMERIC(10,2),
  fuente            TEXT NOT NULL DEFAULT 'CGT_VELOCIDAD',
  geom              GEOMETRY(Point, 4326),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_velocidades_tramo_fecha UNIQUE (tramo_id_externo, fecha_hora)
);

CREATE INDEX IF NOT EXISTS idx_velocidades_tramo ON velocidades (tramo_id_externo);
CREATE INDEX IF NOT EXISTS idx_velocidades_fecha ON velocidades (fecha_hora);
CREATE INDEX IF NOT EXISTS idx_velocidades_geom ON velocidades USING GIST (geom);
COMMENT ON TABLE velocidades IS 'Velocidad actual en vía (CGT). Sin relación directa con nodos aforo por ahora.';
