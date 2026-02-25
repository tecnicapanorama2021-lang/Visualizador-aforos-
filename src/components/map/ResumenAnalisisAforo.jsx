/**
 * Bloque reutilizable "Resumen del aforo": hora pico, volumen, distribución por clase, conflictos.
 * Usado en PanelNodo y en el panel standalone por dimId (/aforos/analisis/:dimId).
 * Normaliza sentido (Norte → Sur) y horas (500 → 05:00). Mensajes de calidad en lenguaje no técnico.
 */
import React, { useState } from 'react';
import { normalizeSentidoLabel, isGiroEnU } from '../../utils/normalizeSentidoLabel';
import { formatPeriodoToHora, formatPeriodoRangoToHora } from '../../utils/formatPeriodoToHora';
import { getClassLabel } from '../../utils/classLabelMap';

const MOTORIZED_LABELS = new Set(['Autos', 'Motos', 'Buses', 'Camiones', 'Camiones C2', 'Camiones C3']);
const NO_MOTORIZED_LABELS = new Set(['Bicicletas', 'Peatones']);

const IMPACTO_WORDS = ['lluvia', 'accidente', 'choque', 'cierre', 'desvío', 'desvio', 'varado', 'obra', 'congestión', 'congestion'];

function getImpactoIcon(descripcion) {
  if (!descripcion || typeof descripcion !== 'string') return null;
  const d = descripcion.toLowerCase();
  if (d.includes('lluvia')) return '🌧️';
  if (['accidente', 'choque', 'cierre', 'desvío', 'desvio', 'varado', 'obra'].some((w) => d.includes(w))) return '🚧';
  if (d.includes('congestión') || d.includes('congestion')) return '⚠️';
  return null;
}

function hasImpacto(descripcion) {
  if (!descripcion || typeof descripcion !== 'string') return false;
  const d = descripcion.toLowerCase();
  return IMPACTO_WORDS.some((w) => d.includes(w));
}

function totalVehicular(d, classHeaders) {
  if (!classHeaders?.length) {
    return (Number(d.vol_autos) || 0) + (Number(d.vol_motos) || 0) + (Number(d.vol_buses) || 0) + (Number(d.vol_pesados) || 0);
  }
  return classHeaders
    .filter((ch) => ch.key && MOTORIZED_LABELS.has(getClassLabel(ch.key, ch.label)))
    .reduce((sum, ch) => sum + (Number(d[ch.key]) || 0), 0);
}

function noMotorizados(d, classHeaders) {
  if (!classHeaders?.length) {
    return (Number(d.vol_bicis) || 0) + (Number(d.vol_peatones) || 0);
  }
  return classHeaders
    .filter((ch) => ch.key && NO_MOTORIZED_LABELS.has(getClassLabel(ch.key, ch.label)))
    .reduce((sum, ch) => sum + (Number(d[ch.key]) || 0), 0);
}

const GAPS_WARNING_REGEX = /Huecos de intervalo detectados\s*\((\d+),\s*intervalo=(\d+)\s*min\)\s*:\s*(.+?)(?:\.\s*Revisar|\.\s*$|$)/is;

function parseGapsWarning(w, analisis) {
  if (typeof w !== 'string') return null;
  const m = w.match(GAPS_WARNING_REGEX);
  if (!m) return null;
  const [, countStr, intervalStr, detail] = m;
  const count = parseInt(countStr, 10) || 0;
  const interval = parseInt(intervalStr, 10) || 15;
  const gapsTotal = analisis?.quality?.checks?.gaps_total ?? count;
  const periodosConDato = analisis?.vol_data_completo?.length ?? 0;
  const totalPeriodosEsperados = analisis?.quality?.checks?.total_periodos_esperados;
  let totalRelevant = totalPeriodosEsperados;
  if (totalRelevant == null && periodosConDato >= 0 && gapsTotal >= 0) {
    totalRelevant = periodosConDato + gapsTotal;
  }
  const pct = totalRelevant > 0 && Number.isFinite(totalRelevant)
    ? Math.round((gapsTotal / totalRelevant) * 100)
    : null;
  return { count, interval, detail: detail?.trim() || null, pct, gapsTotal };
}

function gapsSeverity(pct) {
  if (pct == null) return 'info';
  if (pct < 15) return 'info';
  if (pct <= 40) return 'warn';
  return 'error';
}

function formatQualityWarning(w) {
  if (typeof w !== 'string') return { friendly: String(w), detail: null, isGap: false };
  const m = w.match(GAPS_WARNING_REGEX);
  if (m) {
    const [, count, interval, detail] = m;
    const friendly = `Cobertura parcial: ${count} periodos de ${interval} min sin registro. Los totales se calculan con los periodos disponibles.`;
    return { friendly, detail: detail?.trim() || null, isGap: true };
  }
  return { friendly: w, detail: null, isGap: false };
}

