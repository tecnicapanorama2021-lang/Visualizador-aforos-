/**
 * Convierte periodo numérico (500, 515, "0515") a hora legible "05:00", "05:15".
 * Entrada: number o string. Salida: "HH:MM" o el valor original si no se puede parsear.
 */
export function formatPeriodoToHora(periodNum) {
  if (periodNum == null || periodNum === '') return periodNum == null ? '' : String(periodNum);
  const str = String(periodNum).trim().replace(/\s/g, '');
  if (!str) return String(periodNum);
  const hmMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (hmMatch) {
    const h = parseInt(hmMatch[1], 10);
    const m = parseInt(hmMatch[2], 10);
    if (h <= 23 && m <= 59) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const digits = str.replace(/\D/g, '');
  if (digits.length < 3) return String(periodNum);
  const padded = digits.length <= 4 ? digits.padStart(4, '0') : digits.slice(-4);
  const h = parseInt(padded.slice(0, 2), 10);
  const m = parseInt(padded.slice(2, 4), 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return String(periodNum);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Formatea un rango de periodo (ej. "500-515" o "500 - 600") a "05:00-05:15".
 */
export function formatPeriodoRangoToHora(rango) {
  if (rango == null || typeof rango !== 'string') return rango != null ? String(rango) : '';
  const parts = String(rango).split(/-|–|—/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return String(rango);
  if (parts.length === 1) return formatPeriodoToHora(parts[0]);
  return parts.map(formatPeriodoToHora).join('–');
}
