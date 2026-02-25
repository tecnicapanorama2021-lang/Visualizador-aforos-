/**
 * Verificación de calidad del predictor (CI/CD).
 * Llama GET /api/prediccion/validacion?dias=90 y falla si MAPE >= 50%.
 * [nuevo archivo]
 * Uso: npm run verify:predictor
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const API_BASE = process.env.API_BASE || process.env.API_URL || 'http://localhost:3001';
const VALIDACION_URL = `${API_BASE}/api/prediccion/validacion?dias=90`;

async function main() {
  let data;
  try {
    const res = await fetch(VALIDACION_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      console.error('❌ Predictor: API respondió', res.status, res.statusText);
      process.exit(1);
    }
    data = await res.json();
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      console.error('❌ Backend no está corriendo en', API_BASE);
      console.error('   Levanta: npm run dev');
    } else {
      console.error('❌ Error llamando validación:', err.message);
    }
    process.exit(1);
  }

  const global = data?.global ?? {};
  const mape = global.MAPE != null ? parseFloat(global.MAPE) : null;
  const n = global.n_muestras ?? 0;

  if (n === 0) {
    console.warn('⚠️ Sin muestras históricas; no se puede validar MAPE.');
    process.exit(0);
  }

  if (mape >= 50) {
    console.error('❌ Predictor: MAPE global >= 50% (', mape, '%). Modelo roto o sin datos suficientes.');
    process.exit(1);
  }

  if (mape >= 25 && mape < 50) {
    console.warn('⚠️ MAPE alto:', mape.toFixed(1), '% — revisar datos o modelo.');
  } else {
    console.log('✅ Predictor OK (MAPE:', mape != null ? mape.toFixed(1) : 'n/a', '%)');
  }

  console.log('\nZona      | MAE    | MAPE   | Muestras');
  console.log('----------+--------+--------+----------');
  const porZona = data?.por_zona ?? [];
  for (const row of porZona) {
    const zona = (row.zona || '').slice(0, 10).padEnd(10);
    const mae = (row.MAE != null ? String(row.MAE) : '').padStart(6);
    const mapeZ = (row.MAPE != null ? row.MAPE + '%' : '').padStart(6);
    const muestras = String(row.n_muestras ?? 0).padStart(8);
    console.log(`${zona} | ${mae} | ${mapeZ} | ${muestras}`);
  }
  process.exit(0);
}

main();
