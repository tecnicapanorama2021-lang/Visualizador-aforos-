import React from 'react';
import SEO from '../components/common/SEO';
import MapaPMT from '../components/map/MapaPMT';

const PMTPage = () => {
  return (
    <>
      <SEO 
        title="Herramienta PMT - Mapa Interactivo de Planes de Manejo de Tránsito"
        description="Herramienta interactiva para gestionar Planes de Manejo de Tránsito (PMT) en Bogotá. Visualiza cartografía, calzadas, andenes y agrega señales PMT en tiempo real."
        keywords="PMT, Mapa PMT, Planes de Manejo de Tránsito, Cartografía Bogotá, Malla Vial, Andenes, Señales PMT"
      />
      <MapaPMT />
    </>
  );
};

export default PMTPage;
