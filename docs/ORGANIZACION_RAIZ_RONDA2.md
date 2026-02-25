# Organización raíz – Segunda ronda

Resumen de movimientos de archivos sueltos en la raíz (solo raíz; no se tocaron carpetas ya organizadas).

## Objetivo

Mantener en raíz solo lo canónico: `server.js`, `README.md`, `package*.json`, configs de Vite/Tailwind/PostCSS, `index.html`, `.env.example`, `.gitignore`, `.nvmrc`, `nixpacks.toml`, `render.yaml`. El resto se movió a carpetas adecuadas.

---

## Resumen de movimientos (origen → destino)

| Origen (raíz) | Destino |
|---------------|---------|
| `MAPEO_CAMPOS_IDECA.json` | `data/MAPEO_CAMPOS_IDECA.json` |
| `socrata_metadata.json` | `data/socrata_metadata.json` |
| `.historial_progress.json` | `data/.historial_progress.json` |
| `requirements.txt` | `scripts/python/requirements.txt` |
| `install_dependencies.bat` | `scripts/setup/install_dependencies.bat` |
| `install_dependencies.sh` | `scripts/setup/install_dependencies.sh` |
| `node-v24.13.0-x64.msi` | `deprecated/node-v24.13.0-x64.msi` |

---

## Referencias actualizadas (archivos tocados)

- **server/scripts/buildHistorialMasivo.js**  
  `PROGRESS_FILE` pasa de `../../.historial_progress.json` a `../../data/.historial_progress.json`.

- **scripts/python/get_socrata_metadata.py**  
  Salida de metadatos de `socrata_metadata.json` (raíz) a `data/socrata_metadata.json`. `PROJECT_ROOT` ajustado a raíz del repo (`parent.parent.parent` desde `scripts/python/`).

- **scripts/setup/install_dependencies.bat**  
  Uso de `requirements.txt` vía ruta relativa al script: `%~dp0..\python\requirements.txt`.

- **scripts/setup/install_dependencies.sh**  
  Igual: `"$(dirname "$0")/../python/requirements.txt"`.

- **scripts/check-root-clean.js**  
  Ahora también comprueba que en raíz no estén: `install_dependencies.bat`, `install_dependencies.sh`, `requirements.txt`, `MAPEO_CAMPOS_IDECA.json`, `socrata_metadata.json`, `.historial_progress.json`, y cualquier `*.msi`.

- **docs/referencia/README_DOWNLOAD_SENSORS.md**  
  Comandos de instalación actualizados a `scripts/setup/install_dependencies.bat` y `scripts/setup/install_dependencies.sh`; `pip -r scripts/python/requirements.txt`.

- **server/scripts/README_HISTORIAL.md**  
  Referencia a `.historial_progress.json` sustituida por `data/.historial_progress.json`.

- **docs/referencia/AUDITORIA_LAYERS_IDECA.md**  
  Referencia a `MAPEO_CAMPOS_IDECA.json` sustituida por `data/MAPEO_CAMPOS_IDECA.json`.

- **docs/REGRESION_POST_LIMPIEZA.md**  
  Resumen de cambios actualizado (install_dependencies en `scripts/setup`, socrata en `data/`).

- **deprecated/README.md**  
  Añadida entrada para `node-v24.13.0-x64.msi`.

- **scripts/setup/README.md**  
  Nuevo: descripción de los instaladores y uso desde la raíz.

---

## Comandos de verificación

Desde la raíz del proyecto (PowerShell):

```powershell
npm run check:root
npm run build
npm run verify:debug   # requiere API en 3001 (p. ej. .\scripts\dev.ps1 en otra terminal)
```

- **check:root:** debe indicar raíz limpia (solo archivos canónicos).
- **build:** debe terminar sin errores.
- **verify:debug:** todos los endpoints `/api/debug/*` en 200.

Nada se borró; archivos dudosos o binarios se movieron a `deprecated/` con nota.
