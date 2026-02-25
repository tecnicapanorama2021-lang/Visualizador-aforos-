import React, { Component, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Filter, X, RefreshCw } from 'lucide-react';
import SEO from '../components/common/SEO';
import AforosMap from '../components/map/AforosMap';

/** Error boundary para el mapa: evita pantalla en blanco si algo falla (ej. capa de tráfico). */
class MapErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.warn('[MapErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-100 p-4 text-center">
          <p className="text-slate-700 font-medium">El mapa tuvo un error.</p>
          <p className="text-sm text-slate-500 max-w-md">
            Si activaste &quot;Tráfico en vivo&quot;, desactívalo o configura <code className="bg-slate-200 px-1 rounded">VITE_GOOGLE_MAPS_KEY</code> en tu <code className="bg-slate-200 px-1 rounded">.env</code>.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-panorama-sky text-white hover:bg-panorama-sky-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const AforosPage = () => {
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const params = useParams();
  const [searchParams] = useSearchParams();
  const dimIdFromUrl = params.dimId ?? searchParams.get('dimId');

  return (
    <>
      <SEO 
        title="Aforos Predictivos - Visualización de Tráfico en Tiempo Real"
        description="Visualiza y analiza aforos predictivos de tráfico vehicular en Bogotá. Datos en tiempo real de sensores de movilidad."
        keywords="aforos, tráfico, sensores, movilidad, Bogotá, predictivos, visualización"
      />
      
      <section className="relative w-full h-full min-h-0 bg-slate-100 overflow-hidden flex flex-col">
        {/* Mapa ocupa todo el espacio disponible bajo el navbar, sin scroll */}
        <div className="flex-1 min-h-0 relative">
          <div id="map-container" className="absolute inset-0 w-full h-full overflow-hidden">
            <MapErrorBoundary>
              <AforosMap dimIdFromUrl={dimIdFromUrl} />
            </MapErrorBoundary>
          </div>
        </div>

        {/* Botón + menú flotante de filtros (debajo del navbar, arriba derecha) */}
        <div className="absolute top-20 right-4 z-40 flex flex-col items-end">
          <button
            onClick={() => setIsFiltersOpen((open) => !open)}
            className={`p-2.5 rounded-lg shadow-lg border transition-all ${
              isFiltersOpen
                ? 'bg-panorama-sky text-white border-panorama-sky'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
            title={isFiltersOpen ? 'Cerrar filtros' : 'Abrir filtros'}
            aria-label={isFiltersOpen ? 'Cerrar filtros' : 'Abrir filtros'}
            aria-expanded={isFiltersOpen}
          >
            <Filter className="w-5 h-5" />
          </button>

          {/* Menú flotante que se despliega debajo del botón */}
          {isFiltersOpen && (
            <div
              className="mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"
              role="dialog"
              aria-label="Menú de filtros"
            >
              <div className="p-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-panorama-sky" />
                  <span className="font-semibold text-slate-900 text-sm">Filtros</span>
                </div>
                <button
                  onClick={() => setIsFiltersOpen(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
                  aria-label="Cerrar"
                  title="Cerrar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-3">
                <p className="text-sm text-slate-500 mb-1">Filtros y búsqueda</p>
                <p className="text-xs text-slate-400 italic">Próximamente</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
};

export default AforosPage;
