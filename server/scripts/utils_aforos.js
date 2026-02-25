/**
 * Utilidades compartidas para anexos de aforos (SECOP, descarga, Playwright).
 * Usado por secop_descargar_anexos.js y secop_fetch_anexos_playwright.js.
 */

import path from 'path';

export const EXT_ACEPTADAS = ['.xlsx', '.xls', '.csv', '.pdf'];

export const PATRONES_NOMBRE_AFORO = [
  'aforo',
  'conteo',
  'tránsito',
  'transito',
  'movilidad',
  'pmt',
  'plan_de_manejo',
  'plan de manejo',
  'estudio_de_tránsito',
  'estudios_de_tránsito',
  'estudio de transito',
  'estudios de transito',
  'trafico',
  'volumen',
  'estudio',
];

/**
 * Indica si el nombre de archivo corresponde a un anexo de aforos/estudios de tránsito.
 */
export function esAnexoAforo(nombreArchivo) {
  const raw = String(nombreArchivo || '').toLowerCase();
  const ext = path.extname(raw).toLowerCase();
  if (!EXT_ACEPTADAS.includes(ext)) return false;
  const sinExt = raw.slice(0, -ext.length).replace(/\s+/g, '_');
  return PATRONES_NOMBRE_AFORO.some((p) => {
    const frag = p
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/á/g, 'a')
      .replace(/é/g, 'e')
      .replace(/í/g, 'i')
      .replace(/ó/g, 'o')
      .replace(/ú/g, 'u');
    return sinExt.includes(frag) || raw.includes(p.toLowerCase());
  });
}

export function getTipoFromFilename(nombre) {
  const ext = path.extname(nombre).toLowerCase();
  if (['.xlsx', '.xls'].includes(ext)) return 'XLSX';
  if (ext === '.csv') return 'CSV';
  if (ext === '.pdf') return 'PDF';
  return 'PDF';
}
