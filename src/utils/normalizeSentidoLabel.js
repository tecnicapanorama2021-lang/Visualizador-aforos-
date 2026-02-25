/**
 * Normaliza etiquetas de sentido para UI (convención IDU: Oriente/Occidente, español).
 * Entrada: raw (WE, NS, WN, NN, etc.)
 * Salida: "Occidente → Oriente", "Norte → Sur", "Norte → Norte (giro en U)", etc.
 */
const MAP = {
  NS: 'Norte → Sur',
  SN: 'Sur → Norte',
  EO: 'Oriente → Occidente',
  OE: 'Occidente → Oriente',
  WE: 'Occidente → Oriente',
  EW: 'Oriente → Occidente',
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
  NN: 'Norte → Norte',
  SS: 'Sur → Sur',
  EE: 'Oriente → Oriente',
  OO: 'Occidente → Occidente',
  WW: 'Occidente → Occidente',
  N: 'Norte',
  S: 'Sur',
  E: 'Oriente',
  O: 'Occidente',
  W: 'Occidente',
};

export function normalizeSentidoLabel(raw) {
  if (raw == null || typeof raw !== 'string') return raw == null ? '' : String(raw);
  const s = String(raw).trim().toUpperCase().replace(/\s*->\s*/g, ' → ').replace(/\s+/g, ' ');
  if (!s) return raw;

  const mapped = MAP[s];
  if (mapped) return mapped;
  const match = s.match(/^([NSEWOO]+)(\d*)$/);
  const base = match ? match[1] : s;
  const suffix = match && match[2] ? match[2] : '';
  const label = MAP[base];
  if (label) return suffix ? `${label} (${suffix})` : label;
  return raw;
}

/** True si el sentido ya normalizado es giro en U (origen = destino). Acepta sufijo tipo " (1)". */
export function isGiroEnU(sentidoLabel) {
  if (!sentidoLabel || typeof sentidoLabel !== 'string') return false;
  const parts = sentidoLabel.split(/\s*→\s*/);
  if (parts.length !== 2) return false;
  const origen = parts[0].trim();
  const destino = parts[1].trim().split(/\s*\(/)[0].trim();
  return origen === destino;
}
