-- 018: Reglas de clasificación de nodos (auditable, con prioridad y trazabilidad).
-- Idempotente: puede ejecutarse dos veces sin error.

-- ---------------------------------------------------------------------------
-- Tabla de reglas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodos_categoria_rules (
  id                SERIAL PRIMARY KEY,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  priority          INT NOT NULL DEFAULT 0,
  match_field       TEXT NOT NULL DEFAULT 'nombre',
  match_type        TEXT NOT NULL DEFAULT 'ILIKE',
  pattern           TEXT NOT NULL,
  tipo_nodo         TEXT NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rules_enabled_priority ON nodos_categoria_rules (enabled, priority DESC);
CREATE INDEX IF NOT EXISTS idx_rules_tipo ON nodos_categoria_rules (tipo_nodo);
CREATE INDEX IF NOT EXISTS idx_rules_field ON nodos_categoria_rules (match_field);

-- Evitar duplicados por misma regla (campo + tipo + patrón)
CREATE UNIQUE INDEX IF NOT EXISTS uq_rules_match ON nodos_categoria_rules (match_field, match_type, pattern);

COMMENT ON TABLE nodos_categoria_rules IS 'Reglas para clasificar nodos.tipo_nodo; se aplican por prioridad (mayor primero).';

-- ---------------------------------------------------------------------------
-- Trazabilidad en nodos
-- ---------------------------------------------------------------------------
ALTER TABLE nodos
  ADD COLUMN IF NOT EXISTS tipo_nodo_source TEXT NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS tipo_nodo_rule_id INT NULL,
  ADD COLUMN IF NOT EXISTS tipo_nodo_confidence INT NULL;

COMMENT ON COLUMN nodos.tipo_nodo_source IS 'DEFAULT|RULE|MANUAL: origen de la clasificación tipo_nodo.';
COMMENT ON COLUMN nodos.tipo_nodo_rule_id IS 'ID de la regla que clasificó (si source=RULE).';
COMMENT ON COLUMN nodos.tipo_nodo_confidence IS 'Confianza 0-100 (opcional).';

-- FK opcional (DEFERRABLE para permitir inserts en cualquier orden)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_nodos_tipo_nodo_rule'
  ) THEN
    ALTER TABLE nodos
      ADD CONSTRAINT fk_nodos_tipo_nodo_rule
      FOREIGN KEY (tipo_nodo_rule_id) REFERENCES nodos_categoria_rules(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Seed inicial de reglas (solo si no existen)
-- ---------------------------------------------------------------------------
INSERT INTO nodos_categoria_rules (enabled, priority, match_field, match_type, pattern, tipo_nodo, notes)
VALUES
  (true, 100, 'fuente', 'ILIKE', 'SIMUR', 'SEMAFORO', 'Fuente SIMUR'),
  (true, 90,  'fuente', 'ILIKE', 'DIM', 'AFORO_MANUAL', 'Fuente DIM'),
  (true, 90,  'fuente', 'ILIKE', 'AFORADOR', 'AFORO_MANUAL', 'Fuente aforadores'),
  (true, 80,  'fuente', 'ILIKE', 'IDU', 'OBRA', 'Fuente IDU'),
  (true, 10,  'node_id_externo', 'PREFIX', 'ckan-', 'OTROS', 'Base CKAN externa')
ON CONFLICT (match_field, match_type, pattern) DO NOTHING;
