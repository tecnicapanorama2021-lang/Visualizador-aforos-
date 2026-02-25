# 📘 Guía de Uso - Mapeo de Campos IDECA para React

**Fecha:** 20 de enero de 2026  
**Fuente:** Consulta directa REST API IDECA

---

## 🎯 Resumen Ejecutivo

Este documento proporciona ejemplos prácticos de cómo usar los campos reales de los layers IDECA en tu aplicación React.

### ⚠️ Hallazgo Crítico Confirmado

**Los Layers 11 (Nomenclatura) y 13 (Malla Vial) son IDÉNTICOS en estructura de campos.**

- ✅ Ambos tienen exactamente **17 campos**
- ✅ Todos los campos tienen los mismos nombres, tipos y propiedades
- ✅ La única diferencia es semántica (representan conceptos diferentes pero con la misma estructura)

**Recomendación:** Usa solo uno de los dos layers según tu caso de uso específico.

---

## 📋 Ejemplos de Código React

### 1. Consultar Información de un Layer

```javascript
// src/services/ideca/layerService.js

const BASE_URL = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer';

/**
 * Obtiene la información completa de un layer (campos, tipos, dominios)
 */
export const obtenerInfoLayer = async (layerId) => {
  try {
    const url = `${BASE_URL}/${layerId}?f=json`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      mode: 'cors'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'Error en respuesta');
    }
    
    return {
      layerId,
      nombre: data.name,
      tipoGeometria: data.geometryType,
      tipo: data.type,
      descripcion: data.description,
      copyright: data.copyrightText,
      campos: data.fields || [],
      url: `${BASE_URL}/${layerId}`
    };
  } catch (error) {
    console.error(`Error consultando layer ${layerId}:`, error);
    throw error;
  }
};
```

### 2. Consultar Features de un Layer (con campos reales)

```javascript
/**
 * Consulta features de un layer usando los nombres de campos reales
 */
export const consultarFeatures = async (layerId, options = {}) => {
  const {
    where = '1=1',
    outFields = '*',
    returnGeometry = true,
    geometry = null,
    spatialRel = 'esriSpatialRelIntersects',
    resultRecordCount = 1000
  } = options;
  
  try {
    const url = `${BASE_URL}/${layerId}/query`;
    const params = new URLSearchParams({
      where,
      outFields,
      returnGeometry: returnGeometry.toString(),
      f: 'json',
      outSR: '4326',
      resultRecordCount: resultRecordCount.toString()
    });
    
    if (geometry) {
      params.append('geometry', JSON.stringify(geometry));
      params.append('geometryType', 'esriGeometryPoint');
      params.append('spatialRel', spatialRel);
    }
    
    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      mode: 'cors'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'Error en query');
    }
    
    return data.features || [];
  } catch (error) {
    console.error(`Error consultando features del layer ${layerId}:`, error);
    throw error;
  }
};
```

### 3. Buscar Lote por Código (Layer 38)

```javascript
/**
 * Busca un lote específico por su código
 * Usa el campo real: LOTCODIGO
 */
export const buscarLotePorCodigo = async (codigoLote) => {
  try {
    const features = await consultarFeatures(38, {
      where: `LOTCODIGO = '${codigoLote}'`,
      outFields: 'LOTCODIGO,LOTDISPERS,LOTUPREDIA,LOTDISTRIT,MANZCODIGO',
      returnGeometry: true
    });
    
    if (features.length === 0) {
      return null;
    }
    
    const feature = features[0];
    return {
      codigo: feature.attributes.LOTCODIGO,
      disperso: feature.attributes.LOTDISPERS,
      unidadPredial: feature.attributes.LOTUPREDIA,
      distrito: feature.attributes.LOTDISTRIT,
      codigoManzana: feature.attributes.MANZCODIGO,
      geometria: feature.geometry
    };
  } catch (error) {
    console.error('Error buscando lote:', error);
    throw error;
  }
};
```

### 4. Buscar Construcciones de un Lote (Layer 39)

