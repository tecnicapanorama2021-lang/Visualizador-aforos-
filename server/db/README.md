# Base de datos PostgreSQL + PostGIS (Aforos / Tarea 1)

El backend **no usa Docker** para la BD. Se asume PostgreSQL + PostGIS instalados en el servidor (o en tu máquina de desarrollo). Las rutas `/api/aforos/historial/:nodeId` y `/api/aforos/geocode/:nodeId` se alimentan **exclusivamente** de Postgres; los JSON (`studies_dictionary.json`, `nodos_unificados.json`, `ia_historial.json`) solo se usan en el **proceso ETL**, no en runtime.

---

## 1. Requisitos

- **PostgreSQL 14+** con extensión **PostGIS** (recomendado: 15 o 16).
- Variables de entorno para la conexión (ver más abajo).

---

## 2. Preparar la BD (sin Docker)

### 2.1 Instalar PostgreSQL + PostGIS

- **Windows:** [PostgreSQL installer](https://www.postgresql.org/download/windows/) y luego instalar la extensión PostGIS desde Stack Builder o desde el instalador que incluya PostGIS.
- **Linux (ej. Ubuntu/Debian):** `sudo apt install postgresql-15 postgresql-15-postgis-3`.
- **macOS:** `brew install postgresql@15 postgis`.

Versión mínima recomendada: **PostgreSQL 14** con **PostGIS 3.x**.

### 2.2 Crear la base de datos y habilitar PostGIS

```bash
createdb aforos_db
psql aforos_db -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

(Puedes usar otro nombre de BD; luego lo indicas con `PGDATABASE`.)

### 2.3 Variables de entorno

Configura la conexión **solo con variables de entorno** (nada hardcodeado). Opciones:

**Opción A – Parámetros por separado (recomendado en servidor):**

```bash
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=aforos_db
export PGUSER=mi_usuario
export PGPASSWORD=mi_contraseña
```

**Opción B – URL única:**

```bash
export DATABASE_URL="postgresql://mi_usuario:mi_contraseña@localhost:5432/aforos_db"
```

El cliente en `server/db/client.js` usa por defecto `PGDATABASE=aforos` si no pones nada; puedes usar `aforos_db` o el nombre que hayas dado al `createdb`.

---

## 3. Migraciones y carga inicial

### 3.1 Solo migrar (esquema)

Si la BD está vacía y solo quieres crear tablas e índices:

```bash
npm run db:migrate
```

Aplica todas las migraciones en `server/db/migrations/` en orden (001_init.sql, 002_tarea2_fuentes_externas.sql, etc.). Salida esperada: una línea por archivo aplicado.

### 3.2 Carga completa (recomendado la primera vez)

Un solo comando que aplica la migración y carga **todo** desde los JSON a la BD:

```bash
npm run db:full-load
```

Este script:

1. Comprueba la conexión a Postgres.
2. Aplica `server/db/migrations/001_init.sql`.
3. Ejecuta el ETL de nodos y estudios (`studies_dictionary.json` + `nodos_unificados.json`).
4. Ejecuta el ETL de conteos desde `ia_historial.json` (por **streaming**; no carga el archivo entero en memoria).
5. Escribe en consola los totales cargados.

**Salida de consola esperada** (los números dependerán de tus datos):

```
[db:full-load] Conexión a Postgres OK.
[db:full-load] Migración 001_init.sql aplicada.
[db:full-load] Ejecutando: server/scripts/etl_nodos_estudios_from_json.js
[ETL Fase 1] Resumen:
  Nodos insertados: ...
  Nodos actualizados: ...
  Estudios insertados: ...
  Estudios actualizados: ...
[db:full-load] Ejecutando: server/scripts/etl_conteos_from_historial.js
[ETL Fase 2] Leyendo ia_historial.json por streaming: ...
...
[db:full-load] Totales en BD:
  Nodos:            XXX
  Estudios:         YYYY
  Conteos_resumen:  ZZZZZ
[db:full-load] Carga inicial completada.
```

### 3.3 ETL por pasos (opcional)

Si prefieres ejecutar migración y ETL por separado:

```bash
npm run db:migrate
npm run etl:nodos-estudios
npm run etl:conteos
```

**Reejecutar solo la Fase 2 (conteos desde ia_historial.json):**

```bash
npm run etl:conteos
```

Lee `ia_historial.json` por **streaming** (sin cargar el archivo entero). Idempotente (UPSERT).

### 3.4 Asignar UPZ y localidad a nodos

Para que los nodos tengan `upz_id` y `localidad_id` (y la API de historial devuelva `upz`, `upz_codigo`, `localidad`, `localidad_codigo`), hace falta:

1. Tener en `data/zonas/` los GeoJSON de Bogotá:
   - `data/zonas/localidades_bogota.geojson`
   - `data/zonas/upz_bogota.geojson`
2. Ejecutar el ETL de zonas:

```bash
npm run etl:zonas
```

El script `etl_zonas_ideca.js` lee primero esos archivos locales; si no existen, intenta descargar desde IDECA WFS, ArcGIS o CKAN. Para no depender de fuentes remotas, se recomienda colocar ambos GeoJSON en `data/zonas/` y volver a correr `npm run etl:zonas`.

---

## 4. Levantar el backend y probar

### 4.1 Arrancar la API

Con la BD ya cargada:

```bash
npm run dev:api
```

(O `npm run dev` si quieres front + API.)

### 4.2 Probar rutas clave

- **Historial por nodo** (`:nodeId` = `node_id_externo`, ej. `171`, `136`):

```bash
curl -s http://localhost:3001/api/aforos/historial/171 | jq .
```

Respuesta esperada: **200** y un JSON con `node_id`, `address`, `historico` (array de estudios con `analisis`, `distribucion_hora_pico`, etc.), `estadisticas`. Si el nodo no existe: 404.

- **Geocode (coordenadas del nodo desde la BD):**

```bash
curl -s http://localhost:3001/api/aforos/geocode/171 | jq .
```

Respuesta esperada: **200** y algo como `{ "lat": 4.77, "lng": -74.04 }`. Si el nodo no existe o no tiene geometría: 404.

Puedes probar con otros `nodeId` que existan en tu `studies_dictionary.json` (las claves del objeto `nodes`).

### 4.3 Comprobar que no se leen los JSON en runtime

- Ninguna ruta de Express hace `fs.readFileSync` de `ia_historial.json` ni de `studies_dictionary.json`. Las rutas `/api/aforos/historial/:nodeId` y `/api/aforos/geocode/:nodeId` dependen **únicamente** de PostgreSQL (tablas `nodos`, `estudios`, `conteos_resumen`).
- No queda en el servidor ninguna función que lea esos JSON en runtime; solo los scripts ETL (`etl_nodos_estudios_from_json.js`, `etl_conteos_from_historial.js`) y el generador de historial (`buildHistorialMasivo.js`) usan esos archivos.
- Si **borras o archivas** `ia_historial.json` (y/o los otros JSON) en el servidor de producción, el backend sigue respondiendo bien mientras la BD esté poblada. Los JSON solo hacen falta donde se ejecute el ETL (p. ej. entorno de carga o recargas).

---

## 4.4 Checks rápidos (validación de datos)

Con la BD cargada, puedes comprobar totales y una muestra de `conteos_resumen`:

```sql
-- Totales
SELECT (SELECT COUNT(*) FROM nodos) AS nodos,
       (SELECT COUNT(*) FROM estudios) AS estudios,
       (SELECT COUNT(*) FROM conteos_resumen) AS conteos_resumen;

-- Ejemplo: 5 filas de conteos_resumen para un estudio concreto
SELECT * FROM conteos_resumen
WHERE estudio_id = (SELECT id FROM estudios LIMIT 1)
ORDER BY intervalo_ini
LIMIT 5;
```

**Ejemplo de nodeId con datos:** `171` (varios estudios y conteos). Respuesta parcial de `GET /api/aforos/historial/171` donde se ve que `analisis.vol_data_completo` tiene filas:

```bash
curl -s http://localhost:3001/api/aforos/historial/171 | jq '.historico[0].analisis.vol_data_completo | length'
```

(Si devuelve un número > 0, ese estudio tiene conteos por intervalo.)

Ejemplo de fragmento de respuesta (primer estudio, primeros 2 elementos de `vol_data_completo`):

```bash
curl -s http://localhost:3001/api/aforos/historial/171 | jq '.historico[0].analisis.vol_data_completo[0:2]'
```

Salida típica (shape):

```json
[
  {
    "sentido": "NS",
    "horaRango": "5:00 - 5:15",
    "total": 19,
    "classes": { "LIVIANOS": 13, "MOTOS": 2, "BICICLETAS": 1, ... }
  },
  {
    "sentido": "NS",
    "horaRango": "5:15 - 5:30",
    "total": 22,
    "classes": { ... }
  }
]
```

---

## 5. Esquema (resumen)

- **nodos:** id, internal_id_dim (UNIQUE), node_id_externo (UNIQUE, clave del API), nombre, direccion, geom (Point 4326), fuente (DIM | EXTERNO). Índice GIST en geom.
- **estudios:** id, nodo_id (FK), file_id_dim, tipo_estudio, fecha_inicio/fin, download_url, contratista, total_records, vehicle_types, fuente (DIM | EXTERNO), archivo_fuente_id (FK, NULL para DIM). UNIQUE (nodo_id, file_id_dim).
- **conteos_resumen:** id, estudio_id (FK), sentido, intervalo_ini/fin, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros. UNIQUE (estudio_id, sentido, intervalo_ini).
- **archivos_fuente (Tarea 2):** id, tipo (PDF/XLSX/CSV/JSON), origen, nombre_archivo, hash, procesado. Registro de archivos externos para ingesta; ver `docs/TAREA2_PLAN.md` y `npm run etl:fuente-externa-demo`.
- **contexto_eventos:** obras (IDU, etc.) y eventos (RSS). Incluye localidad_id, upz_id (012), ubicacion_texto, zona_texto (012). Ver abajo.

### 5.1 Geometría en contexto_eventos (obras vs eventos)

- **Obras:** Tienen geometría de origen (IDU, ArcGIS, CKAN). Se cargan con `geom` desde el JSON del calendario. Tras `etl:contexto-zonas` reciben `localidad_id` y `upz_id` por `ST_Intersects` con las tablas de zonas.
- **Eventos RSS (culturales, cierres, manifestaciones):** El calendario solo aporta texto de ubicación (p. ej. "Parque Simón Bolívar", "Carrera 7"). Se persiste en `ubicacion_texto` y `zona_texto`. La geometría es **aproximada**: el script `etl:contexto-geocode` usa una lista fija de lugares/vías de Bogotá (`server/utils/lugaresBogota.js`) para asignar un punto cuando el texto hace match. No todos los eventos tendrán punto; la localización es aproximada (un lugar puede ser una zona amplia).
- **Secuencia recomendada:** `npm run etl:contexto` → `npm run etl:contexto-geocode` → `npm run etl:contexto-zonas`. El endpoint `GET /api/datos-unificados/contexto-eventos` devuelve `geometry`, `ubicacion_texto`, `zona_texto`, `localidad_nombre`, `upz_nombre`, etc., para pintar obras y eventos en el mapa.

### 5.2 Estudios de tránsito enriquecidos (migración 013)

- **estudios_transito:** catálogo por documento (008). **vias_estudio**, **puntos_criticos_estudio**, **infraestructura_vial**, **proyecciones_estudio** (013) almacenan red vial, puntos críticos, señalización y escenarios proyectados por estudio.
- PDFs unificados en `data/estudios-transito/PDFs/{SDP,SECOP,PRIVADO,OTROS}`; extracciones en `data/estudios-transito/extracciones/` y catálogo en `index.json`. Ver **`docs/ESTRUCTURA_ESTUDIOS_TRANSITO.md`** (estructura de carpetas, cómo subir PDFs, qué extrae el ETL).
- ETL: `npm run etl:estudios-transito`. API: `GET /api/estudios-transito/vias`, `/puntos-criticos`, `/infraestructura`, `/proyecciones` (query `estudio_id`).

---

## 6. Producción

- Usar un servidor o servicio gestionado con PostgreSQL + PostGIS (sin Docker si así lo prefieres).
- Configurar **solo** variables de entorno (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` o `DATABASE_URL`).
- Opcional: PgBouncer u otro pooler delante de Postgres; el cliente usa `pg.Pool` y es compatible.

---

## 7. Docker (opcional)

Si en algún momento quieres usar Docker solo como ejemplo o en desarrollo local, hay un `docker-compose` en la carpeta **`deprecated/`** (ver `deprecated/README.md`). El proyecto no depende de él para producción.
