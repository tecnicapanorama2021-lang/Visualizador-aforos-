/**
 * LEGACY – Panel flotante por nodo (tabs por capa).
 * El flujo principal del mapa usa capas separadas y popups por capa (PopupObras, PopupEventos, etc.) sin tabs.
 * Mantenido por compatibilidad o vistas alternativas.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NODE_TYPE_LABELS, NODE_ORIGIN_LABELS } from '../../constants/aforosNodeStyles';
import { API_ENDPOINTS } from '../../constants/apiEndpoints';
import ResumenAnalisisAforo from './ResumenAnalisisAforo';

const defaultGetNodeName = (node) =>
  node?.attributes?.DIRECCION?.trim() ||
  node?.attributes?.NOMBRE ||
  node?.attributes?.NOMBRE_NODO ||
  node?._original?.properties?.nombre ||
  `Nodo ${node?.attributes?.OBJECTID ?? 'Sin nombre'}`;

const defaultGetNodeType = (node) => {
  const t = node?.attributes?.TIPO_NODO || '';
  return NODE_TYPE_LABELS[t] || t || NODE_TYPE_LABELS.default;
};

const defaultGetNodeOrigin = (node) => {
  const o = node?.attributes?.ORIGEN || '';
  return NODE_ORIGIN_LABELS[o] || o || 'Desconocido';
};

const PanelNodo = ({
  selectedNode,
  onClose,
  nodeStudies = [],
  selectedStudyIndex = 0,
  onSelectStudyIndex,
  analisis,
  loadingStudies,
  loadingAnalisis,
  analisisError,
  analisisQuality,
  downloadingFileId,
  downloadError,
  onDownloadAforo,
  constructionNearby = { hasNearby: false, nearbyObras: [] },
  datosUnificadosCalendario,
  datosUnificadosVelocidades,
  loadingDatosUnificados,
  selectedNodeIdForApi,
  matchedNodeId,
  getNodeName = defaultGetNodeName,
  getNodeType = defaultGetNodeType,
  getNodeOrigin = defaultGetNodeOrigin,
  historialNodeData,
  viaPrincipal,
  viaSecundaria,
  upz,
  localidad,
}) => {
  const navigate = useNavigate();
  const [layersData, setLayersData] = useState(null);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState(null);
  const [activeTab, setActiveTab] = useState('aforos');

  useEffect(() => {
    if (!selectedNodeIdForApi) {
      setLayersData(null);
      setLayersError(null);
      setLayersLoading(false);
      return;
    }
    let cancelled = false;
    setLayersLoading(true);
    setLayersError(null);
    setLayersData(null);
    const url = API_ENDPOINTS.NODOS_LAYERS(selectedNodeIdForApi);
    fetch(url, { headers: { Accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText || `${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setLayersData(data);
      })
      .catch((err) => {
        if (!cancelled) setLayersError(err?.message || 'Error cargando capas');
      })
      .finally(() => {
        if (!cancelled) setLayersLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedNodeIdForApi]);

  const selectedStudy = nodeStudies[selectedStudyIndex];

  const tabs = [
    { id: 'aforos', label: 'Aforos' },
    { id: 'obras', label: 'Obras' },
    { id: 'eventos', label: 'Eventos' },
    { id: 'semaforos', label: 'Semáforos' },
  ];

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1002]">
      <div className="pointer-events-auto bg-white/95 backdrop-blur rounded-2xl shadow-2xl w-[min(28rem,92vw)] max-h-[75vh] overflow-hidden border border-slate-200/80 ring-1 ring-slate-100 flex flex-col">
        <div className="bg-gradient-to-r from-panorama-sky to-panorama-sky-600 px-4 py-3 text-white">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-semibold text-sm mb-1">{getNodeName(selectedNode)}</h3>
              <p className="text-xs opacity-90">
                {getNodeType(selectedNode)} • {getNodeOrigin(selectedNode)}
              </p>
              {(viaPrincipal || viaSecundaria) && (
                <p className="text-xs mt-1 opacity-90">
                  {[viaPrincipal, viaSecundaria].filter(Boolean).join(' / ')}
                </p>
              )}
              {(upz || localidad) && (
                <p className="text-xs mt-0.5 opacity-80">Zona: {[upz, localidad].filter(Boolean).join(', ')}</p>
              )}
              {constructionNearby.hasNearby && (
                <p className="text-xs mt-1.5 bg-amber-500/80 rounded px-2 py-0.5 inline-block">
                  Obras cercanas (500 m): {constructionNearby.nearbyObras.length}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-1 transition-colors" aria-label="Cerrar">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {layersError ? (
            <div className="space-y-3 text-sm text-slate-700">
              <p className="font-medium">{getNodeName(selectedNode)}</p>
              <p>{selectedNode?.attributes?.DIRECCION || selectedNode?._original?.properties?.direccion || '—'}</p>
              <p className="text-xs text-slate-500">Fuente: {getNodeOrigin(selectedNode)}</p>
              <p className="text-xs text-amber-600">No se pudieron cargar las capas del nodo.</p>
            </div>
          ) : selectedNodeIdForApi && layersLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-panorama-sky mx-auto mb-2" />
              <p className="text-sm text-slate-600">Cargando capas...</p>
            </div>
          ) : layersData ? (
            <div className="space-y-3">
              <div className="flex gap-1 border-b border-slate-200 pb-2">
                {tabs.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`px-3 py-1.5 rounded-t text-xs font-medium transition-colors ${
                      activeTab === id ? 'bg-panorama-sky text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeTab === 'aforos' && (
                <div className="min-h-[80px]">
                  {layersData?.layers?.aforos?.has && layersData.layers.aforos.estudios?.length > 0 ? (
                    <ul className="space-y-2">
                      {layersData.layers.aforos.estudios.map((e, i) => (
                        <li key={e.id ?? i} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                          <p className="text-sm font-medium text-slate-900">{e.date || 'Sin fecha'}{e.date_end && e.date_end !== e.date ? ` — ${e.date_end}` : ''}</p>
                          <p className="text-xs text-slate-600">{e.type || 'Aforo'}</p>
                          {e.dim_id != null && (
                            <button
                              type="button"
                              onClick={() => navigate(`/aforos/analisis/${e.dim_id}`)}
                              className="mt-2 text-xs font-medium text-panorama-sky hover:text-panorama-sky-600"
                            >
                              Ver análisis
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">Sin estudios de aforo en este nodo.</p>
                  )}
                </div>
              )}
              {activeTab === 'obras' && (
                <div className="min-h-[80px]">
                  {layersData?.layers?.obras?.length > 0 ? (
                    <ul className="space-y-2">
                      {layersData.layers.obras.map((o, i) => (
                        <li key={o.id ?? i} className="border border-slate-200 rounded-lg p-3 bg-amber-50/50">
                          <p className="text-sm font-medium text-slate-900">{o.titulo || 'Obra'}</p>
                          {o.entidad && <p className="text-xs text-slate-600">{o.entidad}</p>}
                          {o.estado && <p className="text-xs">Estado: {o.estado}</p>}
                          {(o.fecha_ini || o.fecha_fin) && <p className="text-xs text-slate-500">{o.fecha_ini ?? ''} — {o.fecha_fin ?? ''}</p>}
                          {o.impacto && <p className="text-xs">Impacto: {o.impacto}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">Sin obras en este nodo.</p>
                  )}
                </div>
              )}
              {activeTab === 'eventos' && (
                <div className="min-h-[80px]">
                  {layersData?.layers?.eventos?.length > 0 ? (
                    <ul className="space-y-2">
                      {layersData.layers.eventos.map((e, i) => (
                        <li key={e.id ?? i} className="border border-slate-200 rounded-lg p-3 bg-violet-50/50">
                          <p className="text-sm font-medium text-slate-900">{e.titulo || 'Evento'}</p>
                          {e.tipo_evento && <p className="text-xs text-slate-600">{e.tipo_evento}</p>}
                          {(e.fecha_ini || e.fecha_fin) && <p className="text-xs text-slate-500">{e.fecha_ini ?? ''} — {e.fecha_fin ?? ''}</p>}
                          {e.descripcion && <p className="text-xs mt-1">{e.descripcion}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">Sin eventos en este nodo.</p>
                  )}
                </div>
              )}
              {activeTab === 'semaforos' && (
                <div className="min-h-[80px]">
                  {layersData?.layers?.semaforos?.length > 0 ? (
                    <ul className="space-y-2">
                      {layersData.layers.semaforos.map((s, i) => (
                        <li key={s.id ?? i} className="border border-slate-200 rounded-lg p-3 bg-amber-50/50">
                          <p className="text-sm font-medium text-slate-900">{s.codigo ? `Código: ${s.codigo}` : 'Semáforo'}</p>
                          {s.estado_operativo && <p className="text-xs">Estado: {s.estado_operativo}</p>}
                          {s.plan_semaforico && <p className="text-xs">Plan: {s.plan_semaforico}</p>}
                          {s.origen && <p className="text-xs text-slate-500">Origen: {s.origen}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">Sin semáforos en este nodo.</p>
                  )}
                </div>
              )}
            </div>
          ) : loadingStudies ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-panorama-sky mx-auto mb-2" />
              <p className="text-sm text-slate-600">Cargando estudios...</p>
            </div>
          ) : nodeStudies.length > 0 ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">Ver aforo / estudio</label>
                <select
                  value={selectedStudyIndex}
                  onChange={(e) => onSelectStudyIndex(Number(e.target.value))}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-panorama-sky focus:border-panorama-sky"
                >
                  {nodeStudies.map((study, idx) => (
                    <option key={study.file_id ?? idx} value={idx}>
                      {study.date || 'Sin fecha'}
                      {study.date_end && study.date_end !== study.date ? ` - ${study.date_end}` : ''}
                      {' · '}
                      {study.type || 'Volúmen vehicular'}
                      {study.contractors?.[0] ? ` (${study.contractors[0]})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selectedStudy && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                  <p className="text-sm font-semibold text-slate-900 mb-3">Resumen del estudio</p>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-slate-600">Tipo:</span>{' '}
                      <span className="text-slate-900 font-medium">{selectedStudy.type || 'Volúmen vehicular'}</span>
                    </div>
                    {selectedStudy.date && (
                      <div>
                        <span className="text-slate-600">Fecha:</span>{' '}
                        <span className="text-slate-900">
                          {selectedStudy.date}
                          {selectedStudy.date_end && selectedStudy.date_end !== selectedStudy.date ? ` — ${selectedStudy.date_end}` : ''}
                        </span>
                      </div>
                    )}
                    {selectedStudy.contractors?.length > 0 && (
                      <div>
                        <span className="text-slate-600">Realizado por:</span>{' '}
                        <span className="text-slate-900">{selectedStudy.contractors.join(', ')}</span>
                      </div>
                    )}
                  </div>
                  {downloadError && <p className="text-xs text-red-600 mt-2">{downloadError}</p>}
                  {selectedStudy.file_id != null && onDownloadAforo && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => onDownloadAforo(selectedStudy)}
                        disabled={downloadingFileId === selectedStudy.file_id}
                        className="inline-flex items-center gap-2 text-sm font-medium text-panorama-sky hover:text-panorama-sky-600 disabled:opacity-60"
                      >
                        {downloadingFileId === selectedStudy.file_id ? (
                          <>
                            <span className="animate-spin rounded-full h-4 w-4 border-2 border-panorama-sky border-t-transparent" />
                            Descargando…
                          </>
                        ) : (
                          <>
                            Descargar Excel
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {selectedStudy && (
                <ResumenAnalisisAforo
                  analisis={analisis}
                  loadingAnalisis={loadingAnalisis}
                  analisisError={analisisError}
                  analisisQuality={analisisQuality}
                />
              )}

              {nodeStudies.length > 1 && (
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-2">Otros estudios en este nodo</p>
                  <ul className="space-y-1">
                    {nodeStudies.map((study, idx) => (
                      <li key={study.file_id ?? idx}>
                        <button
                          type="button"
                          onClick={() => onSelectStudyIndex(idx)}
                          className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${
                            selectedStudyIndex === idx ? 'bg-panorama-sky text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {study.date || 'Sin fecha'}
                          {study.date_end && study.date_end !== study.date ? ` - ${study.date_end}` : ''}
                          {' · '}
                          {study.type || 'Aforo'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(selectedNodeIdForApi || matchedNodeId) && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3">
                  <p className="text-sm font-semibold text-slate-900">Datos unificados (validación IA)</p>
                  {loadingDatosUnificados && (
                    <div className="flex items-center gap-2 text-slate-600 text-xs">
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-panorama-sky border-t-transparent" />
                      Cargando obras, eventos y velocidades…
                    </div>
                  )}
                  {!loadingDatosUnificados && datosUnificadosCalendario && (
                    <>
                      {datosUnificadosCalendario.obras?.length > 0 || datosUnificadosCalendario.eventos?.length > 0 ? (
                        <div className="space-y-2">
                          {datosUnificadosCalendario.obras?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-slate-600 mb-1">Obras cercanas (IDU)</p>
                              <ul className="space-y-1 max-h-24 overflow-y-auto text-xs">
                                {datosUnificadosCalendario.obras.slice(0, 5).map((o, i) => (
                                  <li key={o.id ?? i} className="bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                    {o.nombre || o.descripcion || 'Obra'}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {datosUnificadosCalendario.eventos?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-slate-600 mb-1">Eventos</p>
                              <ul className="space-y-1 max-h-24 overflow-y-auto text-xs">
                                {datosUnificadosCalendario.eventos.slice(0, 5).map((e, i) => (
                                  <li key={e.id ?? i} className="bg-blue-50 border border-blue-200 rounded px-2 py-1">
                                    {e.descripcion?.slice(0, 80) || e.fuente || 'Evento'}
                                    {e.descripcion?.length > 80 ? '…' : ''}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Sin obras ni eventos registrados para este nodo.</p>
                      )}
                    </>
                  )}
                  {!loadingDatosUnificados && datosUnificadosVelocidades?.serie?.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-1">Velocidades recientes</p>
                      <div className="flex flex-wrap gap-1">
                        {datosUnificadosVelocidades.serie.slice(-6).map((p, i) => (
                          <span key={i} className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5">
                            {p.velocidad_kmh} km/h
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center py-8">
                <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm text-slate-600">No se encontraron estudios para este nodo</p>
                <p className="text-xs text-slate-500 mt-1">Los estudios se cargan desde la base de datos</p>
              </div>
              {(selectedNodeIdForApi || matchedNodeId) && (
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3">
                  <p className="text-sm font-semibold text-slate-900">Datos unificados</p>
                  {loadingDatosUnificados && (
                    <div className="flex items-center gap-2 text-slate-600 text-xs">
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-panorama-sky border-t-transparent" />
                      Cargando…
                    </div>
                  )}
                  {!loadingDatosUnificados && datosUnificadosCalendario && (
                    (datosUnificadosCalendario.obras?.length > 0 || datosUnificadosCalendario.eventos?.length > 0) ? (
                      <ul className="space-y-1 text-xs max-h-32 overflow-y-auto">
                        {datosUnificadosCalendario.obras?.slice(0, 3).map((o, i) => (
                          <li key={o.id ?? i} className="bg-amber-50 border border-amber-200 rounded px-2 py-1">{o.nombre || o.descripcion || 'Obra'}</li>
                        ))}
                        {datosUnificadosCalendario.eventos?.slice(0, 3).map((e, i) => (
                          <li key={e.id ?? i} className="bg-blue-50 border border-blue-200 rounded px-2 py-1">{e.descripcion?.slice(0, 60) || 'Evento'}…</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">Sin obras ni eventos para este nodo.</p>
                    )
                  )}
                  {!loadingDatosUnificados && datosUnificadosVelocidades?.serie?.length > 0 && (
                    <p className="text-xs text-slate-600">
                      Velocidades: {datosUnificadosVelocidades.serie.slice(-3).map((p) => `${p.velocidad_kmh} km/h`).join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PanelNodo;
