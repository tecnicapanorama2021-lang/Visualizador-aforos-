# PR: chore/cleanup-pr1-gitignore-data

## Descripción

Política de datos en `.gitignore`: ignorar `data/` completo, mantener `server/data/` versionado y aplicar whitelist canónica en `public/data/`. Documentación en `docs/DATA_POLICY.md`.

## Cambios

- **.gitignore:** Base Node (node_modules, dist, .env, logs, etc.) agrupada; al final bloque `# Project data policy`: `data/`, `!server/data/`, `public/data/*` + excepciones canónicas y artefactos generados.
- **docs/DATA_POLICY.md:** Nuevo. Explica qué es local (`data/`), qué se versiona (`server/data/`, whitelist `public/data/`) y recomendación futura (generados en server o `_generated/`, bootstrap si faltan).

## Estado antes del PR (git status --porcelain)

Resumen: rama `chore/cleanup-pr1-gitignore-data` creada desde `chore/cleanup-pr0-safety-net`. Archivos modificados/añadidos en este PR: `.gitignore`, `docs/DATA_POLICY.md`. El resto del árbol puede tener otros cambios previos (staged/untracked); este PR no borra ningún archivo ya versionado, solo añade reglas de ignorar y doc.

Conteo aproximado para referencia al abrir el PR: revisar `git status --porcelain` y `git diff --stat` en la rama (ej. 2 archivos cambiados: .gitignore, docs/DATA_POLICY.md).

## Verificación

- [x] `npm run verify:build` ejecutado y pasó (Vite build OK).
- No se ha borrado nada versionado en este PR; las reglas solo afectan a archivos no trackeados o futuros.

## Limpieza local (opcional)

Para previsualizar qué archivos/directorios ignorados se eliminarían con `git clean`:

```bash
git clean -nd
```

Para ejecutar la limpieza si el listado es correcto:

```bash
git clean -fd
```

**Nota:** Esto elimina solo archivos y carpetas no trackeados que están en `.gitignore`. Los canónicos de `public/data/` que siguen en la whitelist no se tocan.

## Nota para PR-3

`nodos_unificados.json` y `volumennodo_dim.json` son canónicos y la whitelist los conserva. En un PR posterior (PR-3) se puede: generar automáticamente si faltan (pre-step de dev o `npm run data:bootstrap`) o moverlos a una carpeta “source-of-truth” y ajustar servicios.
