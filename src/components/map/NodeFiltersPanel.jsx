import React, { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { API_ENDPOINTS } from '../../constants/apiEndpoints';

/**
 * Panel de filtros por capas (Aforos, Obras, Eventos, Manifestaciones; Lugares si VITE_SHOW_LUGARES).
 * Toggle vigencia: Activos (hoy + 7 días) vs Histórico. Eventos: subfiltro Activos ahora | Próximos 7 días | Histórico (Waze).
 * Autocompletado server-side: /api/nodos/search (debounced). Al seleccionar: onSearchSelect(feature) -> flyTo en mapa.
 */
const NodeFiltersPanel = ({
  layerKeys = [],
  activeLayerFilters = {},
  onLayerFilterChange,
  nodesByLayer = {},
  searchValue = '',
  onSearchChange,
  temporalMode = 'active',
  onTemporalModeChange,
  eventosTimeFilter = 'active',
  onEventosTimeFilterChange,
  eventosUpcomingCount = 0,
  layerLabelOverrides = {},
  onSearchSelect,
  obrasOnlyWithGeometry = false,
  onObrasOnlyWithGeometryChange,
  obrasOnlyEnriched = false,
  onObrasOnlyEnrichedChange,
  obrasShowIncomplete = false,
  onObrasShowIncompleteChange,
}) => {
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchSuggestionsLoading, setSearchSuggestionsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const q = (searchValue || '').trim();
    if (q.length < 2) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchSuggestionsLoading(true);
      fetch(API_ENDPOINTS.NODOS_SEARCH(q, 10), { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : { features: [] }))
        .then((data) => {
          setSearchSuggestions(data?.features ?? []);
          setShowSuggestions(true);
        })
        .catch(() => setSearchSuggestions([]))
        .finally(() => setSearchSuggestionsLoading(false));
      debounceRef.current = null;
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchValue]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setShowSuggestions(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleSelectSuggestion = (feature) => {
    setShowSuggestions(false);
    setSearchSuggestions([]);
    onSearchSelect?.(feature);
  };
  const handleToggle = (key) => {
    onLayerFilterChange?.((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAll = () => {
    const next = {};
    layerKeys.forEach(({ key }) => { next[key] = true; });
    onLayerFilterChange?.(() => next);
  };
  const clearAll = () => {
    const next = {};
    layerKeys.forEach(({ key }) => { next[key] = false; });
    onLayerFilterChange?.(() => next);
  };
  const onlyAforos = () => {
    const next = {};
    layerKeys.forEach(({ key }) => { next[key] = key === 'aforos'; });
    onLayerFilterChange?.(() => next);
  };
  const onlyEventos = () => {
    const next = {};
    layerKeys.forEach(({ key }) => {
      next[key] = key === 'eventos' || key === 'manifestaciones';
    });
    onLayerFilterChange?.(() => next);
  };

  return (
    <div className="bg-white/95 backdrop-blur rounded-lg shadow border border-slate-200 p-3 w-[260px] max-h-[85vh] flex flex-col">
      <p className="text-xs font-semibold text-slate-600 mb-2">Filtrar por capas</p>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-slate-500">Vigencia:</span>
        <div className="flex rounded-md overflow-hidden border border-slate-200">
          <button
            type="button"
            onClick={() => onTemporalModeChange?.('active')}
            className={`px-2 py-1 text-xs ${temporalMode === 'active' ? 'bg-panorama-sky text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Activos
          </button>
          <button
            type="button"
            onClick={() => onTemporalModeChange?.('historic')}
            className={`px-2 py-1 text-xs ${temporalMode === 'historic' ? 'bg-panorama-sky text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Histórico
          </button>
        </div>
      </div>
      {temporalMode === 'active' && (nodesByLayer.eventos ?? 0) + (nodesByLayer.manifestaciones ?? 0) === 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2" role="status">
          Sin eventos/manifestaciones activos. Cambia a <strong>Histórico</strong> para ver pasados.
        </p>
      )}

      <div className="mb-2">
        <span className="text-xs text-slate-500 block mb-1">Obras:</span>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={obrasOnlyWithGeometry}
              onChange={(e) => onObrasOnlyWithGeometryChange?.(e.target.checked)}
              className="rounded border-slate-300"
            />
            Solo obras con delimitación
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={obrasOnlyEnriched}
              onChange={(e) => onObrasOnlyEnrichedChange?.(e.target.checked)}
              className="rounded border-slate-300"
            />
            Solo obras con detalle
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={obrasShowIncomplete}
              onChange={(e) => onObrasShowIncompleteChange?.(e.target.checked)}
              className="rounded border-slate-300"
            />
            Mostrar obras incompletas
          </label>
        </div>
      </div>
      {temporalMode === 'active' && eventosTimeFilter === 'active' && (nodesByLayer.eventos ?? 0) === 0 && eventosUpcomingCount > 0 && (
        <p className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-1 mb-2" role="status">
          No hay eventos activos ahora. Hay <strong>{eventosUpcomingCount}</strong> próximos en 7 días.
        </p>
      )}

      <div className="mb-2">
        <span className="text-xs text-slate-500 block mb-1">Eventos:</span>
        <div className="flex rounded-md overflow-hidden border border-slate-200">
          <button
            type="button"
            onClick={() => onEventosTimeFilterChange?.('active')}
            className={`flex-1 px-2 py-1 text-xs ${eventosTimeFilter === 'active' ? 'bg-panorama-sky text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Activos ahora
          </button>
          <button
            type="button"
            onClick={() => onEventosTimeFilterChange?.('upcoming')}
            className={`flex-1 px-2 py-1 text-xs ${eventosTimeFilter === 'upcoming' ? 'bg-panorama-sky text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Próximos 7 días
          </button>
          <button
            type="button"
            onClick={() => onEventosTimeFilterChange?.('historic')}
            className={`flex-1 px-2 py-1 text-xs ${eventosTimeFilter === 'historic' ? 'bg-panorama-sky text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Histórico
          </button>
        </div>
      </div>

      <div className="relative mb-3" ref={containerRef}>
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange?.(e.target.value)}
          placeholder="Nombre, dirección, id..."
          className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-panorama-sky/30 focus:border-panorama-sky outline-none"
          aria-label="Buscar nodos"
          autoComplete="off"
        />
        {showSuggestions && (searchSuggestions.length > 0 || searchSuggestionsLoading) && (
          <div className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg z-[1100] max-h-48 overflow-y-auto">
            {searchSuggestionsLoading ? (
              <div className="px-3 py-2 text-xs text-slate-500">Buscando...</div>
            ) : (
              searchSuggestions.map((f, i) => (
                <button
                  key={f?.properties?.node_id_externo ?? f?.properties?.id ?? i}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 border-b border-slate-100 last:border-0"
                  onClick={() => handleSelectSuggestion(f)}
                >
                  <span className="font-medium text-slate-800">{f?.properties?.nombre ?? f?.properties?.direccion ?? 'Nodo'}</span>
                  {f?.properties?.direccion && f?.properties?.nombre !== f?.properties?.direccion && (
                    <span className="block text-xs text-slate-500 truncate">{f.properties.direccion}</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-2">
        <button type="button" onClick={selectAll} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">
          Todo
        </button>
        <button type="button" onClick={onlyAforos} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">
          Solo Aforos
        </button>
        <button type="button" onClick={onlyEventos} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">
          Solo Eventos
        </button>
        <button type="button" onClick={clearAll} className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200">
          Limpiar
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 flex flex-wrap gap-1.5">
        {layerKeys.map(({ key, label, icon, color }) => {
          const count = nodesByLayer[key] ?? 0;
          const isActive = activeLayerFilters[key] !== false;
          const displayLabel = layerLabelOverrides[key] ?? label;
          const isEventosChip = key === 'eventos';
          const showEventosEmptyTooltip = isEventosChip && eventosTimeFilter === 'active' && count === 0;
          const chipTitle = showEventosEmptyTooltip
            ? 'No hay eventos activos en este momento. Los eventos aparecerán aquí cuando estén dentro de su ventana temporal.'
            : displayLabel;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleToggle(key)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-panorama-sky/15 text-panorama-sky border border-panorama-sky/40'
                  : 'bg-slate-100 text-slate-500 border border-transparent hover:bg-slate-200'
              }`}
              style={isActive ? { borderColor: color } : {}}
              title={chipTitle}
            >
              <span>{icon}</span>
              <span className="truncate max-w-[72px]">{displayLabel}</span>
              <span className="tabular-nums opacity-80">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default NodeFiltersPanel;
