-- Asignar UPZ y localidad a contexto_eventos (ST_Intersects desde etl_contexto_zonas).
-- Ejecutar con: npm run db:migrate

ALTER TABLE contexto_eventos
  ADD COLUMN IF NOT EXISTS localidad_id INT REFERENCES localidades(id),
  ADD COLUMN IF NOT EXISTS upz_id       INT REFERENCES upz(id);

CREATE INDEX IF NOT EXISTS idx_contexto_eventos_localidad
  ON contexto_eventos(localidad_id) WHERE localidad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contexto_eventos_upz
  ON contexto_eventos(upz_id) WHERE upz_id IS NOT NULL;
