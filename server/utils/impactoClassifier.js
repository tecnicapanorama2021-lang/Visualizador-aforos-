/**
 * Clasificador automático de impacto vial (tipo Waze).
 * Reglas base por tipo de incidente. Usado en ingest_contexto_eventos_to_incidentes.
 */

const EVENTO_ALTO_KEYWORDS = ['rock', 'festival', 'concierto', 'movistar', 'campin', 'feria'];

/**
 * @param {object} incidente - { tipo, titulo, subtipo, ... }
 * @returns {{ nivel: string, radio_m: number, factor: number, confianza: number }}
 */
export function clasificarImpacto(incidente) {
  const tipo = (incidente?.tipo || '').toUpperCase();
  const titulo = (incidente?.titulo || incidente?.descripcion || '').toLowerCase();

  if (tipo === 'EVENTO') {
    const matchAlto = EVENTO_ALTO_KEYWORDS.some((kw) => titulo.includes(kw));
    if (matchAlto) {
      return { nivel: 'alto', radio_m: 1200, factor: 1.25, confianza: 0.8 };
    }
    return { nivel: 'bajo', radio_m: 400, factor: 1.05, confianza: 0.8 };
  }

  if (tipo === 'OBRA') {
    return { nivel: 'medio', radio_m: 500, factor: 0.85, confianza: 0.8 };
  }

  if (tipo === 'MANIFESTACION') {
    return { nivel: 'critico', radio_m: 1500, factor: 1.5, confianza: 0.8 };
  }

  return { nivel: 'bajo', radio_m: 400, factor: 1.05, confianza: 0.7 };
}
