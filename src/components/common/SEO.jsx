import React from 'react';
import { Helmet } from 'react-helmet-async';

/**
 * SEO: título, descripción y keywords para la página.
 * Usado por todas las páginas (HomePage, BlogPage, AforosPage, etc.).
 */
const SEO = ({ title, description, keywords, url }) => (
  <Helmet>
    {title && <title>{title}</title>}
    {description && <meta name="description" content={description} />}
    {keywords && <meta name="keywords" content={keywords} />}
    {url && <link rel="canonical" href={url} />}
  </Helmet>
);

export default SEO;
