# Sistema de Historial de Aforos - ETL Masivo

## Propósito

Este sistema genera un historial completo de todos los aforos procesados, organizado por nodo. El historial incluye:

- **Análisis completo** de cada estudio (hora pico, distribución, volúmenes)
- **Observaciones y conflictos** con contexto temporal y espacial
- **Patrones extraídos** para aprendizaje de IA (horarios problemáticos, tipos de conflictos comunes)
- **Estadísticas agregadas** por nodo (tendencias, promedios, rangos)

## Estructura del Historial

### Archivo: `public/data/historial.json`

```json
{
  "metadata": {
    "version": "1.0",
    "generated_at": "2026-01-28T...",
    "total_nodes": 788,
    "total_studies_processed": 5000
  },
  "nodes": {
    "171": {
      "node_id": "171",
      "address": "AK_45_X_CL_245",
      "via_principal": "AK_45",
      "via_secundaria": "CL_245",
      "historico": [
        {
          "file_id": 1800,
          "fecha": "2023-12-22",
          "contratista": "ICOVIAS SAS",
          "analisis": { ... },
          "observaciones": {
            "horarios_problematicos": { "07:00": 2 },
            "tipos_conflictos": { "congestion": 2 },
            "observaciones_completas": [ ... ]
          }
        }
      ],
      "estadisticas": {
        "total_estudios": 37,
        "años": [2019, 2021, 2023, 2024],
        "volumen_promedio_pico": 12500,
        "tendencia": "creciente",
        "patrones_observaciones": { ... }
      }
    }
  }
}
```

## Uso del Script ETL

### Procesamiento Completo (primera vez)

```bash
node server/scripts/buildHistorialMasivo.js
```

### Procesamiento Incremental (solo estudios nuevos)

```bash
node server/scripts/buildHistorialMasivo.js --incremental
```

### Modo de Prueba (limitar nodos)

```bash
node server/scripts/buildHistorialMasivo.js --limit=10
```

### Forzar Reprocesamiento Completo

```bash
node server/scripts/buildHistorialMasivo.js --force
```

## Características para IA

### 1. Patrones de Observaciones

Cada estudio incluye análisis de observaciones:

- **Horarios problemáticos**: Agrupación por intervalos de 15 min
- **Tipos de conflictos**: Categorización automática (congestión, accidentes, obras, clima, etc.)
- **Sentidos afectados**: Identificación de direcciones con más problemas
- **Observaciones completas**: Texto original para contexto completo

### 2. Estadísticas Agregadas por Nodo

- **Tendencias temporales**: Comparación de primeros vs últimos estudios
- **Rangos de volumen**: Mínimo, máximo, promedio
- **Patrones globales**: Agregación de todas las observaciones históricas

### 3. Contexto Temporal

Cada estudio incluye:
- Año, mes, día de semana
- Estación del año
- Para análisis estacionales y comparaciones temporales

## Ejemplos de Consultas para IA

### "¿Cuántos aforos ha tenido la Av. Boyacá desde 2019?"

```javascript
const node = historial.nodes[nodeId];
const años = node.estadisticas.años; // [2019, 2021, 2023, 2024]
const total = node.estadisticas.total_estudios; // 37
```

### "¿Cuál es la tendencia de volumen en el nodo 171?"

```javascript
const tendencia = node.estadisticas.tendencia; // "creciente", "decreciente", "estable"
const promedio = node.estadisticas.volumen_promedio_pico;
```

### "¿Qué horarios son problemáticos en este nodo?"

```javascript
const horarios = node.estadisticas.patrones_observaciones.horarios_problematicos;
// { "07:00": 15, "08:00": 12, "17:00": 8 }
```

### "¿Qué tipos de conflictos son más comunes?"

```javascript
const tipos = node.estadisticas.patrones_observaciones.tipos_conflictos;
// { "congestion": 25, "obras": 10, "accidente": 5 }
```

## Archivos Generados

- `public/data/historial.json`: Historial completo
- `data/.historial_progress.json`: Progreso del procesamiento (para modo incremental)

## Notas

- El script descarga Excel desde DIM en tiempo real
- Incluye delay de 100ms entre descargas para no saturar el servidor
- Guarda progreso cada 10 nodos para evitar pérdida de datos
- Las observaciones se categorizan automáticamente para facilitar análisis
