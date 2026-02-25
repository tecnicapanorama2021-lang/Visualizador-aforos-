import { create } from 'zustand';

/**
 * Store global para el mapa PMT
 * Gestiona estado de capas, dibujos, señales y UI
 */
const useMapStore = create((set, get) => ({
  // Estado de capas
  layers: new Map(),
  activeLayers: new Set(),
  layerOpacities: new Map(), // Opacidad por capa
  
  // Estado de dibujos
  drawings: [],
  drawnLayers: new Map(), // Referencias a capas Leaflet dibujadas
  
  // Estado de señales
  signals: [],
  
  // Estado de mediciones
  measurements: [], // Array de mediciones realizadas
  
  // Estado de análisis de intersecciones
  intersectionAnalysis: null, // Análisis actual de intersección
  
  // Estado de recomendaciones PMT
  pmtRecommendations: [], // Recomendaciones generadas por IA
  pmtContext: null, // Contexto usado para generar PMT
  
  // UI State
  panelOpen: true,
  selectedTool: null,
  drawingMode: null, // 'polygon', 'polyline', 'circle', 'marker'
  
  // Acciones de capas
  addLayer: (layerConfig) => set((state) => {
    const newLayers = new Map(state.layers);
    newLayers.set(layerConfig.id, layerConfig);
    return { layers: newLayers };
  }),
  
  removeLayer: (layerId) => set((state) => {
    const newLayers = new Map(state.layers);
    newLayers.delete(layerId);
    const newActiveLayers = new Set(state.activeLayers);
    newActiveLayers.delete(layerId);
    const newOpacities = new Map(state.layerOpacities);
    newOpacities.delete(layerId);
    return { 
      layers: newLayers, 
      activeLayers: newActiveLayers,
      layerOpacities: newOpacities
    };
  }),
  
  toggleLayer: (layerId) => set((state) => {
    const newActiveLayers = new Set(state.activeLayers);
    if (newActiveLayers.has(layerId)) {
      newActiveLayers.delete(layerId);
    } else {
      newActiveLayers.add(layerId);
    }
    return { activeLayers: newActiveLayers };
  }),
  
  setLayerOpacity: (layerId, opacity) => set((state) => {
    const newOpacities = new Map(state.layerOpacities);
    newOpacities.set(layerId, opacity);
    return { layerOpacities: newOpacities };
  }),
  
  getLayerOpacity: (layerId) => {
    const state = get();
    return state.layerOpacities.get(layerId) ?? 0.8;
  },
  
  // Acciones de dibujos
  addDrawing: (drawing) => set((state) => ({
    drawings: [...state.drawings, { 
      ...drawing, 
      id: drawing.id || Date.now() + Math.random() 
    }]
  })),
  
  removeDrawing: (drawingId) => set((state) => ({
    drawings: state.drawings.filter(d => d.id !== drawingId)
  })),
  
  updateDrawing: (drawingId, updates) => set((state) => ({
    drawings: state.drawings.map(d => 
      d.id === drawingId ? { ...d, ...updates } : d
    )
  })),
  
  addDrawnLayer: (drawingId, layer) => set((state) => {
    const newDrawnLayers = new Map(state.drawnLayers);
    newDrawnLayers.set(drawingId, layer);
    return { drawnLayers: newDrawnLayers };
  }),
  
  removeDrawnLayer: (drawingId) => set((state) => {
    const newDrawnLayers = new Map(state.drawnLayers);
    newDrawnLayers.delete(drawingId);
    return { drawnLayers: newDrawnLayers };
  }),
  
  clearDrawings: () => set({ 
    drawings: [],
    drawnLayers: new Map()
  }),
  
  // Acciones de señales
  addSignal: (signal) => set((state) => ({
    signals: [...state.signals, { 
      ...signal, 
      id: signal.id || Date.now() + Math.random(),
      timestamp: signal.timestamp || new Date().toISOString()
    }]
  })),
  
  removeSignal: (signalId) => set((state) => ({
    signals: state.signals.filter(s => s.id !== signalId)
  })),
  
  updateSignal: (signalId, updates) => set((state) => ({
    signals: state.signals.map(s => 
      s.id === signalId ? { ...s, ...updates } : s
    )
  })),
  
  clearSignals: () => set({ signals: [] }),
  
  // Acciones de mediciones
  addMeasurement: (measurement) => set((state) => ({
    measurements: [...state.measurements, {
      ...measurement,
      id: measurement.id || Date.now() + Math.random(),
      timestamp: measurement.timestamp || new Date().toISOString()
    }]
  })),
  
  removeMeasurement: (measurementId) => set((state) => ({
    measurements: state.measurements.filter(m => m.id !== measurementId)
  })),
  
  clearMeasurements: () => set({ measurements: [] }),
  
  // Acciones de análisis de intersecciones
  setIntersectionAnalysis: (analysis) => set({ 
    intersectionAnalysis: analysis,
    timestamp: analysis?.timestamp || new Date().toISOString()
  }),
  
  clearIntersectionAnalysis: () => set({ intersectionAnalysis: null }),
  
  // Acciones de recomendaciones PMT
  setPMTRecommendations: (recommendations, context = null) => set({
    pmtRecommendations: recommendations,
    pmtContext: context
  }),
  
  addPMTRecommendation: (recommendation) => set((state) => ({
    pmtRecommendations: [...state.pmtRecommendations, {
      ...recommendation,
      id: recommendation.id || Date.now() + Math.random(),
      timestamp: recommendation.timestamp || new Date().toISOString()
    }]
  })),
  
  removePMTRecommendation: (recommendationId) => set((state) => ({
    pmtRecommendations: state.pmtRecommendations.filter(r => r.id !== recommendationId)
  })),
  
  clearPMTRecommendations: () => set({ 
    pmtRecommendations: [],
    pmtContext: null
  }),
  
  // UI Actions
  setPanelOpen: (open) => set({ panelOpen: open }),
  setSelectedTool: (tool) => set({ selectedTool: tool }),
  setDrawingMode: (mode) => set({ drawingMode: mode }),
  
  // Helpers
  getActiveLayers: () => {
    const state = get();
    return Array.from(state.activeLayers)
      .map(id => state.layers.get(id))
      .filter(Boolean);
  },
  
  getDrawingsByType: (type) => {
    const state = get();
    return state.drawings.filter(d => d.type === type);
  },
  
  getSignalsByType: (type) => {
    const state = get();
    return state.signals.filter(s => s.type === type);
  },
  
  getSignalsByPriority: (priority) => {
    const state = get();
    return state.signals.filter(s => s.priority === priority);
  }
}));

export default useMapStore;
