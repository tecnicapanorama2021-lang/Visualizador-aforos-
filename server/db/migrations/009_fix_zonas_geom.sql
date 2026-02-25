-- Aceptar cualquier tipo de geometría en localidades y upz (p. ej. GeometryCollection).
-- Ejecutar con: npm run db:migrate

ALTER TABLE localidades
  ALTER COLUMN geom TYPE GEOMETRY(GEOMETRY, 4326)
  USING geom::GEOMETRY(GEOMETRY, 4326);

ALTER TABLE upz
  ALTER COLUMN geom TYPE GEOMETRY(GEOMETRY, 4326)
  USING geom::GEOMETRY(GEOMETRY, 4326);
