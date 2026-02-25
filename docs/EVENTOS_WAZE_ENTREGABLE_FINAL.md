# Eventos tipo Waze — Entregable final

## Fase 5 — Salida esperada

### 1) Tabla final

| Tipo        | BD                    | API                                      | Activos ahora                    | Próximos 7 días                 |
|------------|------------------------|------------------------------------------|----------------------------------|----------------------------------|
| EVENTO     | incidentes (geom + start_at + end_at) | GET /api/eventos/nodos?eventos_filter=active \| upcoming \| historic | now ≥ start_at AND now ≤ end_at | start_at > now AND start_at ≤ now+7d |
| LUGAR_EVENTO | contexto_eventos (nunca en incidentes) | No aparece en /api/eventos/nodos          | —                                | —                                |

- **BD:** Solo se consideran EVENTO con `geom IS NOT NULL`, `start_at IS NOT NULL` y `end_at IS NOT NULL`.
- **API:** Misma regla en `getIncidentesAsGeoJSON` y en el conteo para fallback. Fallback (contexto_eventos) también filtra por `fecha_inicio`/`fecha_fin` no nulos y excluye LUGAR_EVENTO.

### 2) Confirmación

- **EVENTO** solo contiene instancias con horario real (start_at y end_at).
- **LUGAR_EVENTO** no aparece en la capa Eventos (excluido en ingest y en fallback).
- **Activos ahora** es el valor por defecto; el mapa muestra solo eventos en ventana activa cuando el subfiltro es "Activos ahora".
- **Próximos 7 días** y **Histórico** funcionan con el mismo criterio temporal (próximos = inicio en los próximos 7 días; histórico = ya finalizados).
- Predictor y aforos no se han modificado.

### 3) Lista de archivos modificados

| Archivo | Cambios |
|---------|---------|
| `routes/capas.js` | Regla Waze: EVENTO solo con start_at/end_at; eventos_filter=active\|upcoming\|historic; filtro temporal por eventosFilter; fallback con mismo criterio y filtro por fechas. |
| `server/utils/capasAdapter.js` | getEventosFromContexto: excluir filas sin fecha_inicio o fecha_fin. |
| `src/components/map/AforosMap.jsx` | Estado eventosTimeFilter; URL de eventos con ?eventos_filter=; paso de eventosTimeFilter a NodeFiltersPanel. |
| `src/components/map/NodeFiltersPanel.jsx` | Subfiltro Eventos: Activos ahora / Próximos 7 días / Histórico; tooltip en chip Eventos cuando 0 activos. |
| `docs/EVENTOS_WAZE_FASE1_DIAGNOSTICO.md` | Nuevo: auditoría scraper y dry-runs. |
| `docs/EVENTOS_WAZE_ENTREGABLE_FINAL.md` | Este documento. |

---

## Fase 3 — Automatización (si scraper funciona)

- **Ejecución manual confirmada:**
  - `npm run ingest:eventos:web:apply` — escribe en contexto_eventos.
  - `npm run ingest:eventos:incidentes -- --apply` — pasa contexto_eventos → incidentes (idempotente por source_id).
- **Automatización sugerida:**
  - **Opción A (n8n):** Flujo diario con dos pasos: Execute Command `ingest:eventos:web:apply` y luego `ingest:eventos:incidentes -- --apply`.
  - **Opción B (Windows Task Scheduler):** Script .ps1 que ejecute ambos comandos en orden (por ejemplo tras el arranque o a una hora fija).
- **Idempotencia:** El scraper usa upsert por (origen_id, fuente); el paso a incidentes usa upsert por (fuente_principal, source_id). No se duplican eventos.

---

## Fase 4 — Si el scraper no produce eventos activos

**Diagnóstico Fase 1:** Scraper existe (ingest_eventos_web_to_contexto_eventos.js), obtiene 5 eventos de bogota.gov.co en dry-run; idartes devuelve 406. En dry-run no se calcula con_geom.

**Posibles causas y fixes mínimos:**

- **Falta hora (solo fecha):** Permitir hora estimada y marcar en metadata `estimated_time: true`; en API/front no cambiar criterio de “horario real” (seguir pidiendo start_at/end_at).
- **Falta geom (venue no matchea):** Mejorar venue_matcher o forzar match contra LUGAR_EVENTO solo para asignar coordenadas; no exponer LUGAR_EVENTO como EVENTO.
- **Parsing HTML roto:** Ajustar selectores en parseBogotaGovHtml/parseIdartesHtml sin tocar otras fuentes.
- **Fuente caída (p. ej. 406):** Revisar cabeceras Accept o usar fuente alternativa.

No crear eventos en incidentes sin start_at/end_at reales o estimados y marcados explícitamente.
