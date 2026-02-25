/**
 * Panel "Calidad del predictor": KPIs, tabla por zona, MAE por hora.
 * Consume GET /api/prediccion/validacion?dias={rango}.
 * [nuevo archivo]
 */

import React, { useEffect, useState } from 'react';
import { API_ENDPOINTS } from '../../constants/apiEndpoints';

const RANGOS = [30, 60, 90];

function PredictorQualityPanel({ onClose }) {
  const [dias, setDias] = useState(90);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [zonaAbierto, setZonaAbierto] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(API_ENDPOINTS.PREDICCION_VALIDACION(dias), { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Error cargando validación');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [dias]);

  const global = data?.global ?? {};
  const mape = global.MAPE != null ? parseFloat(global.MAPE) : null;
  const estado =
    mape == null ? null : mape < 10 ? 'bueno' : mape <= 25 ? 'aceptable' : 'revisar';

  return (
    <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-4 max-w-lg">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-semibold text-slate-800">Calidad del predictor</h3>
        {onClose && (
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-700" aria-label="Cerrar">
            ×
          </button>
        )}
      </div>

      <div className="mb-3 flex gap-2 flex-wrap">
        {RANGOS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDias(d)}
            className={`px-3 py-1 rounded text-sm ${dias === d ? 'bg-panorama-sky text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            Últimos {d} días
          </button>
        ))}
      </div>

      {loading && <p className="text-slate-500 text-sm">Cargando...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <div className="bg-slate-50 rounded p-2">
              <p className="text-xs text-slate-500">MAE</p>
              <p className="font-mono text-sm">{global.MAE != null ? Number(global.MAE).toFixed(1) : '—'}</p>
            </div>
            <div className="bg-slate-50 rounded p-2">
              <p className="text-xs text-slate-500">MAPE %</p>
              <p className="font-mono text-sm">{global.MAPE != null ? Number(global.MAPE).toFixed(1) : '—'}</p>
            </div>
            <div className="bg-slate-50 rounded p-2">
              <p className="text-xs text-slate-500">RMSE</p>
              <p className="font-mono text-sm">{global.RMSE != null ? Number(global.RMSE).toFixed(1) : '—'}</p>
            </div>
            <div className="bg-slate-50 rounded p-2">
              <p className="text-xs text-slate-500">Sesgo</p>
              <p className="font-mono text-sm">{global.bias != null ? Number(global.bias).toFixed(1) : '—'}</p>
            </div>
          </div>

          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm text-slate-600">Estado:</span>
            {estado === 'bueno' && <span className="text-green-600 font-medium">Bueno</span>}
            {estado === 'aceptable' && <span className="text-amber-600 font-medium">Aceptable</span>}
            {estado === 'revisar' && <span className="text-red-600 font-medium">Necesita revisión</span>}
            {estado == null && <span className="text-slate-500">Sin datos</span>}
          </div>

          <div className="mb-3">
            <button
              type="button"
              onClick={() => setZonaAbierto(!zonaAbierto)}
              className="text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              {zonaAbierto ? '▼' : '▶'} Por zona
            </button>
            {zonaAbierto && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left p-1">Zona</th>
                      <th className="text-right p-1">MAE</th>
                      <th className="text-right p-1">MAPE</th>
                      <th className="text-right p-1">Muestras</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.por_zona ?? []).map((row) => (
                      <tr key={row.zona} className="border-t border-slate-100">
                        <td className="p-1">{row.zona}</td>
                        <td className="text-right p-1 font-mono">{row.MAE != null ? Number(row.MAE).toFixed(1) : '—'}</td>
                        <td className="text-right p-1 font-mono">{row.MAPE != null ? Number(row.MAPE).toFixed(1) + '%' : '—'}</td>
                        <td className="text-right p-1">{row.n_muestras ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1">MAE por hora del día</p>
            <div className="flex items-end gap-0.5 h-12" style={{ minWidth: '240px' }}>
              {(data?.por_hora ?? []).map((h) => {
                const maxMae = Math.max(...(data?.por_hora ?? []).map((x) => x.MAE ?? 0), 1);
                const alt = (h.MAE ?? 0) / maxMae * 100;
                return (
                  <div
                    key={h.hora}
                    className="flex-1 bg-slate-300 rounded-t min-w-0 hover:bg-amber-400"
                    style={{ height: `${Math.max(4, alt)}%` }}
                    title={`Hora ${h.hora}: MAE ${h.MAE != null ? h.MAE.toFixed(1) : '—'}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-slate-400 mt-0.5">
              <span>0h</span>
              <span>12h</span>
              <span>23h</span>
            </div>
          </div>

          {data?.global?.n_muestras != null && (
            <p className="text-xs text-slate-400 mt-2">Muestras: {data.global.n_muestras}</p>
          )}
        </>
      )}
    </div>
  );
}

export default PredictorQualityPanel;
