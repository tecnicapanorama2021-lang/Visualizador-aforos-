/**
 * Popup solo para markers de capa AFOROS. Lista estudios y botón "Ver análisis" por dim_id.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_ENDPOINTS } from '../../../constants/apiEndpoints';

export default function PopupAforos({ feature, onClose }) {
  const navigate = useNavigate();
  const props = feature?.properties ?? {};
  const nodeId = props.node_id_externo ?? props.id;
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(!!nodeId);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!nodeId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setErr(null);
    fetch(API_ENDPOINTS.AFOROS_NODO_ESTUDIOS(nodeId), { headers: { Accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((data) => {
        if (!cancelled && data?.studies) setStudies(data.studies);
      })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [nodeId]);

  const title = props.nombre ?? props.direccion ?? nodeId ?? 'Aforos';

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1002]">
      <div className="pointer-events-auto bg-white/95 backdrop-blur rounded-2xl shadow-2xl w-[min(28rem,92vw)] max-h-[75vh] overflow-hidden border border-slate-200 flex flex-col">
        <div className="bg-gradient-to-r from-green-600 to-green-700 px-4 py-3 text-white flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button type="button" onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-1" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {props.direccion && <p className="text-sm text-slate-600 mb-3">{props.direccion}</p>}
          {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
          {loading && <p className="text-sm text-slate-500">Cargando estudios...</p>}
          {!loading && studies.length === 0 && !err && <p className="text-sm text-slate-500">Sin estudios en este nodo.</p>}
          {!loading && studies.length > 0 && (
            <ul className="space-y-2">
              {studies.map((s, i) => (
                <li key={s.id ?? i} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <p className="text-sm font-medium text-slate-900">{s.fecha_inicio ? new Date(s.fecha_inicio).toISOString().slice(0, 10) : 'Sin fecha'}{s.fecha_fin && s.fecha_fin !== s.fecha_inicio ? ` — ${new Date(s.fecha_fin).toISOString().slice(0, 10)}` : ''}</p>
                  <p className="text-xs text-slate-600">{s.tipo_estudio || 'Aforo'}</p>
                  {s.dim_id != null && (
                    <button
                      type="button"
                      onClick={() => navigate(`/aforos/analisis/${s.dim_id}`)}
                      className="mt-2 text-xs font-medium text-panorama-sky hover:text-panorama-sky-600"
                    >
                      Ver análisis
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
