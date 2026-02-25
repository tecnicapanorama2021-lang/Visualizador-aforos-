# Descarga de Sensores de ArcGIS

**Ubicación del script:** `scripts/python/download_sensors.py` (desde la raíz del proyecto).

Script para descargar la base de datos completa de sensores desde la API de ArcGIS.

## Instalación

### Opción 1: Usar el script de instalación (Recomendado)

**Windows (desde la raíz del proyecto):**
```bash
scripts\setup\install_dependencies.bat
```

**Linux/Mac (desde la raíz del proyecto):**
```bash
chmod +x scripts/setup/install_dependencies.sh
./scripts/setup/install_dependencies.sh
```

### Opción 2: Instalación manual

Para evitar la advertencia de PATH, usa uno de estos comandos:

```bash
# Opción A: Instalar en directorio del usuario (recomendado)
pip install --user --no-warn-script-location -r scripts/python/requirements.txt

# Opción B: Solo suprimir la advertencia
pip install --no-warn-script-location -r scripts/python/requirements.txt

# Opción C: Instalación normal (mostrará advertencia)
pip install -r scripts/python/requirements.txt
```

## Uso

Una vez instaladas las dependencias, ejecuta:

```bash
# Desde la raíz del proyecto
python scripts/python/download_sensors.py
```

El script descargará todos los sensores y guardará el resultado en `src/data/nodos_bogota.json`.

## Características

- ✅ Paginación automática (20 registros por petición)
- ✅ Barra de progreso en tiempo real
- ✅ Manejo de errores robusto
- ✅ Formato GeoJSON estándar
- ✅ Creación automática de directorios
