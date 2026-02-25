-- 019: Clasificación por semántica (estudios asociados). Reglas virtuales y deshabilitar ckan-=>OTROS.
-- Idempotente.

-- Deshabilitar regla que forzaba ckan- => OTROS (prioridad por fuente, no por “tiene estudios”)
UPDATE nodos_categoria_rules
SET enabled = FALSE, updated_at = now()
WHERE match_field = 'node_id_externo' AND match_type = 'PREFIX' AND pattern = 'ckan-';

-- Regla virtual: nodos con al menos un estudio => AFORO_MANUAL (prioridad 110)
INSERT INTO nodos_categoria_rules (enabled, priority, match_field, match_type, pattern, tipo_nodo, notes, updated_at)
VALUES (true, 110, '__HAS_ESTUDIOS__', 'VIRTUAL', 'true', 'AFORO_MANUAL', 'Clasifica como AFORO si hay estudios asociados', now())
ON CONFLICT (match_field, match_type, pattern) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  tipo_nodo = EXCLUDED.tipo_nodo,
  notes = EXCLUDED.notes,
  updated_at = now();

-- Regla virtual: nodos sin estudios => INFRAESTRUCTURA (red vial / nodo base), prioridad 5
INSERT INTO nodos_categoria_rules (enabled, priority, match_field, match_type, pattern, tipo_nodo, notes, updated_at)
VALUES (true, 5, '__NO_ESTUDIOS__', 'VIRTUAL', 'true', 'INFRAESTRUCTURA', 'Nodo sin estudios: red vial / nodo base', now())
ON CONFLICT (match_field, match_type, pattern) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  priority = EXCLUDED.priority,
  tipo_nodo = EXCLUDED.tipo_nodo,
  notes = EXCLUDED.notes,
  updated_at = now();
