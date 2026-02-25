# Documentación — Visualizador de aforos

**Qué leer primero:** para operar el proyecto (levantar API, worker, verificar), usa en este orden: [RUNBOOK.md](RUNBOOK.md) y [SCRIPTS.md](SCRIPTS.md). Para auditoría de dependencias y convenciones de batches: [AUDIT.md](AUDIT.md).

---

## Docs canónicos (fuente de verdad)

| Doc | Para qué sirve |
|-----|----------------|
| **[RUNBOOK.md](RUNBOOK.md)** | Único runbook operativo: cómo levantar dev/prod, golden path, verify vs bootstrap, Redis, comandos oficiales. |
| **[SCRIPTS.md](SCRIPTS.md)** | Catálogo de scripts npm: orden, prerequisitos (Redis/PG), tabla oficial vs legacy, convenciones. |
| **[AUDIT.md](AUDIT.md)** | Índice a docs/audit/ (depcheck y otros) y reglas para batches de deps y falsos positivos. |

Detalle de scripts por prefijo: [RUNBOOK_SCRIPTS.md](RUNBOOK_SCRIPTS.md). Referencia histórica y casos de éxito: [referencia/](referencia/). Otros temas (arquitectura, ingest, tareas): ver archivos en docs/ según necesidad.
