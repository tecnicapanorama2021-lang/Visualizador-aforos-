import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap, GeoJSON } from 'react-leaflet';
import GoogleTrafficLayer from './GoogleTrafficLayer';
import ResumenAnalisisAforo from './ResumenAnalisisAforo';
import NodeFiltersPanel from './NodeFiltersPanel';
import NodosRulesAdmin from './NodosRulesAdmin';
import PredictorQualityPanel from './PredictorQualityPanel';
import PanelAforoDrawer from './PanelAforoDrawer';
import {
  PopupObras,
  PopupEventos,
  PopupManifestaciones,
  PopupConciertos,
  PopupLugares,
} from './popups';
import { API_ENDPOINTS } from '../../constants/apiEndpoints';
import {
  getMarkerColorByLayerType,
  NODE_RADIUS_DEFAULT,
  NODE_RADIUS_WITH_STUDIES,
  NODE_COLOR_SELECTED,
} from '../../constants/aforosNodeStyles';
import { getMarkerKey, logDuplicateKeysInDev } from '../../utils/markerKey';
import 'leaflet/dist/leaflet.css';

function MapSizeAdjuster() {
  const map = useMap();
  useEffect(() => {
    const handleResize = () => map && setTimeout(() => map.invalidateSize(), 100);
    const t = setTimeout(() => map?.invalidateSize(), 100);
    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', handleResize);
    };
  }, [map]);
  return null;
}

/** Sincroniza centro del mapa para vista predicción (limitar nodos por proximidad). */
function MapCenterSync({ onCenter }) {
  const map = useMap();
  useEffect(() => {
    if (!onCenter || !map) return;
    const update = () => {
      const c = map.getCenter();
      onCenter([c.lat, c.lng]);
    };
    update();
    map.on('moveend', update);
    return () => { map.off('moveend', update); };
  }, [map, onCenter]);
  return null;
}

/** Vuela al centro cuando el usuario selecciona un resultado del buscador (sin useMap fuera del MapContainer). */
function FlyToCenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (!center || !Array.isArray(center) || center.length < 2 || !map) return;
    const [lat, lng] = center;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.flyTo([lat, lng], typeof zoom === 'number' ? zoom : 16, { duration: 1 });
    }
  }, [center, zoom, map]);
  return null;
}

const center = [4.6097, -74.0817];
const zoom = 12;

/** Capas reales. Lugares solo visible si VITE_SHOW_LUGARES=true (debug/admin). */
const SHOW_LUGARES = import.meta.env.VITE_SHOW_LUGARES === 'true';

const LAYER_FILTER_KEYS = [
  { key: 'aforos', label: 'Aforos', icon: '📊', color: '#16A34A' },
  { key: 'obras', label: 'Obras', icon: '🚧', color: '#DC2626' },
  { key: 'eventos', label: 'Eventos', icon: '📅', color: '#7C3AED' },
  { key: 'lugares', label: 'Lugares', icon: '📍', color: '#b39ddb' },
  { key: 'manifestaciones', label: 'Manifestaciones', icon: '📢', color: '#EA580C' },
];

/** Capas a mostrar en el panel de filtros (Lugares solo si VITE_SHOW_LUGARES). */
const layerKeysForUI = SHOW_LUGARES ? LAYER_FILTER_KEYS : LAYER_FILTER_KEYS.filter((l) => l.key !== 'lugares');

/** Filtra features por búsqueda (nombre, direccion, id). */
function filterFeaturesBySearch(features, searchText) {
  const q = (searchText || '').trim().toLowerCase();
  if (!q) return features;
  return features.filter((f) => {
    const p = f.properties ?? {};
    const nombre = (p.nombre ?? p.nodo_nombre ?? '').toString().toLowerCase();
    const direccion = (p.direccion ?? '').toString().toLowerCase();
    const id = (p.node_id_externo ?? p.id ?? '').toString().toLowerCase();
    return nombre.includes(q) || direccion.includes(q) || id.includes(q);
  });
}