```javascript
/**
 * Busca todas las construcciones asociadas a un lote
 * Usa el campo de relación: LOTECODIGO
 */
export const buscarConstruccionesPorLote = async (codigoLote) => {
  try {
    const features = await consultarFeatures(39, {
      where: `LOTECODIGO = '${codigoLote}'`,
      outFields: 'CONCODIGO,CONNPISOS,CONALTURA,CONVOLADIZ,CONMEJORA,LOTECODIGO',
      returnGeometry: true
    });
    
    return features.map(feature => ({
      codigo: feature.attributes.CONCODIGO,
      numeroPisos: feature.attributes.CONNPISOS,
      altura: feature.attributes.CONALTURA,
      tieneVoladizo: feature.attributes.CONVOLADIZ === 1,
      tieneMejora: feature.attributes.CONMEJORA === 1,
      codigoLote: feature.attributes.LOTECODIGO,
      geometria: feature.geometry
    }));
  } catch (error) {
    console.error('Error buscando construcciones:', error);
    throw error;
  }
};
```

### 5. Buscar Vía por Nombre (Layers 11 o 13)

```javascript
/**
 * Busca una vía por nombre
 * Puede usar Layer 11 o 13 (son idénticos)
 * Usa el campo real: MVINOMBRE
 */
export const buscarViaPorNombre = async (nombreVia, usarLayer = 13) => {
  try {
    const features = await consultarFeatures(usarLayer, {
      where: `UPPER(MVINOMBRE) LIKE UPPER('%${nombreVia}%')`,
      outFields: 'MVICODIGO,MVINOMBRE,MVITIPO,MVISVIA,MVINUMC,MVIVELREG',
      returnGeometry: true
    });
    
    return features.map(feature => ({
      codigo: feature.attributes.MVICODIGO,
      nombre: feature.attributes.MVINOMBRE,
      tipo: feature.attributes.MVITIPO, // CL, KR, DG, etc.
      sentido: feature.attributes.MVISVIA, // FT, TF, B, N, SD
      carriles: feature.attributes.MVINUMC,
      velocidadReglamentaria: feature.attributes.MVIVELREG,
      geometria: feature.geometry
    }));
  } catch (error) {
    console.error('Error buscando vía:', error);
    throw error;
  }
};
```

### 6. Obtener Calzadas de una Vía (Layer 15)

```javascript
/**
 * Obtiene las calzadas asociadas a una vía
 * Usa el campo de relación: CALCIV (relaciona con MVICIV)
 */
export const obtenerCalzadasPorVia = async (codigoVia) => {
  try {
    const features = await consultarFeatures(15, {
      where: `CALCIV = ${codigoVia}`,
      outFields: 'CALCODIGO,CALCIV,CALFUNCION,CALTSUPERF,CALANCHO,CALLONGITU',
      returnGeometry: true
    });
    
    return features.map(feature => ({
      codigo: feature.attributes.CALCODIGO,
      codigoVia: feature.attributes.CALCIV,
      funcion: feature.attributes.CALFUNCION, // 0: No aplica, 1: Vehicular, 2: Peatonal
      tipoSuperficie: feature.attributes.CALTSUPERF,
      ancho: feature.attributes.CALANCHO,
      longitud: feature.attributes.CALLONGITU,
      geometria: feature.geometry
    }));
  } catch (error) {
    console.error('Error obteniendo calzadas:', error);
    throw error;
  }
};
```

### 7. Hook React para Consultar Layers

```javascript
// src/hooks/useIDECALayer.js

import { useState, useEffect } from 'react';
import { obtenerInfoLayer, consultarFeatures } from '../services/ideca/layerService';

/**
 * Hook personalizado para trabajar con layers IDECA
 */
export const useIDECALayer = (layerId, options = {}) => {
  const [layerInfo, setLayerInfo] = useState(null);
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    const cargarLayer = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Cargar información del layer
        const info = await obtenerInfoLayer(layerId);
        setLayerInfo(info);
        
        // Si hay opciones de consulta, cargar features
        if (options.autoLoad !== false) {
          const featuresData = await consultarFeatures(layerId, options);
          setFeatures(featuresData);
        }
      } catch (err) {
        setError(err.message);
        console.error('Error cargando layer:', err);
      } finally {
        setLoading(false);
      }
    };
    
    if (layerId) {
      cargarLayer();
    }
  }, [layerId, JSON.stringify(options)]);
  
  const recargarFeatures = async (newOptions = {}) => {
    setLoading(true);
    try {
      const featuresData = await consultarFeatures(layerId, { ...options, ...newOptions });
      setFeatures(featuresData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return {
    layerInfo,
    features,
    loading,
    error,
    recargarFeatures
  };
};
```

