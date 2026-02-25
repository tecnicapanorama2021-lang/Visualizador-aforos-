/**
 * ETL Masivo: Descarga Excels de aforos y genera JSON completo para IA
 *
 * - Descarga temporalmente todos los Excels a .cache/excel
 * - Extrae vol-data completo + hoja Identificación (código/nombre/factor equivalencia)
 * - Genera ia_historial.json con toda la información por nodo
 *
 * Uso:
 *   node server/scripts/buildHistorialMasivo.js
 *
 * Opciones:
 *   --incremental     Solo procesa estudios nuevos
 *   --force           Reprocesa todos los estudios
 *   --limit=N         Limita a N nodos (pruebas)
 *   --use-cache       Usa Excels ya descargados en .cache/excel
 *   --save-cache      Guarda cada Excel en .cache/excel (por defecto: sí)
 *   --clear-cache     Al finalizar, borra .cache/excel
 *   --output=path     Ruta del JSON de salida (default: public/data/ia_historial.json)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analizarExcelBuffer } from '../utils/aforoAnalisis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuración
const DIM_ORIGIN = 'https://dim.movilidadbogota.gov.co';
const DIM_BASE = `${DIM_ORIGIN}/visualizacion_monitoreo`;
const DIM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://dim.movilidadbogota.gov.co/visualizacion_monitoreo/',
  'Accept': 'application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream, */*'
};

const STUDIES_DICT_PATH = path.join(__dirname, '../../public/data/studies_dictionary.json');
const CACHE_DIR = path.join(__dirname, '../../.cache/excel');
const PROGRESS_FILE = path.join(__dirname, '../../data/.historial_progress.json');

// Parsear argumentos
const args = process.argv.slice(2);
const isIncremental = args.includes('--incremental');
const isForce = args.includes('--force');
const useCache = args.includes('--use-cache');
const saveCache = !args.includes('--no-save-cache');
const clearCache = args.includes('--clear-cache');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const outputArg = args.find(a => a.startsWith('--output='));
const HISTORIAL_OUTPUT_PATH = outputArg
  ? path.resolve(process.cwd(), outputArg.split('=')[1])
  : path.join(__dirname, '../../public/data/ia_historial.json');

function cachePath(nodeId, idEstudio) {
  return path.join(CACHE_DIR, `nodo_${nodeId}_estudio_${idEstudio}.xlsx`);
}

/**
 * Obtiene el buffer Excel: desde cache si existe y --use-cache, si no desde DIM (y guarda en cache si --save-cache)
 */
async function getExcelBufferForStudy(idEstudio, nodeId) {
  const cacheFile = cachePath(nodeId, idEstudio);

  if (useCache && fs.existsSync(cacheFile)) {
    const buffer = fs.readFileSync(cacheFile);
    return { buffer, nombreOriginal: path.basename(cacheFile), fromCache: true };
  }

  const metaUrl = `${DIM_BASE}/consultararchivoscargados/${idEstudio}`;
  const metaRes = await fetch(metaUrl, { method: 'GET', headers: DIM_HEADERS });
  if (!metaRes.ok) {
    if (metaRes.status === 404) throw new Error('Estudio no encontrado');
    throw new Error(`DIM respondió ${metaRes.status}`);
  }

  const contentType = metaRes.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await metaRes.json();
  } else {
    const text = await metaRes.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('DIM no devolvió JSON válido');
    }
  }

  if (!data) throw new Error('DIM no devolvió JSON válido');
  const list = Array.isArray(data) ? data : [data];
  if (list.length === 0) throw new Error('No hay archivos para este estudio');

  const sorted = [...list].sort((a, b) => {
    const ta = a.instante_carga ? new Date(a.instante_carga).getTime() : 0;
    const tb = b.instante_carga ? new Date(b.instante_carga).getTime() : 0;
    return tb - ta;
  });
  const file = sorted[0];
  const fileId = file?.id ?? file?.id_archivo;
  if (!fileId) throw new Error('No se encontró id del archivo');

  const targetUrl = `${DIM_ORIGIN}/carga_estudios/descargar/${fileId}`;
  const fileRes = await fetch(targetUrl, { method: 'GET', headers: DIM_HEADERS });
  if (!fileRes.ok) throw new Error('No se pudo descargar el archivo');

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  if (buffer[0] === 0x7b || buffer[0] === 0x5b) throw new Error('DIM devolvió metadatos en lugar del Excel');

  if (saveCache) {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, buffer);
  }

  return { buffer, nombreOriginal: file.nombre_original_archivo || `aforo_${idEstudio}.xlsx`, fromCache: false };
}

