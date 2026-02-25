# Aforos: Front (JSON) → Integración con backend PostgreSQL

Este documento describe cómo se mantiene la misma estructura visual y flujo del mapa de aforos (CircleMarkers, panel al clic, análisis, conflictos) leyendo desde **PostgreSQL** en lugar de JSON.

---

## Archivos integrados

| Archivo | Ubicación | Uso |
|--------|-----------|-----|
| **AforosMap.jsx** | `src/components/map/AforosMap.jsx` | Mapa: CircleMarkers, clic en nodo, capas (tráfico, obras), panel. |
| **PanelNodo.jsx** | `src/components/map/PanelNodo.jsx` | Panel flotante al clic; recibe datos por props desde API. |
| **aforosNodeStyles.js** | `src/constants/aforosNodeStyles.js` | Colores y estilos por tipo (azul/amarillo/verde), radios, etiquetas. |

---

## Endpoints utilizados

- **Nodos del mapa:** `GET /api/aforos/nodos` (GeoJSON) o carga desde `volumennodo_dim.json` / `nodos_unificados.json`.
- **Estudios por nodo:** `GET /api/nodos/:nodeId/estudios` → `{ address, studies: [{ file_id, date, date_end, type, contractors, downloadurl }] }`.
- **Historial (zona, vía, análisis embebido):** `GET /api/aforos/historial/:nodeId` → desde BD (nodos, estudios, conteos_resumen).
- **Análisis en vivo (si no en historial):** `GET /api/aforos/analisis/:idEstudio`.
- **Descarga Excel:** `GET /api/aforos/descargar/:fileId`.
- **Datos unificados:** `GET /api/datos-unificados/calendario?nodo_id=...`, `GET /api/datos-unificados/velocidades/:nodoId`, `GET /api/datos-unificados/obras`.

---

## Flujo al clic en nodo

1. Se resuelve `nodeId` (OBJECTID, NOMBRE, id, etc.) y se llama a `GET /api/nodos/:nodeId/estudios`.
2. Se actualiza `nodeStudies` con la respuesta (normalizada a `file_id`, `date_end`, etc.).
3. Se llama a `GET /api/aforos/historial/:nodeId` para zona (UPZ, localidad), vía (principal/secundaria) y análisis precalculado por estudio.
4. Para el estudio seleccionado: si existe en `historico[].analisis` se usa; si no, `GET /api/aforos/analisis/:idEstudio`.
5. PanelNodo muestra lista de estudios, resumen, análisis (hora pico, distribución, conflictos), descarga y datos unificados.

---

## Contrato de análisis

El objeto que el front espera para hora pico, distribución y conflictos:

```ts
{
  resumen: { hora_pico_rango: string; volumen_total_pico: number };
  distribucion_hora_pico: Array<{ sentido: string; total: number; [key: string]: any }>;
  class_headers: Array<{ key: string; label: string }>;
  historial_conflictos: Array<{ hora: string; sentido?: string; descripcion: string }>;
}
```

El endpoint `GET /api/aforos/historial/:nodeId` ya devuelve `historico[].analisis` con este formato desde la BD.
