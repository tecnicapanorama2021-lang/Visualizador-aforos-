# Verificación PostgreSQL/PostGIS + Restore local

**Fecha:** 2026-02-23  
**Carpeta export:** `db_export_20260223_1601`  
**PostgreSQL local:** 18 (C:\Program Files\PostgreSQL\18)

---

## Checklist

| Ítem | Estado | Nota |
|------|--------|------|
| Servicio PostgreSQL | ✅ | `postgresql-x64-18` en **Running** |
| Puerto 5432 | ✅ | **LISTENING** (PID 7604) |
| psql | ✅ | `C:\Program Files\PostgreSQL\18\bin\psql.exe` v18.2 (no en PATH) |
| pg_restore | ✅ | `C:\Program Files\PostgreSQL\18\bin\pg_restore.exe` v18.2 (no en PATH) |
| Conexión psql (auth) | ✅ | Probada con usuario postgres; conexión OK |
| PostGIS instalado local | ❌ | No disponible en PG 18 (0 filas en pg_available_extensions). Instalar vía Stack Builder. |
| Dump validado | ✅ | `pg_restore --list` OK → **restore_list_local.txt** generado |

---

## 1. Instalación detectada

- **Ruta binarios:** `C:\Program Files\PostgreSQL\18\bin\`
- **Versiones:** psql 18.2, pg_restore 18.2
- **Servicio:** `postgresql-x64-18` (PostgreSQL Server 18) — **Running**
- **Puerto:** 5432 (TCP) en escucha

**PATH:** `psql` y `pg_restore` **no** están en el PATH. Usar ruta completa o añadir a PATH:

```powershell
$env:PATH = "C:\Program Files\PostgreSQL\18\bin;" + $env:PATH
```

---

## 2. Conexión

Probada con usuario `postgres` en localhost:5432: **OK** (PostgreSQL 18.2).

Para no escribir la contraseña en scripts, usa variable de entorno solo en la sesión:

```powershell
$env:PGPASSWORD = "tu_password"
# Luego psql / pg_restore / createdb
```

O archivo `.pgpass` en `%APPDATA%\postgresql\pgpass.conf` (formato: host:port:database:user:password).

---

## 3. PostGIS

- **En el dump:** PostGIS 3.6.1 (BD origen, PostgreSQL 16).
- **En local (PG 18):** Comprobado con `SELECT name FROM pg_available_extensions WHERE name='postgis';` → **0 filas** → **PostGIS no está instalado** en este cluster.

**Qué hacer:** Instalar PostGIS para PostgreSQL 18:

1. Ejecutar **Stack Builder** (viene con el instalador de PostgreSQL) o descargarlo desde postgresql.org.
2. Elegir PostgreSQL 18 → **Spatial Extensions** → **PostGIS Bundle**.
3. Instalar y reiniciar si lo pide.
4. Luego, en una BD (p. ej. `aforos`): `CREATE EXTENSION IF NOT EXISTS postgis;`

Sin PostGIS, el restore del dump puede fallar al restaurar objetos espaciales (geometrías, índices PostGIS).

---

## 4. Dump validado

- **Archivos en carpeta export:**
  - `panorama_db.dump` ✅
  - `globals.sql` ✅
  - `restore_toc.txt` ✅ (del servidor)
  - **restore_list_local.txt** ✅ (generado en local con `pg_restore --list`)

- **Contenido del dump:** Format CUSTOM, 341 TOC entries, DB origen 16.12, incluye extensión PostGIS y tablas: archivos_fuente, conteos_resumen, contexto_eventos, estudios, estudios_transito, eventos_canonica, incidentes, nodos, etc.

**Conteos de referencia (del servidor):** nodos 1004, estudios 4260, conteos_resumen 670736, incidentes 1250, contexto_eventos 2776.

---

## 5. Restore (solo cuando autorices)

**Importante:** No se ha creado ni borrado ninguna base. La BD `aforos` no se ha creado ni restaurado hasta que lo autorices.

### 5.1 Crear BD destino

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h localhost -p 5432 -U postgres aforos
```

Si ya existe `aforos` y quieres reemplazarla (¡destruye datos!):

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5432 -U postgres -d postgres -c "DROP DATABASE IF EXISTS aforos;"
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h localhost -p 5432 -U postgres aforos
```

### 5.2 Globals (opcional, con precaución)

`globals.sql` incluye el rol `postgres` con contraseña del servidor de origen. **No ejecutes el globals.sql completo en local** si quieres conservar tu usuario/contraseña local. Si solo necesitas otros roles, edita `globals.sql` y deja solo esos roles antes de aplicar.

```powershell
# Solo si quieres aplicar roles (sin tocar postgres), edita globals.sql antes
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5432 -U postgres -d postgres -f "C:\Users\Ashle\Panorama desarrollos\Visualizador de aforos\db_export_20260223_1601\globals.sql"
```

### 5.3 Restaurar dump

```powershell
$dumpPath = "C:\Users\Ashle\Panorama desarrollos\Visualizador de aforos\db_export_20260223_1601\panorama_db.dump"
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -p 5432 -U postgres -d aforos -Fc $dumpPath
```

Pueden aparecer warnings sobre “role postgres” o “extensions”; si el restore termina y la BD tiene tablas, suele ser aceptable.

### 5.4 Post-restore: PostGIS

Si al arrancar la app falla por PostGIS, conéctate a `aforos` y ejecuta:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT PostGIS_Full_Version();
```

### 5.5 Comprobaciones post-restore

```powershell
# Con PGPASSWORD ya configurado en la sesión
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5432 -U postgres -d aforos -c "SELECT 'nodos' AS tabla, COUNT(*) FROM nodos UNION ALL SELECT 'estudios', COUNT(*) FROM estudios UNION ALL SELECT 'conteos_resumen', COUNT(*) FROM conteos_resumen UNION ALL SELECT 'incidentes', COUNT(*) FROM incidentes;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5432 -U postgres -d aforos -c "SELECT PostGIS_Full_Version();"
```

---

## 6. Resumen

- **Servicio y puerto:** OK.
- **Herramientas CLI:** OK (usar ruta completa o añadir `C:\Program Files\PostgreSQL\18\bin` al PATH).
- **Conexión:** Requiere configurar contraseña (PGPASSWORD o .pgpass).
- **PostGIS:** Comprobar con psql una vez autenticado; si falta, instalar vía Stack Builder para PG 18.
- **Dump:** Validado; `restore_list_local.txt` generado.
- **Restore:** No ejecutado; comandos listos arriba para cuando autorices (crear `aforos` y restaurar `panorama_db.dump`).

**Qué faltaría para dejar todo listo:**

1. Configurar contraseña de postgres en la sesión (o .pgpass) y probar `psql -h localhost -p 5432 -U postgres -d postgres -c "SELECT 1"`.
2. Comprobar PostGIS disponible con la consulta de `pg_available_extensions`.
3. Cuando quieras restaurar: crear BD `aforos`, ejecutar `pg_restore` con el comando de 5.3 y, si hace falta, `CREATE EXTENSION postgis` en `aforos`.
4. Actualizar `.env` del proyecto con `DATABASE_URL` o `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` apuntando a la BD `aforos` local.
