# Diagnóstico Manifestaciones/Eventos y diseño ingesta Agéndate con Bogotá

## Resumen ejecutivo

- **Manifestaciones/Eventos en mapa:** En BD hay **0 EVENTO** y **1 MANIFESTACION** en `incidentes`; el resto son 186 OBRA. La API de eventos/manifestaciones **sí devuelve** 93 y 1 porque usa **fallback** desde `contexto_eventos` (lectura directa con taxonomía). La causa raíz es doble: (1) **Taxonomía** clasificaba como OBRA cualquier registro cuya descripción contenía "obra" o "construcción", incluyendo eventos culturales ("obra de teatro"); (2) el **modo por defecto "Activos"** en la UI puede dejar en 0 eventos si todos son históricos en otros entornos.
- **Fix mínimo aplicado:** (1) En `capasTaxonomy.js` se da **prioridad al tipo almacenado** (EVENTO_CULTURAL, MANIFESTACION, CIERRE_VIA, EVENTO) sobre keywords de obra, de modo que los registros ya tipados como evento no se reclasifiquen como OBRA. (2) Logs en la ingesta contexto_eventos→incidentes (conteo por tipo y por layer). (3) Hint en el panel de filtros cuando hay 0 eventos/manifestaciones y vigencia "Activos": mensaje para cambiar a "Histórico".
- **Re-ingesta:** Tras el cambio de taxonomía, ejecutar `npm run ingest:eventos:incidentes -- --apply` reclasificará los incidentes existentes desde contexto_eventos (upsert por source_id), aumentando EVENTO y ajustando OBRA donde corresponda.
- **Agéndate con Bogotá:** Es viable integrar eventos culturales oficiales manteniendo la arquitectura de fuente única: nuevo script que llene `contexto_eventos` con `source = 'AGENDATE_BOGOTA'` y `source_id` estable; el flujo existente `ingest_contexto_eventos_to_incidentes` los llevará a `incidentes` con tipo EVENTO y subtipos (CONCIERTO, FESTIVAL, etc.) según keywords.

---

# Parte 1 – Manifestaciones/Eventos: diagnóstico y fix

## A. Sanity de backend

- `npm run verify:debug`: todos los endpoints responden 200 (ping, layers-summary-stats, capas-stats, capas-sources-audit, incidentes-stats, capas-temporal-stats, estudios-relation).
- Banner en `server.js`: `[BOOT] Backend canónico incidentes v1` — confirma que el proceso es el actual.

## B. Prueba directa de BD (vía API de debug)

Dado que el script de diagnóstico requiere credenciales de BD, se usó la API que ya está conectada a la misma BD:

**incidentes-stats (API):**

```json
{
  "by_tipo": { "MANIFESTACION": 1, "OBRA": 186 },
  "by_fuente": { "CONTEXTO_EVENTOS": 94, "IDU": 93 },
  "con_geom": 187,
  "sin_geom": 0
}
```

- **Conclusión BD:** Hay **0 EVENTO** en `incidentes`. Todo lo que viene de CONTEXTO_EVENTOS (94) se clasificó como OBRA o MANIFESTACION; ningún registro como EVENTO.
- Las fuentes que aportan a EVENTO/MANIFESTACION son solo las filas de `contexto_eventos` que la taxonomía clasificó así; al priorizar keywords "obra", la mayoría pasaron a OBRA.

**capas-stats (API):**

| Capa           | Conteo API |
|----------------|------------|
| aforos         | 818        |
| obras          | 186        |
| eventos        | 93         |
| manifestaciones| 1          |
| conciertos     | 0          |
| semaforos      | 1          |
| base           | 25         |

- Los 93 eventos vienen del **fallback** en `routes/capas.js`: al no haber EVENTO en incidentes, se usa `getEventosFromContexto()` que lee `contexto_eventos` y aplica `classifyContextoEvento` + `filterByLayerType(..., 'EVENTOS')`.

## C. Pipeline de ingesta y taxonomía

