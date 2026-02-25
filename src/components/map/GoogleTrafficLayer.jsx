import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-api-traffic';
const POLL_TIMEOUT_MS = 10000;

/**
 * Carga el script de Google Maps JS API y resuelve cuando window.google.maps está disponible.
 * Reutiliza el script si ya existe (polling con timeout 10s). Rechaza si no hay key o si el script falla.
 */
function loadGoogleMapsScript(key) {
  return new Promise((resolve, reject) => {
    const k = (key || '').trim();
    if (!k) {
      reject(new Error('VITE_GOOGLE_MAPS_KEY no configurada'));
      return;
    }
    if (typeof window !== 'undefined' && window.google?.maps?.Map) {
      resolve();
      return;
    }
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (existing) {
      const start = Date.now();
      const check = () => {
        if (window.google?.maps?.Map) {
          resolve();
          return;
        }
        if (Date.now() - start >= POLL_TIMEOUT_MS) {
          reject(
            new Error(
              'Google Maps API no estuvo disponible en 10s (script existente). Revisa key o recarga.'
            )
          );
          return;
        }
        setTimeout(check, 50);
      };
      check();
      return;
    }
    const callbackName = '__googleMapsTrafficLoaded_' + Date.now();
    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(k)}&callback=${callbackName}&loading=async`;
    script.async = true;
    script.defer = true;

    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };
    script.onerror = () => {
      delete window[callbackName];
      reject(
        new Error(
          'Error cargando Google Maps API. Revisa VITE_GOOGLE_MAPS_KEY, facturación o red.'
        )
      );
    };
    document.head.appendChild(script);
  });
}

/**
 * Capa de tráfico en vivo (Google). Carga la API solo cuando active=true y hay key.
 * Usa L.gridLayer.googleMutant (registrado en main.jsx) + addGoogleLayer('TrafficLayer').
 */
const GoogleTrafficLayer = ({ active, onError }) => {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!active) {
      if (layerRef.current && map) {
        try {
          if (layerRef.current.removeGoogleLayer) {
            layerRef.current.removeGoogleLayer('TrafficLayer');
          }
          map.removeLayer(layerRef.current);
        } catch (_) {}
        layerRef.current = null;
      }
      return;
    }

    const key = import.meta.env.VITE_GOOGLE_MAPS_KEY?.trim();
    if (!key) {
      const msg = 'Configura VITE_GOOGLE_MAPS_KEY en .env para tráfico en vivo';
      console.error('[GoogleTrafficLayer]', msg);
      onError?.(msg);
      return;
    }

    let cancelled = false;

    loadGoogleMapsScript(key)
      .then(() => {
        if (cancelled || !map) return;
        if (!L.gridLayer?.googleMutant) {
          const msg = 'Plugin Google Mutant no disponible (L.gridLayer.googleMutant)';
          console.error('[GoogleTrafficLayer]', msg);
          onError?.(msg);
          return;
        }
        if (layerRef.current && map) {
          try {
            if (layerRef.current.removeGoogleLayer) {
              layerRef.current.removeGoogleLayer('TrafficLayer');
            }
            map.removeLayer(layerRef.current);
          } catch (_) {}
          layerRef.current = null;
        }
        const options = { type: 'roadmap', pane: 'tilePane' };
        const mutant = L.gridLayer.googleMutant(options);
        if (mutant.setZIndex && typeof mutant.setZIndex === 'function') {
          mutant.setZIndex(50);
        }
        mutant.addTo(map);
        mutant.addGoogleLayer('TrafficLayer');
        layerRef.current = mutant;
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err?.message || 'Tráfico en vivo no disponible';
          console.error('[GoogleTrafficLayer]', message);
          onError?.(message);
        }
      });

    return () => {
      cancelled = true;
      if (layerRef.current && map) {
        try {
          if (layerRef.current.removeGoogleLayer) {
            layerRef.current.removeGoogleLayer('TrafficLayer');
          }
          map.removeLayer(layerRef.current);
        } catch (_) {}
        layerRef.current = null;
      }
    };
  }, [active, map, onError]);

  return null;
};

export default GoogleTrafficLayer;
