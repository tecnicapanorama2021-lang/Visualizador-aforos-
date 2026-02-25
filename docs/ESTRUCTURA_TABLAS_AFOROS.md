# Estructura de tablas PostgreSQL (aforos / historial)

Resumen de las tablas que usa el endpoint **GET /api/aforos/historial/:nodeId** y **GET /api/nodos/:nodeId/estudios**.

---

## 1. `nodos`

Puntos de medición (intersecciones, sensores). La clave que usa el API es **`node_id_externo`** (ej. `"171"`, `"466"`). El front puede enviar también nombre o dirección; el backend busca por los tres.

| Columna           | Tipo           | Descripción |
|-------------------|----------------|-------------|
| id                | SERIAL PK      | ID interno |
| internal_id_dim   | INTEGER        | Opcional, DIM |
| **node_id_externo** | TEXT UNIQUE  | **Identificador del nodo para el API** (ej. "171") |
| nombre            | TEXT           | Nombre o código (ej. "AK_68_X_AC_28") |
| direccion         | TEXT           | Dirección o descripción |
| geom              | GEOMETRY(Point, 4326) | Coordenadas |
| fuente            | TEXT           | 'DIM', 'EXTERNO', etc. |
| via_principal     | TEXT           | Vía principal (nullable) |
| via_secundaria    | TEXT           | Vía secundaria (nullable) |
| upz_id            | INT FK → upz   | UPZ (nullable) |
| localidad_id      | INT FK → localidades | Localidad (nullable) |
| created_at, updated_at | TIMESTAMPTZ | |

---

## 2. `estudios`

Cada estudio de aforo asociado a un **nodo** (tabla `nodos`). Relación: **estudios.nodo_id → nodos.id**.

| Columna         | Tipo     | Descripción |
|-----------------|----------|-------------|
| id              | SERIAL PK | ID interno |
| **nodo_id**     | INT FK → nodos | **Relación con el nodo** |
| file_id_dim     | TEXT     | ID del archivo en DIM (para descarga/analisis) |
| tipo_estudio    | TEXT     | Ej. "Volúmen vehicular" |
| fecha_inicio    | TIMESTAMPTZ | |
| fecha_fin       | TIMESTAMPTZ | |
| download_url    | TEXT     | |
| contratista     | TEXT     | |
| total_records   | INT      | |
| vehicle_types   | TEXT[]   | |
| fuente          | TEXT     | 'DIM' \| 'EXTERNO' |
| archivo_fuente_id | INT FK → archivos_fuente | Opcional |

---

## 3. `conteos_resumen`

Resumen de conteos por estudio, sentido e intervalo. Relación: **conteos_resumen.estudio_id → estudios.id**. No hay tabla aparte de “análisis precalculado”; el análisis se arma desde esta tabla.

| Columna      | Tipo        | Descripción |
|--------------|-------------|-------------|
| id           | SERIAL PK   | |
| **estudio_id** | INT FK → estudios | |
| sentido      | TEXT        | |
| intervalo_ini | TIMESTAMPTZ | Inicio del intervalo |
| intervalo_fin | TIMESTAMPTZ | Fin del intervalo |
| vol_total    | INT         | |
| vol_autos    | INT         | |
| vol_motos    | INT         | |
| vol_buses    | INT         | |
| vol_pesados  | INT         | |
| vol_bicis    | INT         | |
| vol_otros    | INT         | |

---

## 4. `archivos_fuente`

Registro de archivos (PDF, Excel, CSV). Opcionalmente vinculada a **estudios** (estudios.archivo_fuente_id) y a **estudios_transito** (estudios_transito_id). El historial de aforos no la usa obligatoriamente.

| Columna   | Tipo   |
|-----------|--------|
| id        | SERIAL PK |
| tipo      | TEXT   |
| origen    | TEXT   |
| nombre_archivo | TEXT |
| hash, procesado, origen_id, url_remota, datos_extra, estudio_transito_id | |

---

## 5. `estudios_transito` (no usada por /historial)

Catálogo de estudios de tránsito a nivel **documento** (PMT, EDAU, etc.). Tiene `area_influencia`, `url_documento_original`, y se relaciona con nodos vía **estudio_transito_nodos**. El endpoint **/api/aforos/historial** y **/api/nodos/:nodeId/estudios** usan la tabla **estudios**, no **estudios_transito**.

---

## Consulta de ejemplo (nodos + estudios + conteos)

```sql
SELECT
  n.id          AS nodo_id,
  n.node_id_externo,
  n.nombre,
  n.direccion,
  e.id          AS estudio_id,
  e.file_id_dim,
  e.fecha_inicio,
  e.tipo_estudio,
  COUNT(c.id)   AS num_conteos
FROM nodos n
LEFT JOIN estudios e ON e.nodo_id = n.id
LEFT JOIN conteos_resumen c ON c.estudio_id = e.id
WHERE n.node_id_externo = '171'   -- o: n.nombre ILIKE '%AK_68%' o n.direccion ILIKE '%...'
GROUP BY n.id, e.id
ORDER BY n.id, e.fecha_inicio DESC
LIMIT 10;
```

Para listar nodos que tengan al menos un estudio:

```sql
SELECT n.id, n.node_id_externo, n.nombre, n.direccion
FROM nodos n
WHERE EXISTS (SELECT 1 FROM estudios e WHERE e.nodo_id = n.id)
LIMIT 5;
```

---

## Respuesta del endpoint /historial

El backend devuelve un único objeto (no `nodes[nodeId]`):

- **node_id**: `node_id_externo` del nodo encontrado (para que el front use siempre el mismo id).
- **address**, **via_principal**, **via_secundaria**, **upz**, **localidad**, **historico**, **estadisticas**.

Si envías `nodeId = "AK_68_X_AC_28"` y en BD ese valor está en **nombre** o **direccion**, el endpoint busca también por nombre/dirección (ILIKE) y devuelve el nodo; **node_id** en la respuesta será el `node_id_externo` real (ej. `"171"`).
