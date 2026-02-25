# Auditoría — Dependencias y convenciones

**Doc canónico:** índice a auditorías y reglas para batches de dependencias y falsos positivos.

---

## Índice a docs/audit/

| Documento | Contenido |
|-----------|-----------|
| **[audit/depcheck-2026-02-25.md](audit/depcheck-2026-02-25.md)** | Auditoría depcheck: salida original, Batch 1, Batch 2, Post-batches (estado actual), tabla "Acción recomendada". Fuente histórica. |

Otros snapshots (scripts, etc.) se listan en `docs/audit/` cuando existan.

---

## Reglas para batches de dependencias

1. **Antes de eliminar:** confirmar uso real con búsquedas en todo el repo (`src/`, `server/`, `routes/`, `scripts/`, configs). Depcheck puede dar falsos positivos (config, imports dinámicos, CSS).
2. **Si hay duda:** no borrar; documentar en el audit y marcar "Investigar" o "Mantener (falso positivo)".
3. **Deps de build/IDE** (@types/*, autoprefixer, postcss, tailwindcss): no tocar en batches de runtime sin migrar tooling.
4. **Tras eliminar:** actualizar `package.json` y lockfile, quitar imports muertos si existen, ejecutar `npm run verify:all`, actualizar el audit con la tabla del batch.

---

## Falsos positivos conocidos (depcheck)

El repo usa `.depcheckrc.json` en la raíz para ignorar paquetes que depcheck marca como unused pero que sí se usan:

- **leaflet-draw:** uso vía `src/index.css` (`@import 'leaflet-draw/dist/leaflet.draw.css'`).
- **@types/leaflet, @types/react-dom:** tipos para IDE/JSX.
- **autoprefixer, postcss, tailwindcss:** cadena de build (PostCSS/Tailwind).

Ejecutar con config: `npx depcheck --config .depcheckrc.json`.