/**
 * Extrae patrones de observaciones para aprendizaje de IA
 */
function extraerPatronesObservaciones(conflictos) {
  if (!conflictos || conflictos.length === 0) return null;
  
  const patrones = {
    horarios_problematicos: {},
    tipos_conflictos: {},
    sentidos_afectados: new Set(),
    frecuencia_total: conflictos.length
  };
  
  conflictos.forEach(c => {
    // Agrupar por hora (redondear a intervalos de 15 min)
    const hora = c.hora || '';
    const horaMatch = hora.match(/(\d{1,2}):(\d{2})/);
    if (horaMatch) {
      const h = parseInt(horaMatch[1], 10);
      const m = parseInt(horaMatch[2], 10);
      const intervalo = `${h}:${String(Math.floor(m / 15) * 15).padStart(2, '0')}`;
      patrones.horarios_problematicos[intervalo] = (patrones.horarios_problematicos[intervalo] || 0) + 1;
    }
    
    // Categorizar tipo de conflicto por palabras clave
    const desc = (c.descripcion || '').toLowerCase();
    let tipo = 'otro';
    if (desc.includes('congestion') || desc.includes('tráfico') || desc.includes('embotellamiento')) tipo = 'congestion';
    else if (desc.includes('accidente') || desc.includes('choque') || desc.includes('colisión')) tipo = 'accidente';
    else if (desc.includes('obras') || desc.includes('construcción') || desc.includes('mantenimiento')) tipo = 'obras';
    else if (desc.includes('lluvia') || desc.includes('clima') || desc.includes('inundación')) tipo = 'clima';
    else if (desc.includes('semáforo') || desc.includes('semaforo') || desc.includes('señal')) tipo = 'infraestructura';
    else if (desc.includes('peatón') || desc.includes('peaton') || desc.includes('cruce')) tipo = 'peatones';
    
    patrones.tipos_conflictos[tipo] = (patrones.tipos_conflictos[tipo] || 0) + 1;
    
    if (c.sentido) patrones.sentidos_afectados.add(c.sentido);
  });
  
  return {
    frecuencia_total: patrones.frecuencia_total,
    horarios_problematicos: Object.fromEntries(
      Object.entries(patrones.horarios_problematicos)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5) // Top 5 horarios problemáticos
    ),
    tipos_conflictos: patrones.tipos_conflictos,
    sentidos_afectados: Array.from(patrones.sentidos_afectados),
    observaciones_completas: conflictos // Guardar todas para contexto completo
  };
}

/**
 * Calcula estadísticas agregadas y tendencias para un nodo
 */
function calcularEstadisticasNodo(historico) {
  if (!historico || historico.length === 0) return null;
  
  const volumenes = historico.map(h => h.analisis?.volumen_total_pico).filter(v => v != null);
  const años = [...new Set(historico.map(h => {
    const fecha = h.fecha || '';
    return fecha.substring(0, 4);
  }).filter(Boolean))].sort();
  
  const volumenPromedio = volumenes.length > 0
    ? Math.round(volumenes.reduce((a, b) => a + b, 0) / volumenes.length)
    : null;
  
  // Calcular tendencia (comparar primeros vs últimos estudios)
  let tendencia = 'estable';
  if (volumenes.length >= 2) {
    const primeros = volumenes.slice(0, Math.floor(volumenes.length / 2));
    const ultimos = volumenes.slice(-Math.floor(volumenes.length / 2));
    const promPrimeros = primeros.reduce((a, b) => a + b, 0) / primeros.length;
    const promUltimos = ultimos.reduce((a, b) => a + b, 0) / ultimos.length;
    const cambio = ((promUltimos - promPrimeros) / promPrimeros) * 100;
    if (cambio > 10) tendencia = 'creciente';
    else if (cambio < -10) tendencia = 'decreciente';
  }
  
  // Agrupar observaciones de todos los estudios
  const todasObservaciones = historico
    .flatMap(h => h.observaciones?.observaciones_completas || [])
    .filter(Boolean);
  
  const patronesGlobales = todasObservaciones.length > 0
    ? extraerPatronesObservaciones(todasObservaciones)
    : null;
  
  return {
    total_estudios: historico.length,
    años: años,
    volumen_promedio_pico: volumenPromedio,
    volumen_minimo_pico: volumenes.length > 0 ? Math.min(...volumenes) : null,
    volumen_maximo_pico: volumenes.length > 0 ? Math.max(...volumenes) : null,
    tendencia,
    patrones_observaciones: patronesGlobales
  };
}

