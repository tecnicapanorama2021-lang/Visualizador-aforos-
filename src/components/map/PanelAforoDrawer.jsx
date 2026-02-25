/**
 * Panel lateral (drawer) para nodo de aforo: muestra estudios y análisis sin cerrar al cambiar de nodo.
 * - 1 estudio → análisis directo.
 * - Varios estudios → el más reciente expandido, resto colapsado.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../../constants/apiEndpoints';
import ResumenAnalisisAforo from './ResumenAnalisisAforo';

const IMPACTO_WORDS = ['lluvia', 'accidente', 'choque', 'cierre', 'desvío', 'desvio', 'varado', 'obra', 'congestión', 'congestion'];

function hasImpactoFromConflictos(conflictos) {
  if (!Array.isArray(conflictos) || conflictos.length === 0) return false;
  const lower = (t) => (t ?? '').toLowerCase();
  return conflictos.some((c) => {
    const text = lower(c.descripcion);
    return IMPACTO_WORDS.some((w) => text.includes(w));
  });
}

function sanitizeFilename(str) {
  return String(str ?? '')
    .replace(/[^a-zA-Z0-9\-_.]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'sin-nombre';
}

export default function PanelAforoDrawer({ feature, onClose }) {
  const props = feature?.properties ?? {};
  const nodeId = props.node_id_externo ?? props.id ?? '';
  const title = props.nombre ?? props.direccion ?? nodeId ?? 'Aforo';

  const [studies, setStudies] = useState([]);
  const [loadingStudies, setLoadingStudies] = useState(!!nodeId);
  const [studiesError, setStudiesError] = useState(null);
  const [expandedDimId, setExpandedDimId] = useState(null);
  const [analisisByDimId, setAnalisisByDimId] = useState({});
  const [loadingAnalisis, setLoadingAnalisis] = useState({});
  const [errorAnalisis, setErrorAnalisis] = useState({});
  const [impactByDimId, setImpactByDimId] = useState({});
  const [downloadingFileId, setDownloadingFileId] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [impactoVial, setImpactoVial] = useState(null);

  useEffect(() => {
    if (!nodeId) {
      setLoadingStudies(false);
      setStudies([]);
      setStudiesError(null);
      setExpandedDimId(null);
      setAnalisisByDimId({});
      return;
    }
    let cancelled = false;
    setLoadingStudies(true);
    setStudiesError(null);
    setAnalisisByDimId({});
    fetch(API_ENDPOINTS.AFOROS_NODO_ESTUDIOS(nodeId), { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list = data?.studies ?? [];
        setStudies(list);
        const sorted = [...list].sort((a, b) => {
          const da = a.fecha_inicio ? new Date(a.fecha_inicio).getTime() : 0;
          const db = b.fecha_inicio ? new Date(b.fecha_inicio).getTime() : 0;
          return db - da;
        });
        const mostRecent = sorted[0];
        if (mostRecent?.dim_id != null) setExpandedDimId(String(mostRecent.dim_id));
      })
      .catch((e) => { if (!cancelled) setStudiesError(e?.message ?? 'Error'); })
      .finally(() => { if (!cancelled) setLoadingStudies(false); });
    return () => { cancelled = true; };
  }, [nodeId]);

  const fetchAnalisis = (dimId) => {
    if (!dimId || analisisByDimId[dimId] != null) return;
    setLoadingAnalisis((prev) => ({ ...prev, [dimId]: true }));
    setErrorAnalisis((prev) => ({ ...prev, [dimId]: null }));
    fetch(API_ENDPOINTS.AFOROS_ANALISIS(dimId), { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const text = await res.text();
        if ((res.headers.get('content-type') || '').includes('text/html') || text.trimStart().startsWith('<')) {
          throw new Error('El backend no respondió con JSON.');
        }
        if (!res.ok) {
          let err = `Error ${res.status}`;
          try {
            const d = JSON.parse(text);
            err = d?.error ?? err;
          } catch (_) {}
          throw new Error(err);
        }
        return JSON.parse(text);
      })
      .then((data) => {
        setAnalisisByDimId((prev) => ({ ...prev, [dimId]: data }));
        const hasImpacto = hasImpactoFromConflictos(data?.historial_conflictos);
        setImpactByDimId((prev) => ({ ...prev, [dimId]: hasImpacto }));
      })
      .catch((err) => {
        setErrorAnalisis((prev) => ({ ...prev, [dimId]: err?.message ?? 'Error' }));
      })
      .finally(() => {
        setLoadingAnalisis((prev) => ({ ...prev, [dimId]: false }));
      });
  };

  useEffect(() => {
    if (expandedDimId) fetchAnalisis(expandedDimId);
  }, [expandedDimId]);

  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;
    fetch(API_ENDPOINTS.NODOS_IMPACTO(nodeId), { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { factor_total: 1, senales_aplicadas: [] }))
      .then((data) => {
        if (!cancelled) setImpactoVial(data);
      })
      .catch(() => { if (!cancelled) setImpactoVial({ factor_total: 1, senales_aplicadas: [] }); });
    return () => { cancelled = true; };
  }, [nodeId]);

  const handleDownloadExcel = useCallback(
    async (study) => {
      const fileId = study?.file_id ?? study?.file_id_dim;
      if (!fileId) return;
      setDownloadError(null);
      setDownloadingFileId(String(fileId));
      try {
        const res = await fetch(API_ENDPOINTS.AFOROS_DESCARGAR(fileId));
        if (!res.ok) {
          const msg = res.status === 404 ? 'Archivo no disponible' : 'Error al descargar';
          setDownloadError(msg);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const fecha = study.fecha_inicio ? new Date(study.fecha_inicio).toISOString().slice(0, 10) : 'sin-fecha';
        const name = `aforo_${sanitizeFilename(nodeId)}_${sanitizeFilename(fecha)}.xlsx`;
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (_) {
        setDownloadError('Error al descargar');
      } finally {
        setDownloadingFileId(null);
      }
    },
    [nodeId]
  );

  const singleStudy = studies.length === 1 ? studies[0] : null;
  const dimIdToShow = singleStudy?.dim_id != null ? String(singleStudy.dim_id) : expandedDimId;
  const showDownloadBtn = (s) => !!(s?.file_id ?? s?.file_id_dim);

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[min(28rem,92vw)] z-[1002] bg-white/98 backdrop-blur shadow-2xl border-l border-slate-200 flex flex-col pointer-events-auto">
      <div className="bg-gradient-to-r from-green-600 to-green-700 px-4 py-3 text-white flex items-center justify-between shrink-0">
        <h3 className="font-semibold text-sm truncate pr-2">{title}</h3>
        <button type="button" onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-1 shrink-0" aria-label="Cerrar">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {props.direccion && <p className="text-sm text-slate-600 mb-3">{props.direccion}</p>}
        {studiesError && <p className="text-sm text-red-600 mb-2">{studiesError}</p>}
        {loadingStudies && <p className="text-sm text-slate-500">Cargando estudios…</p>}
        {!loadingStudies && studies.length === 0 && !studiesError && <p className="text-sm text-slate-500">Sin estudios en este nodo.</p>}

        {downloadError && (
          <p className="text-sm text-red-600 mb-2" role="alert">{downloadError}</p>
        )}
        {!loadingStudies && studies.length === 1 && singleStudy && (
          <div className="space-y-2">
            {impactByDimId[dimIdToShow] && (
              <p className="text-sm text-amber-700 flex items-center gap-1">
                <span title="Condiciones atípicas">⚠️</span> Condiciones atípicas en este estudio
              </p>
            )}
            {showDownloadBtn(singleStudy) && (
              <button
                type="button"
                disabled={!!downloadingFileId}
                onClick={() => handleDownloadExcel(singleStudy)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {downloadingFileId ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent" />
                    Descargando…
                  </>
                ) : (
                  <>📥 Descargar Excel</>
                )}
              </button>
            )}
            <ResumenAnalisisAforo
              analisis={analisisByDimId[dimIdToShow]}
              loadingAnalisis={!!loadingAnalisis[dimIdToShow]}
              analisisError={errorAnalisis[dimIdToShow]}
              title="Análisis del aforo"
            />
          </div>
        )}

        {impactoVial && nodeId && (
          <div className="mt-4 pt-3 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-700 mb-2">Señales activas que afectan este nodo</p>
            {impactoVial.senales_aplicadas?.length > 0 ? (
              <>
                <ul className="space-y-1 text-sm text-slate-700">
                  {impactoVial.senales_aplicadas.map((s) => (
                    <li key={s.incidente_id}>
                      {s.titulo || s.tipo} ({s.impacto_nivel}) ×{s.impacto_factor}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  Factor total aplicado: ×{impactoVial.factor_total}
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-500">Ninguna señal activa afecta este nodo en este momento.</p>
            )}
          </div>
        )}

        {!loadingStudies && studies.length > 1 && (
          <div className="space-y-2">
            {[...studies]
              .sort((a, b) => {
                const da = a.fecha_inicio ? new Date(a.fecha_inicio).getTime() : 0;
                const db = b.fecha_inicio ? new Date(b.fecha_inicio).getTime() : 0;
                return db - da;
              })
              .map((s) => {
                const dimId = s.dim_id != null ? String(s.dim_id) : null;
                const isExpanded = dimId === expandedDimId;
                const label = s.fecha_inicio ? new Date(s.fecha_inicio).toISOString().slice(0, 10) : 'Sin fecha';
                const hasImpacto = dimId ? impactByDimId[dimId] : false;
                return (
                  <div key={s.id ?? dimId ?? s.fecha_inicio} className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                    <button
                      type="button"
                      onClick={() => setExpandedDimId(isExpanded ? null : dimId)}
                      className="w-full px-3 py-2 text-left flex items-center justify-between text-sm font-medium text-slate-900 hover:bg-slate-100"
                    >
                      <span className="flex items-center gap-1.5">
                        {hasImpacto && <span title="Condiciones atípicas">⚠️</span>}
                        {label}{s.fecha_fin && s.fecha_fin !== s.fecha_inicio ? ` — ${new Date(s.fecha_fin).toISOString().slice(0, 10)}` : ''}
                      </span>
                      <span className="text-slate-500">{isExpanded ? '▼' : '▶'}</span>
                    </button>
                    {isExpanded && dimId && (
                      <div className="px-3 pb-3 pt-1 border-t border-slate-200 bg-white space-y-2">
                        {showDownloadBtn(s) && (
                          <button
                            type="button"
                            disabled={!!downloadingFileId}
                            onClick={() => handleDownloadExcel(s)}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {downloadingFileId ? (
                              <>
                                <span className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent" />
                                Descargando…
                              </>
                            ) : (
                              <>📥 Descargar Excel</>
                            )}
                          </button>
                        )}
                        <ResumenAnalisisAforo
                          analisis={analisisByDimId[dimId]}
                          loadingAnalisis={!!loadingAnalisis[dimId]}
                          analisisError={errorAnalisis[dimId]}
                          title={label}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
