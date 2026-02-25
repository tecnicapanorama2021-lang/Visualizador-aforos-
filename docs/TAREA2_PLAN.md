# Tarea 2: Aforos y PMT desde fuentes externas

**Requisitos:** Node **20 o 22** (el proyecto declara `engines` en `package.json` y tiene `.nvmrc` con `20`). Con Node 24 pueden fallar dependencias por resolución ESM.

---

## Objetivo

Ampliar la base de datos con nuevos aforos (y en el futuro PMT) a partir de:

- Estudios de tránsito externos (PDF y/o Excel).
- Otros orígenes estructurados (archivos subidos manualmente).

**Principio:** no modificar lo que ya funciona en Tarea 1. Las tablas `nodos`, `estudios` y `conteos_resumen` se reutilizan; los estudios externos se distinguen por `fuente = 'EXTERNO'` y opcionalmente por `archivo_fuente_id`.

---

## 1. Esquema de “fuentes externas”

### Tablas existentes (sin cambios de estructura que rompan T1)

- **nodos:** se sigue usando; los nodos creados desde fuentes externas tienen `fuente = 'EXTERNO'` y `node_id_externo` con prefijo `ext-` (ej. `ext-1-1`).
- **estudios:** ya tiene `fuente` (DIM | EXTERNO). Se añadió **archivo_fuente_id** (FK a `archivos_fuente`, NULL para DIM).
- **conteos_resumen:** mismo formato que en Tarea 1 (estudio_id, sentido, intervalo_ini/fin, vol_total, vol_autos, vol_motos, etc.).

### Tabla nueva

- **archivos_fuente**
  - `id` (SERIAL)
  - `tipo` — PDF, XLSX, CSV, JSON
  - `origen` — SDM, SECOP, privado, demo, etc.
  - `nombre_archivo` — nombre o ruta del archivo
  - `hash` — hash del contenido (evitar duplicados / reprocesar)
  - `procesado` (boolean) — si ya se cargaron nodos/estudios/conteos
  - `created_at`, `updated_at`

Migración: `server/db/migrations/002_tarea2_fuentes_externas.sql`. Se aplica con `npm run db:migrate` (que ejecuta todas las migraciones en orden).

---

## 2. Flujo mínimo para un estudio externo

1. **Registrar el archivo** en `archivos_fuente` (tipo, origen, nombre_archivo, hash, procesado = false).
2. **Extraer** (en tu parser de PDF/Excel, o desde JSON de ejemplo):
   - ubicación (texto: intersección o dirección),
   - fechas del estudio (fecha_inicio, fecha_fin),
   - totales y volúmenes por clase por sentido/intervalo.
3. **Resolver o crear el nodo:**
   - Buscar en `nodos` si ya existe uno con dirección/nombre similar (p. ej. ILIKE sobre direccion/nombre).
   - Si no existe, insertar un nuevo nodo con `fuente = 'EXTERNO'` y `node_id_externo = 'ext-{archivo_fuente_id}-1'` (o secuencia si hay varios nodos por archivo).
4. **Crear el estudio** en `estudios`: nodo_id, file_id_dim = `ext-{archivo_fuente_id}-{fecha_inicio}`, tipo_estudio, fecha_inicio, fecha_fin, contratista, fuente = 'EXTERNO', archivo_fuente_id.
5. **Insertar conteos** en `conteos_resumen` con el **mismo formato que DIM**: estudio_id, sentido, intervalo_ini, intervalo_fin, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros. UPSERT por (estudio_id, sentido, intervalo_ini).
6. **Marcar archivo** como procesado: `UPDATE archivos_fuente SET procesado = TRUE WHERE id = ?`.

Así, las rutas actuales `/api/aforos/historial/:nodeId` y `/api/aforos/geocode/:nodeId` siguen funcionando; si el nodo es externo (node_id_externo tipo `ext-1-1`), el historial incluirá también los estudios y conteos cargados desde el archivo.

---

## 3. Implementación mínima (demo)

### Script de ingesta de ejemplo

- **Archivo:** `server/scripts/etl_fuente_externa_demo.js`
- **Entrada de ejemplo:** `server/scripts/data/estudio_externo_ejemplo.json`

El script **simula** la lectura de un estudio externo desde un JSON (en lugar de PDF/Excel). Sirve para fijar:

- Cómo registrar el archivo en `archivos_fuente`.
- Cómo buscar un nodo existente por ubicación o crear uno nuevo (EXTERNO).
- Cómo crear el estudio y escribir en `conteos_resumen` con el mismo esquema que DIM.

Cuando tengas el parser real de PDF o Excel, solo sustituyes la parte de “lectura” del archivo por tu lógica; el resto (insertar archivos_fuente, nodo, estudio, conteos) se reutiliza.