/**
 * Procesa un estudio individual y retorna datos para el historial (vol-data completo + hoja identificación)
 */
async function procesarEstudio(study, nodeId, address) {
  try {
    const { buffer, fromCache } = await getExcelBufferForStudy(study.file_id, nodeId);
    const analisis = analizarExcelBuffer(buffer);

    // Extraer fecha y contexto temporal
    const fecha = study.date || '';
    const fechaObj = fecha ? new Date(fecha) : null;
    const año = fechaObj ? fechaObj.getFullYear() : null;
    const mes = fechaObj ? fechaObj.getMonth() + 1 : null;
    const diaSemana = fechaObj ? ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][fechaObj.getDay()] : null;

    // Extraer patrones de observaciones
    const patronesObs = analisis.historial_conflictos && analisis.historial_conflictos.length > 0
      ? extraerPatronesObservaciones(analisis.historial_conflictos)
      : null;

    const numObs = analisis.historial_conflictos?.length ?? 0;
    const volPico = analisis.resumen?.volumen_total_pico ?? 0;
    const rangoPico = analisis.resumen?.hora_pico_rango || '';
    const resumen_texto = `Aforo ${fecha}, hora pico ${rangoPico}, volumen ${volPico}${numObs > 0 ? `, ${numObs} observaciones` : ', sin observaciones'}`;

    return {
      file_id: study.file_id,
      fecha,
      fecha_fin: study.date_end || fecha,
      contratista: study.contractors?.[0] || 'Desconocido',
      tipo_estudio: study.type || 'Volúmen vehicular',
      resumen_texto,
      analisis: {
        hora_pico_rango: analisis.resumen?.hora_pico_rango || null,
        hora_pico_inicio: analisis.resumen?.hora_pico_inicio || null,
        hora_pico_fin: analisis.resumen?.hora_pico_fin || null,
        volumen_total_pico: analisis.resumen?.volumen_total_pico || null,
        distribucion_hora_pico: analisis.distribucion_hora_pico || [],
        clases_vehiculos: analisis.class_headers || [],
        vol_data_completo: analisis.vol_data_completo || [],
        hoja_identificacion: analisis.hoja_identificacion || []
      },
      observaciones: patronesObs,
      contexto_temporal: {
        año,
        mes,
        dia_semana: diaSemana,
        estacion: año && mes ? (
          mes >= 12 || mes <= 2 ? 'verano' :
          mes >= 3 && mes <= 5 ? 'otoño' :
          mes >= 6 && mes <= 8 ? 'invierno' : 'primavera'
        ) : null
      },
      _from_cache: fromCache
    };
  } catch (err) {
    console.error(`  ❌ Error procesando estudio ${study.file_id}:`, err.message);
    return null;
  }
}

/**
 * Carga el progreso guardado
 */
function cargarProgreso() {
  if (!fs.existsSync(PROGRESS_FILE)) return { processed: new Set(), errors: [] };
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    return {
      processed: new Set(data.processed || []),
      errors: data.errors || []
    };
  } catch {
    return { processed: new Set(), errors: [] };
  }
}

/**
 * Guarda el progreso
 */
function guardarProgreso(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    processed: Array.from(progress.processed),
    errors: progress.errors,
    last_update: new Date().toISOString()
  }, null, 2));
}

/**
 * Función principal
 */