- **ingest_contexto_eventos_to_incidentes.js:** Lee `contexto_eventos` con `WHERE geom IS NOT NULL`, clasifica cada fila con `classifyContextoEvento()` y escribe en `incidentes` (upsert por `fuente_principal`, `source_id`).
- **capasTaxonomy.js (antes del fix):** El orden era: (1) tipo === 'OBRA' → OBRA; (2) **keywords OBRAS en descripción** → OBRA; (3) MANIFESTACION; (4) CONCIERTO; (5) EVENTO_CULTURAL/CIERRE_VIA/EVENTO → EVENTOS. Cualquier texto con "obra" o "construcción" (p. ej. "obra de teatro") se clasificaba como OBRA antes de evaluar EVENTO_CULTURAL.
- **Fix aplicado:** Se evalúa primero MANIFESTACION y luego EVENTO_CULTURAL/CIERRE_VIA/EVENTO; las keywords de obra solo se aplican cuando el tipo no es ya un evento. Así, los registros con tipo EVENTO_CULTURAL en `contexto_eventos` pasan a incidentes como EVENTO.
- **Logs añadidos en ingesta:** Se imprime la clasificación por tipo (OBRA, EVENTO, MANIFESTACION, etc.) y por layer antes de aplicar.

## D. Prueba directa de API

| Endpoint | Params | Status | features.length |
|----------|--------|--------|------------------|
| GET /api/eventos/nodos | (ninguno) | 200 | 93 |
| GET /api/eventos/nodos | ?active=1 | 200 | 93 |
| GET /api/manifestaciones/nodos | (ninguno) | 200 | 1 |
| GET /api/manifestaciones/nodos | ?active=1 | 200 | 1 |

La API devuelve FeatureCollection estándar; el frontend espera `features` y `layerType` en properties, y está correcto.

## E. Frontend

- **AforosMap.jsx:** Pide `EVENTOS_NODOS + qs` y `MANIFESTACIONES_NODOS + qs` con `qs = temporalMode === 'active' ? '?active=1' : ''`. Asigna `eventos?.features ?? []` y `manifestaciones?.features ?? []`. No hay pérdida en el parseo.
- **NodeFiltersPanel:** Se añadió un hint cuando `temporalMode === 'active'` y la suma de eventos + manifestaciones es 0: *"Sin eventos/manifestaciones activos. Cambia a **Histórico** para ver pasados."*

## F. Tabla resumen (Parte 1)

| Capa            | Conteo en BD (incidentes) | features API (sin params) | features API (?active=1) | UI (chips) |
|-----------------|---------------------------|---------------------------|---------------------------|------------|
| OBRA            | 186                       | 186                       | 186                       | 186        |
| EVENTO          | 0                         | 93 (fallback)             | 93 (fallback)             | 93         |
| MANIFESTACION   | 1                         | 1                         | 1                         | 1          |
| CONCIERTO       | 0                         | 0                         | 0                         | 0          |

**¿Dónde se “pierden”?** No se pierden en el frontend cuando la API devuelve 93/1; en este entorno la UI debería mostrar 93 eventos y 1 manifestación. En entornos donde todos los eventos son históricos, con "Activos" la API puede devolver 0 y el hint indica cambiar a "Histórico". La causa raíz de tener 0 EVENTO en BD era la taxonomía; con el fix y la re-ingesta, incidentes tendrá EVENTO y la capa dejará de depender solo del fallback.

## G. Fix mínimo listo para PR

### 1. Backend – Taxonomía (`server/utils/capasTaxonomy.js`)

- **Cambio:** Prioridad a tipo almacenado (EVENTO_CULTURAL, MANIFESTACION, CIERRE_VIA, EVENTO) sobre keywords de obra; keywords de obra solo cuando el tipo no es ya un evento.
- **Código:** Ya aplicado en el archivo (ver diff en repo).

### 2. Backend – Logs en ingesta (`server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js`)

- **Cambio:** Tras leer `contexto_eventos`, se calcula y muestra la clasificación por tipo (incidentes) y por layer (OBRAS/EVENTOS/MANIFESTACIONES) tanto en dry-run como en --apply.
- **Código:** Ya aplicado.

### 3. Frontend – Hint vigencia (`src/components/map/NodeFiltersPanel.jsx`)

- **Cambio:** Si vigencia es "Activos" y (eventos + manifestaciones) === 0, se muestra el mensaje para cambiar a "Histórico".
- **Código:** Ya aplicado.

### Comandos para validar el fix

