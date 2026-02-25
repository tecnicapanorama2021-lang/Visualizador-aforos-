-- 026: Festivos Colombia (Ley Emiliani + distritales) para ajuste del predictor.
-- Idempotente.

CREATE TABLE IF NOT EXISTS festivos_colombia (
  id     SERIAL PRIMARY KEY,
  fecha  DATE NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo   TEXT NOT NULL  -- 'NACIONAL', 'DISTRITAL', 'PUENTE'
);

CREATE INDEX IF NOT EXISTS idx_festivos_fecha ON festivos_colombia (fecha);

COMMENT ON TABLE festivos_colombia IS 'Festivos Colombia/Bogotá para predictor baseline_v1 (ajuste DOW en días festivos).';
