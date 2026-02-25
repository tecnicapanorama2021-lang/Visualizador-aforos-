/**
 * Seed: festivos Colombia 2025–2027 (Ley Emiliani: móviles al lunes siguiente).
 * [nuevo archivo]
 * Uso: npm run db:seed:festivos
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { query, closePool } from '../../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, '../..');
dotenv.config({ path: path.join(__dirname, '../../../.env') });

/** Lunes siguiente si d no es lunes (Ley Emiliani). */
function lunesSiguiente(d) {
  const date = new Date(d);
  const dow = date.getUTCDay();
  if (dow === 1) return date;
  const add = dow === 0 ? 1 : 8 - dow;
  date.setUTCDate(date.getUTCDate() + add);
  return date;
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

/** Genera festivos para un año (fijos + móviles al lunes). */
function festivosAnio(anio) {
  const items = [];
  // Fijos
  items.push({ fecha: `${anio}-01-01`, nombre: 'Año Nuevo', tipo: 'NACIONAL' });
  items.push({ fecha: `${anio}-05-01`, nombre: 'Día del Trabajo', tipo: 'NACIONAL' });
  items.push({ fecha: `${anio}-07-20`, nombre: 'Día de la Independencia', tipo: 'NACIONAL' });
  items.push({ fecha: `${anio}-08-07`, nombre: 'Batalla de Boyacá', tipo: 'NACIONAL' });
  items.push({ fecha: `${anio}-12-08`, nombre: 'Inmaculada Concepción', tipo: 'NACIONAL' });
  items.push({ fecha: `${anio}-12-25`, nombre: 'Navidad', tipo: 'NACIONAL' });
  // Móviles (lunes siguiente)
  const reyes = lunesSiguiente(new Date(`${anio}-01-06T12:00:00Z`));
  items.push({ fecha: toDateStr(reyes), nombre: 'Reyes Magos', tipo: 'NACIONAL' });
  const sanJose = lunesSiguiente(new Date(`${anio}-03-19T12:00:00Z`));
  items.push({ fecha: toDateStr(sanJose), nombre: 'San José', tipo: 'NACIONAL' });
  const sanPedro = lunesSiguiente(new Date(`${anio}-06-29T12:00:00Z`));
  items.push({ fecha: toDateStr(sanPedro), nombre: 'San Pedro y San Pablo', tipo: 'NACIONAL' });
  const asuncion = lunesSiguiente(new Date(`${anio}-08-15T12:00:00Z`));
  items.push({ fecha: toDateStr(asuncion), nombre: 'Asunción de la Virgen', tipo: 'NACIONAL' });
  const raza = lunesSiguiente(new Date(`${anio}-10-12T12:00:00Z`));
  items.push({ fecha: toDateStr(raza), nombre: 'Día de la Raza', tipo: 'NACIONAL' });
  const todosSantos = lunesSiguiente(new Date(`${anio}-11-01T12:00:00Z`));
  items.push({ fecha: toDateStr(todosSantos), nombre: 'Todos los Santos', tipo: 'NACIONAL' });
  const cartagena = lunesSiguiente(new Date(`${anio}-11-11T12:00:00Z`));
  items.push({ fecha: toDateStr(cartagena), nombre: 'Independencia de Cartagena', tipo: 'NACIONAL' });
  return items;
}

async function main() {
  const hasTable = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'festivos_colombia'`
  ).then((r) => r.rows[0]);
  if (!hasTable) {
    console.error('[seed-festivos] Ejecuta npm run db:migrate primero (migración 026).');
    await closePool();
    process.exit(1);
  }

  const todos = [
    ...festivosAnio(2025),
    ...festivosAnio(2026),
    ...festivosAnio(2027),
  ];

  let insertados = 0;
  for (const f of todos) {
    try {
      await query(
        `INSERT INTO festivos_colombia (fecha, nombre, tipo) VALUES ($1::date, $2, $3)
         ON CONFLICT (fecha) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo`,
        [f.fecha, f.nombre, f.tipo]
      );
      insertados++;
    } catch (err) {
      console.warn('[seed-festivos]', f.fecha, err.message);
    }
  }

  const total = await query(`SELECT COUNT(*) AS c FROM festivos_colombia`).then((r) => parseInt(r.rows[0]?.c ?? 0, 10));
  console.log('[seed-festivos] Festivos insertados/actualizados:', insertados, '| Total en BD:', total);
  await closePool();
}

main().catch((err) => {
  console.error('[seed-festivos]', err.message);
  process.exit(1);
});
