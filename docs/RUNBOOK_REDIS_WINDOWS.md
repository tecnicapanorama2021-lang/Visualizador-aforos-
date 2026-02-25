# Runbook — Redis en Windows (WSL2)

Pasos oficiales para tener Redis en local y usarlo con BullMQ en el proyecto.

## 0. Requisitos

- Windows 10/11 con WSL2.
- Redis recomienda WSL2 para Windows: [Redis on Windows](https://redis.io/docs/install/install-redis/install-redis-on-windows/).

## 1. Instalar WSL2

1. Abre **PowerShell como Administrador**.
2. Ejecuta:

   ```powershell
   wsl --install
   ```

3. Reinicia el equipo si te lo pide.
4. Tras reiniciar, abre **Ubuntu** desde el menú Inicio y crea tu usuario y contraseña cuando se solicite.

## 2. Instalar Redis en Ubuntu (WSL)

En la terminal de **Ubuntu (WSL)**:

```bash
sudo apt update
sudo apt install redis-server -y
```

Alternativa usando el repositorio oficial de Redis (versiones recientes):

```bash
curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list
sudo apt-get update
sudo apt-get install redis
```

## 3. Iniciar Redis

```bash
sudo service redis-server start
```

Para comprobar que está en ejecución:

```bash
redis-cli ping
```

Debe responder: `PONG`.

Para ejecutar Redis en segundo plano (daemon):

```bash
redis-server --daemonize yes
```

## 4. Variables en el proyecto (Windows)

En la raíz del proyecto, en `.env`, añade:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
# Opcional si Redis tiene contraseña:
# REDIS_PASSWORD=tu_password
```

## 5. Levantar API + Worker

- **Terminal A** (servidor API):

  ```bash
  npm run dev:api
  ```
  o `npm run start` en producción.

- **Terminal B** (worker BullMQ):

  ```bash
  npm run worker
  ```

Comprueba que Redis está accesible desde Windows: el worker se conecta a `127.0.0.1:6379` (mismo localhost que WSL cuando usas localhost en Windows).

## 6. Opcional: registrar jobs repetibles

Si los repeatables no se registran al arrancar el worker, puedes ejecutar una vez (o al desplegar):

```bash
npm run jobs:seed
```

## 7. Diagnóstico

- **Ping a Redis desde Ubuntu:** `redis-cli ping` → `PONG`.
- **Desde Node (proyecto):** el worker al arrancar intenta conectar; si falla, verás el error de conexión en consola.
- **Redis Insight:** puedes usar [Redis Insight](https://redis.io/docs/stack/insight/) para inspeccionar colas y claves.

## 8. Verificación rápida (checklist)

**A) En Ubuntu (WSL) — Redis**

```bash
redis-cli ping
```

Debe responder: `PONG`.

**B) En el repo**

1. Aplicar migraciones:

   ```bash
   npm run db:migrate
   ```

2. Registrar los repeatables (después de tener Redis corriendo):

   ```bash
   npm run jobs:seed
   ```

3. Levantar API y worker en **dos terminales**:

   - **Terminal A:** `npm run dev:api`
   - **Terminal B:** `npm run worker`

**C) Seed de prueba (confirmación inmediata)**

```bash
npm run seed:manifestacion-geocode-test
```

Crea una manifestación de prueba, la geocodifica y deja al menos 1 registro con `geom` para el mapa.

**D) Verificación**

- **Por API:** `GET /api/manifestaciones/nodos` — deberías ver al menos 1 feature (la de prueba).
- **Por SQL:**

  ```sql
  SELECT quality_status, COUNT(*)
  FROM incidentes
  WHERE tipo = 'MANIFESTACION'
  GROUP BY 1;

  SELECT COUNT(*)
  FROM incidentes
  WHERE tipo = 'MANIFESTACION' AND geom IS NOT NULL;
  ```

## Referencias

- [Install Redis on Ubuntu/Debian](https://redis.io/docs/install/install-redis/install-redis-on-linux/)
- [Redis on Windows (WSL)](https://redis.io/docs/install/install-redis/install-redis-on-windows/)
