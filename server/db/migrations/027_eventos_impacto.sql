-- 027: Tabla eventos_impacto (señales de impacto vial tipo Waze).
-- Relación 1:1 con incidentes. Se crea/actualiza en ingest_contexto_eventos_to_incidentes.
-- Idempotente.

CREATE TABLE IF NOT EXISTS eventos_impacto (
  id SERIAL PRIMARY KEY,
  incidente_id INTEGER NOT NULL REFERENCES incidentes(id) ON DELETE CASCADE,
  impacto_nivel TEXT NOT NULL CHECK (impacto_nivel IN ('bajo', 'medio', 'alto', 'critico')),
  impacto_radio_m INTEGER NOT NULL,
  impacto_factor NUMERIC(4,2) NOT NULL,
  impacto_confianza NUMERIC(3,2) DEFAULT 0.8,
  fuente_senal TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (incidente_id)
);

CREATE INDEX IF NOT EXISTS idx_eventos_impacto_incidente ON eventos_impacto(incidente_id);

COMMENT ON TABLE eventos_impacto IS 'Señales de impacto vial por incidente (radio, factor). Clasificador automático en ingest.';
