import React from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../../constants/mapConfig';

const MapaPMT = () => (
  <div className="w-full h-full min-h-[400px] relative">
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
    </MapContainer>
    <div className="absolute top-4 left-4 z-[1000] bg-white/90 px-3 py-2 rounded-lg shadow text-sm text-slate-600">
      Mapa PMT — Herramienta de Planes de Manejo de Tránsito
    </div>
  </div>
);

export default MapaPMT;
