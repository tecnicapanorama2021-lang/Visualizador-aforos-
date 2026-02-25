/**
 * ETL Fase 2: ia_historial.json → conteos_resumen (con streaming).
 * No carga el archivo completo en memoria; procesa nodo por nodo.
 * Idempotente: UPSERT por (estudio_id, sentido, intervalo_ini).
 *
 * Uso: node server/scripts/etl_conteos_from_historial.js [--path=public/data/ia_historial.json]
 * Requiere: DATABASE_URL (o PGHOST, PGDATABASE, PGUSER, PGPASSWORD)
 * Requiere: ETL Fase 1 ya ejecutado (nodos y estudios en BD).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { query, closePool } from '../db/client.js';
import { mapClassesToVolumes } from '../utils/classToVolumeMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

const DEFAULT_HISTORIAL_PATH = path.join(PROJECT_ROOT, 'public', 'data', 'ia_historial.json');

const BATCH_SIZE = 200;
const ETL_MAP_DEBUG = process.env.ETL_MAP_DEBUG === '1' || process.env.ETL_MAP_DEBUG === 'true';

/**
 * Parsea "6:00 - 6:15" o "6:00" a { inicio, fin } en minutos desde medianoche.
 */
function parseHoraRango(horaRango, fechaStr) {
  if (!horaRango || typeof horaRango !== 'string') return null;
  const s = horaRango.trim();
  const part = s.includes(' - ') ? s.split(' - ').map((p) => p.trim()) : [s, s];
  const parseTime = (t) => {
    if (t == null) return null;
    const s = String(t).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const n = parseInt(s.replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n >= 0 && n < 2400) return Math.floor(n / 100) * 60 + (n % 100);
    return null;
  };
  const ini = parseTime(part[0]);
  let fin = parseTime(part[1] || part[0]);
  if (ini == null) return null;
  if (fin == null) fin = ini + 15;
  if (fin === ini) fin = ini + 15;
  const baseDate = fechaStr ? new Date(fechaStr + 'T00:00:00Z') : new Date(0, 0, 1);
  return {
    intervalo_ini: new Date(baseDate.getTime() + ini * 60 * 1000),
    intervalo_fin: new Date(baseDate.getTime() + fin * 60 * 1000),
  };
}

/**
 * Stream que lee ia_historial.json y emite cada nodo como { nodeId, nodeData }.
 * No carga el objeto "nodes" completo en memoria.
 */