const AforosMap = ({ dimIdFromUrl }) => {
  const navigate = useNavigate();
  const [aforosFeatures, setAforosFeatures] = useState([]);
  const [obrasFeatures, setObrasFeatures] = useState([]);
  const [eventosFeatures, setEventosFeatures] = useState([]);
  const [lugaresFeatures, setLugaresFeatures] = useState([]);
  const [manifestacionesFeatures, setManifestacionesFeatures] = useState([]);
  const [conciertosFeatures, setConciertosFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [standaloneAnalisis, setStandaloneAnalisis] = useState(null);
  const [standaloneLoading, setStandaloneLoading] = useState(false);
  const [standaloneError, setStandaloneError] = useState(null);
  const [standaloneQuality, setStandaloneQuality] = useState(null);
  const [showGoogleTraffic, setShowGoogleTraffic] = useState(false);
  const [trafficError, setTrafficError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [activeLayerFilters, setActiveLayerFilters] = useState({
    aforos: true,
    obras: true,
    eventos: true,
    lugares: false,
    manifestaciones: true,
  });
  const [searchText, setSearchText] = useState('');
  const [showRulesAdmin, setShowRulesAdmin] = useState(false);
  const [showPredictorQuality, setShowPredictorQuality] = useState(false);
  /** 'actual' | 'prediccion' */
  const [viewMode, setViewMode] = useState('actual');
  const [predictionByNode, setPredictionByNode] = useState({});
  const [predictionPercentiles, setPredictionPercentiles] = useState({ p25: 0, p75: 100 });
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionWarning, setPredictionWarning] = useState(null);
  const [mapCenter, setMapCenter] = useState(center);
  /** 'active' = solo activos (hoy + 7 días); 'historic' = histórico (sin filtro o rango). */
  const [temporalMode, setTemporalMode] = useState('active');
  /** Eventos: subfiltro Waze — Activos ahora | Próximos 7 días | Histórico. */
  const [eventosTimeFilter, setEventosTimeFilter] = useState('active');
  const [eventosUpcomingCount, setEventosUpcomingCount] = useState(0);
  /** Desvíos SIMUR por obra: solo visibles al hacer click en una obra. */
  const [desviosFC, setDesviosFC] = useState(null);
  /** Detalle enriquecido de la obra seleccionada (GET /api/obras/:id/detail). */
  const [obraDetail, setObraDetail] = useState(null);
  /** Capas "alrededor" de la obra (GET /api/obras/:id/around). */
  const [obraAround, setObraAround] = useState(null);
  /** Delimitación real (Polygon/LineString) de la obra seleccionada; solo se pinta esta, no todas. */
  const [selectedObraShape, setSelectedObraShape] = useState(null);
  /** Centro para flyTo desde buscador (evita useMap fuera del MapContainer). */
  const [flyToCenter, setFlyToCenter] = useState(null);
  /** Filtros calidad obras: solo con delimitación (geom rica) y/o solo con detalle ArcGIS. */
  const [obrasOnlyWithGeometry, setObrasOnlyWithGeometry] = useState(false);
  const [obrasOnlyEnriched, setObrasOnlyEnriched] = useState(false);
  /** Si true, pide quality=all y se muestran obras incompletas (LOW). */
  const [obrasShowIncomplete, setObrasShowIncomplete] = useState(false);

  /** Cargar capas activas. Al cambiar vigencia, limpiar eventos/manifestaciones antes de refetch. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setApiStatus(null);
    setEventosFeatures([]);
    setManifestacionesFeatures([]);
    setEventosUpcomingCount(0);
    const vigencia = temporalMode === 'active' ? 'activos' : 'historico';
    const qs = temporalMode === 'active' ? '?active=1' : '?active=0';
    let obrasQs = API_ENDPOINTS.OBRAS_NODOS + qs + (qs.includes('?') ? '&' : '?') + 'geomMode=centroid';
    if (obrasOnlyWithGeometry) obrasQs += '&onlyWithGeometry=1';
    if (obrasOnlyEnriched) obrasQs += '&onlyEnriched=1';
    if (obrasShowIncomplete) obrasQs += '&quality=all';
    const eventosFilter = temporalMode === 'historic' ? 'historic' : eventosTimeFilter;
    const eventosQs = temporalMode === 'historic' ? '?vigencia=historico&eventos_filter=historic' : `?vigencia=activos&eventos_filter=${eventosTimeFilter}`;
    const manifestacionesQs = `?vigencia=${vigencia}`;
    const urls = [
      { key: 'aforos', url: API_ENDPOINTS.AFOROS_NODOS },
      { key: 'obras', url: obrasQs },
      { key: 'eventos', url: API_ENDPOINTS.EVENTOS_NODOS + eventosQs },
      { key: 'manifestaciones', url: API_ENDPOINTS.MANIFESTACIONES_NODOS + manifestacionesQs },
      { key: 'conciertos', url: API_ENDPOINTS.CONCIERTOS_NODOS },
    ];
    if (temporalMode === 'active') {
      urls.push({ key: 'eventos_upcoming', url: API_ENDPOINTS.EVENTOS_NODOS + '?vigencia=activos&eventos_filter=upcoming' });
    }
    Promise.all(
      urls.map(({ key, url }) =>
        fetch(url, { headers: { Accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : { features: [] }))
          .then((data) => ({ key, data }))
      )
    ).then((results) => {
        if (cancelled) return;
        setApiStatus(200);
        const byKey = Object.fromEntries(results.map(({ key, data }) => [key, data?.features ?? []]));
        setAforosFeatures(byKey.aforos ?? []);
        setObrasFeatures(byKey.obras ?? []);
        setEventosFeatures(byKey.eventos ?? []);
        setManifestacionesFeatures(byKey.manifestaciones ?? []);
        setConciertosFeatures(byKey.conciertos ?? []);
        if (temporalMode === 'active' && Array.isArray(byKey.eventos_upcoming)) {
          setEventosUpcomingCount(byKey.eventos_upcoming.length ?? 0);
        }
        if (import.meta.env?.DEV) {
          console.debug('eventos fetch', { url: API_ENDPOINTS.EVENTOS_NODOS + eventosQs, received: (byKey.eventos ?? []).length, vigencia, eventos_filter: eventosFilter });
          console.debug('manifestaciones fetch', { url: API_ENDPOINTS.MANIFESTACIONES_NODOS + manifestacionesQs, received: (byKey.manifestaciones ?? []).length, vigencia });
          console.log('✅ Capas cargadas:', vigencia, {
            aforos: (byKey.aforos ?? []).length,
            obras: (byKey.obras ?? []).length,
            eventos: (byKey.eventos ?? []).length,
            manifestaciones: (byKey.manifestaciones ?? []).length,
            conciertos: (byKey.conciertos ?? []).length,
          });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'Error cargando capas');
          console.error('❌ Error cargando capas:', e);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [temporalMode, eventosTimeFilter, obrasOnlyWithGeometry, obrasOnlyEnriched, obrasShowIncomplete]);

  /** Lazy-load Lugares: solo si VITE_SHOW_LUGARES y el usuario activa la capa. */
  useEffect(() => {
    if (!SHOW_LUGARES || !activeLayerFilters.lugares) return;
    let cancelled = false;
    fetch(API_ENDPOINTS.LUGARES_NODOS, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((data) => {
        if (!cancelled) setLugaresFeatures(data?.features ?? []);
      })
      .catch(() => { if (!cancelled) setLugaresFeatures([]); });
    return () => { cancelled = true; };
  }, [SHOW_LUGARES, activeLayerFilters.lugares]);

  /** Por capa: features filtradas por búsqueda. */
  const aforosFiltered = useMemo(() => filterFeaturesBySearch(aforosFeatures, searchText), [aforosFeatures, searchText]);

  /** Nodos aforos para vista predicción: máximo 50 si hay >200, ordenados por cercanía al centro. */
  const aforosParaPrediccion = useMemo(() => {
    if (viewMode !== 'prediccion' || !aforosFiltered.length) return [];
    const withCoords = aforosFiltered
      .filter((f) => Array.isArray(f?.geometry?.coordinates) && f.geometry.coordinates.length >= 2)
      .map((f) => ({
        feature: f,
        nodeId: f?.properties?.node_id_externo ?? f?.properties?.id ?? '',
        lat: f.geometry.coordinates[1],
        lng: f.geometry.coordinates[0],
      }))
      .filter((x) => x.nodeId);
    if (withCoords.length <= 200) return withCoords;
    const [cy, cx] = mapCenter;
    const dist = (a) => (a.lat - cy) ** 2 + (a.lng - cx) ** 2;
    withCoords.sort((a, b) => dist(a) - dist(b));
    return withCoords.slice(0, 50);
  }, [viewMode, aforosFiltered, mapCenter]);

  /** Fetch predicciones para vista predicción (throttle 10). */
  useEffect(() => {
    if (viewMode !== 'prediccion' || aforosParaPrediccion.length === 0) {
      setPredictionByNode({});
      setPredictionPercentiles({ p25: 0, p75: 100 });
      setPredictionWarning(null);
      return;
    }
    setPredictionWarning(aforosFiltered.length > 200 ? `Vista predicción activa para ${aforosParaPrediccion.length} nodos. Zoom in para ver todos.` : null);
    const hoy = new Date().toISOString().slice(0, 10);
    const hora = new Date().getHours();
    setPredictionLoading(true);
    const BATCH = 10;
    const fetchOne = (nodeId) =>
      fetch(API_ENDPOINTS.PREDICCION_NODO(nodeId, hoy, hora), { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    (async () => {
      const byNode = {};
      for (let i = 0; i < aforosParaPrediccion.length; i += BATCH) {
        const batch = aforosParaPrediccion.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map(({ nodeId }) => fetchOne(nodeId)));
        results.forEach((res, j) => {
          const nodeId = batch[j]?.nodeId;
          if (!nodeId) return;
          const data = res.status === 'fulfilled' ? res.value : null;
          if (data?.prediccion != null) byNode[nodeId] = { prediccion: data.prediccion, confianza: data.confianza ?? 'baja' };
        });
      }
      const vals = Object.values(byNode).map((v) => v.prediccion).filter((n) => Number.isFinite(n));
      let p25 = 0, p75 = 100;
      if (vals.length >= 2) {
        vals.sort((a, b) => a - b);
        p25 = vals[Math.floor(vals.length * 0.25)] ?? vals[0];
        p75 = vals[Math.floor(vals.length * 0.75)] ?? vals[vals.length - 1];
      }
      setPredictionByNode(byNode);
      setPredictionPercentiles({ p25, p75 });
      setPredictionLoading(false);
    })();
  }, [viewMode, aforosParaPrediccion]);
  const obrasFiltered = useMemo(() => filterFeaturesBySearch(obrasFeatures, searchText), [obrasFeatures, searchText]);
  const eventosFiltered = useMemo(() => filterFeaturesBySearch(eventosFeatures, searchText), [eventosFeatures, searchText]);
  const lugaresFiltered = useMemo(() => filterFeaturesBySearch(lugaresFeatures, searchText), [lugaresFeatures, searchText]);
  const manifestacionesFiltered = useMemo(() => filterFeaturesBySearch(manifestacionesFeatures, searchText), [manifestacionesFeatures, searchText]);
  const conciertosFiltered = useMemo(() => filterFeaturesBySearch(conciertosFeatures, searchText), [conciertosFeatures, searchText]);

  /** Conteos por capa. received = lo que llegó del API; visible = tras filtro búsqueda. */
  const nodesByLayer = useMemo(
    () => ({
      aforos: aforosFiltered.length,
      obras: obrasFiltered.length,
      eventos: eventosFiltered.length + conciertosFiltered.length,
      lugares: lugaresFiltered.length,
      manifestaciones: manifestacionesFiltered.length,
    }),
    [aforosFiltered.length, obrasFiltered.length, eventosFiltered.length, lugaresFiltered.length, manifestacionesFiltered.length, conciertosFiltered.length]
  );

  /** Panel Front vs API: comparar received (lo que llegó del fetch) vs visible (tras búsqueda). Sin mismatch por reglas de negocio. */
  const statsReceivedVsVisible = useMemo(() => {
    const received = {
      aforos: aforosFeatures.length,
      obras: obrasFeatures.length,
      eventos: eventosFeatures.length + conciertosFeatures.length,
      manifestaciones: manifestacionesFeatures.length,
    };
    const visible = {
      aforos: aforosFiltered.length,
      obras: obrasFiltered.length,
      eventos: eventosFiltered.length + conciertosFiltered.length,
      manifestaciones: manifestacionesFiltered.length,
    };
    if (SHOW_LUGARES) {
      received.lugares = lugaresFeatures.length;
      visible.lugares = lugaresFiltered.length;
    }
    return { received, visible };
  }, [
    aforosFeatures.length, obrasFeatures.length, eventosFeatures.length, manifestacionesFeatures.length, conciertosFeatures.length,
    aforosFiltered.length, obrasFiltered.length, eventosFiltered.length, manifestacionesFiltered.length, conciertosFiltered.length,
    lugaresFeatures.length, lugaresFiltered.length,
  ]);


  // Panel standalone por URL: /aforos/analisis/:dimId o /aforos?dimId=388
  useEffect(() => {
    const dimId = dimIdFromUrl != null && dimIdFromUrl !== '' ? String(dimIdFromUrl).replace(/\D/g, '') || null : null;
    if (!dimId) {
      setStandaloneAnalisis(null);
      setStandaloneError(null);
      setStandaloneQuality(null);
      setStandaloneLoading(false);
      return;
    }
    let cancelled = false;
    setStandaloneLoading(true);
    setStandaloneAnalisis(null);
    setStandaloneError(null);
    setStandaloneQuality(null);
    const url = API_ENDPOINTS.AFOROS_ANALISIS(dimId);
    if (import.meta.env?.DEV) console.log('[AforosMap] standalone dimId:', dimId, 'URL:', url);
    fetch(url)
      .then(async (res) => {
        const text = await res.text();
        if ((res.headers.get('content-type') || '').includes('text/html') || text.trimStart().startsWith('<')) {
          throw new Error('El backend no respondió con JSON.');
        }
        if (!res.ok) {
          let errMsg = `Error ${res.status}`;
          try {
            const d = JSON.parse(text);
            errMsg = d?.error || errMsg;
            if (!cancelled) {
              setStandaloneError(errMsg);
              if (d?.quality) setStandaloneQuality(d.quality);
            }
          } catch (_) {
            if (!cancelled) setStandaloneError(errMsg);
          }
          throw new Error(errMsg);
        }
        return JSON.parse(text);
      })
      .then((data) => { if (!cancelled) setStandaloneAnalisis(data); })
      .catch((err) => { if (!cancelled) setStandaloneError(err?.message || 'Error al analizar'); })
      .finally(() => { if (!cancelled) setStandaloneLoading(false); });
    return () => { cancelled = true; };
  }, [dimIdFromUrl]);

  /** Cargar desvíos SIMUR solo al hacer click en una obra (incidente_id). */
  useEffect(() => {
    const layerType = selectedFeature?.properties?.layerType;
    const incidenteId = selectedFeature?.properties?.incidente_id;
    if (layerType !== 'OBRAS' || !incidenteId) {
      setDesviosFC(null);
      setObraDetail(null);
      setObraAround(null);
      setSelectedObraShape(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(API_ENDPOINTS.OBRAS_DESVIOS(incidenteId), { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] })),
      fetch(API_ENDPOINTS.OBRAS_DETAIL(incidenteId) + '?debug=1', { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(API_ENDPOINTS.OBRAS_AROUND(incidenteId, 500), { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([desviosData, detailData, aroundData]) => {
      if (cancelled) return;
      if (desviosData?.type === 'FeatureCollection') setDesviosFC(desviosData);
      else setDesviosFC(null);
      setObraDetail(detailData && detailData.feature ? detailData : null);
      setObraAround(aroundData && typeof aroundData === 'object' && Object.keys(aroundData).length > 0 ? aroundData : null);
      const feat = detailData?.feature;
      if (feat?.geometry?.type && feat.geometry.type !== 'Point') {
        setSelectedObraShape(feat);
      } else {
        setSelectedObraShape(null);
      }
    }).catch(() => {
      if (!cancelled) {
        setDesviosFC(null);
        setObraDetail(null);
        setObraAround(null);
        setSelectedObraShape(null);
      }
    });
    return () => { cancelled = true; };
  }, [selectedFeature?.properties?.layerType, selectedFeature?.properties?.incidente_id]);

  const onClosePopup = () => {
    setSelectedFeature(null);
    setDesviosFC(null);
    setObraDetail(null);
    setObraAround(null);
    setSelectedObraShape(null);
  };

  /** Renderizar markers por capa. Lugares solo si VITE_SHOW_LUGARES. */
  const layerConfigs = [
    { key: 'aforos', features: viewMode === 'prediccion' ? aforosParaPrediccion.map((x) => x.feature) : aforosFiltered },
    { key: 'obras', features: obrasFiltered },
    { key: 'eventos', features: [...eventosFiltered, ...conciertosFiltered] },
    ...(SHOW_LUGARES ? [{ key: 'lugares', features: lugaresFiltered }] : []),
    { key: 'manifestaciones', features: manifestacionesFiltered },
  ];
  const totalVisible =
    (activeLayerFilters.aforos ? aforosFiltered.length : 0) +
    (activeLayerFilters.obras ? obrasFiltered.length : 0) +
    (activeLayerFilters.eventos ? eventosFiltered.length + conciertosFiltered.length : 0) +
    (SHOW_LUGARES && activeLayerFilters.lugares ? lugaresFiltered.length : 0) +
    (activeLayerFilters.manifestaciones ? manifestacionesFiltered.length : 0);
  const totalNodesForPanel = nodesByLayer.aforos + nodesByLayer.obras + nodesByLayer.eventos + (SHOW_LUGARES ? nodesByLayer.lugares : 0) + nodesByLayer.manifestaciones;

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-[1000]">
        <p className="text-slate-600">Cargando capas...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-[1000]">
        <div className="text-center p-4">
          <p className="text-red-600 font-medium">Error cargando capas</p>
          <p className="text-sm text-slate-600 mt-1">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-panorama-sky text-white rounded-lg hover:bg-panorama-sky-600">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden">
      <MapContainer center={center} zoom={zoom} minZoom={10} maxZoom={19} style={{ height: '100%', width: '100%' }} scrollWheelZoom whenReady={(m) => setTimeout(() => m.target.invalidateSize(), 200)}>
        <MapSizeAdjuster />
        <MapCenterSync onCenter={setMapCenter} />
        <FlyToCenter center={flyToCenter} zoom={16} />
        <GoogleTrafficLayer active={showGoogleTraffic} onError={(msg) => { setShowGoogleTraffic(false); setTrafficError(msg || 'Tráfico en vivo no disponible'); setTimeout(() => setTrafficError(null), 6000); }} />
        <TileLayer
          attribution='&copy; OpenStreetMap &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />
        {layerConfigs.map(({ key, features }) => {
          if (!activeLayerFilters[key] || !features.length) return null;
          if (import.meta.env?.DEV) logDuplicateKeysInDev(key, features);
          const isPrediccionAforos = viewMode === 'prediccion' && key === 'aforos';
          const { p25, p75 } = predictionPercentiles;
          return features.map((feature, index) => {
            const geomType = feature?.geometry?.type;
            const layerType = feature?.properties?.layerType ?? 'BASE';
            const markerKey = getMarkerKey(key, feature, index);
            const isObrasLayer = key === 'obras';

            if (geomType === 'Point') {
              const coords = feature?.geometry?.coordinates;
              if (!Array.isArray(coords) || coords.length < 2) return null;
              const lat = coords[1];
              const lng = coords[0];
              const nodeId = feature?.properties?.node_id_externo ?? feature?.properties?.id ?? '';
              const pred = isPrediccionAforos ? predictionByNode[nodeId] : null;
              let color = getMarkerColorByLayerType(layerType);
              if (isPrediccionAforos && pred?.prediccion != null) {
                if (pred.prediccion <= p25) color = '#4caf50';
                else if (pred.prediccion <= p75) color = '#ff9800';
                else color = '#f44336';
              }
              const isSelected = selectedFeature && selectedFeature === feature;
              const radius = layerType === 'AFOROS' ? NODE_RADIUS_WITH_STUDIES : NODE_RADIUS_DEFAULT;
              const name = feature?.properties?.nombre ?? feature?.properties?.nodo_nombre ?? feature?.properties?.titulo ?? feature?.properties?.direccion ?? feature?.properties?.node_id_externo ?? '';
              return (
                <CircleMarker
                  key={markerKey}
                  center={[lat, lng]}
                  radius={radius}
                  pathOptions={{
                    color: isSelected ? NODE_COLOR_SELECTED : color,
                    fillColor: isSelected ? NODE_COLOR_SELECTED : color,
                    fillOpacity: isSelected ? 1 : (key === 'lugares' ? 0.7 : 0.8),
                    weight: isSelected ? 3 : 1,
                    opacity: 0.9,
                  }}
                  eventHandlers={{ click: () => setSelectedFeature(feature) }}
                >
                  <Tooltip>
                    <div className="text-sm min-w-[160px]">
                      {isPrediccionAforos && pred ? (
                        <>
                          <p className="font-semibold text-slate-900">Nodo: {nodeId || name}</p>
                          <p className="text-xs">Pred: {Number(pred.prediccion).toFixed(0)} veh/h | Confianza: {pred.confianza}</p>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold text-slate-900">{name || layerType}</p>
                          <p className="text-xs text-slate-500">{layerType}</p>
                        </>
                      )}
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            }

            if (['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geomType)) {
              if (isObrasLayer) {
                const centroid = feature?.properties?.centroid;
                const coords = centroid?.type === 'Point' && Array.isArray(centroid?.coordinates) && centroid.coordinates.length >= 2
                  ? centroid.coordinates
                  : null;
                if (coords) {
                  const lat = coords[1];
                  const lng = coords[0];
                  const isSelected = selectedFeature && selectedFeature === feature;
                  const color = getMarkerColorByLayerType(layerType);
                  const name = feature?.properties?.nombre ?? feature?.properties?.titulo ?? feature?.properties?.node_id_externo ?? layerType ?? '';
                  if (import.meta.env?.DEV) {
                    console.debug('[Obras] geometría no Point dibujada como punto (centroide)', { geomType, incidente_id: feature?.properties?.incidente_id });
                  }
                  return (
                    <CircleMarker
                      key={markerKey}
                      center={[lat, lng]}
                      radius={NODE_RADIUS_DEFAULT}
                      pathOptions={{
                        color: isSelected ? NODE_COLOR_SELECTED : color,
                        fillColor: isSelected ? NODE_COLOR_SELECTED : color,
                        fillOpacity: isSelected ? 1 : 0.8,
                        weight: isSelected ? 3 : 1,
                        opacity: 0.9,
                      }}
                      eventHandlers={{ click: () => setSelectedFeature(feature) }}
                    >
                      <Tooltip>
                        <div className="text-sm min-w-[160px]">
                          <p className="font-semibold text-slate-900">{name || layerType}</p>
                          <p className="text-xs text-slate-500">{layerType}</p>
                        </div>
                      </Tooltip>
                    </CircleMarker>
                  );
                }
                return null;
              }
              const isLine = geomType === 'LineString' || geomType === 'MultiLineString';
              const style = { color: getMarkerColorByLayerType(layerType), weight: 2, fillColor: getMarkerColorByLayerType(layerType), fillOpacity: 0.35 };
              return (
                <GeoJSON
                  key={markerKey}
                  data={feature}
                  style={style}
                  onEachFeature={(f, layer) => {
                    layer.on('click', () => setSelectedFeature(feature));
                  }}
                />
              );
            }

            // Fallback: geometría no Point/Polygon/LineString → mostrar centroid como punto (nunca dejar mapa en blanco)
            const centroid = feature?.properties?.centroid;
            const fallbackCoords = centroid?.type === 'Point' && Array.isArray(centroid?.coordinates) && centroid.coordinates.length >= 2
              ? centroid.coordinates
              : null;
            if (fallbackCoords) {
              const lat = fallbackCoords[1];
              const lng = fallbackCoords[0];
              const isSelected = selectedFeature && selectedFeature === feature;
              const color = getMarkerColorByLayerType(layerType);
              const name = feature?.properties?.nombre ?? feature?.properties?.titulo ?? feature?.properties?.node_id_externo ?? layerType ?? '';
              return (
                <CircleMarker
                  key={markerKey}
                  center={[lat, lng]}
                  radius={NODE_RADIUS_DEFAULT}
                  pathOptions={{
                    color: isSelected ? NODE_COLOR_SELECTED : color,
                    fillColor: isSelected ? NODE_COLOR_SELECTED : color,
                    fillOpacity: isSelected ? 1 : 0.8,
                    weight: isSelected ? 3 : 1,
                    opacity: 0.9,
                  }}
                  eventHandlers={{ click: () => setSelectedFeature(feature) }}
                >
                  <Tooltip>
                    <div className="text-sm min-w-[160px]">
                      <p className="font-semibold text-slate-900">{name || layerType}</p>
                      <p className="text-xs text-slate-500">{layerType}</p>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            }
            return null;
          });
        })}
        {selectedObraShape && (() => {
          if (import.meta.env?.DEV) {
            const t = selectedObraShape?.type;
            const len = selectedObraShape?.features?.length;
            console.log('selectedObraShape type', t, len != null ? `features.length=${len}` : '(single Feature)');
          }
          return (
            <GeoJSON
              key={selectedObraShape?.properties?.incidente_id ?? 'none'}
              data={selectedObraShape}
              style={{
                color: '#DC2626',
                weight: 2,
                fillColor: '#DC2626',
                fillOpacity: 0.25,
              }}
            />
          );
        })()}
        {selectedFeature?.properties?.layerType === 'OBRAS' && desviosFC?.features?.length > 0 && (
          <GeoJSON
            key="desvios-simur"
            data={desviosFC}
            style={{ color: '#ea580c', weight: 3, opacity: 0.9 }}
          />
        )}
        {selectedFeature?.properties?.layerType === 'OBRAS' && obraAround && Object.entries(obraAround).map(([layerName, fc]) =>
          fc?.type === 'FeatureCollection' && fc?.features?.length > 0 ? (
            <GeoJSON
              key={`around-${layerName}`}
              data={fc}
              style={{ color: '#d97706', weight: 2, opacity: 0.8, fillColor: '#f59e0b', fillOpacity: 0.35 }}
            />
          ) : null
        )}
      </MapContainer>

      <div className="absolute top-4 left-4 z-[1001] flex flex-col gap-1">
        <small className="text-xs text-slate-500">Fuente: API (capas reales)</small>
        {apiStatus != null && import.meta.env?.DEV && (
          <small className="text-xs text-slate-400">HTTP {apiStatus}</small>
        )}
        {import.meta.env?.DEV && (aforosFeatures.length > 0 || obrasFeatures.length > 0) && statsReceivedVsVisible && (
          <div className="rounded-lg border px-3 py-2 text-xs shadow border-green-400 bg-green-50 text-green-800">
            <strong>Front vs API stats: OK</strong>
            <p className="mt-1 text-[10px]">received (API) vs visible (tras búsqueda)</p>
            <pre className="mt-1 text-[10px] overflow-auto max-h-20">{JSON.stringify(statsReceivedVsVisible, null, 2)}</pre>
            {searchText?.trim() && (
              <p className="mt-1 text-slate-600">Filtros activos: {totalVisible} de {totalNodesForPanel} visibles.</p>
            )}
          </div>
        )}
        <NodeFiltersPanel
          layerKeys={layerKeysForUI}
          activeLayerFilters={activeLayerFilters}
          onLayerFilterChange={setActiveLayerFilters}
          nodesByLayer={nodesByLayer}
          searchValue={searchText}
          onSearchChange={setSearchText}
          temporalMode={temporalMode}
          onTemporalModeChange={setTemporalMode}
          eventosTimeFilter={eventosTimeFilter}
          onEventosTimeFilterChange={setEventosTimeFilter}
          eventosUpcomingCount={eventosUpcomingCount}
          obrasOnlyWithGeometry={obrasOnlyWithGeometry}
          onObrasOnlyWithGeometryChange={setObrasOnlyWithGeometry}
          obrasOnlyEnriched={obrasOnlyEnriched}
          onObrasOnlyEnrichedChange={setObrasOnlyEnriched}
          obrasShowIncomplete={obrasShowIncomplete}
          onObrasShowIncompleteChange={setObrasShowIncomplete}
          onSearchSelect={(feature) => {
            const c = feature?.properties?.centroid?.coordinates ?? feature?.geometry?.coordinates;
            if (c && c[0] != null && c[1] != null) setFlyToCenter([c[1], c[0]]);
            setSelectedFeature(feature);
          }}
        />
        <button
          type="button"
          onClick={() => setShowRulesAdmin(true)}
          className="text-xs text-slate-500 hover:text-panorama-sky px-2 py-1"
        >
          Reglas de nodos
        </button>
        {aforosFeatures.length > 0 && (
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'actual' ? 'prediccion' : 'actual'))}
            className={`text-xs px-2 py-1 rounded ${viewMode === 'prediccion' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:text-panorama-sky'}`}
          >
            {viewMode === 'actual' ? 'Vista predicción' : 'Vista actual'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowPredictorQuality(true)}
          className="text-xs text-slate-500 hover:text-panorama-sky px-2 py-1"
        >
          Calidad del predictor
        </button>
      </div>
      {predictionWarning && (
        <div className="absolute top-20 left-4 z-[1001] px-3 py-2 rounded-lg shadow bg-amber-50 border border-amber-200 text-amber-800 text-xs max-w-[280px]">
          {predictionWarning}
        </div>
      )}
      {predictionLoading && viewMode === 'prediccion' && (
        <div className="absolute top-20 left-4 z-[1001] px-3 py-2 rounded-lg shadow bg-slate-100 text-slate-700 text-xs">
          Cargando predicciones…
        </div>
      )}
      {showPredictorQuality && (
        <div className="absolute top-20 right-4 z-[1002]">
          <PredictorQualityPanel onClose={() => setShowPredictorQuality(false)} />
        </div>
      )}
      {showRulesAdmin && (
        <div
          className="absolute inset-0 z-[1003] flex items-center justify-center bg-black/20"
          onClick={() => setShowRulesAdmin(false)}
          role="presentation"
        >
          <div onClick={(e) => e.stopPropagation()}>
            <NodosRulesAdmin onClose={() => setShowRulesAdmin(false)} />
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-[1001] flex flex-col gap-2">
        {trafficError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg shadow bg-amber-50 border border-amber-200 text-amber-800 text-sm max-w-[280px]">
            <span>{trafficError}</span>
            <button type="button" onClick={() => setTrafficError(null)} className="ml-1">×</button>
          </div>
        )}
        <button type="button" onClick={() => { setTrafficError(null); setShowGoogleTraffic((v) => !v); }} className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow border text-sm ${showGoogleTraffic ? 'bg-amber-500 text-white' : 'bg-white text-slate-700 border-slate-200'}`}>
          {showGoogleTraffic ? 'Ocultar tráfico' : 'Tráfico en vivo'}
        </button>
      </div>

      <div className="absolute bottom-4 right-4 z-[1001] bg-white/90 px-3 py-2 rounded-lg shadow text-xs text-slate-600">
        Marcadores visibles: {totalVisible}
      </div>

      {dimIdFromUrl && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1002]">
          <div className="pointer-events-auto bg-white/95 backdrop-blur rounded-2xl shadow-2xl w-[min(28rem,92vw)] max-h-[75vh] overflow-hidden border border-slate-200 flex flex-col">
            <div className="bg-gradient-to-r from-panorama-sky to-panorama-sky-600 px-4 py-3 text-white flex items-center justify-between">
              <span className="font-semibold text-sm">Resumen del aforo (dimId {dimIdFromUrl})</span>
              <button
                type="button"
                onClick={() => navigate('/aforos')}
                className="text-white hover:bg-white/20 rounded-full p-1 transition-colors"
                aria-label="Cerrar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <ResumenAnalisisAforo
                analisis={standaloneAnalisis}
                loadingAnalisis={standaloneLoading}
                analisisError={standaloneError}
                analisisQuality={standaloneQuality}
                title="Análisis del aforo"
              />
            </div>
          </div>
        </div>
      )}

      {selectedFeature?.properties?.layerType === 'AFOROS' && (
        <PanelAforoDrawer feature={selectedFeature} onClose={onClosePopup} />
      )}
      {selectedFeature && selectedFeature?.properties?.layerType !== 'AFOROS' && (() => {
        const layerType = selectedFeature?.properties?.layerType;
        const common = { feature: selectedFeature, onClose: onClosePopup };
        if (layerType === 'OBRAS') return <PopupObras {...common} detail={obraDetail} />;
        if (layerType === 'EVENTOS') return <PopupEventos {...common} />;
        if (layerType === 'MANIFESTACIONES') return <PopupManifestaciones {...common} />;
        if (layerType === 'CONCIERTOS') return <PopupConciertos {...common} />;
        if (layerType === 'LUGARES') return <PopupLugares {...common} />;
        const nombre = selectedFeature?.properties?.nombre ?? selectedFeature?.properties?.titulo ?? selectedFeature?.properties?.node_id_externo ?? layerType ?? 'Nodo';
        return (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1002]">
            <div className="pointer-events-auto bg-white/95 backdrop-blur rounded-2xl shadow-2xl w-[min(28rem,92vw)] max-h-[75vh] overflow-hidden border border-slate-200 flex flex-col">
              <div className="bg-slate-700 px-4 py-3 text-white flex items-center justify-between">
                <h3 className="font-semibold text-sm">{nombre}</h3>
                <button type="button" onClick={common.onClose} className="text-white hover:bg-white/20 rounded-full p-1" aria-label="Cerrar">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-4 text-sm text-slate-600">{layerType ?? 'Nodo'}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default AforosMap;
