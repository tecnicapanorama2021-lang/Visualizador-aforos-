# Entrega CODEX: Capas reales unificadas + recuperación de datos

## FASE 0 — Inventario (evidencia)

### Archivos y funciones responsables

| Fuente | Archivo(s) | Función / ruta |
|--------|------------|----------------|
| **datos-unificados/obras** | `routes/datosUnificados.js` | `router.get('/obras')` → lee `CALENDAR_PATH` |
| **datos-unificados/calendario** | `routes/datosUnificados.js` | `router.get('/calendario')` → mismo JSON, filtros nodo_id/desde/hasta |
| **datos-unificados/contexto-eventos** | `routes/datosUnificados.js` | `router.get('/contexto-eventos')` → query a tabla `contexto_eventos` |
| **Calendario JSON** | `public/data/calendario_obras_eventos.json` | Alimentado por jobCalendarioObras.js (IDU) y jobCalendarioEventos.js (RSS) |
| **ETL calendario → BD** | `server/scripts/etl_contexto_eventos.js` | Inserta obras/eventos del JSON en **contexto_eventos** (no en obras/eventos_urbanos) |
| **ConstructionLayer / showObras** | `src/components/map/ConstructionLayer.jsx`, `AforosMap.jsx` | Antes usaba datos-unificados/obras; ya no se usa en el mapa de capas |

### Qué trae cada fuente (evidencia)

1. **GET /api/datos-unificados/obras**
   - Lee `public/data/calendario_obras_eventos.json`.
   - Filtra ítems con `geometry.coordinates` (≥2 valores).
   - En el repo actual: `metadata.total_obras: 153`, `metadata.fuentes.idu: 153`.
   - Cada obra tiene: `id`, `nombre`, `estado`, `geometry: { type: 'Point', coordinates: [lng, lat] }`, `fuente`, `fecha_inicio`, `fecha_fin`, `nodo_id` (opcional).

2. **GET /api/datos-unificados/calendario**
   - Mismo archivo; devuelve `obras` y `eventos` (con filtros opcionales).
   - **Eventos:** en el JSON tienen `id`, `tipo: "evento"`, `fuente` (p. ej. "Google News"), `descripcion`, `fecha_inicio`, `url`, `zona`, `ubicacion`; en el archivo actual **no tienen** `geometry` (solo zona/ubicacion texto).

3. **contexto_eventos (BD)**
   - Tabla creada en migración 007; columnas: `id`, `tipo`, `subtipo`, `descripcion`, `fecha_inicio`, `fecha_fin`, `geom`, `fuente`, `url_remota`, `origen_id`, etc.
   - Tiene **geom** (GEOMETRY); GET /contexto-eventos devuelve `ST_AsGeoJSON(c.geom)::json AS geometry`.
   - Conteos por tipo dependen de si se ejecutó `npm run etl:contexto` (rellena desde calendario). Tipos: OBRA, EVENTO_CULTURAL, MANIFESTACION, CIERRE_VIA, etc.

---

## FASE 1 — Decisión arquitectónica

### CAMINO A — Adapter (recomendado, implementado)