function createNodeStream(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  let buffer = '';
  let state = 'SEEK_NODES'; // SEEK_NODES | IN_NODES | IN_NODE_VALUE
  let depth = 0;
  let inString = false;
  let escape = false;
  let nodeKey = null;
  let valueStart = -1;
  let i = 0;

  const target = '"nodes":';
  const keyRegex = /"(\d+)":\s*\{/g;

  const readable = new Readable({
    objectMode: true,
    read() {},
  });

  function emitNode(nodeId, jsonStr) {
    try {
      const nodeData = JSON.parse(jsonStr);
      readable.push({ nodeId, nodeData });
    } catch (e) {
      readable.emit('error', new Error(`JSON parse nodo ${nodeId}: ${e.message}`));
    }
  }

  function processBuffer() {
    while (i < buffer.length) {
      const c = buffer[i];

      if (state === 'SEEK_NODES') {
        const idx = buffer.indexOf(target, i);
        if (idx === -1) {
          i = Math.max(0, buffer.length - target.length - 1);
          return;
        }
        i = idx + target.length;
        while (i < buffer.length && /[\s,]/.test(buffer[i])) i++;
        if (i < buffer.length && buffer[i] === '{') {
          state = 'IN_NODES';
          depth = 1;
          i++;
        }
        continue;
      }

      if (state === 'IN_NODES') {
        if (inString) {
          if (escape) escape = false;
          else if (c === '\\') escape = true;
          else if (c === '"') inString = false;
          i++;
          continue;
        }
        if (c === '"') {
          const rest = buffer.slice(i);
          keyRegex.lastIndex = 0;
          const match = keyRegex.exec(rest);
          if (match) {
            const keyStart = i + match.index;
            const keyEnd = keyStart + match[0].length;
            nodeKey = match[1];
            valueStart = keyEnd - 1;
            keyRegex.lastIndex = 0;
            state = 'IN_NODE_VALUE';
            depth = 1;
            i = keyEnd;
            continue;
          }
          inString = true;
          i++;
          continue;
        }
        if (c === '{') {
          depth++;
          i++;
          continue;
        }
        if (c === '}') {
          depth--;
          if (depth === 0) {
            state = 'SEEK_NODES';
            i++;
            return;
          }
          i++;
          continue;
        }
        if (/[\s,]/.test(c)) {
          i++;
          continue;
        }
        i++;
        continue;
      }

      if (state === 'IN_NODE_VALUE') {
        if (inString) {
          if (escape) escape = false;
          else if (c === '\\') escape = true;
          else if (c === '"') inString = false;
          i++;
          continue;
        }
        if (c === '"') {
          inString = true;
          i++;
          continue;
        }
        if (c === '{') {
          depth++;
          i++;
          continue;
        }
        if (c === '}') {
          depth--;
          if (depth === 0) {
            const jsonStr = buffer.slice(valueStart, i + 1);
            emitNode(nodeKey, jsonStr);
            nodeKey = null;
            valueStart = -1;
            state = 'IN_NODES';
            depth = 1;
            i++;
            return;
          }
          i++;
          continue;
        }
        i++;
      }
    }
  }

  stream.on('data', (chunk) => {
    buffer += chunk;
    processBuffer();
  });

  stream.on('end', () => {
    readable.push(null);
  });

  stream.on('error', (err) => readable.emit('error', err));

  return readable;
}

async function processNode(nodeId, nodeData, stats) {
  const historico = nodeData.historico || [];
  if (historico.length === 0) return;

  const nodoRes = await query('SELECT id FROM nodos WHERE node_id_externo = $1', [nodeId]);
  const nodoRow = nodoRes.rows[0];
  if (!nodoRow) return;
  const nodoPk = nodoRow.id;

  for (const h of historico) {
    const fileIdDim = h.file_id != null ? String(h.file_id) : null;
    const estudioRes = await query(
      'SELECT id FROM estudios WHERE nodo_id = $1 AND file_id_dim = $2',
      [nodoPk, fileIdDim]
    );
    const estudioRow = estudioRes.rows[0];
    if (!estudioRow) continue;

    const estudioId = estudioRow.id;
    const fechaStr = h.fecha || (h.fecha_fin && h.fecha_fin.split('T')[0]) || null;
    const volData = (h.analisis && h.analisis.vol_data_completo) || [];
    const distribucion = (h.analisis && h.analisis.distribucion_hora_pico) || [];

    const rowsToUpsert = [];

    for (const row of volData) {
      const sentido = row.sentido || row.sentidoDisplay || 'N/A';
      const parsed = parseHoraRango(row.horaRango || row.hora_rango, fechaStr);
      if (!parsed) continue;
      const vols = mapClassesToVolumes(row.classes, ETL_MAP_DEBUG);
      let volTotal = row.total != null ? (typeof row.total === 'number' ? row.total : parseFloat(row.total)) : (vols.vol_autos + vols.vol_motos + vols.vol_buses + vols.vol_pesados + vols.vol_bicis + vols.vol_otros);
      if (!Number.isInteger(volTotal)) volTotal = Math.round(volTotal);
      rowsToUpsert.push({
        estudio_id: estudioId,
        sentido,
        intervalo_ini: parsed.intervalo_ini,
        intervalo_fin: parsed.intervalo_fin,
        vol_total: volTotal,
        vol_autos: Math.round(vols.vol_autos) || 0,
        vol_motos: Math.round(vols.vol_motos) || 0,
        vol_buses: Math.round(vols.vol_buses) || 0,
        vol_pesados: Math.round(vols.vol_pesados) || 0,
        vol_bicis: Math.round(vols.vol_bicis) || 0,
        vol_otros: Math.round(vols.vol_otros) || 0,
      });
    }

    if (rowsToUpsert.length === 0 && distribucion.length > 0) {
      for (const d of distribucion) {
        const sentido = d.sentido || 'N/A';
        let volTotal = d.total != null ? (typeof d.total === 'number' ? d.total : parseFloat(d.total)) : 0;
        if (!Number.isInteger(volTotal)) volTotal = Math.round(volTotal);
        const vols = mapClassesToVolumes(d, ETL_MAP_DEBUG);
        if (volTotal === 0 && Object.values(vols).every((v) => v === 0)) continue;
        const intervalo_ini = fechaStr ? new Date(fechaStr + 'T00:00:00Z') : new Date(0, 0, 1);
        const intervalo_fin = new Date(intervalo_ini.getTime() + 60 * 60 * 1000);
        rowsToUpsert.push({
          estudio_id: estudioId,
          sentido,
          intervalo_ini,
          intervalo_fin,
          vol_total: volTotal,
          vol_autos: Math.round(vols.vol_autos) || 0,
          vol_motos: Math.round(vols.vol_motos) || 0,
          vol_buses: Math.round(vols.vol_buses) || 0,
          vol_pesados: Math.round(vols.vol_pesados) || 0,
          vol_bicis: Math.round(vols.vol_bicis) || 0,
          vol_otros: Math.round(vols.vol_otros) || 0,
        });
      }
    }

    for (const r of rowsToUpsert) {
      try {
        await query(
          `INSERT INTO conteos_resumen (estudio_id, sentido, intervalo_ini, intervalo_fin, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (estudio_id, sentido, intervalo_ini) DO UPDATE SET
             intervalo_fin = EXCLUDED.intervalo_fin,
             vol_total = EXCLUDED.vol_total,
             vol_autos = EXCLUDED.vol_autos,
             vol_motos = EXCLUDED.vol_motos,
             vol_buses = EXCLUDED.vol_buses,
             vol_pesados = EXCLUDED.vol_pesados,
             vol_bicis = EXCLUDED.vol_bicis,
             vol_otros = EXCLUDED.vol_otros`,
          [
            r.estudio_id,
            r.sentido,
            r.intervalo_ini,
            r.intervalo_fin,
            r.vol_total,
            r.vol_autos,
            r.vol_motos,
            r.vol_buses,
            r.vol_pesados,
            r.vol_bicis,
            r.vol_otros,
          ]
        );
        stats.conteosUpsert++;
      } catch (err) {
        stats.errors++;
        if (stats.errors <= 5) console.error(`  [ETL] Error conteo estudio ${estudioId}:`, err.message);
      }
    }
  }
}

function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

/**
 * Test rápido de mapClassesToVolumes (ejecutar con: node server/scripts/etl_conteos_from_historial.js --test)
 * Input de ejemplo; output esperado: vol_autos=100, vol_buses=20, vol_motos=30, vol_pesados=10, vol_bicis=5, vol_otros=3
 */
function runMapClassesTest() {
  const input = {
    AUTOMOVIL: 100,
    BUSETA: 20,
    MOTOS: 30,
    CAMION: 10,
    BICICLETA: 5,
    DESCONOCIDO: 3,
  };
  const out = mapClassesToVolumes(input, true);
  console.log('[ETL MAP TEST] Input:', input);
  console.log('[ETL MAP TEST] Output:', out);
  const ok =
    out.vol_autos === 100 &&
    out.vol_buses === 20 &&
    out.vol_motos === 30 &&
    out.vol_pesados === 10 &&
    out.vol_bicis === 5 &&
    out.vol_otros === 3;
  console.log(ok ? '[ETL MAP TEST] OK' : '[ETL MAP TEST] FAIL');
  process.exit(ok ? 0 : 1);
}

async function main() {
  loadEnv();

  if (process.argv.includes('--test')) {
    runMapClassesTest();
    return;
  }

  const pathArg = process.argv.find((a) => a.startsWith('--path='));
  const historialPath = pathArg ? path.resolve(process.cwd(), pathArg.split('=')[1]) : DEFAULT_HISTORIAL_PATH;

  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ETL] Configura DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.exit(1);
  }

  if (!fs.existsSync(historialPath)) {
    console.error('[ETL] No encontrado:', historialPath);
    process.exit(1);
  }

  console.log('[ETL Fase 2] Leyendo ia_historial.json por streaming:', historialPath);
  const nodeStream = createNodeStream(historialPath);

  const stats = { nodesProcessed: 0, conteosUpsert: 0, errors: 0 };

  for await (const { nodeId, nodeData } of nodeStream) {
    await processNode(nodeId, nodeData, stats);
    stats.nodesProcessed++;
    if (stats.nodesProcessed % 50 === 0) {
      console.log(`  Nodos procesados: ${stats.nodesProcessed}, conteos upsert: ${stats.conteosUpsert}`);
    }
  }

  console.log('[ETL Fase 2] Resumen:');
  console.log('  Nodos procesados:', stats.nodesProcessed);
  console.log('  Conteos insertados/actualizados:', stats.conteosUpsert);
  if (stats.errors > 0) console.log('  Errores:', stats.errors);

  await closePool();
}

main().catch((err) => {
  console.error('[ETL Fase 2] Error:', err);
  process.exit(1);
});