```bash
# 1) Re-ingestar contexto_eventos → incidentes (tras fix de taxonomía)
npm run ingest:eventos:incidentes -- --apply

# 2) Verificar endpoints
npm run verify:debug

# 3) Comprobar conteos (API)
# GET /api/debug/incidentes-stats  → by_tipo debe incluir EVENTO si hay filas EVENTO_CULTURAL con geom en contexto_eventos
# GET /api/eventos/nodos           → features.length según datos

# 4) UI: refrescar mapa, activar chip "Eventos" y, si aplica, "Histórico" para ver eventos pasados
```

---

# Parte 2 – Eventos culturales de Bogotá: diseño de ingesta

## 1. Ingesta principal desde “Agéndate con Bogotá”

**Objetivo:** Alimentar `contexto_eventos` desde el recurso geoespacial (GeoJSON/KMZ) de Agéndate con Bogotá, con `source = 'AGENDATE_BOGOTA'` y `source_id` estable, para que el flujo existente contexto_eventos → incidentes los exponga en la capa EVENTOS/CONCIERTOS.

**Ubicación sugerida:** `server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js` (nuevo archivo).

**Esquema de flujo:**

1. Obtener el recurso (GeoJSON preferido; si es KMZ, descomprimir y leer KML/GeoJSON interno o convertir a GeoJSON).
2. Por cada feature/evento:
   - Extraer: título/nombre, descripción, entidad organizadora, fecha/hora inicio y fin, ubicación (coordenadas o geometría), categoría/tipo si existe.
   - Mapear a columnas de `contexto_eventos`: `tipo` (p. ej. 'EVENTO_CULTURAL'), `subtipo` (opcional), `descripcion`, `fecha_inicio`, `fecha_fin`, `fuente` = 'AGENDATE_BOGOTA', `origen_id` = id del dataset o hash estable, `url_remota`, `geom` (ST_GeomFromGeoJSON o punto desde lat/lng).
   - **source_id estable:** Si el dataset trae un `id` único, usarlo como `origen_id`; si no, `hash(título + fecha_inicio + lugar + coords)` (por ejemplo SHA1 truncado) para idempotencia.
3. **Idempotencia:** Upsert en `contexto_eventos` por `(origen_id, fuente)` (índice existente `idx_ctx_origen_unico` con `WHERE origen_id IS NOT NULL`). No duplicar: `ON CONFLICT (origen_id, fuente) DO UPDATE SET ...`.

**Pseudocódigo crítico:**

```js
// 1) Fetch GeoJSON (ej. URL de recurso Agéndate en Datos Abiertos / IDECA)
const res = await fetch(AGENDATE_GEOJSON_URL);
const geojson = await res.json();
const features = geojson?.features ?? [];

for (const f of features) {
  const props = f.properties ?? {};
  const geom = f.geometry; // GeoJSON Point/Polygon
  const titulo = props.nombre ?? props.titulo ?? props.name ?? '';
  const descripcion = [titulo, props.descripcion, props.entidad].filter(Boolean).join(' | ');
  const fechaInicio = parseFecha(props.fecha_inicio ?? props.start ?? props.fecha);
  const fechaFin = parseFecha(props.fecha_fin ?? props.end);
  const origenId = props.id ?? stableHash(titulo, fechaInicio, props.lugar, geom?.coordinates);
  const fuente = 'AGENDATE_BOGOTA';

  await query(`
    INSERT INTO contexto_eventos (tipo, fuente, descripcion, fecha_inicio, fecha_fin, geom, origen_id, url_remota, subtipo)
    VALUES ('EVENTO_CULTURAL', $1, $2, $3::timestamptz, $4::timestamptz, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6, $7, $8)
    ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL
    DO UPDATE SET descripcion = EXCLUDED.descripcion, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin, geom = EXCLUDED.geom, subtipo = EXCLUDED.subtipo
  `, [fuente, descripcion, fechaInicio, fechaFin, JSON.stringify(geom), origenId, props.url ?? null, props.categoria ?? null]);
}
```

**Firma CLI propuesta:**

- `npm run ingest:agendate:contexto` → dry-run (solo log de cuántos se insertarían/actualizarían).
- `npm run ingest:agendate:contexto -- --apply` → aplicar cambios en BD.