async function main() {
  console.log('🚀 ETL Masivo: JSON completo de aforos para IA\n');

  if (saveCache || useCache) {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`📁 Cache de Excels: ${CACHE_DIR}`);
  }
  if (useCache) console.log('   Modo --use-cache: se usarán Excels ya descargados cuando existan.\n');

  // Cargar diccionario de estudios
  if (!fs.existsSync(STUDIES_DICT_PATH)) {
    console.error('❌ No se encontró studies_dictionary.json');
    process.exit(1);
  }

  const studiesDict = JSON.parse(fs.readFileSync(STUDIES_DICT_PATH, 'utf8'));
  const nodes = studiesDict.nodes || {};
  const nodeIds = Object.keys(nodes);

  if (limit) {
    console.log(`⚠️  Modo limitado: procesando solo ${limit} nodos\n`);
  }

  const nodeIdsToProcess = limit ? nodeIds.slice(0, limit) : nodeIds;
  console.log(`📊 Total de nodos a procesar: ${nodeIdsToProcess.length}\n`);

  // Cargar historial existente o crear nuevo
  let historial = {
    metadata: {
      version: '2.0',
      generated_at: new Date().toISOString(),
      total_nodes: 0,
      total_studies_processed: 0,
      last_update: new Date().toISOString(),
      resumen_global: null
    },
    nodes: {}
  };

  if (fs.existsSync(HISTORIAL_OUTPUT_PATH) && !isForce) {
    try {
      historial = JSON.parse(fs.readFileSync(HISTORIAL_OUTPUT_PATH, 'utf8'));
      console.log(`✅ Historial existente cargado: ${Object.keys(historial.nodes || {}).length} nodos\n`);
    } catch (err) {
      console.warn('⚠️  No se pudo cargar historial existente, creando nuevo\n');
    }
  }

  // Cargar progreso
  const progress = isIncremental ? cargarProgreso() : { processed: new Set(), errors: [] };
  console.log(`📝 Modo: ${isIncremental ? 'Incremental' : 'Completo'}\n`);

  let procesados = 0;
  let exitosos = 0;
  let errores = 0;
  let descargados = 0;
  let desdeCache = 0;
  const startTime = Date.now();
  
  // Procesar cada nodo
  for (let i = 0; i < nodeIdsToProcess.length; i++) {
    const nodeId = nodeIdsToProcess[i];
    const nodeData = nodes[nodeId];
    
    if (!nodeData || !nodeData.studies || nodeData.studies.length === 0) {
      console.log(`[${i + 1}/${nodeIdsToProcess.length}] ⏭️  Nodo ${nodeId}: Sin estudios, omitiendo`);
      continue;
    }
    
    console.log(`[${i + 1}/${nodeIdsToProcess.length}] 🔄 Nodo ${nodeId} (${nodeData.address || 'Sin dirección'}): ${nodeData.studies.length} estudios`);
    
    const historico = historial.nodes[nodeId]?.historico || [];
    const estudiosProcesados = new Set(historico.map(h => h.file_id));
    
    // Procesar cada estudio del nodo
    for (const study of nodeData.studies) {
      const studyKey = `${nodeId}_${study.file_id}`;
      
      if (isIncremental && progress.processed.has(studyKey)) {
        continue; // Ya procesado
      }
      
      if (isIncremental && estudiosProcesados.has(study.file_id)) {
        continue; // Ya en historial
      }
      
      procesados++;
      const estudioData = await procesarEstudio(study, nodeId, nodeData.address);

      if (estudioData) {
        const fromCache = estudioData._from_cache;
        delete estudioData._from_cache;
        if (fromCache) desdeCache++;
        else descargados++;
        historico.push(estudioData);
        exitosos++;
        progress.processed.add(studyKey);
        if (!fromCache) await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        errores++;
        progress.errors.push({ nodeId, fileId: study.file_id, timestamp: new Date().toISOString() });
      }
    }
    
    // Ordenar histórico por fecha (más antiguo primero)
    historico.sort((a, b) => {
      const dateA = a.fecha ? new Date(a.fecha).getTime() : 0;
      const dateB = b.fecha ? new Date(b.fecha).getTime() : 0;
      return dateA - dateB;
    });
    
    // Calcular estadísticas del nodo
    const estadisticas = calcularEstadisticasNodo(historico);
    
    // Actualizar o crear entrada del nodo
    historial.nodes[nodeId] = {
      node_id: nodeId,
      address: nodeData.address || '',
      via_principal: nodeData.via_principal || null,
      via_secundaria: nodeData.via_secundaria || null,
      historico,
      estadisticas
    };
    
    // Guardar progreso cada 10 nodos
    if ((i + 1) % 10 === 0) {
      historial.metadata.total_nodes = Object.keys(historial.nodes).length;
      historial.metadata.total_studies_processed = Object.values(historial.nodes)
        .reduce((sum, n) => sum + (n.historico?.length || 0), 0);
      historial.metadata.last_update = new Date().toISOString();
      
      fs.writeFileSync(HISTORIAL_OUTPUT_PATH, JSON.stringify(historial, null, 2));
      guardarProgreso(progress);
      console.log(`  💾 Progreso guardado (${i + 1}/${nodeIdsToProcess.length} nodos)\n`);
    }
  }
  
  // Resumen global para IA (índice rápido)
  const todasFechas = [];
  const nodosConEstudios = [];
  for (const [nid, n] of Object.entries(historial.nodes || {})) {
    const count = n.historico?.length || 0;
    if (count > 0) nodosConEstudios.push({ node_id: nid, address: n.address || '', estudios: count });
    (n.historico || []).forEach(h => { if (h.fecha) todasFechas.push(h.fecha); });
  }
  nodosConEstudios.sort((a, b) => b.estudios - a.estudios);
  const fechasOrdenadas = [...todasFechas].sort();
  const rangoFechas = fechasOrdenadas.length > 0
    ? { min: fechasOrdenadas[0], max: fechasOrdenadas[fechasOrdenadas.length - 1] }
    : { min: null, max: null };

  historial.metadata.total_nodes = Object.keys(historial.nodes).length;
  historial.metadata.total_studies_processed = Object.values(historial.nodes)
    .reduce((sum, n) => sum + (n.historico?.length || 0), 0);
  historial.metadata.last_update = new Date().toISOString();
  historial.metadata.resumen_global = {
    total_estudios: historial.metadata.total_studies_processed,
    rango_fechas: rangoFechas,
    nodos_con_mas_estudios: nodosConEstudios.slice(0, 10)
  };

  fs.writeFileSync(HISTORIAL_OUTPUT_PATH, JSON.stringify(historial, null, 2));
  guardarProgreso(progress);

  if (clearCache && fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true });
    console.log('\n🗑️  Cache de Excels borrada (.cache/excel)\n');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Informe final
  let totalFilasVolData = 0;
  let totalRegistrosIdentificacion = 0;
  let estudiosConIdentificacion = 0;
  for (const n of Object.values(historial.nodes || {})) {
    for (const h of n.historico || []) {
      const v = h.analisis?.vol_data_completo?.length ?? 0;
      totalFilasVolData += v;
      const ident = h.analisis?.hoja_identificacion?.length ?? 0;
      if (ident > 0) estudiosConIdentificacion++;
      totalRegistrosIdentificacion += ident;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ ETL MASIVO COMPLETADO — JSON COMPLETO PARA IA');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('📥 DESCARGAS');
  console.log(`   - Excels descargados desde DIM: ${descargados}`);
  console.log(`   - Excels leídos desde cache:     ${desdeCache}`);
  console.log(`   - Total estudios procesados:    ${exitosos}`);
  console.log(`   - Errores:                      ${errores}\n`);
  console.log('📊 NODOS');
  console.log(`   - Nodos con datos en el JSON:   ${historial.metadata.total_nodes}`);
  console.log(`   - Nodos procesados en esta run: ${nodeIdsToProcess.length}\n`);
  console.log('📋 INFORMACIÓN INCLUIDA EN EL JSON');
  console.log(`   - Filas vol-data (todas):       ${totalFilasVolData}`);
  console.log(`   - Estudios con hoja identificación: ${estudiosConIdentificacion}`);
  console.log(`   - Registros identificación (código/nombre/factor equivalencia): ${totalRegistrosIdentificacion}`);
  console.log(`   - Rango de fechas: ${rangoFechas.min || 'N/A'} → ${rangoFechas.max || 'N/A'}\n`);
  console.log(`⏱️  Tiempo total: ${elapsed}s`);
  console.log(`💾 Archivo generado: ${HISTORIAL_OUTPUT_PATH}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (errores > 0) {
    console.log(`⚠️  Errores guardados en: ${PROGRESS_FILE}\n`);
  }
}

// Ejecutar
main().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