export default function ResumenAnalisisAforo({
  analisis,
  loadingAnalisis,
  analisisError,
  analisisQuality,
  title = 'Análisis del aforo',
}) {
  const [showTechnicalMetrics, setShowTechnicalMetrics] = useState(false);
  const [observacionesExpandidas, setObservacionesExpandidas] = useState(false);
  const isDev = import.meta.env?.DEV;
  const showTechnical = isDev || showTechnicalMetrics;

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <p className="text-sm font-semibold text-slate-900 mb-3">{title}</p>
      {loadingAnalisis && (
        <div className="flex items-center gap-2 py-4 text-slate-600">
          <span className="animate-spin rounded-full h-5 w-5 border-2 border-panorama-sky border-t-transparent" />
          Analizando…
        </div>
      )}
      {analisisError && !loadingAnalisis && (
        <div className="space-y-2">
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{analisisError}</p>
          {analisisQuality && typeof analisisQuality === 'object' && Object.keys(analisisQuality).length > 0 && (
            <details className="text-xs text-slate-600 bg-slate-100 rounded-lg px-3 py-2">
              <summary className="cursor-pointer font-medium">Detalle (sheetName, headerRowIdx, noRowsReason…)</summary>
              <pre className="mt-2 overflow-auto max-h-32 whitespace-pre-wrap break-words">
                {JSON.stringify(analisisQuality, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
      {analisis && !loadingAnalisis && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <span className="text-slate-600 block text-xs">Hora pico</span>
              <span className="font-semibold text-slate-900">
                {analisis.resumen?.hora_pico_rango != null
                  ? formatPeriodoRangoToHora(analisis.resumen.hora_pico_rango) || analisis.resumen.hora_pico_rango
                  : '—'}
              </span>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <span className="text-slate-600 block text-xs">Volumen total pico</span>
              <span className="font-semibold text-slate-900">
                {analisis.resumen?.volumen_total_pico != null
                  ? analisis.resumen.volumen_total_pico.toLocaleString('es-CO')
                  : '—'}
              </span>
            </div>
          </div>
          {analisis.distribucion_hora_pico?.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <p className="text-xs font-medium text-slate-600 bg-slate-50 px-3 py-2 border-b border-slate-200">
                Volúmenes por clase de vehículo (hora pico)
              </p>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                {analisis.distribucion_hora_pico.map((d, idx) => {
                  const classHeaders = analisis.class_headers || [];
                  const classEntries = classHeaders
                    .filter((ch) => ch.key && d[ch.key] != null && Number(d[ch.key]) > 0)
                    .map((ch) => ({ label: getClassLabel(ch.key, ch.label), value: d[ch.key] }));
                  const sentidoLabel = normalizeSentidoLabel(d.sentido) || '—';
                  const sentidoDisplay = isGiroEnU(sentidoLabel) ? `${sentidoLabel} (giro en U)` : sentidoLabel;
                  const totalVeh = totalVehicular(d, classHeaders);
                  const noMot = noMotorizados(d, classHeaders);
                  return (
                    <div key={d.sentido ?? idx} className="px-3 py-2 bg-white flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-panorama-sky mb-1.5">Sentido {sentidoDisplay}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-700">
                          {classEntries.length > 0
                            ? classEntries.map(({ label, value }) => (
                                <span key={label}>
                                  <span className="text-slate-500">{label}:</span>{' '}
                                  <span className="font-medium">{Number(value).toLocaleString('es-CO')}</span>
                                </span>
                              ))
                            : null}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-700">
                          <span className="font-semibold text-slate-900">
                            Total vehicular: {totalVeh.toLocaleString('es-CO')}
                          </span>
                          {noMot > 0 && (
                            <span className="text-slate-600">No motorizados: {noMot.toLocaleString('es-CO')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {analisis.vol_data_completo?.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <p className="text-xs font-medium text-slate-600 bg-slate-50 px-3 py-2 border-b border-slate-200">
                Volumen por periodo
              </p>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                {analisis.vol_data_completo.map((row, idx) => {
                  const periodNum = row.periodNum ?? row.periodo ?? row.hora;
                  const horaStr = periodNum != null ? formatPeriodoToHora(periodNum) : (row.horaRango ?? '—');
                  const volTotal = row.total ?? row.vol_total;
                  const volDisplay = volTotal != null && Number.isFinite(Number(volTotal))
                    ? Number(volTotal).toLocaleString('es-CO')
                    : '—';
                  return (
                    <div key={idx} className="px-3 py-2 bg-white text-xs flex justify-between items-center gap-2">
                      <span className="text-slate-600">{horaStr}</span>
                      <span className="font-medium text-slate-900 tabular-nums">{volDisplay}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {analisis.quality?.warnings?.length > 0 && (
            <div className="border border-amber-200 rounded-lg bg-amber-50/80 p-3">
              <p className="text-xs font-medium text-amber-800 mb-2">Calidad / validaciones</p>
              <ul className="space-y-1 text-xs mb-2">
                {analisis.quality.warnings.map((w, i) => {
                  const gapData = parseGapsWarning(w, analisis);
                  if (gapData) {
                    const { count, interval, detail, pct } = gapData;
                    const sev = gapsSeverity(pct);
                    const baseMsg = `Cobertura parcial: ${count} periodos de ${interval} min sin registro. Los totales se calculan con los periodos disponibles.`;
                    const pctStr = pct != null ? ` (${pct}% sin registro)` : '';
                    const bajaCobertura = sev === 'error' ? ' Baja cobertura.' : '';
                    const bg = sev === 'error' ? 'bg-red-50 border-red-200 text-red-800' : sev === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-sky-50 border-sky-200 text-sky-800';
                    return (
                      <li key={i} className={`rounded px-2 py-1.5 border ${bg}`}>
                        • {baseMsg}{pctStr}{bajaCobertura}
                        {detail && (
                          <details className="mt-1 text-slate-600">
                            <summary className="cursor-pointer font-medium">Detalle por sentido</summary>
                            <span className="block mt-1 font-mono text-[10px]">{detail}</span>
                          </details>
                        )}
                      </li>
                    );
                  }
                  const { friendly, detail } = formatQualityWarning(w);
                  return (
                    <li key={i} className="text-amber-800">
                      • {friendly}
                      {detail && (
                        <details className="mt-1 text-slate-600">
                          <summary className="cursor-pointer font-medium">Detalle por sentido</summary>
                          <span className="block mt-1 font-mono text-[10px]">{detail}</span>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
              {analisis.quality.checks && Object.keys(analisis.quality.checks).length > 0 && (
                showTechnical ? (
                  Object.keys(analisis.quality.checks).length <= 30 ? (
                    <details className="text-xs text-slate-600" open={isDev}>
                      <summary className="cursor-pointer font-medium">Ver métricas técnicas</summary>
                      <pre className="mt-2 overflow-auto max-h-24 whitespace-pre-wrap break-words bg-white/60 rounded p-2">
                        {JSON.stringify(analisis.quality.checks, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <p className="text-xs text-slate-600">
                      Checks con muchas claves; ver respuesta en pestaña Red/Consola si necesitas depurar.
                    </p>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowTechnicalMetrics(true)}
                    className="text-xs text-panorama-sky hover:underline"
                  >
                    Ver métricas técnicas
                  </button>
                )
              )}
            </div>
          )}
          {analisis.historial_conflictos?.length > 0 && (() => {
            const conflictos = analisis.historial_conflictos;
            const N = conflictos.length;
            const anyImpacto = conflictos.some((c) => hasImpacto(c.descripcion));
            const showExpand = N > 5;
            const listToShow = showExpand && !observacionesExpandidas ? conflictos.slice(0, 3) : conflictos;
            return (
              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">
                  📋 Observaciones del aforador ({N})
                </p>
                <ul className="space-y-1.5 max-h-48 overflow-y-auto text-xs">
                  {listToShow.map((c, i) => {
                    const icon = getImpactoIcon(c.descripcion);
                    return (
                      <li key={i} className="bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        <span className="font-medium text-amber-800">{formatPeriodoToHora(c.hora) ?? (c.hora != null ? String(c.hora) : '')}</span>
                        {(c.sentido ?? c.movimiento) && (
                          <span className="text-amber-700">
                            {' · '}{normalizeSentidoLabel(c.sentido ?? c.movimiento) ?? (c.movimiento ?? c.sentido)}
                          </span>
                        )}
                        {icon && <span className="ml-1">{icon}</span>}
                        <span className="text-slate-700 block mt-0.5">{c.descripcion}</span>
                      </li>
                    );
                  })}
                </ul>
                {showExpand && (
                  <button
                    type="button"
                    onClick={() => setObservacionesExpandidas((e) => !e)}
                    className="mt-1.5 text-xs text-panorama-sky hover:underline font-medium"
                  >
                    {observacionesExpandidas ? 'Ver menos' : `Ver todas (${N})`}
                  </button>
                )}
                {anyImpacto && (
                  <p className="mt-2 text-xs text-amber-800 font-medium bg-amber-100 rounded px-2 py-1.5">
                    ⚠️ Condiciones atípicas: interpretar con precaución.
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
