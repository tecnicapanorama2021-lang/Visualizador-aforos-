/**
 * Popup solo para markers de capa CONCIERTOS.
 */
import React from 'react';

export default function PopupConciertos({ feature, onClose }) {
  const p = feature?.properties ?? {};
  const title = p.nombre ?? p.nodo_nombre ?? p.direccion ?? p.node_id_externo ?? 'Concierto';

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1002]">
      <div className="pointer-events-auto bg-white/95 backdrop-blur rounded-2xl shadow-2xl w-[min(28rem,92vw)] max-h-[75vh] overflow-hidden border border-slate-200 flex flex-col">
        <div className="bg-gradient-to-r from-pink-600 to-pink-700 px-4 py-3 text-white flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title}</h3>
          <button type="button" onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-1" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2 text-sm">
          {p.direccion && <p><span className="text-slate-500">Dirección:</span> {p.direccion}</p>}
          {(p.fecha_ini || p.fecha_fin) && <p><span className="text-slate-500">Fechas:</span> {p.fecha_ini ? new Date(p.fecha_ini).toISOString().slice(0, 16) : '—'} — {p.fecha_fin ? new Date(p.fecha_fin).toISOString().slice(0, 16) : '—'}</p>}
          {p.zona_influencia_m != null && <p><span className="text-slate-500">Zona influencia:</span> {p.zona_influencia_m} m</p>}
          {p.descripcion && <p className="text-slate-600">{p.descripcion}</p>}
        </div>
      </div>
    </div>
  );
}