### Cómo ejecutar el script de ingesta demo

1. Aplicar migraciones (incluye 002):

   ```bash
   npm run db:migrate
   ```

2. Ejecutar el ETL de ejemplo (usa el JSON de demo por defecto):

   ```bash
   npm run etl:fuente-externa-demo
   ```

   O con un archivo concreto:

   ```bash
   node server/scripts/etl_fuente_externa_demo.js --path=server/scripts/data/estudio_externo_ejemplo.json
   ```

3. Comprobar en BD:

   - `SELECT * FROM archivos_fuente ORDER BY id DESC LIMIT 1;`
   - Nodo con `fuente = 'EXTERNO'` y `node_id_externo` tipo `ext-1-1`.
   - Estudio con `fuente = 'EXTERNO'` y `archivo_fuente_id` no nulo.
   - Filas en `conteos_resumen` para ese estudio.

4. Probar la API (con el servidor en marcha, Node 20 o 22):

   ```bash
   npm run dev:api
   # En otra terminal:
   curl -s http://localhost:3001/api/aforos/historial/171 | jq .
   curl -s http://localhost:3001/api/aforos/historial/ext-1-1 | jq .
   ```

   - **171** (nodo DIM): debe mostrar varios estudios y `historico[].analisis.vol_data_completo` con muchos intervalos.
   - **ext-1-1** (nodo externo demo): debe mostrar un solo estudio con 4 intervalos en `vol_data_completo` (NS 7:00-7:15, 7:15-7:30 y SN 7:00-7:15, 7:15-7:30). Mismo formato de respuesta que los nodos DIM.

### Formato del JSON de ejemplo

Ver `server/scripts/data/estudio_externo_ejemplo.json`. Campos esperados:

- `ubicacion` (o `direccion`): texto de la intersección.
- `fecha_inicio`, `fecha_fin`: fechas del estudio (YYYY-MM-DD).
- `tipo_estudio`, `contratista`: opcionales.
- `conteos`: array de `{ sentido, horaRango, total, classes }`; `classes` con keys LIVIANOS, MOTOS, BUSES, PESADOS, BICICLETAS (se mapean a vol_autos, vol_motos, etc. como en el ETL de DIM).

---

## 3.1 Formato CSV estándar (intercambio para aforos externos)

Formato de CSV que se puede usar como **intercambio estándar** para cargar estudios externos vía el ETL real (`etl_fuente_externa_csv.js`). Se asume que puedes generar CSV con estas columnas a partir de otros estudios (Excel, exportaciones, etc.).

### Columnas

| Columna         | Tipo   | Obligatorio | Descripción |
|-----------------|--------|-------------|-------------|
| archivo_nombre  | texto  | no          | Identificador del archivo; si no viene, se usa el nombre del fichero. |
| origen          | texto  | no          | Origen del estudio: `SDM`, `SECOP`, `PRIVADO`, etc. Por defecto `EXTERNO`. |
| nodo_nombre     | texto  | sí          | Nombre o etiqueta del punto (ej. "Calle 80 con NQS"). |
| direccion       | texto  | sí          | Dirección o intersección (ej. "KR 50 con CL 23", "CALLE 80 X NQS"). |
| fecha           | texto  | sí          | Fecha del estudio en formato **YYYY-MM-DD**. |
| sentido         | texto  | sí          | Sentido del flujo: NS, SN, EO, OE, etc. |
| hora_inicio     | texto  | sí          | Inicio del intervalo en **HH:MM** (24 h). |
| hora_fin        | texto  | sí          | Fin del intervalo en **HH:MM** (24 h). |
| vol_total       | entero | sí          | Volumen total del intervalo. |
| vol_livianos    | entero | no          | Livianos/autos (mapea a vol_autos). |
| vol_motos       | entero | no          | Motos. |
| vol_buses       | entero | no          | Buses. |
| vol_pesados     | entero | no          | Camiones/pesados. |
| vol_bicis       | entero | no          | Bicicletas. |

- La **primera fila** debe ser la cabecera con los nombres de columna (en minúsculas, con guión bajo).
- Si un valor de texto contiene comas, debe ir entre comillas dobles.
- Volúmenes no informados pueden ir vacíos; se tratarán como 0.

### Ejemplo de 2–3 filas

