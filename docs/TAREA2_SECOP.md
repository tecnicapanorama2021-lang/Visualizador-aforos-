# Ingesta de estudios SECOP (Paso 2 y 3)

Pipeline para estudios de tránsito / ETT / EDAU publicados en **SECOP II**. Incluye: **catálogo de procesos**, **descarga y registro** en `archivos_fuente`, y **transformación a CSV estándar + ETL** (adaptadores por plantilla).

---

## 1. Catálogo de procesos SECOP

### Script

- **Archivo:** `server/scripts/secop_catalogo_estudios.js`

### Fuente de datos

- **API oficial** de Datos Abiertos Colombia (Socrata): dataset [SECOP II Procesos de Contratación](https://www.datos.gov.co/Gastos-Gubernamentales/SECOP-II-Procesos-de-Contrataci-n/p6dx-8zbt).
- No se hace scraping de HTML; la API devuelve JSON con procesos. Opcionalmente se puede intentar extraer enlaces a anexos de la página del proceso (ver más abajo).

### Comportamiento

- Busca procesos con palabras clave en objeto/descripción: *estudio de tránsito*, *estudio de movilidad*, *ETT*, *EDAU*, *Plan de Manejo de Tránsito*, *PMT*, *aforo vehicular*, *conteo vehicular*, *Bogotá movilidad*.
- Filtra por relación con Bogotá (entidad, ciudad, departamento).
- Guarda en **`server/scripts/tmp/secop_catalogo_estudios.json`**.

### Cómo ejecutar

```bash
node server/scripts/secop_catalogo_estudios.js
```

Opcional: para intentar extraer anexos desde la página de cada proceso (scraping ligero de enlaces .xlsx/.csv/.pdf):

```bash
SECOP_FETCH_ANEXOS=1 node server/scripts/secop_catalogo_estudios.js
```

### Formato del JSON de catálogo

Cada entrada tiene la forma:

```json
{
  "id_proceso": "CO1.REQ.37003",
  "referencia_proceso": "ICGH-1021-2015",
  "objeto": "PRESTACIÓN DE SERVICIOS DE ASESORÍA PARA LA ELABORACIÓN DEL PLAN ESTRATÉGICO DE SEGURIDAD VIAL...",
  "nombre_procedimiento": "PRESTACIÓN DE SERVICIOS DE ASESORÍA...",
  "entidad": "EMPRESA DE ACUEDUCTO Y ALCANTARILLADO DE BOGOTÁ - E.S.P.",
  "fecha_publicacion": "2016-02-02T00:00:00.000",
  "url_proceso": "https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.34902",
  "anexos": [
    { "nombre": "Anexo_Aforos.xlsx", "url": "https://...", "tipo": "XLSX" },
    { "nombre": "Matriz_conteos.csv", "url": "https://...", "tipo": "CSV" }
  ]
}
```

Si no se usa `SECOP_FETCH_ANEXOS=1`, `anexos` vendrá vacío; ejecutar con **`SECOP_FETCH_ANEXOS=1`** para intentar extraer enlaces a anexos desde la página HTML de cada proceso.

**Fuente única:** el catálogo se genera **solo** con la API real de SECOP II (datos.gov.co). No se usan catálogos de ejemplo ni archivos dummy.

---

## 2. Descarga y registro de anexos

### Script

- **Archivo:** `server/scripts/secop_descargar_anexos.js`

### Entrada

- Lee **`server/scripts/tmp/secop_catalogo_estudios.json`** (generado en el paso 1).

### Comportamiento

- Recorre cada proceso y sus `anexos`.
- Considera **candidato** un anexo si:
  - Tiene extensión `.xlsx`, `.xls` o `.csv`, **o**
  - El nombre del archivo contiene: *aforo*, *conteo*, *tránsito*, *trafico*, *movilidad*, *transito*, *volumen*, *estudio*.
- Para cada anexo candidato:
  - **Descarga** el archivo y lo guarda en **`data/secop/anexos/<id_proceso>/<nombre_archivo>`**.
  - Calcula **hash SHA-256** del contenido.
  - **Registra o actualiza** en la tabla **`archivos_fuente`** con:
    - `origen = 'SECOP'`
    - `tipo = 'XLSX'` o `'CSV'` (según extensión)
    - `nombre_archivo` = nombre del archivo
    - `hash` = SHA-256
    - `procesado = FALSE`
    - `origen_id` = id_proceso (si existe la columna; ver migración 004)

### Idempotencia

- Si el archivo **ya existe** en disco en la ruta esperada, no se vuelve a descargar (se reutiliza y se recalcula el hash).
- Si ya existe un registro en `archivos_fuente` con el mismo **hash** y **origen = 'SECOP'**, no se inserta otro (se cuenta como “ya existía”).

### Cómo ejecutar

```bash
node server/scripts/secop_descargar_anexos.js
```

Requisitos: haber ejecutado antes el catálogo (paso 1) y tener Postgres accesible (`npm run db:migrate` aplicado, incluyendo la migración 004 si se usa `origen_id`).

### Ruta de los anexos descargados

- **Ruta exacta:** `data/secop/anexos/<id_proceso>/<nombre_archivo>`
- Ejemplo: `data/secop/anexos/CO1.REQ.37003/Anexo_Aforos.xlsx`

### Logs

El script escribe en consola, entre otros:

- Procesos en catálogo: X
- Anexos candidatos: Y
- Descargados nuevos: Z, reutilizados: W
- Registrados en archivos_fuente: N, ya existían (por hash): M

---

## 3. Plantillas de mapeo al CSV estándar

Los adaptadores convierten anexos SECOP (XLSX/CSV) al **CSV estándar** que consume `etl_fuente_externa_csv.js`. Se reconocen por nombre de archivo y se aplica el mapeo de columnas siguiente.

### Plantilla SECOP A: Matriz Aforos (XLSX)

- **Nombre de anexo:** contiene "Matriz" y "Aforo" (ej. `Anexo_3_Matriz_Aforos.xlsx`).
- **Archivo:** `server/scripts/secop_adaptadores.js` → `adaptarMatrizAforosXLSX`.

| Origen (Excel) | CSV estándar | Notas |
|----------------|--------------|--------|
| interseccion / direccion / ubicacion / punto | direccion | Se prueba el primero no vacío. |
| via_principal + via_secundaria | direccion | Si no hay interseccion, se concatena. |
| nodo_nombre / nombre | nodo_nombre | |
| fecha / fecha_conteo / fecha_estudio | fecha | Se normaliza a YYYY-MM-DD. |
| sentido / direccion_flujo / flujo | sentido | Se normaliza a NS, SN, EO, OE si aplica. |
| hora_inicio / hora_ini / hora | hora_inicio | |
| hora_fin / hora_final | hora_fin | Si solo hay un valor tipo "07:00-07:15", se parte en inicio/fin. |
| vol_total / total / intensidad / volumen | vol_total | |
| vol_livianos / livianos / autos | vol_livianos | |
| vol_motos, vol_buses, vol_pesados, vol_bicis | idem | Nombres alternativos: buses, pesados/camiones, bicis/bicicletas. |

### Plantilla SECOP B: Resumen conteos (CSV)

- **Nombre de anexo:** contiene "Resumen" y "conteo" (ej. `Resumen_conteos.csv`).
- **Archivo:** `server/scripts/secop_adaptadores.js` → `adaptarResumenConteosCSV`.
- **Mapeo:** igual que Plantilla A; el CSV puede usar **coma** o **punto y coma** como separador (se detecta automáticamente).

Para añadir nuevas plantillas en el futuro: definir en `secop_adaptadores.js` un nuevo mapeo o variante de `buildColumnMapPlantillaA` y registrar el nombre/patrón en `secop_procesar_anexos.js` (función `coincideConPlantilla`).

### Plantilla SECOP C: Matriz Aforos por Intersección (XLSX)

- **Nombre de anexo:** contiene "Matriz_Aforos_Interseccion" o "Matriz Aforos Interseccion" (ej. `Matriz_Aforos_Interseccion_Corredor.xlsx`).
- **Archivo:** `server/scripts/secop_adaptadores.js` → `adaptarPlantillaC_XLSX`.

| Origen (Excel) | CSV estándar | Notas |
|----------------|--------------|--------|
| INTERSECCION / INTERSECCIÓN / PUNTO_MEDICION | direccion | Se prueba el primero no vacío. |
| VIA_PRINCIPAL, VIA_SECUNDARIA | direccion | Si no hay INTERSECCION, se concatena. |
| FECHA / FECHA_CONTEO / FECHA_ESTUDIO | fecha | YYYY-MM-DD. |
| SENTIDO / DIRECCION_FLUJO / FLUJO | sentido | NS, SN, EO, OE. |
| HORA_INI / HORA_INICIO, HORA_FIN / HORA_FINAL | hora_inicio, hora_fin | O columna INTERVALO "07:00-07:15". |
| V_TOTAL / VOL_TOTAL / TOTAL / INTENSIDAD | vol_total | |
| V_LIVIANOS / VOL_LIVIANOS / LIVIANOS | vol_livianos | |
| V_MOTOS, V_BUSES, V_PESADOS, V_BICIS | idem | Nombres con prefijo V_ o VOL_. |

### Plantilla SECOP D: Conteos PMT (CSV)

- **Nombre de anexo:** contiene "Conteos_PMT" o "Conteos PMT" (ej. `Conteos_PMT_2024.csv`, `Anexo_Conteos_PMT.xlsx`).
- **Archivo:** `server/scripts/secop_adaptadores.js` → `adaptarPlantillaD_CSV` (CSV) o `adaptarPlantillaD_XLSX` (Excel).
- **Mapeo:** columnas típicas de PMT (Plan de Manejo de Tránsito):

| Origen (CSV/Excel) | CSV estándar | Notas |
|--------------------|--------------|--------|
| PUNTO / INTERSECCION / UBICACION | direccion | |
| VIA_PRINCIPAL, VIA_SECUNDARIA | direccion | Concatenación si no hay PUNTO. |
| FECHA_ESTUDIO / FECHA / FECHA_CONTEO | fecha | YYYY-MM-DD. |
| SENTIDO / FLUJO | sentido | NS, SN, EO, OE. |
| INTERVALO / HORA_RANGO / HORA_INI, HORA_FIN | hora_inicio, hora_fin | |
| VOL_TOTAL / V_TOTAL / TOTAL | vol_total | |
| VOL_LIVIANOS, VOL_MOTOS, VOL_BUSES, VOL_PESADOS, VOL_BICIS | idem | |

---

## 4. Procesar anexos (convertir + ETL)

### Script

- **Archivo:** `server/scripts/secop_procesar_anexos.js`

### Comportamiento

1. Lee de `archivos_fuente` los registros con `origen = 'SECOP'`, `tipo IN ('XLSX', 'CSV')`, `procesado = FALSE`.
2. Filtra por nombre: anexos que coinciden con **Plantilla A** (Matriz Aforos), **B** (Resumen conteos), **C** (Matriz Aforos Intersección) o **D** (Conteos PMT).
3. Para cada candidato:
   - **Ruta de entrada:** `data/secop/anexos/<origen_id>/<nombre_archivo>`.
   - **Salida:** `server/scripts/tmp/secop_estudio_<id>.csv` (CSV estándar).
   - Llama al adaptador correspondiente (XLSX o CSV).
   - Ejecuta en subproceso: `node server/scripts/etl_fuente_externa_csv.js --path=...`
   - Si el ETL termina bien, actualiza `archivos_fuente.procesado = TRUE`.

Es **idempotente**: el ETL hace UPSERT por (nodo, estudio, sentido, intervalo); no se duplican estudios ni conteos si se vuelve a correr (y los archivos ya procesados tienen `procesado = TRUE`).

### Cómo ejecutar

```bash
npm run secop:procesar
```

Requisitos: haber ejecutado **`npm run secop:catalogo`** (API real) y **`npm run secop:descargar`**; los anexos deben estar en `data/secop/anexos/<id_proceso>/` y registrados en `archivos_fuente`.

---

## 5. Ejemplo de salida (1 fila CSV, nodo EXTERNO, conteos)

**Una fila del CSV estándar generado** desde un Excel SECOP (Plantilla A), por ejemplo en `server/scripts/tmp/secop_estudio_6.csv`:

```csv
archivo_nombre,origen,nodo_nombre,direccion,fecha,sentido,hora_inicio,hora_fin,vol_total,vol_livianos,vol_motos,vol_buses,vol_pesados,vol_bicis
Anexo_3_Matriz_Aforos.xlsx,SECOP,CALLE 80 X NQS,CALLE 80 X NQS,2025-01-15,NS,07:00,07:15,98,65,18,4,8,3
```

**Nodo EXTERNO creado** en `nodos` (tras ejecutar el ETL):

| node_id_externo | direccion      | fuente  |
|-----------------|----------------|---------|
| ext-6-1         | CALLE 80 X NQS | EXTERNO |

(El número en `ext-6-1` depende del `archivos_fuente.id` asignado al CSV en esa ejecución.)

**Filas en `conteos_resumen`** para ese estudio (ejemplo):

| estudio_id | sentido | intervalo_ini (ej.) | vol_total | vol_autos | vol_motos | ... |
|------------|---------|----------------------|-----------|-----------|-----------|---|
| (id)       | NS      | 2025-01-15 07:00     | 98        | 65        | 18        | 4, 8, 3 |
| (id)       | NS      | 2025-01-15 07:15     | 112       | 72        | 22        | ... |
| (id)       | SN      | 2025-01-15 07:00     | 85        | 58        | 15        | ... |

---

## 6. Integración con archivos_fuente

- El script de descarga usa el mismo **cliente Postgres** (`server/db/client.js`) que el resto del proyecto.
- El script de procesado **sí** invoca `etl_fuente_externa_csv.js` tras generar el CSV estándar; no modifica el ETL, solo lo ejecuta como subproceso.
- La migración **004_archivos_fuente_origen_id.sql** añade la columna opcional **`origen_id`** para guardar `id_proceso` y construir la ruta `data/secop/anexos/<origen_id>/<nombre_archivo>`.

---

## 7. Cadena completa (resumen de comandos)

1. **Catálogo:** `npm run secop:catalogo` → genera `server/scripts/tmp/secop_catalogo_estudios.json`.
2. **Descarga:** `npm run secop:descargar` → descarga anexos candidatos (XLSX, CSV, **PDF**) a `data/secop/anexos/<id_proceso>/` y los registra en `archivos_fuente` (origen SECOP).
3. **Procesar XLSX/CSV:** `npm run secop:procesar` → convierte anexos (Plantillas A, B, C, D) a CSV estándar, ejecuta el ETL y marca `procesado = TRUE`.
4. **Procesar PDF:** `npm run secop:pdf` → extracción de tablas (Python) + PlantillaPDF_1 → ETL CSV. Ver **docs/TAREA3_PDF_SECOP.md**.

Toda la cadena usa **solo datos reales** de la API SECOP II y anexos descargados desde las URLs obtenidas (o desde `SECOP_FETCH_ANEXOS=1`). Para la tabla de **todas las fuentes reales** (SECOP, SDP, SDM, DATOS_ABIERTOS, PRIVADO) y los scripts que las procesan, ver **docs/TAREA3_PDF_SECOP.md** (§ Fuentes de datos: todas reales y públicas).

---

## 8. Explorar anexos SECOP pendientes y nuevas plantillas

Para listar anexos SECOP aún no procesados (y ver nombres reales para definir nuevas plantillas):

```sql
SELECT id, nombre_archivo, origen, tipo, origen_id
FROM archivos_fuente
WHERE origen = 'SECOP' AND procesado = FALSE
ORDER BY origen_id, nombre_archivo;
```

Nombres ya soportados por plantilla: **A** (*Matriz*Aforos*.xlsx), **B** (*Resumen*conteos*.csv), **C** (*Matriz*Aforos*Interseccion*.xlsx), **D** (*Conteos*PMT*.csv o .xlsx). Para añadir más: inspeccionar columnas del anexo, definir el mapeo en `secop_adaptadores.js` y añadir el patrón en `coincideConPlantilla` de `secop_procesar_anexos.js`. Otros candidatos típicos: *Aforos_Vehiculares_*.xlsx*.

---

## 9. Resumen de comandos

| Paso | Comando |
|------|--------|
| Migración (origen_id) | `npm run db:migrate` |
| Catálogo SECOP | `npm run secop:catalogo` |
| Catálogo + intentar anexos | `SECOP_FETCH_ANEXOS=1 npm run secop:catalogo` |
| Descarga y registro | `npm run secop:descargar` |
| Procesar anexos (convertir + ETL) | `npm run secop:procesar` |
| Procesar PDF SECOP | `npm run secop:pdf` |

- **JSON de catálogo:** `server/scripts/tmp/secop_catalogo_estudios.json`
- **Anexos en disco:** `data/secop/anexos/<id_proceso>/<nombre_archivo>`
- **CSV estándar generado por archivo:** `server/scripts/tmp/secop_estudio_<archivos_fuente.id>.csv`
