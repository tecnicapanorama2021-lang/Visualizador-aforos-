# Diagnóstico: por qué no se ven áreas ni desvíos

**Fecha:** 2026-02-24

---

## 1) Datos en BD (geometrías)

### A) Obras por tipo de geometría

```text
ST_Point | 186
```

**Interpretación:** El 100% de las obras en `incidentes` son **Point**. No hay polígonos ni líneas.

### B) Eventos por tipo de geometría

```text
ST_Point | 1061
```

**Interpretación:** El 100% de los eventos son **Point**.

### C) Ejemplos de obras (bbox)

Los 5 ejemplos más recientes tienen `xmin = xmax` y `ymin = ymax`, es decir, son un solo punto (bbox degenerado).

| id  | titulo (resumido)           | xmin ≈ xmax   | ymin ≈ ymax  |
|-----|-----------------------------|---------------|--------------|
| 246 | Convenio Quebrada Tibanica… | -74.209       | 4.605        |
| 245 | Terminación Puente Vehicular… | -74.116   | 4.536        |
| 244 | Elaborar estudios de tránsito… | -74.120  | 4.526        |
| 243 | Inserción urbana Regiotram… | -74.072       | 4.614        |
| 242 | Ciclopuente Av. Boyacá…     | -74.085       | 4.696        |

**Conclusión 1:** No se ven “áreas” porque **en la BD solo hay puntos**. No es un fallo del front ni del API: no hay geometrías ricas (Polygon/LineString) que pintar.

---

## 2) Qué devuelve el API

### 2.1 GET /api/obras/nodos?active=1

- **total features:** 186  
- **geometry.type = Point:** 186  
- **geometry.type ≠ Point:** 0  

El API refleja la BD: solo puntos.

### 2.2 Propiedades de una obra (ej. primera feature)

- **properties.incidente_id:** presente (valor numérico, ej. 1).  
- **properties.centroid:** presente.  
- **properties.layerType:** `OBRAS`.

Al hacer click en una obra, el front tiene `incidente_id` para llamar a desvíos. El problema no es la falta de `incidente_id`.

---

## 3) Endpoint de desvíos

### 3.1 GET /api/obras/246/desvios

- **Status:** 200  
- **features.length:** 0  

El endpoint responde bien, pero la colección de desvíos viene **vacía**.

### 3.2 Cambios en backend (solo DEV)

En `routes/capas.js` se añadieron logs condicionados a `process.env.NODE_ENV !== 'production'`:

- **bbox:** `incidenteId`, `xmin`, `ymin`, `xmax`, `ymax`.  
- **URL y params:** URL base y parámetros enviados a SIMUR (sin tokens).  
- **Respuesta:** `type`, `featuresLength`, `hasError`, `errorMessage`; si no es `FeatureCollection`, se hace log de las keys del objeto.

Al llamar a `/api/obras/<id>/desvios` con el servidor en desarrollo, en consola del backend aparecerán estos logs. Con ellos se puede ver:

- Si el bbox es correcto (ahora se usa `ST_Expand(geom, 0.01)` para puntos ~1 km).  
- Si SIMUR devuelve error o un formato distinto (p. ej. esri JSON en lugar de GeoJSON).

### 3.3 Posibles causas de desvíos vacíos

1. **SIMUR no tiene desvíos en ese bbox** (servicio vacío o bbox demasiado pequeño).  
   - **Fix aplicado:** bbox ampliado de `0.001` a `0.01` grados para puntos.  
2. **SIMUR no soporta `f=geojson`** y devuelve esri JSON (`geometryType`, `features[].geometry` en formato esri).  
   - El backend hoy solo acepta `FeatureCollection`; si no, devuelve `features: []`.  
   - **Fix recomendado:** detectar respuesta esri y convertir con `@terraformer/arcgis` (o similar) a GeoJSON, o documentar “SIMUR no devolvió FeatureCollection” en los logs.

---

## 4) Render (panes / z-index / estilos)

- **AforosMap.jsx** ya hace branch por tipo de geometría:  
  - `Point` → `CircleMarker`.  
  - `Polygon | MultiPolygon | LineString | MultiLineString` → `<GeoJSON />` con estilos (obras en rojo, etc.).  
- No hay capas (tiles, etc.) por encima de las capas de obras que tapen los vectores; el orden es el estándar (TileLayer primero, luego capas de features).  
- Se añadió en DEV un contador `rendered GeoJSON obras: X` cuando hay obras no-Point; cuando existan polígonos/líneas en datos, en consola se verá que sí se pintan.

**Conclusión 4:** El problema no es de panes ni z-index. Cuando haya geometrías no-Point, el front las pintará.

---

## 5) Causa raíz y fixes mínimos

### Causa raíz

| Tema | Causa |
|------|--------|
| **No se ven áreas (polígonos/líneas)** | **Datos:** en `incidentes` solo hay geometría tipo Point para OBRA y EVENTO. No hay datos “ricos” de área. |
| **No se ven desvíos al click** | **API desvíos:** el endpoint responde 200 pero con `features.length = 0`. O SIMUR no devuelve datos para el bbox, o devuelve otro formato (esri) que no se está convirtiendo a GeoJSON. |

### Fix mínimo recomendado

**Para que se vean “áreas” (polígonos/líneas):**

- **Opción A (MVP):** En el ingest de obras (o en una migración/script), generar un polígono a partir del punto, por ejemplo `ST_Buffer(geom::geography, 100)::geometry` (buffer ~100 m) y guardar ese polígono en `incidentes.geom` (o en una columna auxiliar y usar la que corresponda en el API).  
- **Opción B:** Alimentar `incidentes` con geometrías reales de SIMUR/otra fuente (polígonos o líneas de obra), si están disponibles.

**Para que se vean desvíos:**

- **Ya aplicado:** bbox más grande para puntos (`ST_Expand(geom, 0.01)`). Reiniciar backend y probar de nuevo `/api/obras/<id>/desvios`.  
- **Si sigue vacío:** Revisar en consola del backend (con `NODE_ENV !== 'production'`) los logs de bbox, URL y respuesta. Si la respuesta tiene `features` pero no es GeoJSON (p. ej. esri), añadir conversión esri → GeoJSON (p. ej. `@terraformer/arcgis`) y devolver esa FeatureCollection.

---

## 6) Resumen de cambios realizados

- **routes/capas.js**  
  - Logs solo en DEV: bbox, URL, params, slice de respuesta y aviso si no es FeatureCollection.  
  - Bbox para desvíos: `ST_Expand(geom, 0.01)` en lugar de `0.001` para puntos.  
- **AforosMap.jsx**  
  - En DEV, contador “rendered GeoJSON obras: X” cuando hay obras no-Point.

No se ha tocado el flujo de aforos ni de predicción.

---

## Cómo reproducir las pruebas

1. **BD (geometrías):**  
   Ejecutar en `psql` (o cliente) contra la BD `aforos` las consultas de la sección 1 (A, B, C).

2. **API obras:**  
   `GET http://localhost:3001/api/obras/nodos?active=1` y comprobar en el JSON: `features[].geometry.type` (todo Point) y `features[].properties.incidente_id` / `centroid`.

3. **API desvíos:**  
   `GET http://localhost:3001/api/obras/246/desvios` (o otro `incidente_id` válido). Revisar en la consola del backend los logs `[Capas DEV] desvios ...` (bbox, URL, response slice).

4. **Front:**  
   Abrir `/aforos`, activar capa Obras, hacer click en una obra y comprobar que se pide desvíos; si hay polígonos/líneas en el futuro, en consola del navegador debería aparecer “rendered GeoJSON obras: X”.
