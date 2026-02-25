/**
 * Filtro quirúrgico para contratos SECOP (estudios de tránsito reales).
 * Compartido por inspeccionar_secop_catalogo.js y secop_registrar_relevantes.js.
 */

export function textoContrato(d) {
  return (
    (d.descripcion_del_proceso || '') +
    (d.nombre_del_procedimiento || '') +
    (d.objeto_del_contrato || '') +
    (d.objeto || '') +
    (d.nombre_procedimiento || '')
  );
}

export function normalizar(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const frasesEspecificas = [
  'estudio de transito',
  'estudio de trafico',
  'aforo vehicular',
  'aforo de transito',
  'conteo vehicular',
  'plan de manejo de transito',
  'plan de manejo de trafico',
  'pmt vial',
  'estudio de movilidad vial',
  'capacidad vial',
  'nivel de servicio vial',
  'matriz origen destino',
  'interseccion vial',
  'señalizacion vial',
  'diagnostico vial',
  'ppru transito',
  'plan parcial.*transito',
];

export function cumpleFiltro(d) {
  const texto = normalizar(textoContrato(d));
  return frasesEspecificas.some((frase) => {
    const fn = normalizar(frase);
    if (fn.includes('.*')) return new RegExp(fn).test(texto);
    return texto.includes(fn);
  });
}

/**
 * Determina tipo de estudio para estudios_transito.
 * @param {object} d - contrato SECOP
 * @returns {'ETT'|'PMT'|'AFORO'|'PPRU'|'OTRO'}
 */
export function tipoFromContrato(d) {
  const texto = normalizar(textoContrato(d));
  if (texto.includes('estudio de transito') || texto.includes('estudio de trafico')) return 'ETT';
  if (texto.includes('plan de manejo') || texto.includes('pmt vial')) return 'PMT';
  if (texto.includes('aforo vehicular') || texto.includes('aforo de transito') || texto.includes('conteo vehicular')) return 'AFORO';
  if (texto.includes('plan parcial') || texto.includes('ppru transito')) return 'PPRU';
  return 'OTRO';
}
