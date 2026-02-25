ALTER TABLE conteos_resumen DROP CONSTRAINT IF EXISTS uq_conteos_estudio_sentido_ini_fin;
ALTER TABLE conteos_resumen ADD CONSTRAINT uq_conteos_estudio_sentido_ini
  UNIQUE (estudio_id, sentido, intervalo_ini);
