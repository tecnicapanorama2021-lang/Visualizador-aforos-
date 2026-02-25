-- Rollback de 014_grafo_y_interval.sql
-- Ejecutar con: psql $DATABASE_URL -f server/db/migrations/014_grafo_y_interval.down.sql

DROP TABLE IF EXISTS node_turns;
DROP TABLE IF EXISTS node_legs;
ALTER TABLE conteos_resumen DROP COLUMN IF EXISTS interval_minutes;