## 2. Paso contexto_eventos → incidentes

- **Reutilizar** `ingest_contexto_eventos_to_incidentes.js` sin cambios de flujo: ya lee toda `contexto_eventos` con geom y clasifica con `classifyContextoEvento`. Los registros con `tipo = 'EVENTO_CULTURAL'` y fuente AGENDATE_BOGOTA pasarán a incidentes con `tipo = 'EVENTO'`.
- **Subtipo (CONCIERTO, FESTIVAL, etc.):** En `capasTaxonomy.js` ya se detecta CONCIERTO por keywords (concierto, festival, show, gira). Se pueden añadir más keywords para FESTIVAL, TEATRO, FERIA en el mismo estilo y devolver `subtype` para que la ingesta guarde `subtipo` en incidentes.
- **Estado temporal (PROGRAMADO/ACTIVO/FINALIZADO):** Calcular en la ingesta según `start_at`/`end_at` vs `now()` y actualizar columna `estado` en incidentes (ya existe en el esquema 022).

**Mejoras opcionales en capasTaxonomy.js:**

- Añadir keywords para subtipos: `['teatro', 'feria', 'festival', 'exposicion']` y mapear a subtipo (TEATRO, FERIA, FESTIVAL, etc.) cuando no sea CONCIERTO.
- Mantener orden: tipo almacenado EVENTO_CULTURAL/EVENTO tiene prioridad; luego keywords para subtipo.

## 3. Fuentes secundarias de enriquecimiento

- **Agenda cultural bogota.gov.co, IDARTES, Secretaría de Cultura:** Tratarlas como fuentes adicionales en `incidentes_sources`: mismo incidente canónico (mismo `incidente_id`), varias filas en `incidentes_sources` con `(fuente, source_id)` distintos (AGENDATE_BOGOTA, BOGOTA_GOV, IDARTES, SCRD). Payload en `incidentes_sources.payload` con metadata (costo, aforo, categoría). Flujo: script que lee cada fuente, normaliza a un evento (título, fechas, coords), busca o crea incidente por lugar+ventana temporal y hace `INSERT INTO incidentes_sources` para esa fuente.

## 4. Estados temporales tipo Waze

- **EVENTO:** PROGRAMADO (start_at > now) → ACTIVO (start_at <= now <= end_at, con buffer opcional) → FINALIZADO (end_at < now). Campos existentes: `estado`, `start_at`, `end_at`. Opcional: `active_now` booleano calculado en query o en API.
- **MANIFESTACION:** Ventana corta; mismo esquema; se puede marcar FINALIZADO poco después de end_at.
- **Buffers:** `buffer_pre` / `buffer_post` en minutos (ej. 30) para considerar “activo” desde (start_at - buffer) hasta (end_at + buffer). La UI puede filtrar por “Activos” usando `estado = 'ACTIVO'` o una función `is_active(start_at, end_at, now)`.

## 5. Esquema de tablas afectadas

- **contexto_eventos:** Ya existe (007). Columnas usadas: id, tipo, subtipo, descripcion, fecha_inicio, fecha_fin, fuente, url_remota, origen_id, geom. No hace falta nueva migración; solo usar `fuente = 'AGENDATE_BOGOTA'`.
- **incidentes:** Ya existe (022). Sin cambios de esquema.
- **incidentes_sources:** Ya existe (022). Múltiples filas por incidente_id con distintos (fuente, source_id) para enriquecimiento multi-fuente.

## 6. Comandos del flujo completo

```bash
# Ingesta Agéndate → contexto_eventos (dry)
npm run ingest:agendate:contexto

# Ingesta Agéndate → contexto_eventos (aplicar)
npm run ingest:agendate:contexto -- --apply

# Contexto_eventos → incidentes (dry / apply)
npm run ingest:eventos:incidentes
npm run ingest:eventos:incidentes -- --apply

# Verificación
npm run verify:debug
# En UI: activar chips Eventos y Conciertos; vigencia Histórico si los eventos son pasados
```

En `package.json` se puede añadir:

```json
"ingest:agendate:contexto": "node server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js",
"ingest:agendate:contexto:apply": "node server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js --apply"
```

---

*Documento generado a partir del checklist de diagnóstico y del diseño de integración con Agéndate con Bogotá.*
