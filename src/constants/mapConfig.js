/**
 * Configuración del mapa PMT
 */

// Coordenadas por defecto (Bogotá)
export const DEFAULT_CENTER = [4.7110, -74.0721];
export const DEFAULT_ZOOM = 13;
export const MIN_ZOOM = 10;
export const MAX_ZOOM = 25;

// API Keys
export const GOOGLE_MAPS_API_KEY = 'AIzaSyD9V6vU07VLh51ujN-vjku2gV-FWLSwMac';

// URLs de servicios IDECA
export const IDECA_BASE_URL = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services';
export const IDECA_SERVICES = {
  cartografia: `${IDECA_BASE_URL}/Cartografia_Basica/Cartografia_Basica/MapServer`,
  predial: `${IDECA_BASE_URL}/Predial/Predial/MapServer`
};

// Layer IDs de IDECA
export const IDECA_LAYERS = {
  MANZANAS: 12,
  MALLA_VIAL: 13,
  NOMENCLATURA_VIAL: 14,
  CALZADA: 15,
  ANDENES: 16,
  SEPARADORES: 17,
  LOTES: 38,
  CONSTRUCCIONES: 39,
  PLACA_DOMICILIARIA: 34
};

// Z-Index para capas
export const LAYER_Z_INDEX = {
  ANDENES: 100,
  CALZADA: 150,
  SEPARADORES: 200,
  MALLA_VIAL: 300
};

// Opacidades por defecto - Layers necesarios (incluyendo Malla Vial con CIV)
export const DEFAULT_OPACITIES = {
  mallaVial: 0.9,        // Malla Vial con CIV
  andenes: 0.75,
  calzada: 0.85,
  lotes: 0.65,
  placaDomiciliaria: 0.8
};

// Estado inicial de capas - Layers necesarios (incluyendo Malla Vial con CIV)
export const INITIAL_LAYERS = {
  mallaVial: true,       // Malla Vial con CIV (activo por defecto)
  andenes: true,
  calzada: true,
  lotes: false,
  placaDomiciliaria: false
};
