import React from 'react';
import SEO from '../components/common/SEO';
import Blog from '../components/blog/Blog';

const BlogPage = () => {
  return (
    <>
      <SEO 
        title="Noticias de Tránsito y Movilidad en Bogotá"
        description="Información actualizada sobre cierres viales, obras, normativas y planes de manejo de tránsito en Bogotá y Colombia."
        keywords="noticias tránsito, cierres viales Bogotá, obras viales, PMT Bogotá, movilidad Bogotá, Secretaría de Movilidad"
        url="https://www.panoramaingenieria.com/blog"
      />
      <Blog />
    </>
  );
};

export default BlogPage;
