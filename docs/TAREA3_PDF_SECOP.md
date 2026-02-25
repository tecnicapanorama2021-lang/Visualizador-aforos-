# Tarea 3: PDFs SECOP y portales – flujo semi-automatizado

Flujo para detectar, descargar y procesar anexos PDF de estudios de tránsito (SECOP y portales SDM/SDP), extraer tablas de aforos y cargarlos en la BD mediante el CSV estándar y `etl_fuente_externa_csv.js`.

---

## 1. Resumen del flujo

1. **Catálogo SECOP:** `npm run secop:catalogo` → genera `secop_catalogo_estudios.json`.
2. **Descarga anexos (XLSX, CSV, PDF):** `npm run secop:descargar` → descarga a `data/secop/anexos/<id_proceso>/` y registra en `archivos_fuente` (origen SECOP, tipo XLSX/CSV/PDF).
3. **Procesar Excel/CSV:** `npm run secop:procesar` → plantillas A/B/C/D → ETL CSV (sin cambios).
4. **Procesar PDF:** `npm run secop:pdf` → extracción de tablas (Python) → adaptador PlantillaPDF_1 → CSV estándar → ETL CSV → `procesado = TRUE`.
5. **Estadísticas:** `npm run stats:fuentes` → incluye conteos por tipo y PDF procesados/pendientes.

Opcional: **Scraper portales** `node server/scripts/scraper_portales.js` descubre enlaces en páginas SDM/SDP y los registra en `archivos_fuente` (con `url_remota`).

---

## 2. Fuentes de datos: todas reales y públicas

Todo lo que entra a la BD proviene de **fuentes reales** (APIs oficiales, portales públicos o archivos que tú registras). No se usan catálogos de ejemplo ni archivos dummy.

