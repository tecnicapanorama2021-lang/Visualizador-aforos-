import React from 'react';
import SEO from '../components/common/SEO';
import Home from '../components/home/Home';
import Tienda from '../components/home/Tienda';
import FAQ from '../components/home/FAQ';
import Contacto from '../components/home/Contacto';

const HomePage = () => {
  return (
    <>
      <SEO 
        title="Expertos en PMT y Consultoría Vial en Colombia"
        description="Expertos en Planes de Manejo de Tránsito (PMT) y Consultoría Vial en Colombia. PMT desde $1.300.000. Gestión ágil de movilidad y seguridad vial. Entrega en 48-72 horas con aprobación garantizada ante Secretaría de Movilidad."
        keywords="PMT, Planes de Manejo de Tránsito, Consultoría Vial, Colombia, Movilidad, Ingeniería Vial, PMT Bogotá, Secretaría de Movilidad, Planos Record, Cálculos Matemáticos"
      />
      <Home />
      <Tienda />
      <FAQ />
      <Contacto />
    </>
  );
};

export default HomePage;