```csv
archivo_nombre,origen,nodo_nombre,direccion,fecha,sentido,hora_inicio,hora_fin,vol_total,vol_livianos,vol_motos,vol_buses,vol_pesados,vol_bicis
estudio_calle_80.csv,PRIVADO,Calle 80 con NQS,CALLE 80 X NQS,2025-03-10,NS,07:00,07:15,98,65,18,4,8,3
estudio_calle_80.csv,PRIVADO,Calle 80 con NQS,CALLE 80 X NQS,2025-03-10,NS,07:15,07:30,112,72,22,5,10,3
estudio_calle_80.csv,PRIVADO,Calle 80 con NQS,CALLE 80 X NQS,2025-03-10,SN,07:00,07:15,85,58,15,3,7,2
```

---

## 3.2 Ingesta real desde CSV

### Script ETL

- **Archivo:** `server/scripts/etl_fuente_externa_csv.js`
- **Entrada:** ruta del CSV por parámetro `--path=...`

### Comando

```bash
node server/scripts/etl_fuente_externa_csv.js --path=server/scripts/data/estudio_externo_real.csv
```

O con ruta absoluta:

```bash
node server/scripts/etl_fuente_externa_csv.js --path=/ruta/al/archivo.csv
```

### Comportamiento (resumen)

1. Registra el archivo en `archivos_fuente` (tipo `CSV`, origen desde columna o `EXTERNO`, nombre, hash). Si ya existe un registro con el mismo hash, se reutiliza (idempotencia).
2. Lee el CSV fila a fila (streaming).
3. Por cada fila: resuelve o crea nodo (por dirección/nombre), resuelve o crea estudio (nodo + fecha + archivo), inserta/actualiza conteo en `conteos_resumen` (UPSERT por estudio_id, sentido, intervalo_ini).
4. Al final marca el archivo como procesado y muestra resumen (archivos_fuente.id, nodos creados/actualizados, estudios, conteos).

### Verificación en BD

```sql
-- Archivos CSV procesados
SELECT * FROM archivos_fuente WHERE tipo = 'CSV' ORDER BY id DESC;

-- Nodos externos (incluye los creados desde CSV)
SELECT id, node_id_externo, direccion, fuente FROM nodos WHERE fuente = 'EXTERNO' ORDER BY id DESC;

-- Estudios externos
SELECT id, nodo_id, file_id_dim, fecha_inicio, archivo_fuente_id FROM estudios WHERE fuente = 'EXTERNO' ORDER BY id DESC;

-- Conteos de un estudio concreto (sustituir ESTUDIO_ID por un id de la consulta anterior)
SELECT COUNT(*) FROM conteos_resumen WHERE estudio_id = ESTUDIO_ID;
```

### Archivo CSV de ejemplo y node_id_externo recomendado

- **Ruta del ejemplo:** `server/scripts/data/estudio_externo_real.csv`
- **Contenido:** 6 filas (2 nodos: "Calle 80 con NQS" y "Autopista Norte con 127"; varios intervalos NS/SN y EO/OE).

Tras ejecutar el ETL con ese CSV, el script imprime los `node_id_externo` creados (p. ej. `ext-2-1`, `ext-2-2`, donde `2` es el `archivos_fuente.id`). **Para probar la API se recomienda usar el primero**, por ejemplo:

```bash
curl -s http://localhost:3001/api/aforos/historial/ext-2-1 | jq .
```

(Sustituye `ext-2-1` por el valor que haya impreso el script si tu `archivos_fuente.id` es distinto.)

---

## 3.3 Ingesta automática CGT (Conteo Vehículos)

Flujo: **CGT (Datos Abiertos / ArcGIS) → fetch_and_convert_cgt_csv.js → CSV estándar → etl_fuente_externa_csv.js → BD.**

### Recurso CGT

