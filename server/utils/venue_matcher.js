/**
 * Geocoding interno: match de nombre de venue (texto libre) contra contexto_eventos tipo LUGAR_EVENTO.
 * Sin llamadas externas; usa descripcion/ubicacion_texto y opcionalmente pg_trgm.
 * [nuevo archivo]
 */

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'al', 'a']);

/** Quita tildes (NFD + strip combining marks). */
function removeAccents(str) {
  if (typeof str !== 'string') return '';
  return str.normalize('NFD').replace(/\p{Mc}|\p{Mn}/gu, '');
}

/**
 * Normaliza nombre de venue: lowercase, trim, quitar tildes, quitar palabras vacías.
 * @param {string} str
 * @returns {string}
 */
function normalizeVenueName(str) {
  if (typeof str !== 'string') return '';
  let s = str.trim().toLowerCase();
  s = removeAccents(s);
  s = s.replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter((w) => w.length > 0 && !STOPWORDS.has(w));
  return words.join(' ');
}

/**
 * Busca un venue en contexto_eventos (tipo LUGAR_EVENTO) por nombre.
 * Usa LIKE con nombre normalizado; si existe extensión pg_trgm se puede usar % para fuzzy.
 *
 * @param {string} nombreTexto - Ej: "Movistar Arena", "Parque Simón Bolívar", "Corferias"
 * @param {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} db - cliente con método query
 * @returns {Promise<{ id: number, titulo: string, geom: object, tipo_lugar: string | null, entidad: string | null } | null>}
 */
async function matchVenueByName(nombreTexto, db) {
  const norm = normalizeVenueName(nombreTexto);
  if (!norm) return null;

  const escapeLike = (s) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const likeNorm = `%${escapeLike(norm)}%`;
  const likeRaw = `%${nombreTexto.trim().toLowerCase()}%`;
  const sql = `
    SELECT id,
           COALESCE(ubicacion_texto, descripcion) AS titulo,
           ST_AsGeoJSON(geom)::json AS geom_json,
           subtipo AS tipo_lugar,
           datos_extra->>'entidad' AS entidad
    FROM contexto_eventos
    WHERE tipo = 'LUGAR_EVENTO'
      AND geom IS NOT NULL
      AND (
        translate(LOWER(TRIM(COALESCE(ubicacion_texto, descripcion))), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN') LIKE $1 ESCAPE '\\'
        OR LOWER(TRIM(COALESCE(ubicacion_texto, descripcion))) LIKE $2
      )
    ORDER BY LENGTH(COALESCE(ubicacion_texto, descripcion))
    LIMIT 1
  `;

  try {
    const result = await db.query(sql, [likeNorm, likeRaw]);
    const row = result.rows[0];
    if (!row) return null;

    let geom = null;
    if (row.geom_json && row.geom_json.coordinates) {
      const [lon, lat] = row.geom_json.coordinates;
      geom = { type: 'Point', coordinates: [lon, lat], lat, lon };
    }

    return {
      id: row.id,
      titulo: row.titulo || '',
      geom,
      tipo_lugar: row.tipo_lugar || null,
      entidad: row.entidad || null,
    };
  } catch (err) {
    return null;
  }
}

export { matchVenueByName, normalizeVenueName };
