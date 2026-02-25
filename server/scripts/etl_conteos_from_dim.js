/**
 * ETL: PostgreSQL (estudios) + Excel DIM → conteos_resumen.
 * Fuente de verdad: BD + DIM (no ia_historial.json).
 * Idempotente: UPSERT por (estudio_id, sentido, intervalo_ini, intervalo_fin).
 *
 * Uso:
 *   node server/scripts/etl_conteos_from_dim.js [--limit=N] [--studyId=ID] [--dimId=ID] [--dry-run] [--write] [--upsert] [--since=YYYY-MM-DD]
 * Ejemplos:
 *   node server/scripts/etl_conteos_from_dim.js --limit=10
 *   node server/scripts/etl_conteos_from_dim.js --studyId=4266 --dry-run
 *   node server/scripts/etl_conteos_from_dim.js --studyId=4266 --write
 *   node server/scripts/etl_conteos_from_dim.js --dimId=388 --write
 *
 * Requiere: DATABASE_URL (o PGHOST, PGDATABASE, PGUSER, PGPASSWORD)
 * Migración: 016_conteos_resumen_unique_ini_fin.sql (UNIQUE estudio_id, sentido, intervalo_ini, intervalo_fin).
 * Tablas: estudios (id, nodo_id, file_id_dim, archivo_fuente_id, fecha_inicio), conteos_resumen
 * Para descarga DIM se usa archivo_fuente_id (id numérico DIM). file_id_dim es código externo (ej. ext-388-2026-02-19).
 *
 * Debug: ETL_MAP_DEBUG=1 imprime clases normalizadas que caen en vol_otros por estudio (para ampliar CLASS_TO_COL).
 *
 * Verificación SQL antes/después (reemplaza 123 por estudio_id):
 *   -- Antes:
 *   SELECT estudio_id, sentido, intervalo_ini, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros
 *   FROM conteos_resumen WHERE estudio_id = 123 ORDER BY sentido, intervalo_ini;
 *   -- Ejecutar ETL: node server/scripts/etl_conteos_from_dim.js --studyId=123
 *   -- Después: repetir la misma SELECT y comparar (vol_otros debería bajar si CLASS_TO_COL mapea más clases).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';
import { getExcelBufferForStudy } from '../utils/dimExcel.js';
import { analizarExcelBuffer } from '../utils/aforoAnalisis.js';
import { mapClassesToVolumes, normalizeClassKey, CLASS_TO_COL } from '../utils/classToVolumeMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

const ETL_MAP_DEBUG = process.env.ETL_MAP_DEBUG === '1' || process.env.ETL_MAP_DEBUG === 'true';

/**
 * Parsea "6:00 - 6:15" o "6:00" a { intervalo_ini, intervalo_fin } (Date en base a fechaStr YYYY-MM-DD).
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

function loadEnv() {
  const paths = [
    path.join(PROJECT_ROOT, '.env'),
    path.join(PROJECT_ROOT, 'server', '.env'),
  ];
  for (const envPath of paths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  }
}

function parseArgs() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const studyIdArg = process.argv.find((a) => a.startsWith('--studyId='));
  const dimIdArg = process.argv.find((a) => a.startsWith('--dimId='));
  const sinceArg = process.argv.find((a) => a.startsWith('--since='));
  const write = process.argv.includes('--write');
  const dryRun = process.argv.includes('--dry-run') || !write;
  const upsert = !process.argv.includes('--no-upsert');
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
  const studyId = studyIdArg ? studyIdArg.split('=')[1].trim() : null;
  const dimId = dimIdArg ? dimIdArg.split('=')[1].trim() : null;
  const since = sinceArg ? sinceArg.split('=')[1].trim() : null;
  return {
    limit: Number.isFinite(limit) ? limit : null,
    studyId: studyId || null,
    dimId: dimId || null,
    since: since || null,
    dryRun,
    write: !dryRun,
    upsert,
  };
}

async function main() {
  loadEnv();

  const hasUrl = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim().length > 0;
  if (!hasUrl && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[ETL DIM] DATABASE_URL no está definido. En PowerShell: $env:DATABASE_URL = \'postgresql://postgres:TU_PASSWORD@localhost:5432/aforos\' — o configura .env en la raíz con DATABASE_URL o PGHOST/PGDATABASE/PGUSER/PGPASSWORD.');
    process.exit(1);
  }

  const { limit, studyId, dimId, since, dryRun, write, upsert } = parseArgs();
  if (dryRun) console.log('[ETL DIM] --dry-run: no se escribe en BD');
  if (write) console.log('[ETL DIM] --write: se escribirá en BD (upsert=', upsert, ')');

  let sql = 'SELECT id, nodo_id, file_id_dim, archivo_fuente_id, fecha_inicio FROM estudios';
  const params = [];
  const conditions = [];
  let p = 0;
  if (studyId) {
    p++;
    conditions.push(`id = $${p}`);
    params.push(studyId);
  }
  if (dimId) {
    p++;
    conditions.push(`archivo_fuente_id = $${p}`);
    params.push(dimId);
  }
  if (since) {
    p++;
    conditions.push(`fecha_inicio >= $${p}::date`);
    params.push(since);
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY id';
  if (limit != null && !studyId && !dimId) {
    sql += ' LIMIT $' + (params.length + 1);
    params.push(limit);
  }

  const { rows: estudios } = await query(sql, params);
  if (estudios.length === 0) {
    console.log('[ETL DIM] No hay estudios que procesar.');
    await closePool();
    return;
  }

  console.log('[ETL DIM] Estudios a procesar:', estudios.length);

  const stats = { estudiosOk: 0, estudiosSkip: 0, estudiosErr: 0, conteosUpsert: 0, insertados: 0, actualizados: 0 };

  for (const estudio of estudios) {
    const { id: estudioId, file_id_dim, archivo_fuente_id, fecha_inicio } = estudio;
    const dimId = archivo_fuente_id;
    console.log('[ETL DIM]', 'estudio:', estudioId, 'file_id_dim:', file_id_dim, 'archivo_fuente_id:', archivo_fuente_id, 'dim_id usado:', dimId);
    if (dimId == null) {
      console.log(`  [ETL DIM] Estudio ${estudioId}: sin archivo_fuente_id, omitido`);
      stats.estudiosSkip++;
      continue;
    }

    const fechaStr = fecha_inicio ? new Date(fecha_inicio).toISOString().slice(0, 10) : null;

    try {
      const { buffer } = await getExcelBufferForStudy(dimId);
      let analisis;
      try {
        analisis = analizarExcelBuffer(buffer);
      } catch (err) {
        if (err?.quality?.noRowsReason && write) {
          console.error(`  [ETL DIM] Estudio ${estudioId}: análisis falló (noRowsReason). Abortando write.`, err.quality);
          process.exit(1);
        }
        throw err;
      }
      const volData = analisis?.vol_data_completo;
      if (!Array.isArray(volData) || volData.length === 0) {
        console.log(`  [ETL DIM] Estudio ${estudioId}: sin vol_data_completo, omitido`);
        stats.estudiosSkip++;
        continue;
      }

      if (write && analisis?.quality) {
        const q = analisis.quality;
        if (q.noRowsReason) {
          console.error(`  [ETL DIM] Estudio ${estudioId}: quality.noRowsReason presente. Abortando write.`, q.noRowsReason);
          process.exit(1);
        }
        if (q.headerConfidence === 'low' && (q.validRows ?? 0) === 0) {
          console.error(`  [ETL DIM] Estudio ${estudioId}: cabecera baja y sin filas válidas. Abortando write.`);
          process.exit(1);
        }
        const blockingPattern = /cabecera inválida|no se pudieron interpretar/i;
        const blockingWarnings = (q.warnings || []).filter((w) => blockingPattern.test(String(w)));
        if (blockingWarnings.length > 0) {
          console.error(`  [ETL DIM] Estudio ${estudioId}: advertencias que bloquean write (cabecera/filas no interpretadas):`, blockingWarnings);
          process.exit(1);
        }
        if (q.warnings?.length > 0) {
          console.warn(`  [ETL DIM] Estudio ${estudioId}: advertencias de calidad (suma/gaps/clases):`, q.warnings);
        }
      }

      const movementDetected = !!(analisis?.quality?.movementDetected);

      const rowsToUpsert = [];
      /** Solo en debug: clases normalizadas que caen en vol_otros → volumen total (para ampliar CLASS_TO_COL). */
      const unmappedByKey = new Map();
      let sampleClassKeysLogged = false;
      for (const row of volData) {
        const parsed = parseHoraRango(row.horaRango, fechaStr);
        if (!parsed) continue;
        if (estudioId === 4266 && !sampleClassKeysLogged) {
          console.log('[ETL DIM] sample class keys (estudio 4266):', Object.keys(row.classes || {}));
          sampleClassKeysLogged = true;
        }
        if (ETL_MAP_DEBUG && row.classes && typeof row.classes === 'object') {
          for (const [k, v] of Object.entries(row.classes)) {
            const key = normalizeClassKey(k);
            if (!CLASS_TO_COL[key]) {
              const n = typeof v === 'number' && Number.isFinite(v) ? v : parseInt(v, 10) || 0;
              unmappedByKey.set(key, (unmappedByKey.get(key) || 0) + n);
            }
          }
        }
        const vols = mapClassesToVolumes(row.classes, ETL_MAP_DEBUG);
        const volTotal = row.total != null ? Math.round(Number(row.total)) : 0;
        let intervalMinutes = null;
        if (row.interval_minutes != null && Number.isFinite(row.interval_minutes)) {
          intervalMinutes = row.interval_minutes;
        } else if (
          parsed.intervalo_ini &&
          parsed.intervalo_fin &&
          typeof parsed.intervalo_ini.getTime === 'function' &&
          typeof parsed.intervalo_fin.getTime === 'function' &&
          Number.isFinite(parsed.intervalo_ini.getTime()) &&
          Number.isFinite(parsed.intervalo_fin.getTime())
        ) {
          const diff = Math.round((parsed.intervalo_fin.getTime() - parsed.intervalo_ini.getTime()) / (60 * 1000));
          intervalMinutes = diff;
        }
        if (intervalMinutes != null && (intervalMinutes <= 0 || intervalMinutes > 240)) intervalMinutes = null;
        let intervaloFin = parsed.intervalo_fin;
        if (intervalMinutes != null && parsed.intervalo_ini) {
          intervaloFin = new Date(parsed.intervalo_ini.getTime() + intervalMinutes * 60 * 1000);
        }
        rowsToUpsert.push({
          estudio_id: estudioId,
          sentido: row.sentido || '',
          intervalo_ini: parsed.intervalo_ini,
          intervalo_fin: intervaloFin,
          interval_minutes: intervalMinutes,
          vol_total: volTotal,
          vol_autos: Math.round(vols.vol_autos) || 0,
          vol_motos: Math.round(vols.vol_motos) || 0,
          vol_buses: Math.round(vols.vol_buses) || 0,
          vol_pesados: Math.round(vols.vol_pesados) || 0,
          vol_bicis: Math.round(vols.vol_bicis) || 0,
          vol_otros: Math.round(vols.vol_otros) || 0,
        });
      }

      const nullIntervalCount = rowsToUpsert.filter((r) => r.interval_minutes == null).length;
      if (dryRun) {
        console.log(`  [ETL DIM] [dry-run] Estudio ${estudioId}: ${rowsToUpsert.length} filas que se insertarían (muestra 1):`, rowsToUpsert[0] || null);
        console.log(`  [ETL DIM] [dry-run] Filas con interval_minutes null: ${nullIntervalCount}`);
        if (nullIntervalCount > 0) {
          const ex = rowsToUpsert.find((r) => r.interval_minutes == null);
          console.log(`  [ETL DIM] [dry-run] Ejemplo fila con interval_minutes null:`, ex ? { sentido: ex.sentido, intervalo_ini: ex.intervalo_ini } : null);
        }
        stats.conteosUpsert += rowsToUpsert.length;
        stats.estudiosOk++;
        console.log(`  [ETL DIM] Estudio ${estudioId}: ${rowsToUpsert.length} conteos (dry-run)`);
        if (ETL_MAP_DEBUG && unmappedByKey.size > 0) {
          const obj = Object.fromEntries([...unmappedByKey.entries()].sort((a, b) => b[1] - a[1]));
          console.log(`  [ETL DIM DEBUG] estudio_id ${estudioId} — clases en vol_otros (normalized):`, JSON.stringify(obj));
        }
        continue;
      }

      let insertadosEst = 0;
      let actualizadosEst = 0;
      const rowKey = (row) => {
        const ini = row.intervalo_ini instanceof Date ? row.intervalo_ini.getTime() : new Date(row.intervalo_ini).getTime();
        const fin = row.intervalo_fin instanceof Date ? row.intervalo_fin.getTime() : new Date(row.intervalo_fin).getTime();
        return `${row.sentido}|${ini}|${fin}`;
      };
      if (upsert) {
        const existingRes = await query(
          'SELECT sentido, intervalo_ini, intervalo_fin FROM conteos_resumen WHERE estudio_id = $1',
          [estudioId]
        );
        const existingKeys = new Set(
          existingRes.rows.map((row) => {
            const ini = new Date(row.intervalo_ini).getTime();
            const fin = new Date(row.intervalo_fin).getTime();
            return `${row.sentido}|${ini}|${fin}`;
          })
        );
        for (const r of rowsToUpsert) {
          if (existingKeys.has(rowKey(r))) actualizadosEst++;
          else insertadosEst++;
        }
      } else {
        insertadosEst = rowsToUpsert.length;
      }

      for (const r of rowsToUpsert) {
        await query(
          `INSERT INTO conteos_resumen (estudio_id, sentido, intervalo_ini, intervalo_fin, interval_minutes, vol_total, vol_autos, vol_motos, vol_buses, vol_pesados, vol_bicis, vol_otros)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (estudio_id, sentido, intervalo_ini, intervalo_fin) DO UPDATE SET
             interval_minutes = EXCLUDED.interval_minutes,
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
            r.interval_minutes,
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
      }
      stats.insertados += insertadosEst;
      stats.actualizados += actualizadosEst;
      try {
        await query('UPDATE estudios SET has_movement_data = $1 WHERE id = $2', [movementDetected, estudioId]);
      } catch (err) {
        if (err.message && err.message.includes('has_movement_data')) {
          console.warn(`  [ETL DIM] Estudio ${estudioId}: columna has_movement_data no existe en estudios (se omitió el UPDATE).`);
        } else {
          throw err;
        }
      }
      stats.estudiosOk++;
      console.log(`  [ETL DIM] Estudio ${estudioId}: ${rowsToUpsert.length} conteos upsert (insertados: ${insertadosEst}, actualizados: ${actualizadosEst}), has_movement_data=${movementDetected}`);
      if (ETL_MAP_DEBUG && unmappedByKey.size > 0) {
        const obj = Object.fromEntries([...unmappedByKey.entries()].sort((a, b) => b[1] - a[1]));
        console.log(`  [ETL DIM DEBUG] estudio_id ${estudioId} — clases en vol_otros (normalized):`, JSON.stringify(obj));
      }
    } catch (err) {
      stats.estudiosErr++;
      console.error(`  [ETL DIM] Estudio ${estudioId}:`, err.message);
    }
  }

  console.log('[ETL DIM] Resumen:');
  console.log('  Estudios OK:', stats.estudiosOk);
  console.log('  Estudios omitidos:', stats.estudiosSkip);
  console.log('  Estudios error:', stats.estudiosErr);
  console.log('  Conteos upsert total:', stats.conteosUpsert);
  if (write) {
    console.log('  Insertados:', stats.insertados);
    console.log('  Actualizados:', stats.actualizados);
  }

  await closePool();
}

main().catch((err) => {
  const msg = err && err.message ? String(err.message) : '';
  if (msg.includes('password authentication failed') || msg.includes('auth') || msg.includes('ECONNREFUSED')) {
    console.error('[ETL DIM] Credenciales Postgres inválidas; revisa DATABASE_URL o .env (usuario, PGPASSWORD, host, puerto).');
  } else {
    console.error('[ETL DIM] Error:', err);
  }
  process.exit(1);
});