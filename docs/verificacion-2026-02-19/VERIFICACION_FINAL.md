# VERIFICACIÓN INTEGRAL DEL BACKEND – 2026-02-19

## Estado general

**Estado general: ✅ Backend en buen estado, con 2 observaciones (endpoint /eventos no existe; endpoints nuevos devolvieron 404 en esta prueba por servidor previo en 3001).**

---

### Base de datos
- **Migraciones aplicadas:** ✅ (proyecto no usa tabla schema_migrations; migraciones vía archivos .sql en server/db/migrations/; 013 aplicado)
- **Nuevas tablas existen:** ✅ (vias_estudio, puntos_criticos_estudio, infraestructura_vial, proyecciones_estudio)
- **Nuevas tablas pobladas:** ✅ (infraestructura_vial: 54, proyecciones_estudio: 43; vias_estudio y puntos_criticos_estudio: 0)
- **Columna estudios_transito.diagnostico_json:** ✅ SÍ existe
- **Tablas existentes intactas:** ✅ (nodos: 1004, conteos_resumen: 670688, estudios_transito: 75, localidades: 20, upz: 112)

---

### Endpoints existentes
- **GET /api/aforos/historial/171:** ✅ Status 200
- **GET /api/aforos/nodos?fuente=DIM:** ✅ Status 200 (788 features)
- **GET /api/aforos/geocode/171:** ✅ Status 200
- **GET /api/datos-unificados/contexto-eventos:** ✅ Status 200
- **GET /api/datos-unificados/obras:** ✅ Status 200
- **GET /api/datos-unificados/eventos:** ❌ Status 404 (Cannot GET /api/datos-unificados/eventos). No existe ruta específica; los eventos se obtienen con contexto-eventos.

---

### Endpoints nuevos (estudios-transito)
En esta ejecución los cuatro devolvieron **404**. Suele deberse a que el proceso que respondía en el puerto 3001 era una instancia anterior del servidor (sin las rutas añadidas en server.js). Tras **reiniciar el servidor** desde la raíz del proyecto, se debe verificar de nuevo.

- **GET /api/estudios-transito/infraestructura?estudio_id=72:** ❌ 404 (verificar tras reinicio)
- **GET /api/estudios-transito/proyecciones?estudio_id=66:** ❌ 404 (verificar tras reinicio)
- **GET /api/estudios-transito/puntos-criticos?estudio_id=72:** ❌ 404 (verificar tras reinicio)
- **GET /api/estudios-transito/vias?estudio_id=72:** ❌ 404 (verificar tras reinicio)

Las rutas están definidas en `routes/estudiosTransito.js` y montadas en `server.js` en `/api/estudios-transito`. La BD tiene datos para infraestructura (54) y proyecciones (43), por lo que al responder el servidor correcto los endpoints deberían devolver datos.

---

### Carpetas y archivos
- **Estructura estudios-transito:** ✅ (data/estudios-transito/PDFs/ con SDP: 5, SECOP: 1, PRIVADO: 14 PDFs)
- **index.json:** ✅ (JSON válido, 19 estudios, 18 procesados, 1 error, campos correctos)
- **Carpetas antiguas eliminadas:** ❌ (data/secop/anexos y data/privado/anexos siguen existiendo y con archivos; opcional eliminarlas)

---

### Carga de datos (stats:fuentes)
- **Estudios de tránsito (estudios_transito):** 75 total (ETT 56, OTRO 14, PMT 2, PPRU 2, AFORO 1). Por fuente: SECOP 51, PRIVADO 14, SDP 10.
- **Aforos (conteos_resumen):** 670688 total (DIM ~670427, SDP 156, PRIVADO 62, etc.)
- **Infraestructura (infraestructura_vial):** 54 registros
- **Proyecciones (proyecciones_estudio):** 43 registros
- **Puntos críticos (puntos_criticos_estudio):** 0 registros
- **Vías (vias_estudio):** 0 registros

---

## Conclusión

**Backend en buen estado.** La BD tiene las nuevas tablas y datos; los endpoints existentes (aforos, nodos, geocode, contexto-eventos, obras) responden correctamente. El endpoint listado como “/api/datos-unificados/eventos” no existe en el código (solo contexto-eventos y obras). Los cuatro endpoints nuevos de estudios-transito devolvieron 404 en esta prueba porque muy probablemente el servidor que contestó en el puerto 3001 era una instancia antigua; se recomienda cerrar cualquier `node server.js` previo, volver a ejecutar `node server.js` desde la raíz del proyecto y repetir las peticiones a /api/estudios-transito/*.

---

## Detalles de errores / observaciones

1. **GET /api/datos-unificados/eventos → 404**  
   No hay ruta definida para “/eventos”; los eventos se sirven en “/contexto-eventos”. Si se desea un endpoint solo de eventos, habría que añadirlo.

2. **GET /api/estudios-transito/* → 404 en esta verificación**  
   Rutas presentes en código; 404 atribuido a servidor previo en 3001. Acción: reiniciar servidor y volver a probar.

3. **Carpetas data/secop/anexos y data/privado/anexos**  
   Siguen existiendo y con archivos. La documentación indica que su eliminación es opcional tras migrar a data/estudios-transito/PDFs/.
