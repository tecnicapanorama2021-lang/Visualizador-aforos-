# Restaurar copia de la BD en Windows (local)

Pasos para restaurar en una máquina Windows la copia portable generada por `scripts/db_export.ps1` o `scripts/db_export.sh` (carpeta `db_export_YYYYMMDD_HHMM`).

**No se incluyen contraseñas ni secretos.** Debes configurar las credenciales en tu entorno local.

---

## Requisitos en Windows

1. **PostgreSQL** instalado (ej. 14, 15 o 16) con `psql`, `pg_restore` en el PATH.  
   Ejemplo típico: `C:\Program Files\PostgreSQL\16\bin\`

2. **PostGIS** instalado en el mismo cluster (o extensión disponible).  
   Tras crear/restaurar la BD, ejecutar si hace falta:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- si usas buscador nodos
   ```

3. Carpeta de exportación copiada en el equipo local (p. ej. `db_export_20260223_1200`), con al menos:
   - `panorama_db.dump`
   - `globals.sql` (opcional si quieres roles/permisos)
   - `restore_toc.txt` (solo verificación)

---

## Paso 0: Detectar conexión

- **Postgres en Windows (servicio local):** `host=localhost`, `port=5432`, usuario típico `postgres`, BD que vas a crear/restaurar (ej. `aforos`).
- **Docker:** si Postgres corre en un contenedor, usa `host=localhost` y el puerto mapeado (ej. `5432`).
- **Remoto (RDS/Cloud):** usa el host y puerto que te proporcione el proveedor.

Comprobar conectividad (sustituir usuario y nombre de BD; la contraseña se pedirá o usará `PGPASSWORD` / `.pgpass`):

```powershell
psql -h localhost -p 5432 -U postgres -d postgres -c "SELECT version();"
```

---

## Restore recomendado

### 1. Crear la base de datos (si no existe)

Conectado a la BD `postgres` (u otra existente):

```powershell
psql -h localhost -p 5432 -U postgres -d postgres -c "CREATE DATABASE aforos ENCODING 'UTF8' LC_COLLATE='en_US.UTF-8' LC_CTYPE='en_US.UTF-8' TEMPLATE template0;"
```

Si tu instalación usa otro locale (ej. `Spanish_Colombia.1252`), ajusta `LC_COLLATE`/`LC_CTYPE` o omite si quieres usar el default del cluster.

### 2. Restaurar roles/permisos (opcional)

Solo si quieres replicar roles y privilegios del servidor de origen (puede requerir superuser):

```powershell
psql -h localhost -p 5432 -U postgres -d postgres -f "RUTA\db_export_YYYYMMDD_HHMM\globals.sql"
```

Si en local usas un único usuario (ej. `postgres`), puedes **omitir** este paso.

### 3. Restaurar el dump custom

Desde la carpeta donde está `panorama_db.dump` (o indicando la ruta completa):

```powershell
pg_restore -h localhost -p 5432 -U postgres -d aforos -Fc panorama_db.dump
```

- `-d aforos`: BD de destino (debe existir si no usas `-C`).
- Si prefieres que cree la BD por ti (y restaurar en ella):
  ```powershell
  pg_restore -h localhost -p 5432 -U postgres -d postgres -C -Fc panorama_db.dump
  ```
  (`-C` crea la BD antes de restaurar; el nombre sale del propio dump.)

Es normal ver avisos tipo "already exists" o "no matching roles" si en local no tienes los mismos usuarios que en origen (el dump se generó con `--no-owner --no-privileges` para evitar dependencias de roles).

### 4. Extensiones PostGIS (y otras)

Si tras el restore faltan extensiones:

