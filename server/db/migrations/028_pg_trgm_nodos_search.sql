-- pg_trgm para búsqueda por similitud en nodos (buscador server-side).
-- Uso: npm run db:migrate (aplica en orden con el resto de migraciones).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índices GIN para ILIKE/LIKE con comodines en nombre, direccion, node_id_externo
CREATE INDEX IF NOT EXISTS idx_nodos_nombre_gin_trgm ON nodos USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_nodos_direccion_gin_trgm ON nodos USING gin (direccion gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_nodos_node_id_externo_gin_trgm ON nodos USING gin (node_id_externo gin_trgm_ops);
