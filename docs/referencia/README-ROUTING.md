# Routing - Blog como Página Separada

## ✅ Implementación Completada

El blog ahora es una página separada accesible en `/blog`

### Rutas Configuradas

- **`/`** - Página principal (Home, Tienda, FAQ, Contacto)
- **`/blog`** - Página del blog con noticias

### Navegación

- El botón **"Noticias"** en el Navbar navega a `/blog`
- El **logo** navega a la página principal `/`
- Los demás botones (Servicios, Tienda, FAQ, Contacto) hacen scroll en la página principal

### Estructura de Archivos

```
src/
├── pages/
│   ├── HomePage.jsx      # Página principal
│   └── BlogPage.jsx      # Página del blog
├── components/
│   ├── Blog.jsx          # Componente del blog
│   └── Navbar.jsx        # Navbar con routing
└── App.jsx               # Router configurado
```

### Cómo Funciona

1. **React Router** maneja la navegación entre páginas
2. El **Navbar** está presente en todas las páginas
3. El **Blog** es una página independiente con su propia URL

### Acceso

- **Página Principal**: `http://localhost:5173/`
- **Blog**: `http://localhost:5173/blog`
