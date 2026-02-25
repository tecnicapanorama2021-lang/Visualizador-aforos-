-- 029: Campos canónicos para OBRAS en incidentes y caché de dominios ArcGIS.
-- Permite normalizar título/objetivo/ubicación y nombres decodificados (entidad, localidad, estado, tipo_obra).
-- Idempotente: ADD COLUMN IF NOT EXISTS no existe en PostgreSQL, se usa DO block.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'title') THEN
    ALTER TABLE incidentes ADD COLUMN title TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'objetivo') THEN
    ALTER TABLE incidentes ADD COLUMN objetivo TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'ubicacion') THEN
    ALTER TABLE incidentes ADD COLUMN ubicacion TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'entidad_code') THEN
    ALTER TABLE incidentes ADD COLUMN entidad_code TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'entidad_name') THEN
    ALTER TABLE incidentes ADD COLUMN entidad_name TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'localidad_code') THEN
    ALTER TABLE incidentes ADD COLUMN localidad_code TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'localidad_name') THEN
    ALTER TABLE incidentes ADD COLUMN localidad_name TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'estado_code') THEN
    ALTER TABLE incidentes ADD COLUMN estado_code TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'estado_name') THEN
    ALTER TABLE incidentes ADD COLUMN estado_name TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'tipo_obra_code') THEN
    ALTER TABLE incidentes ADD COLUMN tipo_obra_code TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'tipo_obra_name') THEN
    ALTER TABLE incidentes ADD COLUMN tipo_obra_name TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'source_system') THEN
    ALTER TABLE incidentes ADD COLUMN source_system TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'quality_status') THEN
    ALTER TABLE incidentes ADD COLUMN quality_status TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'cod_rel') THEN
    ALTER TABLE incidentes ADD COLUMN cod_rel TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'cod_obra') THEN
    ALTER TABLE incidentes ADD COLUMN cod_obra TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidentes' AND column_name = 'upz') THEN
    ALTER TABLE incidentes ADD COLUMN upz TEXT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS arcgis_domains_cache (
  service_url TEXT NOT NULL,
  layer_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service_url, layer_id, field_name, code)
);

CREATE INDEX IF NOT EXISTS idx_arcgis_domains_service_layer_field
  ON arcgis_domains_cache (service_url, layer_id, field_name);

COMMENT ON TABLE arcgis_domains_cache IS 'Caché de dominios coded-value de ArcGIS MapServer (sync 24h).';
