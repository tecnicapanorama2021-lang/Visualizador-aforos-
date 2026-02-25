import React from 'react';

/**
 * Filtros por categoría de nodos (Fase 5).
 * Muestra toggles por tipo: Obras, Eventos, Aforos Manuales, etc.
 */
const CategoryFilter = ({
  categories = {},
  activeFilters = {},
  onFilterChange,
  nodesByCategory = {},
}) => {
  const handleToggle = (key) => {
    onFilterChange?.((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const order = [
    'AFORO_MANUAL',
    'OBRA',
    'EVENTO',
    'INFRAESTRUCTURA',
    'MANIFESTACION',
    'CONCIERTO',
    'OTROS',
  ];

  return (
    <div className="bg-white/95 backdrop-blur rounded-lg shadow border border-slate-200 p-3 max-w-[220px]">
      <p className="text-xs font-semibold text-slate-600 mb-2">Filtrar por tipo</p>
      <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto">
        {order.map((key) => {
          const meta = categories[key];
          if (!meta) return null;
          const count = nodesByCategory[key]?.length ?? 0;
          const isActive = activeFilters[key] !== false;
          return (
            <label
              key={key}
              className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 rounded px-2 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                checked={isActive}
                onChange={() => handleToggle(key)}
                className="rounded border-slate-300 text-panorama-sky focus:ring-panorama-sky"
              />
              <span className="shrink-0" style={{ color: meta.color }} title={meta.label}>
                {meta.icon}
              </span>
              <span className="text-slate-700 truncate flex-1">{meta.label}</span>
              <span className="text-xs text-slate-400 tabular-nums">{count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryFilter;
