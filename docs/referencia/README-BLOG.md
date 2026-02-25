# Blog Automático - Noticias de Tránsito

## 🚀 Cómo ejecutar el proyecto

### Opción 1: Ejecutar todo junto (Recomendado)
```bash
npm run dev:all
```
Esto iniciará tanto el servidor API (puerto 3001) como el servidor Vite (puerto 5173).

### Opción 2: Ejecutar por separado

**Terminal 1 - Servidor API:**
```bash
npm run dev:api
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

## 📡 Endpoints

- **API de Noticias**: `http://localhost:3001/api/noticias`
- **Health Check**: `http://localhost:3001/health`
- **Frontend**: `http://localhost:5173`

## 🔧 Fuentes de Noticias

El blog automático obtiene noticias de:

1. **Google News RSS** - Búsqueda de noticias sobre tránsito, cierres, obras en Bogotá
2. **El Tiempo RSS** - Sección de Bogotá filtrada por palabras clave
3. **El Espectador RSS** - Sección de Bogotá filtrada por palabras clave

## ⚙️ Características

- ✅ Actualización automática cada 15 minutos
- ✅ Cache inteligente (15 minutos)
- ✅ Deduplicación automática
- ✅ Categorización automática (Cierres, Obras, PMT, Transporte, Tránsito)
- ✅ Filtros por categoría
- ✅ Diseño responsive
- ✅ Sin costo (RSS gratuito)

## 📝 Notas

- El servidor API debe estar corriendo para que el blog funcione
- En producción, configura la URL del API en `Blog.jsx` (línea 20)
- El cache se resetea cada 15 minutos automáticamente
