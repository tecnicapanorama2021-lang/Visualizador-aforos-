-- Tablas enriquecidas para estudios de tránsito: vías, puntos críticos, infraestructura, proyecciones.
-- Ejecutar con: npm run db:migrate
-- Idempotente: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

-- Diagnóstico espacial en estudios_transito (localidades, UPZ, comercio, densidad)
ALTER TABLE estudios_transito
  ADD COLUMN IF NOT EXISTS diagnostico_json JSONB;

COMMENT ON COLUMN estudios_transito.diagnostico_json IS 'Diagnóstico espacial extraído del estudio: localidades/UPZ afectadas, comercio, densidad.';

-- ---------------------------------------------------------------------------
-- Vías analizadas en el estudio (red vial, capacidades, velocidades)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vias_estudio (
  id                    SERIAL PRIMARY KEY,
  estudio_transito_id   INT NOT NULL REFERENCES estudios_transito(id) ON DELETE CASCADE,
  nombre_via            VARCHAR(255),
  tipo_via              VARCHAR(50),   -- arterial, complementaria, local
  sentidos              INT,            -- 1 o 2
  capacidad_vehicular    INT,
  velocidad_permitida    INT,
  cicloinfra            BOOLEAN DEFAULT FALSE,
  pasos_peatonales      INT,
  semaforos             INT,
  geom                  GEOMETRY(LINESTRING, 4326),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vias_estudio_et ON vias_estudio(estudio_transito_id);
CREATE INDEX IF NOT EXISTS idx_vias_estudio_geom ON vias_estudio USING GIST(geom);

COMMENT ON TABLE vias_estudio IS 'Vías analizadas en estudios de tránsito: nombre, tipo, capacidad, velocidad, geom.';

-- ---------------------------------------------------------------------------
-- Puntos críticos (congestión, accidentes, riesgos peatonales/ciclistas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS puntos_criticos_estudio (
  id                    SERIAL PRIMARY KEY,
  estudio_transito_id   INT NOT NULL REFERENCES estudios_transito(id) ON DELETE CASCADE,
  nombre                VARCHAR(255),
  tipo                  VARCHAR(50),   -- congestión, accidente, peatonal-inseguro, ciclista-inseguro
  descripcion           TEXT,
  frecuencia_anual      INT,
  geom                  GEOMETRY(POINT, 4326),
  localidad_id          INT REFERENCES localidades(id),
  upz_id                INT REFERENCES upz(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_puntos_criticos_et ON puntos_criticos_estudio(estudio_transito_id);
CREATE INDEX IF NOT EXISTS idx_puntos_criticos_geom ON puntos_criticos_estudio USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_puntos_criticos_tipo ON puntos_criticos_estudio(tipo);

COMMENT ON TABLE puntos_criticos_estudio IS 'Intersecciones o puntos con problemas de tránsito en el estudio.';

-- ---------------------------------------------------------------------------
-- Infraestructura vial (semáforos, pasos peatonales, cicloinfra)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS infraestructura_vial (
  id                    SERIAL PRIMARY KEY,
  estudio_transito_id   INT NOT NULL REFERENCES estudios_transito(id) ON DELETE CASCADE,
  tipo                  VARCHAR(50),   -- semaforo, paso-peatonal, cicloinfra, refugio, anden
  ubicacion             VARCHAR(255),
  estado                VARCHAR(50),  -- operativo, fuera-servicio
  geom                  GEOMETRY(POINT, 4326),
  observaciones         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infraestructura_et ON infraestructura_vial(estudio_transito_id);
CREATE INDEX IF NOT EXISTS idx_infraestructura_geom ON infraestructura_vial USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_infraestructura_tipo ON infraestructura_vial(tipo);

COMMENT ON TABLE infraestructura_vial IS 'Infraestructura vial mencionada en el estudio: semáforos, pasos peatonales, cicloinfra.';

-- ---------------------------------------------------------------------------
-- Proyecciones (escenarios 5/10 años, volúmenes proyectados)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proyecciones_estudio (
  id                    SERIAL PRIMARY KEY,
  estudio_transito_id   INT NOT NULL REFERENCES estudios_transito(id) ON DELETE CASCADE,
  escenario             VARCHAR(50),   -- baseline, 5-años, 10-años, con-proyecto, con-cierre-vial
  descripcion           TEXT,
  volumen_proyectado    INT,
  velocidad_promedio    NUMERIC(10,2),
  nivel_congestion      VARCHAR(10),   -- A, B, C, D, E, F
  nodo_id               INT REFERENCES nodos(id),
  via_id                INT REFERENCES vias_estudio(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proyecciones_et ON proyecciones_estudio(estudio_transito_id);
CREATE INDEX IF NOT EXISTS idx_proyecciones_escenario ON proyecciones_estudio(escenario);

COMMENT ON TABLE proyecciones_estudio IS 'Escenarios proyectados del estudio: 5/10 años, volúmenes y nivel de congestión.';
