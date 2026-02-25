-- Grafo local por nodo (legs + turns) y duración de intervalo para baseline Waze-style.
-- Rollback: DROP TABLE IF EXISTS node_turns; DROP TABLE IF EXISTS node_legs; ALTER TABLE conteos_resumen DROP COLUMN IF EXISTS interval_minutes;

-- 1) Duración del intervalo en minutos (para normalización temporal)
ALTER TABLE conteos_resumen
  ADD COLUMN IF NOT EXISTS interval_minutes INTEGER NULL;
COMMENT ON COLUMN conteos_resumen.interval_minutes IS 'Duración del intervalo en minutos (ej. 15). NULL si no se pudo detectar.';

-- 2) Legs por nodo (ramas/accesos: N, S, E, W o A, B, C)
CREATE TABLE IF NOT EXISTS node_legs (
  id           SERIAL PRIMARY KEY,
  node_id      INTEGER NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  leg_code     TEXT NOT NULL,
  bearing_deg  NUMERIC NULL,
  meta         JSONB NULL,
  UNIQUE (node_id, leg_code)
);
CREATE INDEX IF NOT EXISTS idx_node_legs_node_id ON node_legs(node_id);
COMMENT ON TABLE node_legs IS 'Ramas/accesos por nodo para grafo (sentido o movimiento). leg_code ej: N, S, E, W.';

-- 3) Turns por nodo (flujo from_leg -> to_leg por timebucket)
CREATE TABLE IF NOT EXISTS node_turns (
  id              SERIAL PRIMARY KEY,
  node_id         INTEGER NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  from_leg_code   TEXT NOT NULL,
  to_leg_code     TEXT NOT NULL,
  timebucket      TEXT NOT NULL,
  flow_total      NUMERIC NOT NULL DEFAULT 0,
  flow_by_class   JSONB NULL,
  p_turn          NUMERIC NULL,
  quality         JSONB NULL,
  UNIQUE (node_id, from_leg_code, to_leg_code, timebucket)
);
CREATE INDEX IF NOT EXISTS idx_node_turns_node_bucket ON node_turns(node_id, timebucket);
COMMENT ON TABLE node_turns IS 'Flujo y probabilidad de giro por nodo y timebucket (ej. weekday_07:00).';
COMMENT ON COLUMN node_turns.timebucket IS 'Estándar: weekday|weekend + _HH:MM en 15 o 60 min. Ej: weekday_07:00.';
COMMENT ON COLUMN node_turns.p_turn IS 'Probabilidad flow(from->to)/sum(flow(from->*)).';
