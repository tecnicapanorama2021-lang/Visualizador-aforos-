# Popup Obras: UI tipo tarjeta y dominios ArcGIS

**Fecha:** 2026-02-24

---

## Objetivo

- Título del popup: **display_name** (texto humano), nunca solo un número.
- Campos ENTIDAD, ESTADO, LOCALIDAD, UPZ, TIPOOBRA: **nombre decodificado** si existe el dominio; si no, "Código X".
- Popup como **tarjeta**: header, chips, sección Detalles, acordeón JSON crudo al final.
- Funciona **offline** tras el ingest: dominios se cachean 24h en backend; si ArcGIS no está disponible se usa cache o "Código X".

---

## Backend

### GET /api/arcgis/domains

- **Query:** `serviceUrl` (opcional), `layerId` (opcional, default 0).
- **Respuesta:** `{ fieldName: { code: name } }` para cada campo con dominio coded-value.
- **Implementación:** `server/utils/arcgisDomains.js` obtiene la metadata del layer (`MapServer/{id}?f=json`), extrae `fields[].domain.codedValues` y cachea 24h en memoria.
- **URL por defecto:** `ARCGIS_BASE_URL` o Obras Distritales MapServer (Catastro).

### GET /api/obras/:id/detail (enriquecido)

Además de `feature`, `bbox`, `centroid`, devuelve:

| Campo          | Descripción |
|----------------|-------------|
| **display_name** | Texto humano para el título. Prioridad: nombre/título → objeto (texto largo) → obra + grupo/tramo → "Obra {entidad} – {codrel} – {localidad}". Nunca solo un número. |
| **decoded**    | Objeto con campos decodificados (dominios) o "Código X" cuando no hay dominio. Timestamps en ms convertidos a fecha legible. |
| **raw**        | `attributes_raw` tal cual (para el acordeón "Ver atributos ArcGIS"). |

- **display_name** se calcula en `routes/capas.js` con `buildDisplayName(attrs, decoded)`.
- **decoded** se rellena usando `getDomains()` (cache 24h). Si la llamada a ArcGIS falla, se usa cache previa o valor crudo / "Código X".

---

## Frontend: PopupObras

- **Título:** `detail.display_name`; si no viene o es solo número, fallback a `feature.properties.titulo/nombre` o "Obra".
- **Chips:** Estado, Entidad, Localidad (desde `detail.decoded` o `detail.raw`).
- **Detalles:** hasta 10 filas (Objeto, CODREL/CODOBRA, Fechas inicio/fin, UPZ, Valor formateado, Tramo, Dirección, Barrio, etc.) desde `decoded`/`raw`.
- **Acordeón:** "Ver atributos ArcGIS" muestra `detail.raw` (JSON).

---

## Archivos

| Archivo | Rol |
|---------|-----|
| `server/utils/arcgisDomains.js` | Fetch layer JSON, extracción de dominios, cache 24h. |
| `routes/arcgis.js` | GET /api/arcgis/domains. |
| `routes/capas.js` | buildDisplayName, decoded, display_name y raw en GET /obras/:id/detail; uso de getDomains(). |
| `src/components/map/popups/PopupObras.jsx` | Tarjeta: header (display_name), chips, Detalles, acordeón raw. |
| `docs/OBRAS_POPUP_UI.md` | Este documento. |

---

## Validación

- Probar 5 obras aleatorias: ninguna debe tener título solo numérico.
- Probar al menos 1 obra con ENTIDAD/ESTADO/LOCALIDAD decodificados (dominios cargados).
- Si GET /api/arcgis/domains o el MapServer fallan, el detalle sigue funcionando con "Código X" o cache previa.
