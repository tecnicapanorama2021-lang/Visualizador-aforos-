# Scripts Python (tooling)

Scripts de utilidad (Socrata, Simur, descargas, geocodificación) movidos desde la raíz. Son **herramientas auxiliares**; el pipeline principal de aforos e incidentes usa Node en **server/scripts/**.

---

## Cómo correrlos

Desde la **raíz del proyecto**:

```bash
python scripts/python/download_sensors.py
python scripts/python/geocode_missing_nodes.py
# etc.
```

O entrando en la carpeta:

```bash
cd scripts/python
python download_sensors.py
```
(Los scripts usan rutas relativas a la raíz del proyecto vía `Path(__file__)`; funcionan desde cualquier directorio, pero se recomienda ejecutar desde la raíz.)

Algunos scripts asumen rutas relativas a la raíz (p. ej. `src/data/`); en ese caso es mejor ejecutar desde la raíz como arriba.

---

## Variables de entorno / requisitos

Dependen del script:

- **download_sensors.py**, **download_*.py**: suelen usar URLs de API o datos abiertos; a veces API key en env (ver comentarios o doc dentro de cada script).
- **geocode_missing_nodes.py**: puede requerir API de geocodificación (ArcGIS, Google, etc.) y variables en `.env` o entorno.
- **test_socrata_endpoint.py**, **test_simur_urls.py**: pruebas de conectividad a endpoints; a veces `PROXY_URL` o similar para Tor.

No hay un único `.env` obligatorio para todos; revisar la cabecera o la doc de cada script. El backend Node usa `.env` en la raíz (DATABASE_URL, etc.); los Python pueden usar las mismas variables si las leen.

---

## Listado breve

| Script | Uso |
|--------|-----|
| download_sensors.py | Descarga sensores (ArcGIS) → p. ej. src/data |
| download_nodes_from_socrata.py | Nodos desde Socrata |
| download_unified_nodes.py | Nodos unificados |
| geocode_missing_nodes.py | Geocodificar nodos faltantes |
| harvest_dim_studies.py | Estudios DIM |
| filter_bogota_only.py | Filtrar solo Bogotá |
| find_socrata_dataset.py, get_socrata_metadata.py | Búsqueda/metadatos Socrata |
| scan_simur_services.py, test_simur_urls.py, test_socrata_endpoint.py | Pruebas de endpoints |

Doc detallada de sensores: [docs/referencia/README_DOWNLOAD_SENSORS.md](../../docs/referencia/README_DOWNLOAD_SENSORS.md).
