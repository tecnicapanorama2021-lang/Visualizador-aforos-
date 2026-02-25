-- Zonas de referencia (UPZ / Localidades) para Bogotá.
-- Ejecutar con: npm run db:migrate

-- Localidades de Bogotá
CREATE TABLE IF NOT EXISTS localidades (
  id        SERIAL PRIMARY KEY,
  codigo    VARCHAR(10) UNIQUE,
  nombre    VARCHAR(100) NOT NULL,
  geom      GEOMETRY(MULTIPOLYGON, 4326)
);
CREATE INDEX IF NOT EXISTS idx_localidades_geom
  ON localidades USING GIST(geom);

-- UPZ de Bogotá
CREATE TABLE IF NOT EXISTS upz (
  id            SERIAL PRIMARY KEY,
  codigo        VARCHAR(10) UNIQUE,
  nombre        VARCHAR(100) NOT NULL,
  localidad_id  INT REFERENCES localidades(id),
  geom          GEOMETRY(MULTIPOLYGON, 4326)
);
CREATE INDEX IF NOT EXISTS idx_upz_geom
  ON upz USING GIST(geom);

-- Columnas en nodos (nullable, se llenan después con el ETL)
ALTER TABLE nodos
  ADD COLUMN IF NOT EXISTS localidad_id INT REFERENCES localidades(id),
  ADD COLUMN IF NOT EXISTS upz_id       INT REFERENCES upz(id);

-- Columnas que estaban siempre null en la API, ahora las guardamos en BD
ALTER TABLE nodos
  ADD COLUMN IF NOT EXISTS via_principal   TEXT,
  ADD COLUMN IF NOT EXISTS via_secundaria  TEXT;
