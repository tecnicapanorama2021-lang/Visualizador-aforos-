# Scripts de configuración / instalación

Scripts para instalar dependencias o preparar el entorno. Ejecutar **desde la raíz del proyecto**.

| Script | Uso |
|--------|-----|
| install_dependencies.bat | Windows: instala dependencias Python (`scripts/python/requirements.txt`) para herramientas como `download_sensors.py`. |
| install_dependencies.sh | Linux/Mac: igual que el .bat. `chmod +x scripts/setup/install_dependencies.sh` y `./scripts/setup/install_dependencies.sh`. |

Tras instalar, ejecutar desde la raíz: `python scripts/python/download_sensors.py` (ver `scripts/python/README.md`).
