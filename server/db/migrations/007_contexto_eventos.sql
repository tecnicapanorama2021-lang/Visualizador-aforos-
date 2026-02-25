-- Contexto de eventos (incidentes, obras, cierres, PMT, etc.).
-- Ejecutar con: npm run db:migrate

CREATE TABLE IF NOT EXISTS contexto_eventos (
  id                  SERIAL PRIMARY KEY,
  tipo                VARCHAR(50) NOT NULL,
  -- Valores: 'INCIDENTE','OBRA','EVENTO_CULTURAL','SINIESTRO',
  --          'CIERRE_VIA','PMT','MANIFESTACION','AFORO_PEATONAL','OTRO'
  subtipo             VARCHAR(100),
  descripcion         TEXT,
  fecha_inicio        TIMESTAMPTZ,
  fecha_fin           TIMESTAMPTZ,
  geom                GEOMETRY(GEOMETRY, 4326),  -- punto, línea o polígono
  radio_influencia_m  INT DEFAULT 500,
  fuente              VARCHAR(50),
  -- Valores: 'SDM','IDU','UMV','SCRD','RSS','MANUAL','DATOS_ABIERTOS'
  url_remota          TEXT,   -- link original de donde se sacó el dato
  origen_id           TEXT,   -- id en el sistema de origen
  datos_extra         JSONB,
  procesado           BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ctx_geom
  ON contexto_eventos USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_ctx_fecha
  ON contexto_eventos(fecha_inicio, fecha_fin);
CREATE INDEX IF NOT EXISTS idx_ctx_tipo
  ON contexto_eventos(tipo, fuente);

-- Índice único para idempotencia en ingestas
CREATE UNIQUE INDEX IF NOT EXISTS idx_ctx_origen_unico
  ON contexto_eventos(origen_id, fuente)
  WHERE origen_id IS NOT NULL;
