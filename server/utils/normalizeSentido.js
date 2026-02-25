/**
 * Normaliza códigos de sentido (BD/Excel) al formato "Origen → Destino" en español.
 * Convención IDU: NORTE | SUR | ORIENTE | OCCIDENTE.
 * No modifica BD; se aplica al leer (queries/respuesta API).
 */

const SENTIDO_MAP = {
  // Recto (pasante)
  NS: 'Norte → Sur',
  SN: 'Sur → Norte',
  EO: 'Oriente → Occidente',
  OE: 'Occidente → Oriente',
  WE: 'Occidente → Oriente',
  EW: 'Oriente → Occidente',
  // Giros (W → Occidente)
  NW: 'Norte → Occidente',
  NE: 'Norte → Oriente',
  SW: 'Sur → Occidente',
  SE: 'Sur → Oriente',
  WN: 'Occidente → Norte',
  WS: 'Occidente → Sur',
  EN: 'Oriente → Norte',
  ES: 'Oriente → Sur',
  ON: 'Occidente → Norte',
  OS: 'Occidente → Sur',
  // Giros en U
  NN: 'Norte → Norte',
  SS: 'Sur → Sur',
  EE: 'Oriente → Oriente',
  OO: 'Occidente → Occidente',
  WW: 'Occidente → Occidente',
  // Accesos simples
  N: 'Norte',
  S: 'Sur',
  E: 'Oriente',
  O: 'Occidente',
  W: 'Occidente',
  // Nombres completos (passthrough)
  NORTE: 'Norte',
  SUR: 'Sur',
  ORIENTE: 'Oriente',
  OCCIDENTE: 'Occidente',
  'NORTE → SUR': 'Norte → Sur',
  'SUR → NORTE': 'Sur → Norte',
  'ORIENTE → OCCIDENTE': 'Oriente → Occidente',
  'OCCIDENTE → ORIENTE': 'Occidente → Oriente',
};

/**
 * @param {string} raw - Código crudo (ej: 'NS', 'WN', 'Norte → Sur')
 * @returns {string} Etiqueta en español o 'Sin datos'
 */
function normalizeSentido(raw) {
  if (raw == null || typeof raw !== 'string') return raw == null ? 'Sin datos' : String(raw).trim() || 'Sin datos';
  const clean = raw
    .trim()
    .toUpperCase()
    .replace(/\s*->\s*/g, ' → ')
    .replace(/\s+/g, ' ');
  const mapped = SENTIDO_MAP[clean];
  if (mapped) return mapped;
  // Sufijo numérico (ej: NS1 → Norte → Sur (1))
  const match = clean.match(/^([NSEWOO]+)(\d*)$/);
  if (match) {
    const base = match[1];
    const suffix = match[2];
    const label = SENTIDO_MAP[base];
    if (label) return suffix ? `${label} (${suffix})` : label;
  }
  return raw.trim() || 'Sin datos';
}

export { normalizeSentido, SENTIDO_MAP };
