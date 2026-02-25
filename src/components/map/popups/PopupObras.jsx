/**
 * Popup capa OBRAS: solo campos canónicos del API (title, objetivo, ubicacion, entidad_name, etc.).
 * attributes_raw solo en acordeón debug (detail._debug.attributes_raw cuando el API se llama con ?debug=1).
 */
import React, { useState, useMemo } from 'react';

/** Orden y labels de Detalles. VALOR no se muestra nunca. */
const DETAIL_FIELDS = [
  { key: 'title', label: 'Título' },
  { key: 'objetivo', label: 'Objetivo', truncate: 80 },
  { key: 'ubicacion', label: 'Ubicación' },
  { key: 'cod_rel', label: 'Cód. relación' },
  { key: 'cod_obra', label: 'Cód. obra' },
  { key: 'entidad_name', label: 'Entidad' },
  { key: 'localidad_name', label: 'Localidad' },
  { key: 'upz', label: 'UPZ' },
  { key: 'estado_name', label: 'Estado' },
  { key: 'tipo_obra_name', label: 'Tipo obra' },
];

export default function PopupObras({ feature, onClose, detail }) {
  const [showRaw, setShowRaw] = useState(false);

  const title = useMemo(() => {
    const t = detail?.title ?? feature?.properties?.title ?? '';
    return typeof t === 'string' && t.trim() ? t.trim() : 'Obra sin nombre';
  }, [detail?.title, feature?.properties?.title]);

  const chips = useMemo(() => {
    const items = [];
    const estado = detail?.estado_name ?? feature?.properties?.estado_name;
    if (estado && String(estado).trim()) items.push({ label: 'Estado', value: String(estado).trim() });
    const entidad = detail?.entidad_name ?? feature?.properties?.entidad_name;
    if (entidad && String(entidad).trim()) items.push({ label: 'Entidad', value: String(entidad).trim() });
    const localidad = detail?.localidad_name ?? feature?.properties?.localidad_name;
    if (localidad && String(localidad).trim()) items.push({ label: 'Localidad', value: String(localidad).trim() });
    return items;
  }, [detail?.estado_name, detail?.entidad_name, detail?.localidad_name, feature?.properties]);

  const detailRows = useMemo(() => {
    const out = [];
    const src = { ...detail, ...feature?.properties };
    for (const { key, label, truncate } of DETAIL_FIELDS) {
      const val = src[key];
      if (val == null || String(val).trim() === '') continue;
      let value = String(val).trim();
      if (truncate && value.length > truncate) value = value.slice(0, truncate) + '…';
      out.push({ label, value });
    }
    return out;
  }, [detail, feature?.properties]);

  const rawAttrs = detail?._debug?.attributes_raw ?? null;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1002]">
      <div className="pointer-events-auto bg-white/98 backdrop-blur rounded-2xl shadow-2xl w-[min(28rem,92vw)] max-h-[80vh] overflow-hidden border border-slate-200 flex flex-col">
        <header className="bg-gradient-to-r from-red-600 to-red-700 px-4 py-3 text-white shrink-0">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold text-sm leading-snug line-clamp-2">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-white hover:bg-white/20 rounded-full p-1"
              aria-label="Cerrar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {chips.map(({ label, value }) => (
                <span
                  key={label}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/20 text-white"
                >
                  {label}: {value}
                </span>
              ))}
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {detailRows.length > 0 && (
            <section className="mb-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Detalles</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {detailRows.map(({ label, value }) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-slate-500 truncate">{label}</dt>
                    <dd className="text-slate-800 font-medium break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {detail?.bbox && (
            <p className="text-xs text-slate-400 mb-2">Delimitación disponible en el mapa</p>
          )}

          <section className="border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="text-slate-500 hover:text-slate-700 text-xs font-medium"
            >
              {showRaw ? 'Ocultar' : 'Ver'} atributos ArcGIS
            </button>
            {showRaw && (
              <>
                {rawAttrs && typeof rawAttrs === 'object' ? (
                  <pre className="mt-2 p-2 bg-slate-50 rounded text-xs overflow-auto max-h-48 border border-slate-100">
                    {JSON.stringify(rawAttrs, null, 2)}
                  </pre>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">Activar debug en la petición del detalle para ver atributos crudos.</p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
