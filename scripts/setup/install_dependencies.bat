@echo off
echo Instalando dependencias de Python...
echo.

REM Ruta a requirements.txt (scripts/python/ respecto a este script en scripts/setup/)
set REQ=%~dp0..\python\requirements.txt
pip install --user --no-warn-script-location -r "%REQ%"

echo.
echo ✅ Instalación completada!
echo.
echo Ahora puedes ejecutar el script (desde la raíz del proyecto) con:
echo   python scripts\python\download_sensors.py
pause
