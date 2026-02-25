/**
 * Descarga Excel de aforo desde DIM (Movilidad Bogotá).
 * PASO 1: GET consultararchivoscargados/{ID_ESTUDIO} → lista JSON; archivo más reciente.
 * PASO 2: GET carga_estudios/descargar/{FILE_ID} → binario.
 * Usado por server.js (API) y por etl_conteos_from_dim.js.
 */

const DIM_ORIGIN = 'https://dim.movilidadbogota.gov.co';
const DIM_BASE = `${DIM_ORIGIN}/visualizacion_monitoreo`;
const DIM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://dim.movilidadbogota.gov.co/visualizacion_monitoreo/',
  Accept:
    'application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream, */*',
};

function parseJsonFromResponse(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text().then((text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
}

function pickMostRecentFile(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const sorted = [...list].sort((a, b) => {
    const ta = a.instante_carga != null ? new Date(a.instante_carga).getTime() : 0;
    const tb = b.instante_carga != null ? new Date(b.instante_carga).getTime() : 0;
    return tb - ta;
  });
  return sorted[0];
}

function isBinaryResponse(buffer) {
  if (!buffer || buffer.length < 2) return false;
  const b0 = buffer[0];
  if (b0 === 0x7b || b0 === 0x5b) return false;
  return true;
}

/**
 * Obtiene el buffer Excel para un id_estudio (paso 1 + paso 2 DIM).
 * @param {string} idEstudio - ID del estudio en DIM (coincide con estudios.file_id_dim).
 * @returns {Promise<{ buffer: Buffer, nombreOriginal: string }>}
 */
export async function getExcelBufferForStudy(idEstudio) {
  const metaUrl = `${DIM_BASE}/consultararchivoscargados/${idEstudio}`;
  const metaRes = await fetch(metaUrl, { method: 'GET', headers: DIM_HEADERS });
  if (!metaRes.ok)
    throw new Error(metaRes.status === 404 ? 'Estudio no encontrado en DIM' : `DIM respondió ${metaRes.status}`);
  const data = await parseJsonFromResponse(metaRes);
  if (data == null) throw new Error('DIM no devolvió JSON válido');
  const list = Array.isArray(data) ? data : [data];
  if (list.length === 0) throw new Error('No hay archivos para este estudio en DIM');
  const file = pickMostRecentFile(list);
  const fileId = file?.id ?? file?.id_archivo;
  if (fileId == null) throw new Error('No se encontró id del archivo en la respuesta de DIM');
  const targetUrl = `${DIM_ORIGIN}/carga_estudios/descargar/${fileId}`;
  const fileRes = await fetch(targetUrl, { method: 'GET', headers: DIM_HEADERS });
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  if (!fileRes.ok) throw new Error('No se pudo descargar el archivo desde DIM');
  if (!isBinaryResponse(buffer)) throw new Error('DIM devolvió metadatos en lugar del Excel');
  return { buffer, nombreOriginal: file.nombre_original_archivo || `aforo_${idEstudio}.xlsx` };
}
