# Deprecated / Solo ejemplo

Esta carpeta contiene archivos **opcionales** que el proyecto ya no requiere para funcionar.

---

## Qué entra aquí

- Configuraciones o ejemplos que dejaron de ser el camino oficial (p. ej. docker-compose para desarrollo local cuando el estándar es Postgres instalado).
- Código o configs que se mantienen solo como referencia y no se usan en el flujo actual.

## Qué no entra

- Código legacy que sigue referenciado por el proyecto (eso se marca como legacy en su sitio o en **server/scripts/legacy** según el caso).
- Documentación; la doc legacy/referencia va a **docs/referencia/**.

## Cuándo se elimina

- Cuando el equipo decida que ya no se necesita ni siquiera como referencia.
- Antes de borrar: comprobar que ningún script, doc o CI haga referencia a archivos de esta carpeta.

---

## Contenido actual

### node-v24.13.0-x64.msi (si existe)

- **Uso:** Instalador de Node.js para Windows; no es necesario para el proyecto (se usa nvm o Node instalado por otro medio). Movido aquí para mantener la raíz limpia.
- **Eliminar:** Cuando ya no se necesite como referencia.

### docker-compose.yml

- **Uso:** Solo si quieres levantar Postgres + PostGIS en Docker para desarrollo local.
- **Producción:** El proyecto está preparado para un servidor con PostgreSQL + PostGIS instalado directamente (sin Docker). Ver `server/db/README.md` para instrucciones.
