/**
 * ETL: construye node_legs y node_turns desde conteos_resumen + estudios + nodos.
 * Sin datos de movimiento (from_leg/to_leg reales), usa sentido como leg único y
 * crea turns placeholder (from_leg = to_leg = sentido, p_turn = 1, quality.low_confidence).
 *
 * Uso:
 *   node server/scripts/build_node_turns_baseline.js [--dry-run] [--node-id=N]
 * Requiere: migración 014 (node_legs, node_turns) y conteos_resumen con datos.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');

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

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  const nodeIdArg = process.argv.find(a => a.startsWith('--node-id='));
  const nodeId = nodeIdArg ? parseInt(nodeIdArg.split('=')[1], 10) : null;
  return { dryRun, nodeId: Number.isFinite(nodeId) ? nodeId : null };
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL && !process.env.PGHOST && !process.env.PGDATABASE) {
    console.error('[baseline] Configura DATABASE_URL o PGHOST/PGDATABASE');
    process.exit(1);
  }
  const { dryRun, nodeId } = parseArgs();
  if (dryRun) console.log('[baseline] --dry-run: no se escribe en BD');

  // Política quality_bad: excluir estudios con interval_minutes inconsistentes (varios valores distintos o mezcla NULL/no NULL).
  const { rows: diagRows } = await query(`
    SELECT estudio_id,
      COUNT(*) AS total_rows,
      COUNT(*) FILTER (WHERE interval_minutes IS NULL) AS null_count,
      COUNT(DISTINCT interval_minutes) FILTER (WHERE interval_minutes IS NOT NULL) AS distinct_count_non_null,
      MIN(interval_minutes) AS min_minutes,
      MAX(interval_minutes) AS max_minutes
    FROM conteos_resumen
    GROUP BY estudio_id
  `);
  const excludedStudies = [];
  for (const r of diagRows) {
    const hasNull = Number(r.null_count) > 0;
    const distinctNonNull = Number(r.distinct_count_non_null) || 0;
    if (hasNull && distinctNonNull > 0) {
      excludedStudies.push({ estudio_id: r.estudio_id, motivo: 'mezcla NULL y no NULL' });
    } else if (distinctNonNull > 1) {
      excludedStudies.push({ estudio_id: r.estudio_id, motivo: 'más de un valor distinto de interval_minutes' });
    }
  }
  const badEstudioIds = excludedStudies.map((x) => x.estudio_id);
  if (excludedStudies.length > 0) {
    console.log('[baseline] Estudios excluidos (quality_bad):', excludedStudies.map((x) => `${x.estudio_id} (${x.motivo})`).join(', '));
  }
  if (diagRows.length <= 5) {
    console.log('[baseline] Diagnóstico interval_minutes por estudio:', diagRows);
  } else {
    console.log('[baseline] Diagnóstico interval_minutes (primeros 5):', diagRows.slice(0, 5));
  }

  const params = [];
  if (nodeId != null) params.push(nodeId);
  const paramNode = nodeId != null ? 1 : 0;
  const paramBad = paramNode + 1;
  const qualityFilter =
    badEstudioIds.length > 0
      ? `AND (c.interval_minutes IS NULL OR c.estudio_id NOT IN (SELECT unnest($${paramBad}::int[])))`
      : 'AND 1=1';
  if (badEstudioIds.length > 0) params.push(badEstudioIds);

  // Legs: desde todos los conteos (estudios no quality_bad). Solo sentido → node_legs.
  const tzBucket = 'America/Bogota';
  let legsSql = `
    SELECT DISTINCT e.nodo_id AS node_id, c.sentido AS leg_code
    FROM conteos_resumen c
    JOIN estudios e ON e.id = c.estudio_id
    WHERE c.vol_total > 0
      ${qualityFilter}
  `;
  if (nodeId != null) legsSql += ' AND e.nodo_id = $1';
  legsSql += ' ORDER BY node_id, leg_code';
  const { rows: legsList } = await query(legsSql, params);

  // Turns: solo estudios con has_movement_data = true (no insertar placeholders from_leg=to_leg cuando no hay movimiento).
  let sql = `
    WITH slot AS (
      SELECT
        e.nodo_id,
        c.sentido,
        (CASE WHEN EXTRACT(DOW FROM (c.intervalo_ini AT TIME ZONE '${tzBucket}')) IN (1,2,3,4,5) THEN 'weekday' ELSE 'weekend' END)
          || '_' || to_char(
            date_trunc('hour', (c.intervalo_ini AT TIME ZONE '${tzBucket}'))
              + (floor(EXTRACT(MINUTE FROM (c.intervalo_ini AT TIME ZONE '${tzBucket}'))::int / 15) * 15) * interval '1 minute',
            'HH24:MI'
          ) AS timebucket,
        c.vol_total,
        c.vol_autos, c.vol_motos, c.vol_buses, c.vol_pesados, c.vol_bicis, c.vol_otros
      FROM conteos_resumen c
      JOIN estudios e ON e.id = c.estudio_id
      WHERE c.vol_total > 0
        AND (e.has_movement_data = true)
        ${qualityFilter}
  `;
  if (nodeId != null) {
    sql += ' AND e.nodo_id = $1';
  }
  sql += `
    )
    SELECT
      nodo_id AS node_id,
      sentido AS from_leg_code,
      sentido AS to_leg_code,
      timebucket,
      SUM(vol_total)::numeric AS flow_total,
      jsonb_build_object(
        'vol_autos', SUM(vol_autos),
        'vol_motos', SUM(vol_motos),
        'vol_buses', SUM(vol_buses),
        'vol_pesados', SUM(vol_pesados),
        'vol_bicis', SUM(vol_bicis),
        'vol_otros', SUM(vol_otros)
      ) AS flow_by_class
    FROM slot
    GROUP BY nodo_id, sentido, timebucket
    ORDER BY nodo_id, sentido, timebucket
  `;

  const { rows: turnsList } = await query(sql, params);

  const legsByNode = new Map();
  for (const leg of legsList) {
    const legKey = `${leg.node_id}|${leg.leg_code}`;
    legsByNode.set(legKey, { node_id: leg.node_id, leg_code: leg.leg_code });
  }

  if (turnsList.length === 0) {
    console.log('[baseline] No hay turns con has_movement_data=true (solo se insertarán node_legs).');
  }

  for (const t of turnsList) {
    t.p_turn = 1;
    t.quality = { low_confidence: true, reason: 'solo_sentido' };
  }

  if (dryRun) {
    console.log('[baseline] Agregados (dry-run):');
    console.log('  node_legs que se insertarían:', legsByNode.size);
    console.log('  node_turns que se insertarían:', turnsList.length);
    const sample = turnsList.slice(0, 3);
    console.log('  muestra turns:', JSON.stringify(sample, null, 2));
    // Log: intervalo_ini original + bucket resultante (3 ejemplos)
    const sampleParams = [];
    let sampleSql = `
      SELECT c.intervalo_ini,
        (CASE WHEN EXTRACT(DOW FROM (c.intervalo_ini AT TIME ZONE '${tzBucket}')) IN (1,2,3,4,5) THEN 'weekday' ELSE 'weekend' END)
          || '_' || to_char(
            date_trunc('hour', (c.intervalo_ini AT TIME ZONE '${tzBucket}'))
              + (floor(EXTRACT(MINUTE FROM (c.intervalo_ini AT TIME ZONE '${tzBucket}'))::int / 15) * 15) * interval '1 minute',
            'HH24:MI'
          ) AS timebucket
      FROM conteos_resumen c
      JOIN estudios e ON e.id = c.estudio_id
      WHERE c.vol_total > 0
    `;
    if (nodeId != null) {
      sampleSql += ' AND e.nodo_id = $1';
      sampleParams.push(nodeId);
    }
    sampleSql += ' ORDER BY c.intervalo_ini LIMIT 3';
    const sampleBucketRes = await query(sampleSql, sampleParams);
    console.log('  [dry-run] intervalo_ini + timebucket (3 ejemplos, zona ' + tzBucket + '):');
    for (const r of sampleBucketRes.rows) {
      console.log('    ', r.intervalo_ini, ' -> ', r.timebucket);
    }
    await closePool();
    return;
  }

  let legsInserted = 0;
  let turnsInserted = 0;
  for (const [, leg] of legsByNode) {
    try {
      await query(
        `INSERT INTO node_legs (node_id, leg_code) VALUES ($1, $2)
         ON CONFLICT (node_id, leg_code) DO NOTHING`,
        [leg.node_id, leg.leg_code]
      );
      legsInserted++;
    } catch (e) {
      console.error('[baseline] Error insert leg:', e.message);
    }
  }
  for (const t of turnsList) {
    try {
      await query(
        `INSERT INTO node_turns (node_id, from_leg_code, to_leg_code, timebucket, flow_total, flow_by_class, p_turn, quality)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (node_id, from_leg_code, to_leg_code, timebucket) DO UPDATE SET
           flow_total = EXCLUDED.flow_total,
           flow_by_class = EXCLUDED.flow_by_class,
           p_turn = EXCLUDED.p_turn,
           quality = EXCLUDED.quality`,
        [t.node_id, t.from_leg_code, t.to_leg_code, t.timebucket, t.flow_total, JSON.stringify(t.flow_by_class || {}), t.p_turn, JSON.stringify(t.quality || {})]
      );
      turnsInserted++;
    } catch (e) {
      console.error('[baseline] Error insert turn:', e.message);
    }
  }
  console.log('[baseline] node_legs insertados/actualizados:', legsInserted);
  console.log('[baseline] node_turns insertados/actualizados:', turnsInserted);
  await closePool();
}

main().catch(err => {
  console.error('[baseline] Error:', err);
  process.exit(1);
});
