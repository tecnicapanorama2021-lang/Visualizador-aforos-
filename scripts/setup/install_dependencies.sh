#!/bin/bash

echo "Instalando dependencias de Python..."
echo ""

# Ruta a requirements.txt (scripts/python/ respecto a este script en scripts/setup/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REQ="${SCRIPT_DIR}/../python/requirements.txt"
pip install --user --no-warn-script-location -r "$REQ"

echo ""
echo "✅ Instalación completada!"
echo ""
echo "Ahora puedes ejecutar el script (desde la raíz del proyecto) con:"
echo "  python scripts/python/download_sensors.py"
