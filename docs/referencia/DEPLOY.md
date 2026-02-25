# Desplegar la app (tú mismo, en 2 minutos)

El proyecto ya tiene todo configurado para **un solo servicio** (frontend + API en la misma URL). Elige una opción.

---

## Opción 1: Render.com (gratis, recomendado)

1. Entra a **https://render.com** e inicia sesión (o regístrate con GitHub).
2. **New** → **Web Service**.
3. Conecta el repo de GitHub donde está este proyecto (si no está, súbelo antes).
4. Render detectará `render.yaml`. Si no, rellena a mano:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm run start`
   - **Environment:** añade `NODE_ENV` = `production`
5. **Create Web Service**.
6. Espera a que termine el build y el deploy. Tu app quedará en `https://tu-app.onrender.com`.

No hace falta configurar `VITE_API_URL`: todo va al mismo dominio.

---

## Opción 2: Railway

1. Entra a **https://railway.app** e inicia sesión con GitHub.
2. **New Project** → **Deploy from GitHub repo** → elige este repo.
3. Railway usará `nixpacks.toml` (build + start ya definidos).
4. En **Settings** → **Networking** → **Generate Domain** para obtener la URL pública.
5. Listo: la app y la API estarán en esa URL.

---

## Opción 3: Desde tu máquina (solo para probar)

```bash
npm run build
npm run start
```

Abre **http://localhost:3001**. El mismo proceso sirve la web y `/api` (incluida la descarga de aforos).

---

## Resumen

- **Un solo despliegue:** un servicio que sirve frontend (Vite) y API (Express).
- **Misma URL:** no hay 404 en `/api/aforos/descargar` porque todo es mismo origen.
- **Variables:** no necesitas `VITE_API_URL` si usas Render o Railway como arriba.
