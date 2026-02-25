-- Catálogo de estudios de tránsito (nivel documento/proyecto).
-- Ejecutar con: npm run db:migrate

-- Catálogo centralizado de estudios de tránsito (nivel documento/proyecto)
CREATE TABLE IF NOT EXISTS estudios_transito (
  id                    SERIAL PRIMARY KEY,
  nombre                VARCHAR(255) NOT NULL,
  descripcion           TEXT,
  tipo                  VARCHAR(50),
  -- Valores: 'PPRU','PMT','EDAU','ETT','ESTUDIO_MOVILIDAD','PRIVADO','OTRO'
  consultora            VARCHAR(255),
  cliente               VARCHAR(255),
  contrato_secop        VARCHAR(100),   -- número de proceso/contrato SECOP
  fecha_inicio          DATE,
  fecha_fin             DATE,
  area_influencia       GEOMETRY(GEOMETRY, 4326), -- polígono o punto
  url_documento_original TEXT NOT NULL,  -- link SIEMPRE requerido (SDP, SECOP, etc.)
  fuente                VARCHAR(50),
  -- Valores: 'SECOP','SDP','SDM','PRIVADO','UNIVERSIDAD','OTRO'
  datos_extra           JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_et_geom
  ON estudios_transito USING GIST(area_influencia);
CREATE INDEX IF NOT EXISTS idx_et_tipo
  ON estudios_transito(tipo, fuente);
CREATE UNIQUE INDEX IF NOT EXISTS idx_et_url_unica
  ON estudios_transito(url_documento_original);

-- Tabla pivote: un estudio puede tener muchos nodos de aforo
CREATE TABLE IF NOT EXISTS estudio_transito_nodos (
  estudio_transito_id  INT REFERENCES estudios_transito(id) ON DELETE CASCADE,
  nodo_id              INT REFERENCES nodos(id) ON DELETE CASCADE,
  PRIMARY KEY (estudio_transito_id, nodo_id)
);

-- Enlace de archivos_fuente a un estudio_transito (opcional, nullable)
ALTER TABLE archivos_fuente
  ADD COLUMN IF NOT EXISTS estudio_transito_id INT
    REFERENCES estudios_transito(id);
