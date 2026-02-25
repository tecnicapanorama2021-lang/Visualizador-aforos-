# Estructura unificada de estudios de tránsito

## Estructura de carpetas

```
data/estudios-transito/
├── PDFs/                    ← Única carpeta para todos los PDFs
│   ├── SDP/                 ← Estudios SDP (PPRU, etc.)
│   ├── SECOP/               ← Estudios de procesos SECOP
│   ├── PRIVADO/             ← Estudios privados / consultorías
│   └── OTROS/               ← Cualquier otro origen
├── extracciones/            ← Resultados del ETL (auto-generado)
│   ├── 001_<nombre_estudio>/
│   │   ├── aforos.csv
│   │   ├── vias.csv
│   │   ├── puntos_criticos.json
│   │   ├── infraestructura.csv
│   │   ├── metadata.json
│   │   └── raw_tables.json
│   └── ...
└── index.json               ← Catálogo de estudios (archivo, origen, hash, resumen)
```

## Cómo subir nuevos PDFs

1. Copiar el PDF en la carpeta según el origen:
   - **SDP**: `data/estudios-transito/PDFs/SDP/`
   - **SECOP**: `data/estudios-transito/PDFs/SECOP/`
   - **PRIVADO**: `data/estudios-transito/PDFs/PRIVADO/`
   - **OTROS**: `data/estudios-transito/PDFs/OTROS/`

2. Ejecutar el ETL de estudios de tránsito:
   ```bash
   npm run etl:estudios-transito
   ```

3. El script:
   - Detecta PDFs nuevos (comparando hash con `index.json`)
   - Los registra en `archivos_fuente` y en `estudios_transito`
   - Extrae tablas del PDF y clasifica: aforos, vías, puntos críticos, infraestructura, proyecciones
   - Actualiza `index.json` con resumen (aforos, vías, puntos críticos, etc.) y estado

## Qué esperar de cada extracción

| Tipo | Tabla BD | Contenido |
|------|----------|-----------|
| **Aforos** | `conteos_resumen` | Volúmenes por nodo, sentido, intervalo (veh/hora, conteo, etc.) |
| **Vías** | `vias_estudio` | Vías analizadas: nombre, tipo, sentidos, capacidad, velocidad, cicloinfra, geom |
| **Puntos críticos** | `puntos_criticos_estudio` | Congestión, accidentes, riesgos peatonales/ciclistas, geom |
| **Infraestructura** | `infraestructura_vial` | Semáforos, pasos peatonales, cicloinfra, estado, geom |
| **Diagnóstico** | `estudios_transito.diagnostico_json` | Localidades/UPZ, comercio, densidad (JSON) |
| **Proyecciones** | `proyecciones_estudio` | Escenarios 5/10 años, volumen proyectado, nivel congestión |

Los CSV/JSON en `extracciones/<id>/` son una copia de lo extraído para auditoría; la fuente de verdad para el mapa y la API es la base de datos.

## Migración desde la estructura antigua

Los PDFs que estaban en:
- `data/privado/anexos/SDP/` → `data/estudios-transito/PDFs/SDP/`
- `data/privado/anexos/PRIVADO/` → `data/estudios-transito/PDFs/PRIVADO/`
- `data/secop/anexos/<id_proceso>/` → `data/estudios-transito/PDFs/SECOP/`

se migraron a la estructura unificada. El ETL genérico (`npm run etl:pdf`) y el ETL enriquecido (`npm run etl:estudios-transito`) resuelven la ruta del PDF buscando primero en `data/estudios-transito/PDFs/<origen>/` y luego en las rutas antiguas por compatibilidad.

Tras verificar que todo funciona, puedes eliminar las carpetas antiguas para evitar duplicados:
- `data/secop/anexos/` (solo anexos; `data/secop/pdf_extracciones/` puede conservarse si la usas)
- `data/privado/anexos/`