- **Obras:** GET /api/obras/nodos lee de **calendario_obras_eventos.json** (misma lógica que datos-unificados/obras). Devuelve N real (153 en el repo actual) con `layerType: 'OBRAS'`.
- **Eventos / Manifestaciones:** GET /api/eventos/nodos y /api/manifestaciones/nodos leen de **contexto_eventos** (BD) con `geom IS NOT NULL`, mapeando `tipo` → EVENTOS o MANIFESTACIONES.
- **Conciertos / Semáforos:** Siguen desde tablas 020 (eventos_urbanos tipo CONCIERTO, semaforos). Sin fuente externa hoy; se documenta como “pendiente dataset”.
- **Ventaja:** El mapa muestra N real sin ETL adicional. datos-unificados/* se mantiene intacto.

### CAMINO B — Ingesta canónica

- Scripts de ingesta desde calendario/contexto_eventos hacia tablas **obras** y **eventos_urbanos**, con resolución de `nodo_id` (proximidad o geocode).
- Requiere migración 021 si se añaden columnas (geom/source_id) y diseño de idempotencia (ON CONFLICT).
- Ventaja a largo plazo: una sola fuente de verdad en BD.

### Decisión recomendada

- **Recomendado para “mapa perfecto ya”:** CAMINO A (Adapter), implementado en esta entrega.
- Opción futura: cuando se defina georreferenciación estable (nodo_id o geom en 020), añadir CAMINO B como ingesta canónica y poder deprecar el adapter.

---

## FASE 2 — Cambios por archivo

### Backend

| Archivo | Cambio |
|---------|--------|
| **server/utils/capasAdapter.js** | **Nuevo.** `getObrasFromCalendario()`, `getEventosFromContexto()`, `filterByLayerType()`, `getCalendarioCounts()`, `getContextoEventosCounts()`. |
| **routes/capas.js** | GET /obras/nodos usa `getObrasFromCalendario()`. GET /eventos/nodos y /manifestaciones/nodos usan `getEventosFromContexto()` + `filterByLayerType()`. Conciertos y semáforos siguen desde BD. |
| **routes/debug.js** | GET /capas-stats usa adapter (obras = calendario, eventos/manif = contexto_eventos). Nuevo GET /capas-sources-audit: conteos por calendario, contexto_eventos y tablas 020. |

### Frontend

| Archivo | Cambio |
|---------|--------|
| **src/components/map/popups/PopupObras.jsx** | Se muestra `fuente` cuando exista. |
| **src/components/map/popups/PopupEventos.jsx** | Se muestra `fuente` y enlace `url_remota` (“Ver enlace”) si existe. |
| **ResumenAnalisisAforo.jsx** | “Volumen por periodo” ya muestra número (`row.total`/`row.vol_total`) o “—”; no se pinta sentido (“NO”) como volumen. |

### Sin cambios (ya correctos)

- AforosMap: 7 fetches, 7 capas, popups por tipo sin tabs.
- GET /api/aforos/nodos: solo nodos con estudios; GET /api/aforos/nodo/:nodoId/estudios para popup.
- Colores y filtros por capa.

---

## FASE 3 — Verificación (comandos exactos)

### A) Backend (PowerShell)

```powershell
Invoke-RestMethod http://localhost:3001/api/debug/capas-stats | ConvertTo-Json
Invoke-RestMethod http://localhost:3001/api/debug/capas-sources-audit | ConvertTo-Json
(Invoke-RestMethod http://localhost:3001/api/obras/nodos).features.Count
(Invoke-RestMethod http://localhost:3001/api/eventos/nodos).features.Count
(Invoke-RestMethod http://localhost:3001/api/manifestaciones/nodos).features.Count
(Invoke-RestMethod http://localhost:3001/api/conciertos/nodos).features.Count
(Invoke-RestMethod http://localhost:3001/api/semaforos/nodos).features.Count
(Invoke-RestMethod http://localhost:3001/api/base/nodos).features.Count
(Invoke-RestMethod http://localhost:3001/api/aforos/nodos).features.Count
```

**Esperado (con calendario y contexto_eventos poblado):** obras Count ≥ 1 (típ. 153 si existe el JSON); eventos/manif según contexto_eventos con geom; capas-stats coherente con los .Count.

**Nota:** Reiniciar el backend tras cambios para que `/api/debug/capas-sources-audit` y el adapter de obras/eventos estén activos. Verificar con: `npm run verify:debug`. Si tras reiniciar obras sigue en 1, comprobar que existe `public/data/calendario_obras_eventos.json` y que el servidor se inicia desde la raíz del proyecto (el adapter resuelve la ruta desde `server/utils/capasAdapter.js`).

### B) SQL (psql / pgAdmin)

```sql
SELECT COUNT(*) FROM obras;
SELECT COUNT(*) FROM eventos_urbanos;
SELECT COUNT(*) FROM semaforos;
SELECT COUNT(*) FROM contexto_eventos;
SELECT tipo, fuente, COUNT(*) FROM contexto_eventos GROUP BY 1, 2 ORDER BY 3 DESC;
```

### C) Front

- **Network:** 7 peticiones a /api/*/nodos (aforos, obras, eventos, manifestaciones, conciertos, semaforos, base).
- **Chips:** Conteos iguales a los .features.Count de cada endpoint.
- **Colores:** Distintos por capa (verde/rojo/morado/naranja/fucsia/amarillo/gris).
- **Desactivar capa:** Solo desaparecen los markers de esa capa.
- **Popup:** Sin tabs; PopupObras / PopupEventos muestran fuente y, si aplica, enlace.

---

## Checklist de aceptación

- [x] GET /api/debug/capas-stats devuelve obras ≥ 1 (153 si existe calendario). **Verificado:** obras: 153, eventos: 94, aforos: 818, base: 25.
- [x] GET /api/debug/capas-sources-audit devuelve calendario_obras_eventos (obras_count, obras_con_coords), contexto_eventos (total, con_geom, by_tipo), tablas_020. **Verificado.**
- [x] GET /api/obras/nodos devuelve FeatureCollection con properties.layerType = 'OBRAS'. **Verificado:** 153 features.
- [x] GET /api/eventos/nodos y /manifestaciones/nodos devuelven features desde contexto_eventos (con geom). **Verificado:** eventos 94, manifestaciones 0 (by_tipo: EVENTO_CULTURAL 13, OBRA 93, CIERRE_VIA 5).
- [ ] Chips en UI coinciden con capas-stats (comprobar en navegador).
- [ ] Popups por capa sin tabs; Aforos → “Ver análisis” por dim_id (comprobar en navegador).
- [ ] “Volumen por periodo”: número o “—”, nunca “NO” como valor de volumen (comprobar en análisis aforo).

---

## Resultado de la verificación ejecutada (backend reiniciado)

| Endpoint / Comando | Resultado |
|--------------------|-----------|
| `verify_debug_endpoints.js` | OK — todos responden 200 (ping, layers-summary-stats, capas-stats, capas-sources-audit, estudios-relation). |
| `GET /api/debug/capas-stats` | aforos: 818, obras: **153**, eventos: **94**, manifestaciones: 0, conciertos: 0, semaforos: 1, base: 25. |
| `GET /api/debug/capas-sources-audit` | calendario: 153 obras con coords, 18 eventos sin coords; contexto_eventos: 111 total, 94 con geom (OBRA 93, EVENTO_CULTURAL 13, CIERRE_VIA 5); tablas_020: 1 cada una. |
| `GET /api/*/nodos` .features.Count | aforos 818, obras 153, eventos 94, manifestaciones 0, conciertos 0, semaforos 1, base 25. |

Los chips del front deben mostrar esos mismos números; los popups y “Volumen por periodo” se comprueban en el navegador.

---

## Resumen

- **Datos reales:** Obras en `public/data/calendario_obras_eventos.json` (153 en repo); eventos en tabla **contexto_eventos** (con geom si existe y tras ETL).
- **Adapter:** Obras desde calendario; eventos/manifestaciones desde contexto_eventos. Conciertos y semáforos desde tablas 020 (demo hasta tener dataset real).
- **Decisión:** CAMINO A (Adapter) implementado; CAMINO B (ingesta canónica) queda como evolución futura.
