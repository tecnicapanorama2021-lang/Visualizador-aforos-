/**
 * Crea anexos de ejemplo (XLSX + CSV) en data/secop/anexos/CO1.REQ.EJEMPLO/
 * y los registra en archivos_fuente para poder probar secop:procesar.
 * Ejecutar una vez: node server/scripts/secop_crear_ejemplo_anexos.js
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const ANEXOS_DIR = path.join(PROJECT_ROOT, 'data', 'secop', 'anexos', 'CO1.REQ.EJEMPLO');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const PLANTILLA_A_ROWS = [
  ['interseccion', 'direccion', 'fecha', 'sentido', 'hora_inicio', 'hora_fin', 'vol_total', 'vol_livianos', 'vol_motos', 'vol_buses', 'vol_pesados', 'vol_bicis'],
  ['CALLE 80 X NQS', 'Calle 80 con NQS', '2025-01-15', 'NS', '07:00', '07:15', 98, 65, 18, 4, 8, 3],
  ['CALLE 80 X NQS', 'Calle 80 con NQS', '2025-01-15', 'NS', '07:15', '07:30', 112, 72, 22, 5, 10, 3],
  ['CALLE 80 X NQS', 'Calle 80 con NQS', '2025-01-15', 'SN', '07:00', '07:15', 85, 58, 15, 3, 7, 2],
];

const PLANTILLA_B_CSV = `interseccion;direccion;fecha;sentido;hora_inicio;hora_fin;vol_total;vol_livianos;vol_motos;vol_buses;vol_pesados;vol_bicis
AK 15 X CL 127;Autopista Norte con 127;2025-01-16;EO;17:00;17:15;145;95;28;8;12;2
AK 15 X CL 127;Autopista Norte con 127;2025-01-16;OE;17:00;17:15;132;88;25;7;10;2
`;

async function main() {
  fs.mkdirSync(ANEXOS_DIR, { recursive: true });

  const xlsxPath = path.join(ANEXOS_DIR, 'Anexo_3_Matriz_Aforos.xlsx');
  const ws = XLSX.utils.aoa_to_sheet(PLANTILLA_A_ROWS);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Aforos');
  XLSX.writeFile(wb, xlsxPath);
  console.log('[secop-ejemplo] Creado:', xlsxPath);

  const csvPath = path.join(ANEXOS_DIR, 'Resumen_conteos.csv');
  fs.writeFileSync(csvPath, PLANTILLA_B_CSV, 'utf8');
  console.log('[secop-ejemplo] Creado:', csvPath);

  const hasOrigenId = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'origen_id'`
  ).then((r) => r.rows[0]);

  const idProceso = 'CO1.REQ.EJEMPLO';

  for (const { nombre, tipo } of [
    { nombre: 'Anexo_3_Matriz_Aforos.xlsx', tipo: 'XLSX' },
    { nombre: 'Resumen_conteos.csv', tipo: 'CSV' },
  ]) {
    const fullPath = path.join(ANEXOS_DIR, nombre);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
    const existing = await query(
      'SELECT id FROM archivos_fuente WHERE hash = $1 AND origen = $2 LIMIT 1',
      [hash, 'SECOP']
    );
    if (existing.rows[0]) {
      await query('UPDATE archivos_fuente SET procesado = FALSE, updated_at = NOW() WHERE id = $1', [existing.rows[0].id]);
      console.log('[secop-ejemplo] Ya registrado, procesado=FALSE:', nombre);
    } else {
      if (hasOrigenId) {
        await query(
          `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, origen_id, updated_at)
           VALUES ($1, 'SECOP', $2, $3, FALSE, $4, NOW())`,
          [tipo, nombre, hash, idProceso]
        );
      } else {
        await query(
          `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, updated_at)
           VALUES ($1, 'SECOP', $2, $3, FALSE, NOW())`,
          [tipo, nombre, hash]
        );
      }
      console.log('[secop-ejemplo] Registrado en archivos_fuente:', nombre);
    }
  }

  await closePool();
  console.log('[secop-ejemplo] Listo. Ejecuta: npm run secop:procesar');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
