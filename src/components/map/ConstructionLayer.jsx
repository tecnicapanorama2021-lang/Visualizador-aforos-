import React from 'react';
/**
 * DEPRECATED – Capa de obras desde datos-unificados.
 * Las obras se muestran desde /api/obras/nodos (incidentes) en AforosMap. Este componente es stub y no se usa.
 */
const ConstructionLayer = ({ visible, onError }) => {
  React.useEffect(() => {
    if (visible && onError) onError('Capa de obras IDU no disponible');
  }, [visible, onError]);
  return null;
};
export default ConstructionLayer;
