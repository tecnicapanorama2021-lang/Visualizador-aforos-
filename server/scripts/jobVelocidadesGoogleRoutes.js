/**
 * Job: actualiza velocidades_por_nodo.json con velocidades estimadas desde Google Directions API.
 * Usa pares origen-destino derivados de nodos_unificados; asocia cada step a el nodo más cercano.
 *
 * Uso: node server/scripts/jobVelocidadesGoogleRoutes.js
 * Opciones: --output=path (velocidades JSON), --pairs=N (máx pares, default 10), --limit-nodes=N (nodos a usar para pares)
 *
 * Requiere: GOOGLE_MAPS_API_KEY con Directions API activada.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_KEY;
const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const VELOCIDADES_PATH_ARG = process.argv.find(a => a.startsWith('--output='));
const VELOCIDADES_PATH = VELOCIDADES_PATH_ARG
  ? path.resolve(process.cwd(), VELOCIDADES_PATH_ARG.split('=')[1])
  : path.join(__dirname, '../../public/data/velocidades_por_nodo.json');
const NODOS_PATH = path.join(__dirname, '../../public/data/nodos_unificados.json');
const PAIRS_ARG = process.argv.find(a => a.startsWith('--pairs='));
const MAX_PAIRS = PAIRS_ARG ? parseInt(PAIRS_ARG.split('=')[1], 10) : 10;
const LIMIT_NODES_ARG = process.argv.find(a => a.startsWith('--limit-nodes='));
const LIMIT_NODES = LIMIT_NODES_ARG ? parseInt(LIMIT_NODES_ARG.split('=')[1], 10) : 24;
const MAX_DISTANCE_KM = 0.5;
const DELAY_MS = 500;

function loadNodosUnificados() {
  try {
    const raw = fs.readFileSync(NODOS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return data.features || [];
  } catch {
    return [];
  }
}

function getCoords(feature) {
  const coords = feature.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    return { lng: coords[0], lat: coords[1] };
  }
  return null;
}

function getNodeId(feature) {
  return String(feature.properties?.id ?? feature.properties?.raw_data?.siteid ?? feature.attributes?.id ?? '');
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function nearestNodeId(lat, lng, nodes) {
  if (!nodes || nodes.length === 0) return null;
  let best = null;
  let bestKm = MAX_DISTANCE_KM;
  for (const f of nodes) {
    const c = getCoords(f);
    if (!c) continue;
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = getNodeId(f);
    }
  }
  return best || null;
}

function buildPairs(nodes) {
  const pairs = [];
  const limited = nodes.slice(0, LIMIT_NODES);
  for (let i = 0; i < limited.length - 1 && pairs.length < MAX_PAIRS; i += 2) {
    const a = getCoords(limited[i]);
    const b = getCoords(limited[i + 1]);
    if (a && b) pairs.push({ origin: `${a.lat},${a.lng}`, destination: `${b.lat},${b.lng}` });
  }
  return pairs;
}

async function getDirections(origin, destination, departureTime) {
  const res = await axios.get(DIRECTIONS_URL, {
    params: {
      origin,
      destination,
      departure_time: departureTime,
      traffic_model: 'best_guess',
      mode: 'driving',
      key: GOOGLE_KEY
    },
    timeout: 15000
  });
  return res.data;
}

function extractStepsWithSpeed(data) {
  const points = [];
  const routes = data.routes || [];
  for (const route of routes) {
    const legs = route.legs || [];
    for (const leg of legs) {
      const steps = leg.steps || [];
      for (const step of steps) {
        const durationSec = (step.duration_in_traffic && step.duration_in_traffic.value) || (step.duration && step.duration.value) || 0;
        const distanceM = (step.distance && step.distance.value) || 0;
        if (durationSec <= 0) continue;
        const speedKmh = (distanceM / 1000) / (durationSec / 3600);
        const loc = step.start_location || step.end_location;
        if (loc && loc.lat != null && loc.lng != null) {
          points.push({ lat: loc.lat, lng: loc.lng, velocidad_kmh: Math.round(speedKmh * 10) / 10 });
        }
      }
    }
  }
  return points;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function main() {
  if (!GOOGLE_KEY) {
    console.warn('GOOGLE_MAPS_API_KEY (o VITE_GOOGLE_MAPS_KEY) no configurada; no se ejecutan llamadas a Directions API.');
    process.exit(0);
  }

  (async () => {
    console.log('Job Velocidades Google Routes: iniciando...');
    const nodes = loadNodosUnificados();
    const pairs = buildPairs(nodes);
    console.log(`Nodos: ${nodes.length}, pares a consultar: ${pairs.length}`);

    const ts = new Date().toISOString();
    const departureTime = Math.floor(Date.now() / 1000);
    const newByNode = {};

    for (const { origin, destination } of pairs) {
      try {
        const data = await getDirections(origin, destination, departureTime);
        if (data.status !== 'OK') {
          console.warn(`Directions status: ${data.status}`);
          await sleep(DELAY_MS);
          continue;
        }
        const points = extractStepsWithSpeed(data);
        for (const p of points) {
          const nodeId = nearestNodeId(p.lat, p.lng, nodes);
          if (nodeId) {
            if (!newByNode[nodeId]) newByNode[nodeId] = [];
            newByNode[nodeId].push({ ts, velocidad_kmh: p.velocidad_kmh, origen: 'google_routes' });
          }
        }
      } catch (err) {
        console.warn('Error en par:', err.message);
      }
      await sleep(DELAY_MS);
    }

    let existing = { metadata: { version: '1.0' }, by_node: {} };
    try {
      const raw = fs.readFileSync(VELOCIDADES_PATH, 'utf8');
      existing = JSON.parse(raw);
    } catch {}

    const by_node = { ...(existing.by_node || {}) };
    for (const [nodeId, list] of Object.entries(newByNode)) {
      const prev = Array.isArray(by_node[nodeId]) ? by_node[nodeId] : [];
      by_node[nodeId] = [...prev, ...list];
    }

    const maxPointsPerNode = 5000;
    for (const nodeId of Object.keys(by_node)) {
      const arr = by_node[nodeId];
      if (arr.length > maxPointsPerNode) {
        by_node[nodeId] = arr.slice(-maxPointsPerNode);
      }
    }

    const output = {
      metadata: {
        ...existing.metadata,
        version: '1.0',
        updated_at: ts,
        description: 'Velocidades por nodo/segmento desde Google Routes, SIMUR o Bitcarrier'
      },
      by_node
    };

    fs.mkdirSync(path.dirname(VELOCIDADES_PATH), { recursive: true });
    fs.writeFileSync(VELOCIDADES_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Velocidades guardadas: ${VELOCIDADES_PATH}`);
  })().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

main();
