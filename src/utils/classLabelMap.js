/**
 * Etiquetas de clase de vehículo para UI (convención IDU: Autos, Camiones; no Livianos/Pesados).
 */
const LABELS = {
  pt: 'Peatones',
  livianos: 'Autos',
  autos: 'Autos',
  vol_autos: 'Autos',
  motos: 'Motos',
  vol_motos: 'Motos',
  buses: 'Buses',
  vol_buses: 'Buses',
  pesados: 'Camiones',
  camiones: 'Camiones',
  vol_pesados: 'Camiones',
  bicis: 'Bicicletas',
  bicicletas: 'Bicicletas',
  vol_bicis: 'Bicicletas',
  otros: 'Otros',
  vol_otros: 'Otros',
  c3: 'Camiones C3',
  camiones_c3: 'Camiones C3',
};

export function getClassLabel(key, fallbackLabel) {
  if (key == null || key === '') return fallbackLabel ?? '';
  const k = String(key).trim().toLowerCase();
  return LABELS[k] ?? fallbackLabel ?? k;
}
