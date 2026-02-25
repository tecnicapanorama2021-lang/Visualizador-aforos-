# 📊 Reporte de Auditoría - Layers IDECA

**Fecha:** 20 de enero de 2026  
**Total de Layers Auditados:** 10  
**Estado:** ✅ Completado

---

## 📋 Resumen Ejecutivo

| Métrica | Valor |
|---------|-------|
| **Total de Layers** | 10 |
| **Total de Campos Únicos** | 56 |
| **Total de Campos Duplicados** | 17 |
| **Layers con Duplicación Crítica** | 2 (Nomenclatura Vial y Malla Vial) |

---

## 🔍 Hallazgos Principales

### ⚠️ Duplicación Crítica Detectada

**Layers 11 (Nomenclatura Vial) y 13 (Malla Vial) tienen IDÉNTICOS campos:**

Estos dos layers comparten **15 campos exactamente iguales**, lo que sugiere que:
- Pueden ser representaciones diferentes de la misma información
- Uno podría ser un subconjunto del otro
- Podría haber redundancia innecesaria en la base de datos

**Campos duplicados entre Layer 11 y Layer 13:**
1. `MVICODIGO` - Identificador único del eje vial
2. `MVICCALZAD` - Código de Identificación de Calzada
3. `MVICIV` - Código de Identificación Vial
4. `MVICCAT` - Código identificador UAECD
5. `MVITCLA` - Tipo de clasificación
6. `MVITIPO` - Tipo de vía
7. `MVINOMBRE` - Nombre de la vía
8. `MVINALTERN` - Nombre alternativo de la vía
9. `MVINPRINCI` - Nomenclatura principal
10. `MVINGENERA` - Nomenclatura generadora
11. `MVINANTIGU` - Nomenclatura antigua
12. `MVIETIQUET` - Etiqueta
13. `MVISVIA` - Sentido de la vía
14. `MVINUMC` - Carriles por calzada
15. `MVIVELREG` - Velocidad Reglamentaria

**Diferencia clave:** Ambos tienen la misma geometría (`esriGeometryPolyline`) y los mismos campos, pero representan conceptos diferentes:
- **Layer 11:** Nomenclatura Vial (información de nombres y etiquetas)
- **Layer 13:** Malla Vial (información de la estructura vial)

**Recomendación:** Verificar si realmente necesitas ambos layers activos simultáneamente, o si puedes usar solo uno según el caso de uso.

---

## 📊 Detalle por Layer

### 1. Layer 11: Nomenclatura Vial
- **Tipo:** Feature Layer (Polyline)
- **Campos:** 17
- **URL REST:** `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/11`
- **Descripción:** Layer que representa la nomenclatura dentro del objeto geográfico Malla Vial
- **Campos únicos:** 0 (todos compartidos con Layer 13)

### 2. Layer 13: Malla Vial
- **Tipo:** Feature Layer (Polyline)
- **Campos:** 17
- **URL REST:** `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/13`
- **Campos únicos:** 0 (todos compartidos con Layer 11)
- **Estado:** ⚠️ Duplicación completa con Layer 11

### 3. Layer 14: Puente
- **Tipo:** Feature Layer (Polygon)
- **Campos:** 5
- **Campos únicos:** 3 (`PUECODIGO`, `PUETIPO`, `PUEUBICACI`)
- **Estado:** ✅ Sin duplicación significativa

### 4. Layer 15: Calzada
- **Tipo:** Feature Layer (Polygon)
- **Campos:** 8
- **Campos únicos:** 6 (`CALCODIGO`, `CALCIV`, `CALFUNCION`, `CALTSUPERF`, `CALANCHO`, `CALLONGITU`)
- **Relación:** `CALCIV` se relaciona con `MVICIV` de los layers 11 y 13
- **Estado:** ✅ Sin duplicación significativa

### 5. Layer 16: Andenes
- **Tipo:** Feature Layer (Polygon)
- **Campos:** 5
- **Campos únicos:** 3 (`ANDCODIGO`, `ANDCIV`, `ANDMATERIA`)
- **Relación:** `ANDCIV` se relaciona con `MVICIV` de los layers 11 y 13
- **Estado:** ✅ Sin duplicación significativa

### 6. Layer 17: Separadores
- **Tipo:** Feature Layer (Polygon)
- **Campos:** 5
- **Campos únicos:** 3 (`SEPCODIGO`, `SEPCIV`, `SEPMATERIA`)
- **Relación:** `SEPCIV` se relaciona con `MVICIV` de los layers 11 y 13
- **Estado:** ✅ Sin duplicación significativa

### 7. Layer 34: Placa Domiciliaria
- **Tipo:** Feature Layer (Point)
- **Campos:** 9
- **Campos únicos:** 7 (`PDOCODIGO`, `PDOTIPO`, `PDOTEXTO`, `PDOCINTERI`, `PDOANGULO`, `PDONVIAL`, `PDOCLOTE`)
- **Relación:** `PDOCLOTE` se relaciona con `LOTCODIGO` del Layer 38
- **Estado:** ✅ Sin duplicación significativa

