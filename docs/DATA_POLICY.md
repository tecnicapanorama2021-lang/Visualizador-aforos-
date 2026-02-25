# Política de datos del proyecto

Este documento describe qué datos se versionan en el repositorio y cuáles se consideran locales o generados.

## `data/` (raíz)

- **No se versiona.** La carpeta `data/` está en `.gitignore`.
- Contiene datos de trabajo locales y regenerables:
  - GeoJSON de IDECA (zonas, localidades, UPZ)
  - Descargas y anexos SECOP
  - Datos abiertos descargados
  - PDFs de estudios de tránsito, extracciones, progreso de historial (`.historial_progress.json`), etc.
- Son datos que cada desarrollador o entorno obtiene/regenera según necesidad.

## `server/data/`

- **Sí se versiona.** Incluye diccionarios y configuración que el servidor necesita (por ejemplo `corredores_bogota.json`).
- La regla `!server/data/` en `.gitignore asegura que no quede ignorado por un patrón genérico.

## `public/data/`

- **Whitelist canónica:** solo se trackean los archivos explícitamente permitidos. El resto se ignora.
- **Archivos canónicos actuales:**
  - `studies_dictionary.json` — fuente ETL nodos/estudios
  - `nodos_unificados.json` — jobs, ETL y fallback frontend
  - `volumennodo_dim.json` — mapa de aforos (frontend)
  - `calendario_obras_eventos.json` — API obras y jobs
  - `agenda_eventos.json` — ingesta manual a contexto_eventos
  - `README.md`, `README_DATOS_UNIFICADOS.md` — documentación en árbol
- **No versionados:** todo lo generado por jobs o scripts (historial, snapshot, raw, velocidades_por_nodo, etc.) y archivos opcionales/descargables (malla_vial, andenes, etc.) están en `.gitignore`.

## Recomendación futura

En un PR posterior se puede:

- Mover datos canónicos generados a `server/data/` o a algo como `public/data/_generated/`.
- Hacer que la app (o un paso de arranque tipo `npm run data:bootstrap`) genere esos archivos si faltan, en lugar de depender de que estén commiteados.

Hasta entonces, la whitelist actual conserva los canónicos necesarios para build, ETL y desarrollo.
