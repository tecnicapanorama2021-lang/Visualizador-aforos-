import React from 'react'
import ReactDOM from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import L from 'leaflet'
import App from './App.jsx'
import './index.css'

// Registrar Google Mutant sobre el mismo L que importamos (los componentes usan import L from 'leaflet')
import GoogleMutant from 'leaflet.gridlayer.googlemutant'
if (typeof L !== 'undefined') {
  L.GridLayer = L.GridLayer || {}
  L.GridLayer.GoogleMutant = GoogleMutant
  L.gridLayer = L.gridLayer || {}
  L.gridLayer.googleMutant = function (options) {
    return new L.GridLayer.GoogleMutant(options)
  }
}
if (typeof window !== 'undefined') {
  window.L = L
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
)
