# Fase 1 — Auditoría scraper eventos (diagnóstico)

## 1) Scripts relacionados (package.json)

| Script | Archivo ejecutado | Descripción inferida |
|--------|-------------------|----------------------|
| `ingest:eventos` | `server/scripts/ingest_eventos_from_contexto.js --apply` | Ingesta eventos desde contexto (a BD) |
| `ingest:eventos:dry` | `server/scripts/ingest_eventos_from_contexto.js` | Dry-run de lo anterior |
| `ingest:eventos:incidentes` | `server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js --apply` | contexto_eventos → incidentes (canónicos) |
| `ingest:eventos:incidentes:dry` | `server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js` | Dry-run contexto → incidentes |
| `ingest:eventos:web:dry` | `server/scripts/ingest/ingest_eventos_web_to_contexto_eventos.js` | Scraper web → contexto_eventos (sin escribir) |
| `ingest:eventos:web:apply` | `server/scripts/ingest/ingest_eventos_web_to_contexto_eventos.js --apply` | Scraper web → contexto_eventos (aplica) |
| `ingest:agendate:contexto:dry` | `server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js` | Agéndate Bogotá → contexto (dry) |
| `ingest:agendate:contexto:apply` | `server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js --apply` | Agéndate → contexto (aplica) |
| `ingest:agenda:manual:dry` | `server/scripts/ingest/ingest_agenda_manual_to_contexto_eventos.js` | Agenda manual → contexto (dry) |
| `ingest:agenda:manual:apply` | `server/scripts/ingest/ingest_agenda_manual_to_contexto_eventos.js --apply` | Agenda manual → contexto (aplica) |
| `scraper:portales` | `server/scripts/scraper_portales.js` | Scraper portales (no eventos culturales) |

## 2) Archivos reales del scraper de eventos

- **Scraper web (agenda cultural):** `server/scripts/ingest/ingest_eventos_web_to_contexto_eventos.js`
- **Paso a incidentes:** `server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js`
- **Agéndate (lugares/eventos):** `server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js`
- **Agenda manual:** `server/scripts/ingest/ingest_agenda_manual_to_contexto_eventos.js`

## 3) Dry-run scraper web (ingest:eventos:web:dry)

- **bogota.gov.co agenda:** 5 eventos leídos.
- **idartes agenda:** Fetch falló (HTTP 406); 0 eventos.
- En dry-run **no** se hace venue match ni escritura; por tanto no se reportan con_geom/sin_geom/listos para incidentes en esta ejecución.
- Conclusión: el scraper existe y obtiene eventos de una fuente; la otra fuente (idartes) falla por 406.

## 4) Dry-run contexto_eventos → incidentes (ingest:eventos:incidentes:dry)

- **contexto_eventos con geom (excl. LUGAR_EVENTO):** 97 filas.
- **Clasificación → incidentes tipo:** OBRA: 93, MANIFESTACION: 1, **EVENTO: 3**.
- **Clasificación → layer:** OBRAS: 93, MANIFESTACIONES: 1, EVENTOS: 3.
- Los 97 registros vienen de otras fuentes (agendate, manual, etc.); el scraper web solo aportaría tras `ingest:eventos:web:apply`.

## 5) Diagnóstico final Fase 1

**B) Scraper existe pero no produce eventos “activos” en volumen**

- El scraper web existe y corre (bogota.gov.co devuelve 5 eventos en dry-run).
- En dry-run no se calculan con_geom/start_at/end_at; en apply solo se insertan en contexto_eventos los que tengan venue match (geom) y opcionalmente start_at.
- Idartes está caído/406.
- Solo 3 EVENTO en incidentes provienen de contexto_eventos actual; el resto son OBRAS/MANIFESTACIONES.
- **LUGAR_EVENTO** no entra en incidentes (ya excluido en la query en `ingest_contexto_eventos_to_incidentes.js`).

No se ha ejecutado apply del scraper en esta auditoría; la propuesta de reglas Waze (solo eventos con horario real y geom) y subfiltros en el frontend sigue siendo aplicable.
