/**
 * Rutas ArcGIS: dominios (coded values) para decodificar campos en popup Obras.
 * GET /api/arcgis/domains?serviceUrl=...&layerId=0
 * Cache 24h en memoria en server/utils/arcgisDomains.js.
 */

import express from 'express';
import { getDomains, DEFAULT_OBRAS_MAPSERVER_URL } from '../server/utils/arcgisDomains.js';

const router = express.Router();

/**
 * GET /api/arcgis/domains
 * Query: serviceUrl (opcional, default Obras Distritales MapServer), layerId (opcional, default 0).
 * Respuesta: { fieldName: { code: name } }
 */
router.get('/domains', async (req, res) => {
  try {
    const serviceUrl = req.query.serviceUrl?.trim() || DEFAULT_OBRAS_MAPSERVER_URL;
    const layerId = Math.max(0, parseInt(req.query.layerId, 10) || 0);
    const domains = await getDomains(serviceUrl, layerId);
    return res.json(domains);
  } catch (err) {
    console.error('[ArcGIS] GET /domains:', err.message);
    return res.status(502).json({ error: 'No se pudieron obtener dominios ArcGIS', detail: err.message });
  }
});

export default router;
