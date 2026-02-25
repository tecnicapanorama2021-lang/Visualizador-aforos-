-- 024: updated_at en contexto_eventos (para guard de 30 días en ingest Agéndate).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contexto_eventos' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE contexto_eventos ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
    UPDATE contexto_eventos SET updated_at = created_at WHERE updated_at IS NULL;
    ALTER TABLE contexto_eventos ALTER COLUMN updated_at SET DEFAULT now();
  END IF;
END $$;
