-- Ubicación textual de eventos RSS (zona/ubicacion extraída del calendario JSON).
-- Ejecutar con: npm run db:migrate

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'ubicacion_texto'
  ) THEN
    ALTER TABLE contexto_eventos ADD COLUMN ubicacion_texto TEXT NULL;
    COMMENT ON COLUMN contexto_eventos.ubicacion_texto IS 'Ubicación en texto (ej. extraída de evento RSS: "Parque Simón Bolívar", "Carrera 7").';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'zona_texto'
  ) THEN
    ALTER TABLE contexto_eventos ADD COLUMN zona_texto TEXT NULL;
    COMMENT ON COLUMN contexto_eventos.zona_texto IS 'Zona en texto (mismo origen que ubicacion_texto para eventos RSS).';
  END IF;
END $$;
