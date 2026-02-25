# Documentación — Panorama Ingeniería 2026

Índice de la documentación del proyecto. **Raíz:** solo [README.md](../README.md) como manual de entrada.

---

## Canónicas (manual operativo y arquitectura)

| Doc | Uso |
|-----|-----|
| [DESARROLLO_LOCAL.md](DESARROLLO_LOCAL.md) | Dev/ops: puertos, arranque, migraciones, ingestas, verificación |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitectura tipo Waze, fuente única incidentes, capas |
| [RUNBOOK_INGEST.md](RUNBOOK_INGEST.md) | Ingestas canónicas (calendario y contexto_eventos → incidentes) y verificación |
| [LEGACY.md](LEGACY.md) | Listado de scripts, rutas y componentes legacy/deprecados |
| [LIMPIEZA_REPO_RESUMEN.md](LIMPIEZA_REPO_RESUMEN.md) | Resumen de organización del repo (movimientos, comandos oficiales) |

---

## Referencia (histórico / no operativo diario)

Todo lo que estaba en la raíz como .md de referencia está en **[referencia/](referencia/)**:

- Índice: [referencia/README.md](referencia/README.md)
- Incluye: AUDITORIA_LAYERS_IDECA, COLORS, DEPLOY, MAPEO_CAMPOS_IDECA_REACT, README-BLOG, README-ROUTING, README_DOWNLOAD_SENSORS, CASO_DE_EXITO_PMT_MOVILIDAD, etc.

Otras doc temática (TAREA2, TAREA3, API_GRAFO, ESTRUCTURA_*, INSTRUCCIONES-INTEGRACION-BD, etc.) sigue en **docs/** al mismo nivel que este README.

---

## Regla del repo

- **No se agregan .md a la raíz** (excepto README.md).
- **No se agregan .py a la raíz**; herramientas Python van en **scripts/python/**.

Verificación: `npm run check:root` (ejecuta `scripts/check-root-clean.js`).
