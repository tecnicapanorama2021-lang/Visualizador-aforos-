-- Llave natural idempotente: (estudio_id, sentido, intervalo_ini, intervalo_fin)
-- Sustituye UNIQUE (estudio_id, sentido, intervalo_ini) por incluir intervalo_fin.
-- Idempotente: no falla si el constraint o el índice ya existen (consulta catálogos).

ALTER TABLE conteos_resumen DROP CONSTRAINT IF EXISTS uq_conteos_estudio_sentido_ini;

DO $$
DECLARE
  tbl_oid oid := 'public.conteos_resumen'::regclass;
  constraint_exists boolean;
  index_oid oid;
BEGIN
  -- ¿Ya existe el constraint uq_conteos_estudio_sentido_ini_fin?
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_conteos_estudio_sentido_ini_fin'
      AND conrelid = tbl_oid
  ) INTO constraint_exists;

  IF constraint_exists THEN
    RETURN;
  END IF;

  -- ¿Existe una relación (índice) con ese nombre? (p. ej. índice creado en run anterior)
  index_oid := to_regclass('public.uq_conteos_estudio_sentido_ini_fin')::oid;

  IF index_oid IS NOT NULL THEN
    -- Reutilizar el índice existente para crear el constraint
    EXECUTE format(
      'ALTER TABLE conteos_resumen ADD CONSTRAINT uq_conteos_estudio_sentido_ini_fin UNIQUE USING INDEX %I',
      'uq_conteos_estudio_sentido_ini_fin'
    );
  ELSE
    -- Crear constraint (y su índice) desde cero
    ALTER TABLE conteos_resumen ADD CONSTRAINT uq_conteos_estudio_sentido_ini_fin
      UNIQUE (estudio_id, sentido, intervalo_ini, intervalo_fin);
  END IF;
END $$;
