/**
 * Inspección del catálogo SECOP con filtro quirúrgico (estudios de tránsito reales).
 * PASO B.1 + B.2: sin registro en BD.
 *
 * Uso: node server/scripts/inspeccionar_secop_catalogo.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ruta = path.join(__dirname, 'tmp', 'secop_catalogo_estudios.json');
const data = JSON.parse(fs.readFileSync(ruta, 'utf8'));

function textoContrato(d) {
  return (
    (d.descripcion_del_proceso || '') +
    (d.nombre_del_procedimiento || '') +
    (d.objeto_del_contrato || '') +
    (d.objeto || '') +
    (d.nombre_procedimiento || '')
  );
}

function normalizar(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const frasesEspecificas = [
  'estudio de transito',
  'estudio de trafico',
  'aforo vehicular',
  'aforo de transito',
  'conteo vehicular',
  'plan de manejo de transito',
  'plan de manejo de trafico',
  'pmt vial',
  'estudio de movilidad vial',
  'capacidad vial',
  'nivel de servicio vial',
  'matriz origen destino',
  'interseccion vial',
  'señalizacion vial',
  'diagnostico vial',
  'ppru transito',
  'plan parcial.*transito',
];

function cumpleFiltro(d) {
  const texto = normalizar(textoContrato(d));
  return frasesEspecificas.some((frase) => {
    if (frase.includes('.*')) {
      return new RegExp(normalizar(frase)).test(texto);
    }
    return texto.includes(normalizar(frase));
  });
}

const relevantes = data.filter(cumpleFiltro);

const entidadBogotaPatron = [
  'bogota',
  'bogotá',
  'cundinamarca',
  'idrd',
  'idu',
  'sdm',
  'secretaria de movilidad',
  'transmilenio',
  'metro de bogota',
];

function esBogotaCundinamarca(d) {
  const ent = normalizar(d.nombre_entidad || d.entidad || '');
  return entidadBogotaPatron.some((p) => ent.includes(p));
}

const relevantesBogota = relevantes.filter(esBogotaCundinamarca);

// ----- PASO B.1 -----
console.log('=== PASO B.1 – Filtro quirúrgico ===\n');
console.log('Total contratos en catálogo:', data.length);
console.log('Total contratos relevantes (frases específicas):', relevantes.length);
console.log('\n--- Muestra de 10 contratos ---');
relevantes.slice(0, 10).forEach((d, i) => {
  const obj = (d.objeto || d.objeto_del_contrato || d.descripcion_del_proceso || '').slice(0, 200);
  console.log(`\n${i + 1}. Entidad: ${d.nombre_entidad || d.entidad}`);
  console.log('   Objeto:', obj);
  console.log('   Valor:', d.valor_total_contrato ?? '(no disponible)');
  console.log('   URL:', d.urlproceso || d.url_proceso || '(sin url)');
});
console.log('\n--- Bogotá/Cundinamarca vs resto ---');
console.log('Relevantes en Bogotá/Cundinamarca:', relevantesBogota.length);
console.log('Relevantes resto del país:', relevantes.length - relevantesBogota.length);

// ----- PASO B.2 – Clasificación por categoría -----
const categorias = {
  ESTUDIO_TRANSITO: ['estudio de transito', 'estudio de trafico'],
  AFORO: ['aforo vehicular', 'aforo de transito', 'conteo vehicular'],
  PMT: ['plan de manejo de transito', 'plan de manejo de trafico', 'pmt vial'],
  MOVILIDAD_VIAL: ['estudio de movilidad vial', 'capacidad vial', 'nivel de servicio vial'],
  SEÑALIZACION: ['señalizacion vial', 'diagnostico vial'],
  PPRU: ['plan parcial', 'ppru transito'],
};

function perteneceCategoria(d, frases) {
  const texto = normalizar(textoContrato(d));
  return frases.some((f) => {
    const fn = normalizar(f);
    return fn.includes('.*') ? new RegExp(fn).test(texto) : texto.includes(fn);
  });
}

const conteoPorCategoria = {};
const conteoBogotaPorCategoria = {};
for (const [cat, frases] of Object.entries(categorias)) {
  conteoPorCategoria[cat] = relevantes.filter((d) => perteneceCategoria(d, frases)).length;
  conteoBogotaPorCategoria[cat] = relevantesBogota.filter((d) => perteneceCategoria(d, frases)).length;
}

console.log('\n=== PASO B.2 – Conteo por categoría ===\n');
console.log('Categoría           | Total | En Bogotá/Cund.');
console.log('--------------------|-------|----------------');
for (const [cat, total] of Object.entries(conteoPorCategoria)) {
  const bogota = conteoBogotaPorCategoria[cat] ?? 0;
  const nombre = cat.padEnd(18);
  console.log(`${nombre} | ${String(total).padStart(5)} | ${String(bogota).padStart(14)}`);
}
console.log('--------------------|-------|----------------');
console.log(`TOTAL (relevantes)   | ${String(relevantes.length).padStart(5)} | ${String(relevantesBogota.length).padStart(14)}`);
console.log('\n(Un contrato puede contar en varias categorías si cumple varias frases.)');
