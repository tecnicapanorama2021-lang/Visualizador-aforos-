-- Rollback de 015_estudios_has_movement_data.sql

ALTER TABLE estudios DROP COLUMN IF EXISTS has_movement_data;
