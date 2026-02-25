-- 017: Agregar tipo_nodo a nodos para clasificación en mapa (aforos, eventos, obras, etc.).
-- Idempotente: puede ejecutarse dos veces sin error.
-- EXTERNO queda OTROS hasta que exista tabla/fuente o reglas mejores para clasificarlo.

-- Columna
ALTER TABLE nodos
  ADD COLUMN IF NOT EXISTS tipo_nodo TEXT NOT NULL DEFAULT 'OTROS';

-- Índice
CREATE INDEX IF NOT EXISTS idx_nodos_tipo_nodo ON nodos(tipo_nodo);

-- Backfill inicial según nodos.fuente (único criterio confiable hoy)
-- Reglas: SIMUR=>SEMAFORO, DIM/AFORADORES=>AFORO_MANUAL, IDU/OBRA=>OBRA, etc.
UPDATE nodos
SET tipo_nodo = CASE
  WHEN upper(COALESCE(fuente, '')) LIKE '%SIMUR%'     THEN 'SEMAFORO'
  WHEN upper(COALESCE(fuente, '')) LIKE '%AFORADOR%'   THEN 'AFORO_MANUAL'
  WHEN upper(COALESCE(fuente, '')) LIKE '%DIM%'        THEN 'AFORO_MANUAL'
  WHEN upper(COALESCE(fuente, '')) LIKE '%OBRA%'       THEN 'OBRA'
  WHEN upper(COALESCE(fuente, '')) LIKE '%IDU%'        THEN 'OBRA'
  WHEN upper(COALESCE(fuente, '')) LIKE '%CONCIERTO%'  THEN 'CONCIERTO'
  WHEN upper(COALESCE(fuente, '')) LIKE '%MANIFEST%'   THEN 'MANIFESTACION'
  WHEN upper(COALESCE(fuente, '')) LIKE '%EVENTO%'     THEN 'EVENTO'
  ELSE 'OTROS'
END
WHERE tipo_nodo IS NULL OR tipo_nodo = 'OTROS';

COMMENT ON COLUMN nodos.tipo_nodo IS 'Clasificación para filtros en mapa: AFORO_MANUAL, OBRA, EVENTO, CONCIERTO, MANIFESTACION, SEMAFORO, OTROS. EXTERNO sin regla queda OTROS.';