```powershell
psql -h localhost -p 5432 -U postgres -d aforos -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -h localhost -p 5432 -U postgres -d aforos -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

---

## Checklist post-restore

1. **Versión PostGIS:**
   ```powershell
   psql -h localhost -p 5432 -U postgres -d aforos -c "SELECT PostGIS_Full_Version();"
   ```

2. **Conteos de tablas clave** (deben ser coherentes con el inventario `table_counts.csv` del export):
   ```sql
   SELECT 'nodos' AS table_name, COUNT(*) FROM nodos
   UNION ALL SELECT 'estudios', COUNT(*) FROM estudios
   UNION ALL SELECT 'conteos_resumen', COUNT(*) FROM conteos_resumen
   UNION ALL SELECT 'incidentes', COUNT(*) FROM incidentes
   UNION ALL SELECT 'contexto_eventos', COUNT(*) FROM contexto_eventos
   UNION ALL SELECT 'node_legs', COUNT(*) FROM node_legs
   UNION ALL SELECT 'node_turns', COUNT(*) FROM node_turns
   UNION ALL SELECT 'festivos_colombia', COUNT(*) FROM festivos_colombia;
   ```

3. **Encoding/locale:**  
   Si en el servidor de origen usabas encoding o locale especial, al crear la BD en Windows elige uno compatible (UTF8 recomendado). El dump no cambia los datos; la BD destino debe ser compatible.

---

## Cómo apuntar el proyecto local (.env)

En la raíz del proyecto, configura la conexión **sin escribir la contraseña en este documento**:

- **Opción 1 – Variables por separado (recomendado para local):**
  ```env
  PGHOST=localhost
  PGPORT=5432
  PGDATABASE=aforos
  PGUSER=postgres
  PGPASSWORD=***  # definir en .env local (no versionar .env)
  ```

- **Opción 2 – DATABASE_URL:**
  ```env
  DATABASE_URL=postgresql://postgres:***@localhost:5432/aforos
  ```
  Sustituir `***` por la contraseña real solo en tu `.env` local.

Luego:

```powershell
npm run db:migrate
```

solo si quieres volver a aplicar migraciones (normalmente no hace falta si el dump ya incluye el esquema actual). Usar el mismo `DATABASE_URL` o `PG*` para el backend.

---

## Verificación del dump antes de restaurar

Para comprobar que el archivo custom es válido y ver su contenido:

```powershell
pg_restore -l RUTA\db_export_YYYYMMDD_HHMM\panorama_db.dump
```

(O usar el archivo `restore_toc.txt` generado en la exportación.)

---

## Entregables finales (tras ejecutar el script de exportación)

- **Ruta de la carpeta:** `db_export_YYYYMMDD_HHMM` (en la misma ruta donde ejecutaste el script: por defecto la raíz del proyecto, o la que hayas pasado como `OutDir` en PowerShell / argumento en Bash). Para descargar desde el servidor: `scp`, SFTP o copia directa según tu entorno.
- **Tamaño de archivos:** en PowerShell: `Get-ChildItem RUTA\db_export_YYYYMMDD_HHMM | Format-Table Name, Length -AutoSize`. El archivo más grande suele ser `panorama_db.dump`.
- **Warnings posibles:**  
  - `pg_dumpall`: si no tienes rol superuser, pueden faltar roles; en local suele bastar con restaurar solo el dump.  
  - `pg_restore -l`: si el dump es de otra versión de Postgres, puede haber avisos al restaurar; revisar que la BD quede usable.  
  - Extensiones: si en el servidor tenías PostGIS/pg_trgm y en local no están instaladas, hay que instalarlas y ejecutar `CREATE EXTENSION` después del restore.
- **Encoding/locale:** si en el servidor la BD usa un encoding o locale distinto (p. ej. `en_US.UTF-8`), al crear la BD en Windows elige uno compatible (UTF8 recomendado). El dump no altera los bytes de los datos.

---

## Resumen de archivos de la carpeta de exportación

| Archivo            | Descripción                                              |
|--------------------|----------------------------------------------------------|
| `versions.txt`     | Salida de `SELECT version();` (Postgres).               |
| `postgis_version.txt` | Salida de `PostGIS_Full_Version();`.                 |
| `extensions.txt`   | Salida de `\dx` (extensiones habilitadas).              |
| `db_size.txt`      | Tamaño de la BD (legible).                              |
| `table_counts.csv` | Conteos: nodos, estudios, conteos_resumen, incidentes, contexto_eventos, node_legs, node_turns, festivos_colombia. |
| `globals.sql`      | Roles/permisos (pg_dumpall --globals-only).             |
| `panorama_db.dump` | Dump principal en formato custom (-Fc).                 |
| `pg_dump_cmd.txt`  | Comando exacto usado para el dump (sin contraseña).     |
| `restore_toc.txt`  | Listado TOC de pg_restore -l (verificación).            |
| `TRANSFER_README.md` | Este documento (instrucciones de restore).           |