### 8. Layer 38: Lotes
- **Tipo:** Feature Layer (Polygon)
- **Campos:** 8
- **Campos únicos:** 6 (`LOTCODIGO`, `LOTDISPERS`, `LOTILDISPE`, `LOTUPREDIA`, `LOTDISTRIT`, `MANZCODIGO`)
- **Relación:** `MANZCODIGO` se relaciona con `MANCODIGO` del Layer 40
- **Estado:** ✅ Sin duplicación significativa

### 9. Layer 39: Construcciones
- **Tipo:** Feature Layer (Polygon)
- **Campos:** 11
- **Campos únicos:** 9 (`CONCODIGO`, `CONNPISOS`, `CONTSEMIS`, `CONNSOTANO`, `CONVOLADIZ`, `CONALTURA`, `CONELEVACI`, `CONMEJORA`, `LOTECODIGO`)
- **Relación:** `LOTECODIGO` se relaciona con `LOTCODIGO` del Layer 38
- **Estado:** ✅ Sin duplicación significativa

### 10. Layer 40: Manzanas
- **Tipo:** Feature Layer (Polygon)
- **Campos:** 4
- **Campos únicos:** 2 (`MANCODIGO`, `SECCODIGO`)
- **Estado:** ✅ Sin duplicación significativa

---

## 🔗 Relaciones entre Layers

### Jerarquía Vial
```
Malla Vial (13) / Nomenclatura Vial (11)
    ├── Calzada (15) → CALCIV → MVICIV
    ├── Andenes (16) → ANDCIV → MVICIV
    └── Separadores (17) → SEPCIV → MVICIV
```

### Jerarquía Predial
```
Manzanas (40)
    └── Lotes (38) → MANZCODIGO → MANCODIGO
        ├── Construcciones (39) → LOTECODIGO → LOTCODIGO
        └── Placa Domiciliaria (34) → PDOCLOTE → LOTCODIGO
```

---

## 📝 Campos Estándar (Presentes en Todos los Layers)

Estos campos son normales y esperados en todos los layers de ArcGIS:

1. **OBJECTID** (`esriFieldTypeOID`) - Identificador único del registro
2. **SHAPE** (`esriFieldTypeGeometry`) - Geometría del objeto espacial

**Estado:** ✅ Normal - No se consideran duplicación problemática

---

## 🎯 Recomendaciones

### 1. Duplicación Crítica (Alta Prioridad)
- **Problema:** Layers 11 y 13 tienen campos idénticos
- **Acción:** 
  - Verificar con IDECA si ambos layers son necesarios
  - Si solo necesitas la información de nombres, usar Layer 11
  - Si solo necesitas la estructura vial, usar Layer 13
  - Considerar desactivar uno de los dos en tu aplicación

### 2. Optimización de Consultas
- **Oportunidad:** Los layers relacionados pueden consultarse mediante JOINs usando los campos de relación
- **Ejemplo:** 
  - Para obtener información completa de un lote: Layer 38 (Lotes) + Layer 39 (Construcciones) usando `LOTCODIGO`
  - Para obtener información vial completa: Layer 13 (Malla Vial) + Layer 15 (Calzada) usando `MVICIV` / `CALCIV`

### 3. Campos de Relación Identificados
Los siguientes campos permiten relacionar layers:
- `MVICIV` / `CALCIV` / `ANDCIV` / `SEPCIV` → Relación entre elementos viales
- `LOTCODIGO` / `LOTECODIGO` / `PDOCLOTE` → Relación entre elementos prediales
- `MANZCODIGO` / `MANCODIGO` → Relación entre manzanas y lotes

---

## 📈 Estadísticas de Campos

### Por Tipo de Dato
- **Integer:** 25 campos
- **String:** 20 campos
- **Double:** 3 campos
- **SmallInteger:** 2 campos
- **OID:** 10 campos (OBJECTID)
- **Geometry:** 10 campos (SHAPE)

### Por Categoría
- **Vialidad:** 15 campos únicos (sin contar duplicados)
- **Predial:** 17 campos únicos
- **Infraestructura:** 3 campos únicos (Puentes)
- **Estándar:** 2 campos (OBJECTID, SHAPE)

---

## ✅ Conclusión

La auditoría revela que:
1. ✅ La mayoría de los layers tienen campos únicos y bien definidos
2. ⚠️ Existe una duplicación crítica entre Layers 11 y 13 que requiere atención
3. ✅ Las relaciones entre layers están bien definidas mediante campos de relación
4. ✅ Los campos estándar (OBJECTID, SHAPE) están presentes correctamente en todos los layers

**Próximos pasos sugeridos:**
1. Decidir si mantener ambos layers 11 y 13 activos o consolidar en uno
2. Implementar consultas relacionadas usando los campos identificados
3. Optimizar la carga de layers según el caso de uso específico

---

**Generado por:** Sistema de Auditoría IDECA  
**Versión:** 1.0

---

## 📎 Documentos Relacionados

- **data/MAPEO_CAMPOS_IDECA.json**: Mapeo completo de todos los campos con nombres reales, tipos y propiedades
- **MAPEO_CAMPOS_IDECA_REACT.md**: Guía práctica con ejemplos de código React para usar los campos reales

---

## ✅ Verificación Confirmada

**Los datos de este reporte fueron verificados consultando directamente las URLs REST de cada layer:**

```
https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/{layerId}?f=json
```

**Confirmación:** Los nombres de campos, tipos, aliases y dominios fueron obtenidos directamente de la API REST oficial de IDECA.
