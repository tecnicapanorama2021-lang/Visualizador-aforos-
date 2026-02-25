# Checklist antes de mergear cada PR

En **cada** PR antes de dar Merge:

1. **"Able to merge"** — Que GitHub muestre que no hay conflictos (botón verde, sin aviso de conflictos).
2. **Files changed** — Revisar el diff por si hay algo raro (ej. se borró un archivo core como `server.js`, `package.json` sin sentido, o una ruta que no debería tocarse).
3. **Estrategia:** usar **Squash and merge** para que `main` quede con un commit limpio por PR (título del PR = mensaje del commit squashed). Ser consistente en todos.

---

## Después de mergear los 4 PRs

En tu máquina (para alinear todo):

```bash
git checkout main
git pull --ff-only
npm run verify:all
```

Si `verify:all` corre bien, ya se puede seguir con PR-5B (remover deps).

---

## Si te aparecen conflictos

**Causa típica:** varios PRs tocaron el mismo archivo (p. ej. `package.json`, `docs/...`). GitHub no deja mergear hasta que la rama del PR esté actualizada con `main`.

**Qué hacer:**

1. Anota **qué PR** muestra conflicto y **con qué archivo** (ej. “PR-4, conflicto en `package.json`” o “PR-3, conflicto en `docs/RUNBOOK.md`”).
2. En tu máquina, en la rama de ese PR:
   ```bash
   git checkout <rama-del-pr>   # ej. chore/cleanup-pr4-scripts-group-deprecate
   git fetch origin
   git rebase origin/main
   ```
3. Si hay conflictos, Git marcará los archivos. Ábrelos y:
   - **package.json:** suele ser orden distinto de `scripts` o líneas duplicadas. Queda con el orden/bloque que quieras (ej. el de PR-4 reordenado) y borra marcadores `<<<<<<<`, `=======`, `>>>>>>>`.
   - **docs:** elige el trozo que corresponda (mantener ambas secciones si aplica) y quita los marcadores.
4. Tras resolver:
   ```bash
   git add <archivos-resueltos>
   git rebase --continue
   git push --force-with-lease origin <rama-del-pr>
   ```
5. Vuelve a GitHub: el PR debería mostrar ya "Able to merge".

Si me dices el PR y el archivo en conflicto, te puedo indicar exactamente qué bloques dejar y qué borrar (sin perder cambios).

---

## Resolución concreta: PR #3 (scripts group deprecate) desfasado tras merge de PR #1 y #2

Es normal: al hacer **Squash and merge** de PR #1 y #2, `main` cambió, y PR #3 (rama `chore/cleanup-pr4-scripts-group-deprecate`) también toca `package.json` y docs, así que GitHub ya no puede mezclarlo automático. Archivos que suelen chocar: `docs/RUNBOOK.md`, `docs/SCRIPTS.md`, `package.json`, `scripts/bootstrap_local.js`.

La forma más limpia: **actualizar la rama del PR #3 con main y resolver conflictos en local**, luego pushear. No resolver “a ciegas” en el editor web si no estás cómoda; en local es más seguro.

### A) Actualizar repo local

```bash
git checkout main
git pull --ff-only
```

### B) Ir a la rama del PR #3 y rebasarla contra main

```bash
git checkout chore/cleanup-pr4-scripts-group-deprecate
git fetch origin
git rebase origin/main
```

Git se detendrá en los conflictos.

### C) Cómo resolver cada conflicto (regla simple)

Abre cada archivo con marcadores `<<<<<<<`, `=======`, `>>>>>>>` y aplica:

| Archivo | Regla |
|---------|--------|
| **scripts/bootstrap_local.js** | Quedarse con la versión más nueva: la que incluye el prompt **"Type YES"** y soporta **`--yes`**. Si las dos tienen cosas distintas, conservar TODO lo de confirmación + abortos; no perder los guardrails. |
| **package.json** | Mantener los scripts de PR #2 (ya en main): `verify:all`, `bootstrap:local`. Mantener el **reordenamiento/agrupación** de PR #3 sin borrar scripts. Si chocan por orden, no importa el orden exacto; importa que **estén todos** y correctos. |
| **docs/RUNBOOK.md** y **docs/SCRIPTS.md** | Combinar ambas: conservar la sección de **"Flujo oficial (C)"** + **"verify vs bootstrap"** + **"Comandos oficiales"**. Si hay duplicado, dejar una sola versión, pero no perder info. |

Borrar siempre los marcadores de conflicto (`<<<<<<<`, `=======`, `>>>>>>>`).

Cuando termines de editar, marcar resuelto:

```bash
git add package.json scripts/bootstrap_local.js docs/RUNBOOK.md docs/SCRIPTS.md
git rebase --continue
```

Si aparecen más conflictos, repetir (abrir archivo, aplicar regla, `git add`, `git rebase --continue`).

### D) Subir la rama actualizada

Como hiciste rebase, hace falta push con lease:

```bash
git push --force-with-lease origin chore/cleanup-pr4-scripts-group-deprecate
```

`--force-with-lease` es el “force” seguro (solo fuerza si nadie más cambió la rama).

### E) Volver a GitHub

El PR #3 debería pasar de “conflicts must be resolved” a **Able to merge**.
