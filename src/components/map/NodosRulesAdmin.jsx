/**
 * Panel admin simple para reglas de clasificación de nodos (solo dev).
 * Lista reglas y permite ejecutar Aplicar (dry-run) / Aplicar.
 */

import React, { useEffect, useState } from 'react';
import { API_ENDPOINTS } from '../../constants/apiEndpoints';

const NodosRulesAdmin = ({ onClose }) => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyResult, setApplyResult] = useState(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(API_ENDPOINTS.NODOS_RULES)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data?.rules) setRules(data.rules);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const runApply = (dryRun) => {
    setApplying(true);
    setApplyResult(null);
    fetch(API_ENDPOINTS.NODOS_RULES_APPLY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun, resetDefaults: false }),
    })
      .then((r) => r.json())
      .then((data) => setApplyResult(data))
      .catch((err) => setApplyResult({ error: err.message }))
      .finally(() => setApplying(false));
  };

  return (
    <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[min(520px,92vw)] max-h-[80vh] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 rounded-t-xl">
        <h3 className="font-semibold text-slate-800">Reglas de clasificación de nodos</h3>
        <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-700 p-1" aria-label="Cerrar">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-slate-500">Cargando reglas...</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">{rules.length} reglas</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-slate-200">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="text-left p-1">Prioridad</th>
                    <th className="text-left p-1">Campo</th>
                    <th className="text-left p-1">Tipo</th>
                    <th className="text-left p-1">Patrón</th>
                    <th className="text-left p-1">tipo_nodo</th>
                    <th className="text-left p-1">Activa</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="p-1">{r.priority}</td>
                      <td className="p-1">{r.match_field}</td>
                      <td className="p-1">{r.match_type}</td>
                      <td className="p-1 truncate max-w-[100px]" title={r.pattern}>{r.pattern}</td>
                      <td className="p-1">{r.tipo_nodo}</td>
                      <td className="p-1">{r.enabled ? 'Sí' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={applying}
                onClick={() => runApply(true)}
                className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-sm hover:bg-slate-300 disabled:opacity-50"
              >
                Aplicar (dry-run)
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={() => runApply(false)}
                className="px-3 py-1.5 rounded bg-panorama-sky text-white text-sm hover:bg-panorama-sky-600 disabled:opacity-50"
              >
                Aplicar
              </button>
            </div>
            {applyResult && (
              <pre className="mt-2 p-2 bg-slate-100 rounded text-xs overflow-auto max-h-32">
                {applyResult.error ? String(applyResult.error) : JSON.stringify(applyResult, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NodosRulesAdmin;