### 8. Componente React para Mostrar Información de Lote

```jsx
// src/components/LoteInfo.jsx

import { useState, useEffect } from 'react';
import { buscarLotePorCodigo, buscarConstruccionesPorLote } from '../services/ideca/layerService';

const LoteInfo = ({ codigoLote }) => {
  const [lote, setLote] = useState(null);
  const [construcciones, setConstrucciones] = useState([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    const cargarDatos = async () => {
      if (!codigoLote) return;
      
      setLoading(true);
      try {
        // Buscar lote
        const loteData = await buscarLotePorCodigo(codigoLote);
        setLote(loteData);
        
        // Buscar construcciones asociadas
        if (loteData) {
          const construccionesData = await buscarConstruccionesPorLote(codigoLote);
          setConstrucciones(construccionesData);
        }
      } catch (error) {
        console.error('Error cargando datos del lote:', error);
      } finally {
        setLoading(false);
      }
    };
    
    cargarDatos();
  }, [codigoLote]);
  
  if (loading) return <div>Cargando...</div>;
  if (!lote) return <div>Lote no encontrado</div>;
  
  return (
    <div className="lote-info">
      <h3>Información del Lote</h3>
      <div>
        <p><strong>Código:</strong> {lote.codigo}</p>
        <p><strong>Disperso:</strong> {lote.disperso}</p>
        <p><strong>Unidad Predial:</strong> {lote.unidadPredial}</p>
        <p><strong>Distrito:</strong> {lote.distrito === 1 ? 'Sí' : 'No'}</p>
        <p><strong>Código Manzana:</strong> {lote.codigoManzana}</p>
      </div>
      
      <h4>Construcciones ({construcciones.length})</h4>
      <ul>
        {construcciones.map((construccion, idx) => (
          <li key={idx}>
            {construccion.codigo} - {construccion.numeroPisos} pisos - 
            Altura: {construccion.altura}m
          </li>
        ))}
      </ul>
    </div>
  );
};

export default LoteInfo;
```

---

## 🔑 Campos Clave por Layer

### Layer 11/13 (Nomenclatura/Malla Vial)
- **MVICODIGO**: Identificador único del eje vial
- **MVINOMBRE**: Nombre de la vía
- **MVITIPO**: Tipo de vía (CL, KR, DG, etc.)
- **MVISVIA**: Sentido de la vía (FT, TF, B, N, SD)
- **MVICIV**: Código de identificación vial (para relaciones)

### Layer 38 (Lote)
- **LOTCODIGO**: Identificador único del lote (12 caracteres)
- **MANZCODIGO**: Código de manzana (relación con Layer 40)
- **LOTDISPERS**: Disperso (M, D, N)

### Layer 39 (Construcción)
- **CONCODIGO**: Identificador de la construcción
- **LOTECODIGO**: Código del lote (relación con Layer 38)
- **CONNPISOS**: Número de pisos
- **CONALTURA**: Altura

### Layer 15 (Calzada)
- **CALCODIGO**: Identificador único de la calzada
- **CALCIV**: Código de identificación vial (relación con Layers 11/13)
- **CALFUNCION**: Funcionalidad (0, 1, 2)
- **CALANCHO**: Ancho de la calzada

---

## 📝 Notas Importantes

1. **Nombres de Campos:** Siempre usar los nombres en MAYÚSCULAS como aparecen en la API (ej: `LOTCODIGO`, no `lotCodigo`)

2. **Tipos de Datos:** 
   - Strings: Usar comillas simples en WHERE clauses (`LOTCODIGO = '123456'`)
   - Integers: Sin comillas (`CALCIV = 12345`)

3. **Relaciones:** Los campos de relación permiten hacer JOINs lógicos entre layers:
   - `MVICIV` conecta Layers 11/13 con Layers 15, 16, 17
   - `LOTCODIGO` conecta Layer 38 con Layers 34 y 39
   - `MANZCODIGO` conecta Layer 38 con Layer 40

4. **Dominios:** Algunos campos tienen dominios codificados. Consultar el JSON completo para ver los valores válidos.

---

**Última actualización:** 20 de enero de 2026  
**Fuente de datos:** Consulta directa REST API IDECA