| Origen | Tipo | Ejemplos de URLs / procedencia | Script que procesa |
|--------|------|--------------------------------|---------------------|
| **SECOP** | XLSX, CSV, PDF | API [SECOP II – datos.gov.co](https://www.datos.gov.co/Gastos-Gubernamentales/SECOP-II-Procesos-de-Contrataci-n/p6dx-8zbt); anexos descargados desde enlaces del proceso | `secop_catalogo_estudios.js`, `secop_descargar_anexos.js`, `secop_procesar_anexos.js`, `etl_pdf_secop.js` |
| **SDP** | PDF, XLSX, CSV | sdp.gov.co (estudios PPRU: Nueva Aranda, El Carmen, informe tránsito vf, etc.) | `scraper_portales.js` → registro; descarga manual o script → `etl_pdf_generico.js` / `etl_fuente_externa_csv.js` |
| **SDM** | PDF, XLSX, CSV | movilidadbogota.gov.co, simur.gov.co/pmt (enlaces descubiertos por scraper) | `scraper_portales.js` → registro; luego descarga y `etl_pdf_generico.js` o ETL CSV |
| **DATOS_ABIERTOS** | CSV, GeoJSON, XLSX | datosabiertos.bogota.gov.co (CKAN): conteo vehicular CGT, aforos, estudios de tránsito | `ckan_registrar_recursos_aforos.js` → `descargar_datos_abiertos.js` (opcional `--procesar` → `etl_fuente_externa_csv.js`) |
| **PRIVADO** / **UNIVERSIDAD** | PDF | PDFs que registras con `secop_registrar_pdf_local.js --origen=PRIVADO|UNIVERSIDAD` (consultoras, universidades, etc.) | `secop_registrar_pdf_local.js` → `etl_pdf_generico.js` |

Ver también **docs/TAREA2_SECOP.md** para la cadena SECOP (solo API real).

---

## 3. Ampliación SECOP: anexos PDF

### 3.0 Limitación: descarga automática bloqueada (403/WAF)

La **descarga automática** de anexos desde SECOP (enlaces obtenidos del catálogo) está **bloqueada** por 403/WAF (Azure u otro) en la práctica. El **catálogo** (`npm run secop:catalogo`) sí funciona. Para los estudios de Bogotá (p. ej. ~19 procesos con anexos de aforos) se recomienda:

1. **Descargar los PDF manualmente** desde el portal SECOP (o la vía que permita tu red).
2. Copiar los PDF a `data/secop/anexos/<id_proceso>/` (un folder por proceso, `id_proceso` = identificador del proceso en SECOP).
3. **Registrar** cada PDF con `npm run secop:registrar-pdf -- --path=ruta/al/archivo.pdf --id-proceso=<id_proceso>` o registrar todos los PDF de una carpeta con `npm run secop:registrar-carpeta -- --carpeta=data/secop/anexos/bogota_manual [--id-proceso=...]`.
4. **Procesar** con `npm run etl:pdf` (extrae tablas, genera CSV estándar y carga nodos/estudios/conteos).

Así los PDF quedan en disco y se procesan con el mismo pipeline (adaptadores PDF → ETL CSV) sin depender de la descarga automática.

---

En `secop_descargar_anexos.js`:

- **Extensiones aceptadas:** `.xlsx`, `.xls`, `.csv`, **`.pdf`**.
- **Criterio de “anexo de aforos”:** función **`esAnexoAforo(nombreArchivo)`**:
  - La extensión debe ser una de las aceptadas.
  - El nombre (sin extensión) debe contener al menos uno de:  
    `aforo`, `conteo`, `tránsito`/`transito`, `movilidad`, `PMT`, `plan_de_manejo`, `estudio_de_tránsito`, `estudios_de_tránsito`, `trafico`, `volumen`, `estudio`.

Los PDF que cumplan se descargan a la misma ruta que el resto de anexos y se registran con `tipo = 'PDF'`, `procesado = FALSE`, `origen_id = id_proceso`.

---

## 4. Scraper portales (SDM/SDP)

- **Script:** `server/scripts/scraper_portales.js`.
- **Config:** `server/scripts/data/portales_seeds.json`:

```json
[
  {
    "origen": "SDM",
    "baseUrl": "https://www.simur.gov.co/pmt",
    "patronLinks": "a[href$='.pdf'], a[href$='.xlsx'], a[href$='.csv']",
    "patronesNombre": ["aforo", "conteo", "estudio", "tránsito", "PMT"]
  }
]
```

Para cada seed se descarga el HTML de `baseUrl`, se extraen enlaces que coincidan con `patronLinks` y se filtran por `patronesNombre`. Cada enlace se inserta en `archivos_fuente` con `origen`, `tipo` (por extensión), `url_remota`, `procesado = FALSE`. Requiere la columna **`url_remota`** (migración 005).

Opcional: `node server/scripts/scraper_portales.js --download` para descargar los archivos a `data/sdm/anexos/<origen>/`.

---

## 5. Extracción de tablas PDF (Python)

- **Script:** `server/scripts/pdf_extract_tablas.py`.
- **Uso:** `python server/scripts/pdf_extract_tablas.py <pdf_path> <out_dir>`.
- **Dependencia:** Camelot (`pip install "camelot-py[cv]"`). Ver `server/scripts/requirements-pdf.txt`.

Comportamiento:

- Lee todas las páginas (`pages="all"`).
- Extrae tablas (flavor `lattice`; si no hay, `stream`).
- Guarda cada tabla como `tabla_1.csv`, `tabla_2.csv`, … en `out_dir`.
- Si no encuentra tablas, sale con código distinto de 0.

---

## 6. Plantillas PDF y fuentes reales (PPRU / SDP)

Todas las plantillas están afinadas contra **PDFs reales y públicos**. No se usan datos de ejemplo inventados.

### PlantillaPDF_1 – Estudios PPRU / SDP (tablas de aforos)

**PDFs de referencia (URLs públicas):**

| Documento | URL real |
|-----------|----------|
| Estudio PPRU Nueva Aranda | https://www.sdp.gov.co/sites/default/files/001-estudio_de_transito_ppru_nueva_aranda_v4.1.pdf |
| Informe de tránsito – Plan Renovación Urbana | https://www.sdp.gov.co/sites/default/files/4_190805_informe_de_transito_vf.pdf |
| Estudio de tránsito – Plan Parcial El Carmen | https://www.sdp.gov.co/sites/default/files/estudio_transito_pp_el_carmen_v4.pdf |
| Estudio de tránsito (DAPD) | https://portal.dapd.gov.co/sites/default/files/v2_estudio_de_transito.pdf |
| Estudio de movilidad – PPRU Fenicia | https://fenicia.co/wp-content/uploads/2020/12/4.ESTUDIO-DE-MOVILIDAD.pdf |

- **Adaptador:** `server/scripts/secop_adaptadores_pdf.js` → **`adaptarPlantillaPDF_1`**.
- **Entrada:** ruta a un CSV crudo (p. ej. `tabla_2.csv` extraído por Python).
- **Salida:** CSV estándar (mismas columnas que el resto del pipeline: `archivo_nombre`, `origen`, `nodo_nombre`, `direccion`, `fecha`, `sentido`, `hora_inicio`, `hora_fin`, `vol_total`, `vol_livianos`, `vol_motos`, `vol_buses`, `vol_pesados`, `vol_bicis`).

Mapeo típico (columnas del PDF → CSV estándar):

| Origen (tabla PDF)     | CSV estándar   | Notas |
|------------------------|----------------|--------|
| Intersección / Punto / Ubicación | direccion, nodo_nombre | |
| Fecha / Fecha conteo   | fecha          | YYYY-MM-DD (TODO: inferir del PDF si no viene) |
| Sentido / Flujo       | sentido        | Normalizado a NS, SN, EO, OE. |
| Hora / Intervalo / Rango horario | hora_inicio, hora_fin | HH:MM |
| Total / Volumen / Intensidad | vol_total | |
| Livianos, Motos, Buses, Pesados, Bicis | vol_livianos, vol_motos, vol_buses, vol_pesados, vol_bicis | |

Por defecto se usa **`tabla_2.csv`** como tabla de aforos. La plantilla se elige en **`getAdaptadorPdfParaArchivo`** por nombre de archivo.

### PlantillaPDF_2 – Plan Parcial El Carmen

- **PDF de referencia:** `estudio_transito_pp_el_carmen_v4.pdf`  
  URL: https://www.sdp.gov.co/sites/default/files/estudio_transito_pp_el_carmen_v4.pdf  
- **Adaptador:** `adaptarPlantillaPDF_2` (reutiliza mapeo de PlantillaPDF_1; ajustar en `secop_adaptadores_pdf.js` si la estructura difiere).

### PlantillaPDF_3 – Informe de tránsito (Plan Renovación Urbana)

- **PDF de referencia:** `4_190805_informe_de_transito_vf.pdf`  
  URL: https://www.sdp.gov.co/sites/default/files/4_190805_informe_de_transito_vf.pdf  
- **Adaptador:** `adaptarPlantillaPDF_3` (reutiliza mapeo de PlantillaPDF_1; ajustar si la estructura difiere).

### Resumen por archivo

| Plantilla     | PDF real (ejemplo) |
|---------------|---------------------|
| PlantillaPDF_1 | 001-estudio_de_transito_ppru_nueva_aranda_v4.1.pdf, 4.ESTUDIO-DE-MOVILIDAD.pdf, v2_estudio_de_transito.pdf |
| PlantillaPDF_2 | estudio_transito_pp_el_carmen_v4.pdf |
| PlantillaPDF_3 | 4_190805_informe_de_transito_vf.pdf |

---

## 7. ETL PDF (SECOP solo o todos los orígenes)

- **SECOP únicamente:** `server/scripts/etl_pdf_secop.js` → `npm run secop:pdf`.  
  Lista `archivos_fuente` con `origen = 'SECOP'`, `tipo = 'PDF'`, `procesado = FALSE`. Ruta PDF: `data/secop/anexos/<origen_id>/<nombre_archivo>`.

- **Todos los orígenes (SECOP, SDP, SDM, PRIVADO, UNIVERSIDAD):** `server/scripts/etl_pdf_generico.js` → `npm run etl:pdf`.  
  Lista todos los PDF con `tipo = 'PDF'` y `procesado = FALSE`. Rutas:  
  - SECOP: `data/secop/anexos/<origen_id>/<nombre_archivo>`  
  - SDP / SDM / PRIVADO / UNIVERSIDAD: `data/privado/anexos/<origen>/<nombre_archivo>`

En ambos casos: se ejecuta `pdf_extract_tablas.py`, se elige una tabla de aforos entre las extraídas, se aplica **`adaptarPlantillaPDF_1`** (o PlantillaPDF_2/3 en el futuro) y se genera el CSV estándar. Si no es `--dry-run`, se ejecuta `etl_fuente_externa_csv.js` y se marca `procesado = TRUE`.

**Modo revisión manual (dry run):**

```bash
node server/scripts/etl_pdf_generico.js --dry-run
node server/scripts/etl_pdf_generico.js --dry-run --origen=PRIVADO
```

Solo extrae tablas y genera el CSV estándar. No ejecuta el ETL ni actualiza `procesado`.

---

## 8. Cómo agregar una nueva plantilla PDF (PlantillaPDF_2)

1. **En `secop_adaptadores_pdf.js`:**
   - Implementar **`adaptarPlantillaPDF_2(tablaCsvPath, archivoOriginalNombre, metadatos)`** con el mapeo de columnas del nuevo formato.
   - En **`getAdaptadorPdfParaArchivo(archivoFuente, tablasCsvPaths)`**, añadir lógica para elegir plantilla según:
     - `archivoFuente.nombre_archivo` (patrones),
     - o inspección del contenido de las tablas (p. ej. cabeceras).
   - Devolver `{ adaptador: 'adaptarPlantillaPDF_2', tablaIndex: N }` cuando corresponda.

2. **En `etl_pdf_secop.js` y `etl_pdf_generico.js`:**
   - Tras obtener `getAdaptadorPdfParaArchivo`, invocar también `adaptarPlantillaPDF_2` cuando `adaptador === 'adaptarPlantillaPDF_2'` (igual que con `adaptarPlantillaPDF_1`).

3. **Documentar** en este doc el nuevo formato (columnas origen → CSV estándar) y en qué tipo de estudios se usa.

---

## 9. Registrar PDF local (SECOP, PRIVADO, UNIVERSIDAD)

Para estudios que obtengas manualmente (descarga desde SDP, consultoras, universidades, etc.):

```bash
node server/scripts/secop_registrar_pdf_local.js --path="C:\ruta\al\estudio_transito.pdf"
node server/scripts/secop_registrar_pdf_local.js --path=ruta/al/estudio.pdf --origen=PRIVADO
node server/scripts/secop_registrar_pdf_local.js --path=ruta/al/estudio.pdf --origen=UNIVERSIDAD
```

- **SECOP:** copia a `data/secop/anexos/<id_proceso>/` (por defecto `id_proceso=local`; usar `--id-proceso=ID` si aplica).
- **PRIVADO / UNIVERSIDAD:** copia a `data/privado/anexos/<origen>/`.

Luego ejecuta **`npm run etl:pdf`** para procesar todos los PDF pendientes (o `npm run secop:pdf` solo para origen SECOP).

---

## 10. Comandos resumen

| Paso                    | Comando |
|-------------------------|--------|
| Migración (url_remota)  | `npm run db:migrate` |
| Catálogo SECOP          | `npm run secop:catalogo` |
| Descarga anexos (incl. PDF) | `npm run secop:descargar` |
| Procesar XLSX/CSV       | `npm run secop:procesar` |
| Procesar PDF (dry-run)  | `node server/scripts/etl_pdf_secop.js --dry-run` |
| Procesar PDF (completo) | `npm run secop:pdf` |
| Scraper portales        | `node server/scripts/scraper_portales.js` |
| Scraper + descarga      | `node server/scripts/scraper_portales.js --download` |
| Estadísticas (incl. PDF)| `npm run stats:fuentes` |
| Registrar PDF local      | `npm run secop:registrar-pdf -- --path=ruta/al.pdf [--origen=SECOP|PRIVADO|UNIVERSIDAD]` |
| Procesar todos los PDF   | `npm run etl:pdf` (o `--origen=PRIVADO` para solo ese origen) |
| Registrar recursos CKAN | `npm run ckan:registrar-aforos` |
| Descargar Datos Abiertos | `npm run datos-abiertos:descargar` (opcional `--procesar`) |
| Cargar CGT (conteo vehicular) | `npm run etl:cgt` |
| Actualizar sensores bici | `npm run etl:sensores-bici` |

### Buscar más información y agregar estudios

1. **Catálogo SECOP** (solo API real): `npm run secop:catalogo` → luego `npm run secop:descargar` y `npm run secop:procesar` o `npm run secop:pdf` según tipo.
2. **CGT y sensores**: `npm run etl:cgt` y `npm run etl:sensores-bici` actualizan nodos y conteos desde Datos Abiertos (requiere URLs en `.env`).
3. **Datos Abiertos Bogotá (CKAN)**: `npm run ckan:registrar-aforos` busca datasets reales "conteo/aforo/tránsito"; luego `npm run datos-abiertos:descargar` (opcional `--procesar`) para descargar y cargar.
4. **Scraper portales**: `npm run scraper:portales` descubre enlaces reales en las URLs de `server/scripts/data/portales_seeds.json` (SDP, SDM). Con `--download` guarda archivos en `data/sdm/anexos/`.
5. **Estudios propios**: coloca CSV estándar en una ruta y ejecuta `node server/scripts/etl_fuente_externa_csv.js --path=ruta/al/archivo.csv`.

**Nota:** Los comandos `secop:ejemplo` y `seed:aforos-secop` existen solo para pruebas locales con datos sintéticos; **no** forman parte del flujo de fuentes reales.

---

## 11. Dependencias Python

Para `pdf_extract_tablas.py`:

```bash
pip install -r server/scripts/requirements-pdf.txt
```

O: `pip install "camelot-py[cv]"`. En algunos entornos se necesita Ghostscript en el PATH.
