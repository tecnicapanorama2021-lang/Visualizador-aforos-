/**
 * Popup para markers de capa MANIFESTACIONES.
 * Énfasis en impacto vial si existe en descripción.
 */
import React from 'react';

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) {
    return '—';
  }
}

export default function PopupManifestaciones({ feature, onClose }) {
  const p = feature?.properties ?? {};
  const title = p.nombre ?? p.nodo_nombre ?? p.direccion ?? p.node_id_externo ?? 'Manifestación';
  const desc = p.descripcion || '';
  const hasImpactoVial = /cierre|bloqueo|desvío|afecta|vial|tránsito|via|calle/i.test(desc);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1002]">
      <div className="pointer-events-auto bg-white/95 backdrop-blur rounded-2xl shadow-2xl w-[min(28rem,92vw)] max-h-[75vh] overflow-hidden border border-slate-200 flex flex-col">
        <div className="bg-gradient-to-r from-orange-600 to-orange-700 px-4 py-3 text-white flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button type="button" onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-1" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 text-sm">
          {hasImpactoVial && (
            <p className="text-amber-700 bg-amber-50 px-2 py-1 rounded text-xs font-medium">Impacto vial (cierre/bloqueo/desvío)</p>
          )}
          {p.fuente && <p><span className="text-slate-500">Fuente:</span> {p.fuente}</p>}
          {(p.start_at || p.end_at || p.fecha_ini || p.fecha_fin) && (
            <p>
              <span className="text-slate-500">Inicio — Fin:</span>{' '}
              {formatDateTime(p.start_at || p.fecha_ini)} — {formatDateTime(p.end_at || p.fecha_fin)}
            </p>
          )}
          {p.direccion && <p><span className="text-slate-500">Dirección:</span> {p.direccion}</p>}
          {p.zona_influencia_m != null && <p><span className="text-slate-500">Zona influencia:</span> {p.zona_influencia_m} m</p>}
          {p.descripcion && <p className="text-slate-600">{p.descripcion}</p>}
          {p.url_remota && (
            <p>
              <a href={p.url_remota} target="_blank" rel="noopener noreferrer" className="text-panorama-sky hover:underline text-xs">
                Ver enlace
              </a>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
