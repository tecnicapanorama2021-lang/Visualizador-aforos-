/**
 * Resuelve el dimId (ID DIM del archivo Excel) para llamar a GET /api/aforos/analisis/:dimId.
 * El backend espera dimId (ej. 388), NO estudio_id de BD (ej. 4266).
 *
 * Orden de prioridad:
 * a) estudio.archivo_fuente_id (numérico)
 * b) estudio.dim_id
 * c) estudio.file_id_dim o estudio.fileid con patrón "ext-<num>-" → parsear <num>
 * d) estudio.id o estudio.estudio_id (fallback; puede fallar si el backend no usa ese ID para análisis)
 */
const DEV_LOG = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

export function getDimIdForAnalisis(estudio) {
  if (!estudio) return null;

  const n = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

  // a) archivo_fuente_id numérico (388)
  const archivo = n(estudio.archivo_fuente_id);
  if (archivo != null) {
    if (DEV_LOG) console.log('[getDimIdForAnalisis] usando archivo_fuente_id:', archivo);
    return archivo;
  }

  // b) dim_id
  const dimId = n(estudio.dim_id);
  if (dimId != null) {
    if (DEV_LOG) console.log('[getDimIdForAnalisis] usando dim_id:', dimId);
    return dimId;
  }

  // c) file_id_dim / fileid con patrón ext-<num>-
  const raw = estudio.file_id_dim ?? estudio.fileid ?? '';
  const str = String(raw).trim();
  const match = str.match(/ext-(\d+)-/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (DEV_LOG) console.log('[getDimIdForAnalisis] parseado desde file_id_dim/fileid:', str, '→ dimId:', num);
    return num;
  }

  // d) fallback id / estudio_id (puede no coincidir con dimId en backend)
  const fallback = n(estudio.id) ?? n(estudio.estudio_id) ?? n(estudio.file_id);
  if (fallback != null) {
    console.warn('[getDimIdForAnalisis] ⚠️ Fallback a id/estudio_id/file_id:', fallback, '- puede fallar si el API espera dimId. Estudio:', estudio);
    return fallback;
  }

  return null;
}