- **Dataset:** [Conteo Vehiculos CGT Bogotá D.C.](https://datosabiertos.bogota.gov.co/dataset/conteo-vehiculos-cgt-bogota-d-c)
- **URL usada por el script:** configurable por entorno:
  - **CGT_CSV_URL:** puede ser (1) una **URL HTTP que termina en `.geojson` o contiene `geojson?`**: el script descarga el GeoJSON, parsea `features[].properties` (y geometría para lat/lng), genera filas estándar (nodo_nombre, direccion, fecha desde creationda, vol_total si existe o 0) y escribe `cgt_standard.csv` con columnas opcionales `lat,lng` para que el ETL asigne geom; (2) una **URL de CSV** directo; (3) una **ruta local** (ej. para pruebas).
  - **CGT_ARCGIS_QUERY_URL:** si el recurso es un Feature Server / ArcGIS (query JSON), pon la URL base del `query`. El script añade `where=1=1&outFields=*&f=json&resultRecordCount=5000` si no van. Los resultados se guardan en `server/scripts/tmp/cgt_raw.json` y se convierten a CSV estándar.

Solo hace falta definir **una** de las dos variables en `.env`. Si no defines ninguna, el script indica que configures una.

**Ejemplo con GeoJSON real (Datos Abiertos):**

```env
CGT_CSV_URL=http://datos-abiertos-sdm-movilidadbogota.hub.arcgis.com/datasets/018087c3f2ef4df4895ec5027561eea7_0.geojson?outSR={"latestWkid":4686,"wkid":4686}
```

(En `.env` las comillas internas se escapan: `outSR={\"latestWkid\":4686,\"wkid\":4686}` si hace falta.)

El script puede trabajar tanto con **CSV local de prueba** como con **GeoJSON real** desde la URL anterior. Con GeoJSON se crea un nodo por feature (ubicación con geom desde el GeoJSON cuando hay Point); si el recurso no trae conteos por intervalo, las filas llevan `vol_total=0` y sirven para poblar nodos con coordenadas.

**Prueba con CSV local:** `CGT_CSV_URL=server/scripts/data/cgt_prueba_raw.csv`. El script detecta que no es una URL HTTP y lee el archivo desde disco.

### Mapeo CGT → CSV estándar

| Origen (CGT)        | CSV estándar   | Notas |
|---------------------|----------------|--------|
| NOMBRE_NODO / NOMBRE / DIRECCION | nodo_nombre, direccion | Se prueban varias claves en mayúsculas. |
| FECHA / FECHA_CONTEO / FECHA_HORA | fecha         | Se toma YYYY-MM-DD. |
| HORA_INICIO, HORA_FIN / HORA      | hora_inicio, hora_fin | Si solo hay una hora, hora_fin = +15 min. |
| SENTIDO / DIRECCION_FLUJO         | sentido       | Por defecto "NS" si no existe. |
| VOL_TOTAL / VOLUMEN / TOTAL       | vol_total     | Obligatorio. |
| (sin desglose)                    | vol_livianos, vol_motos, vol_buses, vol_pesados, vol_bicis | En esta iteración se dejan en 0. |
| (fijo)                             | origen        | Siempre `CGT_SDM`. |

### Comando

```bash
npm run etl:cgt
```

El script: (1) descarga o consulta CGT según la variable configurada, (2) guarda copia cruda en `server/scripts/tmp/`, (3) genera `server/scripts/tmp/cgt_standard.csv`, (4) ejecuta `etl_fuente_externa_csv.js --path=server/scripts/tmp/cgt_standard.csv`. La idempotencia la mantiene el ETL CSV (hash del estándar): mismo contenido → mismo `archivos_fuente`; contenido distinto → nuevo registro y nueva ingesta.

### Verificación en BD

```sql
-- Archivos CGT
SELECT * FROM archivos_fuente WHERE origen = 'CGT_SDM' ORDER BY id DESC;

-- Estudios externos de CGT
SELECT COUNT(*) FROM estudios WHERE fuente = 'EXTERNO' AND archivo_fuente_id IN (SELECT id FROM archivos_fuente WHERE origen = 'CGT_SDM');

-- Conteos de un archivo CGT (sustituir ARCHIVO_ID por un id de archivos_fuente)
SELECT COUNT(*) FROM conteos_resumen WHERE estudio_id IN (SELECT id FROM estudios WHERE archivo_fuente_id = ARCHIVO_ID);
```

### Probar la API con un nodo CGT

Al final, el ETL CSV imprime los `node_id_externo` creados (p. ej. `ext-3-1`, `ext-3-2`). **Ejemplo para probar con el primer nodo CGT:**

```bash
curl -s http://localhost:3001/api/aforos/historial/ext-3-1 | jq .
```

(Reemplaza `ext-3-1` por el valor que haya impreso el script; el número depende del `archivos_fuente.id` asignado.)

---

## 3.4 Geocoding para nodos EXTERNO

Al **crear** nodos EXTERNO nuevos desde el ETL CSV (`etl_fuente_externa_csv.js`), se intenta asignar coordenadas (`geom`) mediante un helper de geocoding. Así, la ruta `GET /api/aforos/geocode/:nodeId` puede devolver `{ lat, lng }` para nodos externos.

### Archivo

- **`server/scripts/utils/geocoding.js`**
  - `geocodeDireccion(direccion)` → `{ lat, lng }` o `null`.
  - **Paso 1:** diccionario local (direcciones normalizadas: mayúsculas, sin tildes, conector `" X "`).
  - **Paso 2 (opcional):** fallback con ArcGIS (comentado o detrás de flag): geocodificar `"<direccion>, Bogotá, Colombia"`; si hay candidato devolver `{ lat, lng }`, si no o si falla devolver `null`.

### Direcciones soportadas por el diccionario local

| Dirección normalizada   | Descripción (referencia) |
|-------------------------|---------------------------|
| CALLE 13 X CARRERA 7    | Centro |
| AK 30 X CL 53           | Autopista Sur con Calle 53 |
| CALLE 80 X NQS          | Calle 80 con NQS |
| AK 15 X CL 127          | Autopista Norte con 127 |

Cualquier variante que, tras normalizar (mayúsculas, quitar tildes, unificar conector a `" X "`), coincida con una de estas claves obtiene las coordenadas del diccionario.

### Lógica de fallback

- Si `geocodeDireccion(direccion)` devuelve `{ lat, lng }`: el INSERT del nodo nuevo incluye `geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)`.
- Si devuelve `null`: el INSERT se hace **sin** `geom` (queda NULL). La carga del ETL **sigue con normalidad**; el nodo se crea igual y solo carece de coordenadas para el mapa/geocode.
- **No se actualiza** `geom` en nodos que ya existan en esa iteración (solo se rellena en la creación).

### Verificación

```sql
SELECT node_id_externo, direccion, ST_Y(geom) AS lat, ST_X(geom) AS lng
FROM nodos
WHERE node_id_externo LIKE 'ext-2-%' OR node_id_externo LIKE 'ext-3-%';
```

Probar que la API devuelve coordenadas para un nodo externo con geom:

```bash
curl -s http://localhost:3001/api/aforos/geocode/ext-3-1
```

Debe devolver `{ "lat": ..., "lng": ... }` cuando el nodo tiene `geom` no nulo.

---

## 3.5 Sensores de conteo bicicleta (SDM)

Pipeline: **GeoJSON/FeatureServer sensores bici → etl_sensores_bici.js → tabla sensores_bici.**

### Tabla sensores_bici

| Columna    | Tipo               | Descripción |
|------------|--------------------|-------------|
| id         | SERIAL PRIMARY KEY | |
| id_externo | TEXT UNIQUE        | site_id o identificador del sensor |
| nombre     | TEXT               | Nombre/código (ej. BOYCL53, CL80KR70) |
| direccion  | TEXT               | Dirección o localidad |
| geom       | GEOMETRY(Point, 4326) | Ubicación WGS84 |
| fuente     | TEXT               | Por defecto 'SDM_BICI' |
| created_at, updated_at | TIMESTAMPTZ | |

Migración: `003_sensores_bici_velocidades.sql` (con `npm run db:migrate`).

### Recurso

- **Dataset:** [Sensores Conteo Bicicleta Bogotá D.C.](https://datosabiertos.bogota.gov.co/dataset/sensores-conteo-bicicleta-bogota-d-c)
- **Hub ArcGIS / GeoJSON:** `http://datos-abiertos-sdm-movilidadbogota.hub.arcgis.com/datasets/a3c4aa2325734484ab0895aed8c2f4ac_0`

### Configuración y comando

En `.env`:

```env
SENSORES_BICI_GEOJSON_URL=http://datos-abiertos-sdm-movilidadbogota.hub.arcgis.com/datasets/a3c4aa2325734484ab0895aed8c2f4ac_0.geojson
```

O FeatureServer: `SENSORES_BICI_FEATURESERVER_URL` con la URL base del layer (se añade `/query`).

```bash
npm run etl:sensores-bici
```

Comportamiento: consume el recurso, hace UPSERT por `id_externo` (site_id/FID). **Primera fase:** solo ubicación; no se cargan series temporales de conteos.

### Verificación en BD

```sql
SELECT id_externo, nombre, direccion, ST_Y(geom) AS lat, ST_X(geom) AS lng FROM sensores_bici LIMIT 10;
```

### Segunda fase (diseño, no implementada aún)

Traer series temporales de conteos (por minuto/hora) del mismo recurso u otro endpoint, normalizarlas al CSV estándar (nodo_nombre, direccion, fecha, sentido, hora_inicio, hora_fin, vol_bicis, vol_total, …) y cargarlas con el mismo ETL CSV para integrarlas como estudios/aforos en `nodos` + `estudios` + `conteos_resumen`.

---

## 3.6 Velocidad actual en vía (CGT)

Pipeline: **FeatureServer velocidades CGT → etl_velocidades_cgt.js → tabla velocidades.**

### Tabla velocidades

| Columna         | Tipo               | Descripción |
|-----------------|--------------------|-------------|
| id              | SERIAL PRIMARY KEY | |
| tramo_id_externo| TEXT               | Identificador del tramo en CGT |
| fecha_hora      | TIMESTAMPTZ        | Momento del registro |
| vel_media_kmh   | NUMERIC(10,2)      | Velocidad media (km/h) |
| fuente          | TEXT               | Por defecto 'CGT_VELOCIDAD' |
| geom            | GEOMETRY(Point, 4326) | Opcional |
| created_at, updated_at | TIMESTAMPTZ | |

Constraint: `UNIQUE (tramo_id_externo, fecha_hora)` para UPSERT.

Migración: `003_sensores_bici_velocidades.sql`.

### Recurso

- **Dataset:** [Velocidad Actual en Vía. Bogotá D.C.](https://datosabiertos.bogota.gov.co/dataset/velocidad-actual-en-via-bogota-d-c)
- **FeatureServer:** `https://srvarcgis1.eastus.cloudapp.azure.com/agserver/rest/services/Hosted/V2_CGT_RegsVelocity_Recent_v2/FeatureServer/0`

### Configuración y comando

En `.env`:

```env
VELOCIDADES_CGT_FEATURESERVER_URL=https://srvarcgis1.eastus.cloudapp.azure.com/agserver/rest/services/Hosted/V2_CGT_RegsVelocity_Recent_v2/FeatureServer/0
```

```bash
npm run etl:velocidades:cgt
```

El script hace `query?where=1=1&outFields=*&returnGeometry=true&f=json&resultRecordCount=5000` e inserta/actualiza por (tramo_id_externo, fecha_hora). No se relaciona aún con nodos de aforo; más adelante se pueden hacer joins espaciales o por tramo.

### Verificación en BD

```sql
SELECT tramo_id_externo, fecha_hora, vel_media_kmh, fuente FROM velocidades ORDER BY fecha_hora DESC LIMIT 10;
```

---

## 3.7 Catálogo SDM transporte

Script para generar un **catálogo local** de datasets de transporte/movilidad desde Datos Abiertos Bogotá (CKAN), sin integrar aún con la BD.

### Script

- **Archivo:** `server/scripts/catalogo_sdm_transporte.js`
- **Salida:** `server/scripts/tmp/catalogo_sdm_transporte.json`

Comportamiento: llama a la API CKAN de Datos Abiertos (`package_search` con `q=transporte movilidad`), obtiene la lista de datasets y guarda por cada uno: `id`, `name`, `title`, `url`, `tags`, `resources` (con `format`, `url`, etc.). Opcionalmente se puede restringir por organización (Secretaría Distrital de Movilidad) o grupo cuando la API lo permita.

### Comando

```bash
npm run catalogo:sdm-transporte
```

### Contenido del JSON generado

Array de objetos con: `id`, `name`, `title`, `url`, `notes`, `tags`, `organization`, `resources` (cada recurso con `id`, `name`, `format`, `url`, `created`, `last_modified`). Sirve para decidir qué datasets integrar después (aforos, velocidades, bicis, etc.) y con qué URL recurso usar en cada ETL.

**Extracto de ejemplo** (datasets candidatos a integrar; el JSON real puede variar según la API CKAN):

| name | title | Uso en pipeline |
|------|--------|------------------|
| conteo-vehiculos-cgt-bogota-d-c | Conteo Vehículos CGT Bogotá D.C. | CGT_CSV_URL (GeoJSON) → etl:cgt |
| sensores-conteo-bicicleta-bogota-d-c | Sensores Conteo Bicicleta Bogotá D.C. | SENSORES_BICI_GEOJSON_URL → etl:sensores-bici |
| velocidad-actual-en-via-bogota-d-c | Velocidad Actual en Vía. Bogotá D.C. | VELOCIDADES_CGT_FEATURESERVER_URL → etl:velocidades:cgt |
| observatorio-movilidad-bogota-d-c | Observatorio de Movilidad. Bogotá D.C. | Diseño: Excel → tablas agregadas (ver 4.1) |

---

## 3.8 Ingesta de estudios SECOP (Paso 2: catálogo y descarga)

Pipeline para estudios de tránsito / ETT / EDAU publicados en SECOP II. En esta iteración solo se implementa: **catálogo de procesos** (API datos.gov.co) y **descarga + registro en archivos_fuente**. El parseo Excel→CSV estándar queda para la siguiente iteración.

- **Catálogo:** `node server/scripts/secop_catalogo_estudios.js` → `server/scripts/tmp/secop_catalogo_estudios.json`
- **Descarga y registro:** `node server/scripts/secop_descargar_anexos.js` → anexos en `data/secop/anexos/<id_proceso>/` e inserciones en `archivos_fuente` (origen = 'SECOP').

Documentación completa: **`docs/TAREA2_SECOP.md`**.

---

## 3.9 Fuentes y crecimiento de la base

Todas las fuentes alimentan la **misma estructura**: `nodos` (con `fuente` DIM o EXTERNO), `estudios` y `conteos_resumen`. El origen concreto (SECOP, PANORAMA, CGT, etc.) se rastrea en **archivos_fuente.origen** y en **estudios.archivo_fuente_id**.

| Fuente      | Cómo entra | Tabla/registro |
|-------------|------------|-----------------|
| DIM         | ETL Tarea 1 (JSON) | nodos.fuente=DIM, estudios sin archivo_fuente_id |
| SECOP       | secop:descargar → secop:procesar (adaptadores → CSV → ETL) | archivos_fuente.origen=SECOP, nodos EXTERNO |
| PANORAMA    | CSV estándar con origen=PANORAMA → etl_fuente_externa_csv.js | archivos_fuente.origen=PANORAMA, nodos EXTERNO |
| CGT_SDM     | etl:cgt (fetch_and_convert_cgt_csv → ETL CSV) | archivos_fuente.origen=CGT_SDM, nodos EXTERNO |
| Sensores bici | etl:sensores-bici | tabla sensores_bici (ubicaciones; conteos en fase futura) |
| Velocidades | etl:velocidades:cgt | tabla velocidades |

Para ver cómo crece la base por origen: `npm run stats:fuentes` (script `server/scripts/stats_fuentes_aforos.js`).

---

## 3.10 Estudios propios (Panorama) y ejecuciones periódicas

### Estudios Panorama (CSV estándar)

- **Formato:** mismo CSV estándar (nodo_nombre, direccion, fecha, sentido, hora_inicio, hora_fin, vol_*, etc.). Se recomienda columna **origen = PANORAMA**.
- **Comando:** `node server/scripts/etl_fuente_externa_csv.js --path=ruta/a/tu_estudio.csv`
- **Documentación detallada:** `docs/TAREA2_PANORAMA.md`

### Ejecuciones periódicas (CGT, sensores bici)

Para mantener actualizados nodos CGT, sensores de bici y (cuando aplique) velocidades, se pueden ejecutar los ETL de forma recurrente:

| Objetivo        | Comando | Frecuencia sugerida |
|-----------------|--------|---------------------|
| Actualizar conteos/nodos CGT | `npm run etl:cgt` (o `npm run etl:cgt:daily`) | Diaria o semanal |
| Actualizar sensores bici     | `npm run etl:sensores-bici` (o `npm run etl:sensores-bici:daily`) | Semanal |
| Velocidades en vía           | `npm run etl:velocidades:cgt` | Según necesidad |

Por ahora no hay scheduler integrado: se ejecutan **a mano** o con un programador externo (cron, Task Scheduler, etc.). Los scripts `etl:cgt:daily` y `etl:sensores-bici:daily` son alias de los mismos ETL para uso en cron/tareas programadas.

---

## 4. Qué no se hace en esta iteración

- Parser real de PDFs complejos (siguiente paso de Tarea 2).
- Cambios en el frontend.
- Nuevas rutas de API (más adelante se pueden añadir endpoints para listar fuentes externas o estudios por fuente).
- PMT (queda para cuando se definan fuentes/formatos de PMT).

### 4.1 Observatorio de Movilidad → BD (diseño)

Conjunto **“Observatorio de Movilidad. Bogotá D.C.”** en Datos Abiertos: varios Excel (C7_Gráficos y Tablas.xlsx, C9_..., hasta C15_... por modo).

- **Qué Excel usar primero:** por ejemplo el de automóviles/carga o el que entregue tablas agregadas por corredor o zona (no por punto de medición).
- **Transformación:** leer con librería (ej. xlsx), detectar tablas por hoja/corredor, normalizar a tablas agregadas por zona/corredor/fecha (no por nodo puntual). Posible tabla nueva `observatorio_agregado` (zona_id, corredor, fecha, modo, indicador, valor).
- **Asociación a nodos:** por join espacial (zona/corredor con geometría si existe) o por nombre de corredor/vía con `nodos.direccion` o `nodos.nombre`, para cruzar indicadores del Observatorio con aforos por nodo.

### 4.2 ETT/EDAU → BD (diseño)

Trámite SDM regulado por la **Resolución 132490 de 2023** (ETT/EDAU). Aforos suelen venir en anexos de estudios (Excel/PDF) publicados o referenciados en SECOP II / convenios con la SDM.

- **Obtención de datos:** usar SECOP II o fuentes de convenios SDM para localizar procesos que incluyan anexos de aforo; descargar o enlazar esos anexos (Excel/PDF).
- **Normalización:** extraer de cada anexo las tablas de conteo (intersección, fecha, sentido, intervalo, vol_total y desglose por tipo) y convertirlas al **CSV estándar** actual (archivo_nombre, origen, nodo_nombre, direccion, fecha, sentido, hora_inicio, hora_fin, vol_total, vol_livianos, vol_motos, vol_buses, vol_pesados, vol_bicis).
- **Carga:** usar el mismo **ETL CSV** (`etl_fuente_externa_csv.js --path=...`) para cargar en `archivos_fuente`, `nodos` (EXTERNO), `estudios` y `conteos_resumen`, con la misma idempotencia y geocoding que el resto de fuentes externas.

---

## 5. Resumen de archivos

| Archivo | Descripción |
|---------|-------------|
| `server/db/migrations/002_tarea2_fuentes_externas.sql` | Tabla `archivos_fuente` y columna `estudios.archivo_fuente_id`. |
| `server/scripts/etl_fuente_externa_demo.js` | Script de ingesta demo (JSON → archivos_fuente, nodo, estudio, conteos_resumen). |
| `server/scripts/etl_fuente_externa_csv.js` | Script ETL real para CSV (formato estándar; idempotente). |
| `server/scripts/data/estudio_externo_ejemplo.json` | JSON de ejemplo con ubicación, fechas y conteos. |
| `server/scripts/data/estudio_externo_real.csv` | CSV de ejemplo con 2 nodos y varios intervalos (Calle 80 con NQS, AK 15 con CL 127). |
| `server/scripts/fetch_and_convert_cgt_csv.js` | Descarga/consulta CGT, convierte a CSV estándar e invoca el ETL CSV. |
| `server/scripts/utils/geocoding.js` | Geocoding: diccionario local + ArcGIS opcional; usado por el ETL CSV al crear nodos EXTERNO. |
| `server/db/migrations/003_sensores_bici_velocidades.sql` | Tablas `sensores_bici` y `velocidades`. |
| `server/scripts/etl_sensores_bici.js` | ETL sensores de conteo bicicleta (GeoJSON/FeatureServer → sensores_bici). |
| `server/scripts/etl_velocidades_cgt.js` | ETL velocidad actual en vía (FeatureServer CGT → velocidades). |
| `server/scripts/catalogo_sdm_transporte.js` | Catálogo CKAN transporte/movilidad → `tmp/catalogo_sdm_transporte.json`. |
| `server/scripts/secop_catalogo_estudios.js` | Catálogo SECOP II (estudios tránsito/ETT/EDAU Bogotá) → `tmp/secop_catalogo_estudios.json`. |
| `server/scripts/secop_descargar_anexos.js` | Descarga anexos candidatos y registro en `archivos_fuente`; anexos en `data/secop/anexos/`. |
| `server/scripts/secop_procesar_anexos.js` | Convierte anexos SECOP (plantillas A/B/C/D) a CSV estándar y ejecuta ETL CSV. |
| `server/scripts/stats_fuentes_aforos.js` | Estadísticas por fuente: nodos, estudios, conteos_resumen por origen. |
| `server/scripts/tmp/` | `cgt_raw.csv`, `cgt_standard.csv`, `secop_catalogo_estudios.json`, `secop_estudio_*.csv`. |
| `docs/TAREA2_PLAN.md` | Este documento (flujo y uso del script). |
| `docs/TAREA2_SECOP.md` | Ingesta SECOP: catálogo, descarga, plantillas, procesar. |
| `docs/TAREA2_PANORAMA.md` | Estudios propios (Panorama): formato CSV y comando de carga. |

Scripts npm (flujo real): `etl:fuente-externa-csv` (requiere `--path=...`), `etl:cgt`, `etl:sensores-bici`, `etl:velocidades:cgt`, `catalogo:sdm-transporte`, `secop:catalogo`, `secop:descargar`, `secop:procesar`, `secop:pdf`, `etl:pdf`, `ckan:registrar-aforos`, `datos-abiertos:descargar`, `scraper:portales`, `stats:fuentes`. Opcionales para pruebas locales: `etl:fuente-externa-demo`, `secop:ejemplo`, `seed:aforos-secop`.

---

## 6. Resumen para comunicación

**Tarea 1:** Se migró todo el historial de aforos DIM a PostgreSQL/PostGIS (tablas `nodos`, `estudios`, `conteos_resumen`) y se cambió la API para que **nunca más lea los JSON grandes** (`ia_historial.json`, `studies_dictionary.json`) en runtime. Las rutas `/api/aforos/historial/:nodeId` y `/api/aforos/geocode/:nodeId` leen solo de la BD.

**Tarea 2 (fase 0):** Ya está el andamiaje para incorporar estudios externos: tabla `archivos_fuente`, creación de nodos con `fuente = 'EXTERNO'` (p. ej. `node_id_externo` tipo `ext-1-1`), estudios externos vinculados por `archivo_fuente_id` y conteos en el **mismo formato** que DIM en `conteos_resumen`. La API devuelve el historial de nodos externos con la misma forma que la de los nodos DIM.
