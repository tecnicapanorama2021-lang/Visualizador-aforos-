# Jobs de datos unificados

Scripts que alimentan `public/data/calendario_obras_eventos.json` y `public/data/velocidades_por_nodo.json` para validación y entrenamiento de aforos predictivos.

## Scripts disponibles

| Script | Comando npm | Descripción |
|--------|-------------|-------------|
| jobCalendarioObras.js | `npm run datos-unificados:obras` | Obras desde IDU FeatureServer (principal) y CKAN/ArcGIS (respaldo); actualiza la sección "obras" del calendario. |
| jobCalendarioEventos.js | `npm run datos-unificados:eventos` | Eventos desde RSS (Google News, El Tiempo Bogotá); actualiza la sección "eventos". |
| jobVelocidadesGoogleRoutes.js | `npm run datos-unificados:velocidades` | Velocidades por segmento desde Google Directions API; actualiza velocidades_por_nodo.json. |

## Frecuencia recomendada

- **Obras**: una vez al día (ej. cron 6:00).
- **Eventos**: una vez al día (ej. cron 6:30).
- **Velocidades Google Routes**: cada 15–30 min o bajo demanda (respetar cuota Directions API).

## Bitcarrier / SIMUR velocidades (Fase 3 – preparada)

El esquema y el endpoint `GET /api/datos-unificados/velocidades/:nodoId` ya están listos para consumir velocidades por segmento desde SIMUR o Bitcarrier.

**Estado**: No se ha confirmado una API REST o descarga pública de SIMUR/Bitcarrier que exponga velocidades por segmento/nodo. Se revisó el catálogo SIMUR (ver `scan_simur_services.py` en la raíz del proyecto) y las capas conocidas (Red Semafórica, Nodo Contrato Monitoreo, etc.); no hay una capa documentada de “velocidades por segmento” expuesta de forma abierta.

**Cuando exista una fuente**:

1. Documentar URL y formato de respuesta (REST o descarga).
2. Añadir un script similar a `jobVelocidadesGoogleRoutes.js` que:
   - Consulte la API o descargue el archivo (variable de entorno p. ej. `SIMUR_VELOCIDADES_URL` o `BITCARRIER_API_URL`).
   - Normalice a `(nodo_id o segment_id, timestamp, velocidad_kmh)`.
   - Añada los registros a `velocidades_por_nodo.json` con `origen: "simur"` o `"bitcarrier"`.
3. Programar la ejecución periódica (cron) según la actualización de la fuente.

Mientras tanto, la única fuente de velocidades integrada es **Google Routes** (`jobVelocidadesGoogleRoutes.js`), que requiere `GOOGLE_MAPS_API_KEY` con Directions API activada.
