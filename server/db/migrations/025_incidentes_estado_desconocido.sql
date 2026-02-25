-- 025: Permitir estado DESCONOCIDO en incidentes (para eventos sin start_at).
ALTER TABLE incidentes DROP CONSTRAINT IF EXISTS chk_estado;
ALTER TABLE incidentes ADD CONSTRAINT chk_estado
  CHECK (estado IN ('ACTIVO', 'PROGRAMADO', 'FINALIZADO', 'DESCONOCIDO'));
