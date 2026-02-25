-- Flag por estudio: si el Excel tiene columna movimiento/giro (para baseline: solo crear node_turns cuando true).
-- Rollback: 015_estudios_has_movement_data.down.sql

ALTER TABLE estudios
  ADD COLUMN IF NOT EXISTS has_movement_data BOOLEAN NULL;
COMMENT ON COLUMN estudios.has_movement_data IS 'True si analisis.quality.movementDetected; solo con movimiento se insertan node_turns reales (no placeholders).';
