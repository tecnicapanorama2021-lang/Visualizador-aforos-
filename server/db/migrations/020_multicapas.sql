-- 020: Capas multicapa para nodos (obras, eventos, semáforos, aforos). Idempotente.

-- ---------------------------------------------------------------------------
-- A) Tabla puente: presencia de capas por nodo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodos_layers (
  nodo_id     INT NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  layer_key   TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  meta        JSONB NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (nodo_id, layer_key)
);
CREATE INDEX IF NOT EXISTS idx_nodos_layers_layer_key ON nodos_layers(layer_key);
CREATE INDEX IF NOT EXISTS idx_nodos_layers_nodo_id ON nodos_layers(nodo_id);

-- ---------------------------------------------------------------------------
-- B) Obras (detalle)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS obras (
  id          SERIAL PRIMARY KEY,
  nodo_id     INT NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  entidad     TEXT NULL,
  estado      TEXT NULL,
  fecha_ini   DATE NULL,
  fecha_fin   DATE NULL,
  impacto     TEXT NULL,
  descripcion TEXT NULL,
  fuente_url  TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_obras_nodo_id ON obras(nodo_id);
CREATE INDEX IF NOT EXISTS idx_obras_estado ON obras(estado);

-- ---------------------------------------------------------------------------
-- C) Eventos urbanos (detalle)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventos_urbanos (
  id                   SERIAL PRIMARY KEY,
  nodo_id              INT NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  tipo_evento          TEXT NOT NULL,
  titulo               TEXT NOT NULL,
  fecha_ini            TIMESTAMPTZ NULL,
  fecha_fin            TIMESTAMPTZ NULL,
  zona_influencia_m    INT NULL,
  descripcion          TEXT NULL,
  fuente_url           TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eventos_urbanos_nodo_id ON eventos_urbanos(nodo_id);
CREATE INDEX IF NOT EXISTS idx_eventos_urbanos_tipo ON eventos_urbanos(tipo_evento);

-- ---------------------------------------------------------------------------
-- D) Semáforos (detalle)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS semaforos (
  id                 SERIAL PRIMARY KEY,
  nodo_id            INT NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  codigo             TEXT NULL,
  estado_operativo   TEXT NULL,
  plan_semaforico    TEXT NULL,
  origen             TEXT NULL,
  descripcion        TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_semaforos_nodo_id ON semaforos(nodo_id);
CREATE INDEX IF NOT EXISTS idx_semaforos_origen ON semaforos(origen);

-- ---------------------------------------------------------------------------
-- Seed mínimo demo (solo si no existen registros demo)
-- ---------------------------------------------------------------------------
INSERT INTO obras (nodo_id, titulo, estado, descripcion)
SELECT n.id, 'Demo obra (migración 020)', 'ACTIVA', 'Dato demo para validar UI multicapa'
FROM nodos n
WHERE n.geom IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM obras o WHERE o.titulo = 'Demo obra (migración 020)')
LIMIT 1;

INSERT INTO eventos_urbanos (nodo_id, tipo_evento, titulo, descripcion)
SELECT n.id, 'MANIFESTACION', 'Demo evento (migración 020)', 'Dato demo para validar UI multicapa'
FROM nodos n
WHERE n.geom IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM eventos_urbanos e WHERE e.titulo = 'Demo evento (migración 020)')
LIMIT 1;

INSERT INTO semaforos (nodo_id, codigo, estado_operativo, origen, descripcion)
SELECT n.id, 'DEMO-020', 'OPERATIVO', 'SIMUR', 'Dato demo para validar UI multicapa'
FROM nodos n
WHERE n.geom IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM semaforos s WHERE s.codigo = 'DEMO-020')
LIMIT 1;
