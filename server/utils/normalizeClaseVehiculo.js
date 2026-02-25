/**
 * Normaliza códigos de clase vehicular a etiquetas en español (convención Excel IDU).
 * AUTOS (no "Livianos"), BUSES, CAMIONES, MOTOS, BICICLETAS, PEATONES.
 */

const CLASE_VEHICULO = {
  L: 'Autos',
  A: 'Autos',
  AUTOS: 'Autos',
  LIVIANOS: 'Autos',
  livianos: 'Autos',
  liviano: 'Autos',
  auto: 'Autos',
  autos: 'Autos',
  vol_autos: 'Autos',
  B: 'Buses',
  BUSES: 'Buses',
  buses: 'Buses',
  bus: 'Buses',
  vol_buses: 'Buses',
  C: 'Camiones',
  C2: 'Camiones C2',
  C3: 'Camiones C3',
  CAMIONES: 'Camiones',
  'CAMIONES C2': 'Camiones C2',
  'CAMIONES C3': 'Camiones C3',
  camiones: 'Camiones',
  pesados: 'Camiones',
  PESADOS: 'Camiones',
  vol_pesados: 'Camiones',
  M: 'Motos',
  MOTOS: 'Motos',
  motos: 'Motos',
  vol_motos: 'Motos',
  Bi: 'Bicicletas',
  BI: 'Bicicletas',
  BICICLETAS: 'Bicicletas',
  bicicletas: 'Bicicletas',
  bicis: 'Bicicletas',
  vol_bicis: 'Bicicletas',
  CICLAS: 'Bicicletas',
  ciclas: 'Bicicletas',
  P: 'Peatones',
  PEATONES: 'Peatones',
  peatones: 'Peatones',
  pt: 'Peatones',
  OTROS: 'Otros',
  otros: 'Otros',
  vol_otros: 'Otros',
};

/**
 * @param {string} codigo - Código de BD/Excel (ej: 'L', 'vol_autos', 'LIVIANOS')
 * @returns {string|undefined} Etiqueta legible o el valor original si no hay mapa
 */
function normalizeClaseVehiculo(codigo) {
  if (codigo == null || typeof codigo !== 'string') return codigo;
  const k = codigo.trim();
  const upper = k.toUpperCase();
  return CLASE_VEHICULO[upper] ?? CLASE_VEHICULO[k] ?? codigo;
}

export { normalizeClaseVehiculo, CLASE_VEHICULO };
