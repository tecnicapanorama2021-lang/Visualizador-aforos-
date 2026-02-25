# Tarea 1: Migración JSON → PostgreSQL + PostGIS (Aforos)

## Estado: COMPLETA

---

## Qué hace ahora Tarea 1

Tarea 1 deja el sistema de aforos apoyado en una base de datos PostgreSQL con PostGIS. Los datos que antes estaban solo en JSON (`studies_dictionary.json`, `nodos_unificados.json`, `ia_historial.json`) se cargan en las tablas `nodos`, `estudios` y `conteos_resumen`. El servidor Express **no lee** esos JSON en runtime: las rutas `GET /api/aforos/historial/:nodeId` y `GET /api/aforos/geocode/:nodeId` consultan únicamente Postgres. Los JSON se usan solo en los scripts ETL para poblar o actualizar la BD (por ejemplo en un entorno de carga o al hacer una recarga inicial).

El ETL de conteos lee `ia_historial.json` por **streaming**, sin cargar el archivo entero en memoria, y hace UPSERT en `conteos_resumen`. Así se evita el problema de memoria que daba el archivo gigante cuando se leía completo.

---

## Cómo se ejecuta

**Carga inicial (migración + ETL completo):**

```bash
npm run db:full-load
```

**Probar las rutas (con el backend levantado, p. ej. `npm run dev:api`):**

```bash
# Historial de un nodo (node_id_externo = 171)
curl -s http://localhost:3001/api/aforos/historial/171 | jq .

# Geocode del mismo nodo
curl -s http://localhost:3001/api/aforos/geocode/171 | jq .
```

Más ejemplos y checks rápidos en `server/db/README.md`.

**Mini validación pre-T2** (comprobar que 2–3 nodos tienen estudios, conteos y que la API devuelve curvas):

```bash
npm run validacion:pre-t2
```

Comprueba los nodeId **171**, **136** y **466** en la BD (varios estudios, filas en `conteos_resumen`) y, si el servidor está en marcha (`npm run dev:api`), que la API devuelve bien `historico` y `vol_data_completo`. Si todo sale OK, se considera listo para Tarea 2.

---

## Qué de ia_historial está en la base de datos

**Sí está en la BD (y la API lo reconstruye):**

- **Nodos:** `node_id_externo`, dirección/nombre (desde `nodos`; el ETL Fase 1 usa `studies_dictionary` + `nodos_unificados`).
- **Por cada estudio:** `file_id`, fechas, contratista, tipo_estudio → tabla `estudios`.
- **Conteos por intervalo:** cada fila de `analisis.vol_data_completo` (y, si no hay, cada fila de `analisis.distribucion_hora_pico`) → tabla `conteos_resumen` con sentido, intervalo_ini/fin, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros.

La ruta `GET /api/aforos/historial/:nodeId` arma `historico[].analisis.vol_data_completo` y `distribucion_hora_pico` leyendo solo de Postgres, así que **toda la información que la app usa para gráficas y tablas** está en la BD.

**No está en la BD (la API devuelve null o valores por defecto):**

- `via_principal`, `via_secundaria` → la API devuelve `null` (solo estaban en el JSON del historial).
- `resumen_texto` → no se guarda el texto original; la API genera uno tipo "Aforo YYYY-MM-DD, volumen pico N".
- `analisis.hora_pico_rango`, `hora_pico_inicio`, `hora_pico_fin` → la API devuelve `null` (se podrían calcular después desde los intervalos si se necesitan).
- `analisis.clases_vehiculos` (lista de keys/labels) → la API devuelve `[]`; los números por clase sí están en `vol_data_completo`/conteos.
- `analisis.hoja_identificacion` → la API devuelve `[]`.
- `observaciones`, `contexto_temporal` a nivel de estudio → la API devuelve `null`.
- En cada fila de vol_data: `periodNum`, `observ` → no se guardan (no se usan en el front).
- El objeto global `metadata` del JSON (resumen_global, total_nodes, etc.) → no se usa en runtime.

En resumen: **los datos numéricos y la estructura que el front necesita del historial están en la BD**; algunos campos de texto o metadatos del JSON no se migraron y la app no los usa.

---

## Siguiente paso (Tarea 2)

**Tarea 2** dependerá de las tablas `nodos`, `estudios` y `conteos_resumen` y usará la misma estructura para insertar nuevos aforos desde PDFs u otras fuentes de estudios. No se ha implementado aún; solo se deja esta nota como preparación.
