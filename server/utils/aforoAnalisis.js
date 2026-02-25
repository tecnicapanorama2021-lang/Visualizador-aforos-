/**
 * Motor de procesamiento: lee Excel de aforo, calcula hora pico y entrega JSON para el frontend.
 * Usado por GET /api/aforos/analisis/:idEstudio
 */
import XLSX from 'xlsx';
import { normalizeSentido } from './normalizeSentido.js';
import { normalizeClaseVehiculo } from './normalizeClaseVehiculo.js';

function normalizeHeader(value) {
  if (value == null) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_');
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const raw = value.trim().replace(/\s+/g, '');
    const n = Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatTime(XLSX, v) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1) {
    try {
      return XLSX.SSF.format('hh:mm', v);
    } catch {
      return null;
    }
  }
  return v != null ? String(v).trim() : null;
}

/**
 * Dado un array de headers normalizados, devuelve nonDataKeys y classKeys (misma lógica que el análisis).
 */
function buildNonDataKeysAndClassKeys(headers) {
  const colIndex = new Map(headers.map((h, i) => [h, i]).filter(([h]) => h));
  const findKey = (pred) => {
    for (const [k] of colIndex) {
      if (pred(k)) return k;
    }
    return null;
  };
  const sentidoKey = findKey(h => h === 'sentido' || h.includes('sentido')) || findKey(h => h.includes('direccion'));
  const rangoHoraKey = findKey(h => h.includes('rango') && h.includes('hora')) || findKey(h => h.includes('franja')) || findKey(h => h.includes('intervalo')) || findKey(h => h.includes('periodo'));
  const horaInicioKey = findKey(h => h.includes('hora') && h.includes('inicio'));
  const horaFinKey = findKey(h => h.includes('hora') && h.includes('fin'));
  const horaKey = findKey(h => h === 'hora' || (h.includes('hora') && !h.includes('fin') && !h.includes('inicio')));
  const totalKey = findKey(h => h.includes('mixt') || h === 'total' || h.includes('total'));
  const observKey = findKey(h => h.includes('observacion') || h.includes('conflicto') || h.includes('nota'));
  const nonDataKeys = new Set([sentidoKey, rangoHoraKey, horaKey, horaInicioKey, horaFinKey, totalKey, observKey].filter(Boolean));
  for (const h of headers) {
    if (!h) continue;
    if (h === 'nodo' || h === 'fecha' || h === 'acceso') nonDataKeys.add(h);
    if (h.includes('movimiento')) nonDataKeys.add(h);
  }
  const classKeys = headers.filter(Boolean).filter(h => !nonDataKeys.has(h));
  // movimiento/giro están en nonDataKeys (no se suman como clase de vehículo) pero se leen por separado vía movementKey → movement_raw
  return { nonDataKeys, classKeys };
}

const DEBUG_AFORO = process.env.DEBUG_AFORO === '1' || process.env.DEBUG_AFORO === 'true';

/**
 * Detecta la fila que es cabecera: debe tener sentido o movimiento, hora/rango/intervalo, y al menos 3 columnas candidatas a clases.
 */
function detectHeaderRowIndex(table) {
  for (let i = 0; i < Math.min(table.length, 50); i++) {
    const row = table[i];
    if (!Array.isArray(row)) continue;
    const rawHeaders = (row || []).map(v => normalizeHeader(v));
    const hasSentidoOrMovimiento = rawHeaders.some(h => h === 'sentido' || h.includes('sentido') || h.includes('movimiento'));
    const hasHora = rawHeaders.some(h => h.includes('hora') || h.includes('rango') || h.includes('intervalo') || h.includes('franja') || h.includes('periodo'));
    const { classKeys } = buildNonDataKeysAndClassKeys(rawHeaders);
    if (DEBUG_AFORO) {
      console.log('[DEBUG_AFORO] header candidate row', i, '-> headers encontrados:', rawHeaders.filter(Boolean).length ? rawHeaders.filter(Boolean) : '(vacío)');
    }
    if (hasSentidoOrMovimiento && hasHora && classKeys.length >= 3) return i;
  }
  return 0;
}

/**
 * Indica si una fila de cabecera tiene columnas de aforo (sentido, movimiento, periodo/hora).
 */
function hasAforoHeaderKeywords(rawHeaders) {
  if (!Array.isArray(rawHeaders)) return false;
  const set = new Set(rawHeaders.filter(Boolean).map(h => String(h).toLowerCase()));
  const has = (k) => set.has(k) || [...set].some(h => h.includes(k));
  return has('sentido') || has('movimiento') || has('periodo') || has('rango') || has('hora') || has('intervalo');
}

/**
 * Cabecera válida para tabla de aforo: tiene sentido y (periodo u hora/intervalo/rango/franja).
 * movimiento/acceso/giro opcionales.
 */
function isValidAforoHeader(headersNormalized) {
  if (!Array.isArray(headersNormalized)) return false;
  const raw = headersNormalized.filter(Boolean).map(h => String(h).toLowerCase());
  const has = (k) => raw.some(h => h === k || h.includes(k));
  const hasSentido = has('sentido');
  const hasTiempo = has('periodo') || has('hora') || has('intervalo') || has('rango') || has('franja');
  return hasSentido && hasTiempo;
}

/**
 * True si la fila parece datos (números, nodo+fecha+periodo numéricos), no cabecera.
 */
function rowLooksLikeData(rowCells) {
  if (!Array.isArray(rowCells) || rowCells.length < 3) return false;
  const first6 = rowCells.slice(0, 6);
  const numericCount = first6.filter(v => {
    if (v == null || String(v).trim() === '') return false;
    const n = Number(String(v).replace(/[,.\s]/g, '').replace(/\./g, ''));
    return Number.isFinite(n);
  }).length;
  if (numericCount >= 3) return true;
  const asStr = first6.map(v => v != null ? String(v).trim() : '');
  const looksLikeNodoFechaPeriodo = asStr[0] && /^\d+$/.test(asStr[0]) && asStr[1] && /^\d+$/.test(asStr[1]) && asStr[2] && (/^\d+$/.test(asStr[2]) || /^\d{3,4}$/.test(asStr[2]));
  return !!looksLikeNodoFechaPeriodo;
}

const METADATA_KEYWORDS = [
  'marco_contractual',
  'datos_generales',
  'responsables',
  'movimientos_del_estudio',
  'tipos_de_vehiculo_del_estudio'
];
const SENTIDO_VALUES = /^(we|ew|ns|sn|n|s|e|w)$/i;

/**
 * Score para preferir hojas "tabla de aforo" sobre metadata.
 * +100 sentido, +80 periodo/hora/rango, +40 acceso/movimiento/giro, +10*classKeysCount,
 * -60 metadata keywords, +20 si en primeras 10 filas sentido parece we|ew|n|s|e|w.
 */
function scoreSheetForAforo(headers, classKeys, table, headerRowIdx) {
  const raw = (headers || []).filter(Boolean).map(h => String(h).toLowerCase());
  const has = (k) => raw.some(h => h === k || h.includes(k));
  let score = 0;
  if (has('sentido')) score += 100;
  if (has('periodo') || has('hora') || has('rango') || has('intervalo') || has('franja')) score += 80;
  if (has('acceso') || has('movimiento') || has('giro')) score += 40;
  score += 10 * (classKeys?.length ?? 0);
  for (const kw of METADATA_KEYWORDS) {
    if (raw.some(h => h.includes(kw))) {
      score -= 60;
      break;
    }
  }
  const sentidoCol = headers.findIndex(h => h === 'sentido' || (h && String(h).toLowerCase().includes('sentido')));
  if (sentidoCol >= 0 && Array.isArray(table) && table.length > headerRowIdx + 1) {
    let count = 0;
    for (let r = headerRowIdx + 1; r < Math.min(table.length, headerRowIdx + 11); r++) {
      const cell = table[r]?.[sentidoCol];
      const v = cell != null ? String(cell).trim().toLowerCase() : '';
      if (SENTIDO_VALUES.test(v)) count++;
    }
    if (count >= 1) score += 20;
  }
  return score;
}

/**
 * Escanea todas las hojas y elige la de mayor score (tabla de aforo vs metadata).
 * Garantiza coherencia: headers/classKeys vienen siempre de la hoja seleccionada.
 */
function selectBestSheet(wb) {
  const names = wb.SheetNames || [];
  let best = null;
  let bestScore = -Infinity;
  for (const name of names) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!Array.isArray(table) || table.length < 2) continue;
    const headerRowIdx = detectHeaderRowIndex(table);
    const headers = (table[headerRowIdx] || []).map(v => normalizeHeader(v));
    const { classKeys } = buildNonDataKeysAndClassKeys(headers);
    const score = scoreSheetForAforo(headers, classKeys, table, headerRowIdx);
    if (DEBUG_AFORO) {
      console.log('[DEBUG_AFORO] candidate sheet:', name, 'classKeysCount:', classKeys.length, 'score:', score);
    }
    if (score > bestScore) {
      bestScore = score;
      best = { sheetName: name, table, headerRowIdx, headers, classKeys };
    } else if (best === null) {
      bestScore = score;
      best = { sheetName: name, table, headerRowIdx, headers, classKeys };
    }
  }
  if (!best) {
    const firstName = names[0];
    const firstWs = wb.Sheets[firstName];
    const firstTable = firstWs ? XLSX.utils.sheet_to_json(firstWs, { header: 1, raw: true, defval: null }) : [];
    const firstTableArr = Array.isArray(firstTable) ? firstTable : [];
    const hr = firstTableArr.length >= 2 ? detectHeaderRowIndex(firstTableArr) : 0;
    const hrHeaders = (firstTableArr[hr] || []).map(v => normalizeHeader(v));
    const { classKeys: firstCk } = buildNonDataKeysAndClassKeys(hrHeaders);
    best = { sheetName: firstName, table: firstTableArr, headerRowIdx: hr, headers: hrHeaders, classKeys: firstCk };
  }
  if (DEBUG_AFORO) {
    console.log('[DEBUG_AFORO] selected sheet:', best.sheetName, 'score:', bestScore);
  }
  return best;
}

function titleCase(s) {
  return String(s).toLowerCase().split(/[_\s]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Convierte periodo (600, "615", "6:00", "6:00 - 6:15") a número HHMM comparable. */
function periodToNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 2400) return value;
  const s = String(value).trim().replace(/\s+/g, ' ');
  const part = s.includes(' - ') ? s.split(' - ')[0].trim() : s;
  const n = parseInt(part.replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(n) && n >= 0 && n < 2400) return n;
  const match = part.match(/^(\d{1,2}):(\d{2})$/);
  if (match) return parseInt(match[1], 10) * 100 + parseInt(match[2], 10);
  return null;
}

/** Formatea número HHMM a "H:MM" o "HH:MM". */
function formatPeriodNum(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const h = Math.floor(n / 100);
  const m = n % 100;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Detecta duración del intervalo en minutos desde horaRango (ej. "07:00 - 07:15" -> 15).
 * Si no hay rango con "-", devuelve null y inferred true (se puede inferir después por diferencias).
 */
function parseIntervalMinutes(horaRango) {
  if (!horaRango || typeof horaRango !== 'string') return { minutes: null, inferred: true };
  const s = horaRango.trim();
  if (s.includes(' - ')) {
    const parts = s.split(' - ').map(p => p.trim());
    const parseMins = (t) => {
      const m = String(t).trim().match(/^(\d{1,2}):(\d{2})$/);
      if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const n = parseInt(String(t).replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n >= 0 && n < 2400) return Math.floor(n / 100) * 60 + (n % 100);
      return null;
    };
    const ini = parseMins(parts[0]);
    const fin = parseMins(parts[1] || parts[0]);
    if (ini != null && fin != null) {
      let diff = fin - ini;
      if (diff <= 0) diff += 24 * 60;
      return { minutes: diff, inferred: false };
    }
  }
  return { minutes: null, inferred: true };
}

/** Suma 15 minutos a HHMM (ej. 1800 → 1815, 1845 → 1900). */
function add15Min(hhmm) {
  if (hhmm == null || !Number.isFinite(hhmm)) return null;
  let h = Math.floor(hhmm / 100);
  let m = hhmm % 100;
  m += 15;
  if (m >= 60) {
    m -= 60;
    h += 1;
  }
  return h * 100 + m;
}

/**
 * Analiza un buffer Excel y devuelve JSON para el dashboard.
 * @param {Buffer} buffer - Contenido del .xlsx
 * @returns {{ resumen: object, distribucion_hora_pico: array, historial_conflictos: array }}
 */
export function analizarExcelBuffer(buffer) {
  if (!buffer || buffer.length < 4) {
    throw new Error('Archivo vacío o no válido');
  }
  if (buffer[0] === 0x7b || buffer[0] === 0x5b) {
    throw new Error('El contenido es JSON, no un Excel');
  }

  const wb = XLSX.read(buffer, { type: 'buffer' });
  const names = wb.SheetNames || [];
  if (names.length === 0) throw new Error('No se encontró hoja en el archivo');

  const best = selectBestSheet(wb);
  const { sheetName, table: selectedTable, headerRowIdx: bestHeaderRowIdx } = best;
  if (!Array.isArray(selectedTable) || selectedTable.length < 2) {
    throw new Error('No se encontraron datos tabulares');
  }

  // Garantizar coherencia: headers y classKeys se derivan SIEMPRE del table de la hoja seleccionada.
  let headerRowIdx = bestHeaderRowIdx;
  let headers = (selectedTable[headerRowIdx] || []).map(v => normalizeHeader(v));
  let { classKeys } = buildNonDataKeysAndClassKeys(headers);

  // PARTE 3: fallback a siguiente fila SOLO si la cabecera actual NO es válida y la siguiente no parece datos.
  const validHeader = isValidAforoHeader(headers);
  if (validHeader) {
    if (DEBUG_AFORO) console.log('[DEBUG_AFORO] fallback NO aplicado: cabecera válida (sentido+periodo/hora). headerRowIdx:', headerRowIdx);
  } else {
    const poorClassKeys = classKeys.length === 0 || (classKeys.length === 1 && classKeys[0] === 'pt');
    if (poorClassKeys && headerRowIdx + 1 < selectedTable.length) {
      const nextRow = selectedTable[headerRowIdx + 1] || [];
      const nextHeaders = nextRow.map(v => normalizeHeader(v));
      const nextLooksLikeData = rowLooksLikeData(nextRow);
      const { classKeys: nextClassKeys } = buildNonDataKeysAndClassKeys(nextHeaders);
      const nextValidHeader = isValidAforoHeader(nextHeaders);
      const improvesWithoutDestroying = nextClassKeys.length > classKeys.length && (nextValidHeader || nextClassKeys.length >= 2);
      if (nextLooksLikeData) {
        if (DEBUG_AFORO) console.log('[DEBUG_AFORO] fallback NO aplicado: fila siguiente parece datos (no usarla como cabecera). headerRowIdx:', headerRowIdx);
      } else if (improvesWithoutDestroying) {
        headerRowIdx = headerRowIdx + 1;
        headers = nextHeaders;
        classKeys = nextClassKeys;
        if (DEBUG_AFORO) console.log('[DEBUG_AFORO] fallback aplicado: cabecera actual no válida y fila siguiente mejora classKeys. headerRowIdx:', headerRowIdx, 'classKeys:', classKeys);
      } else {
        if (DEBUG_AFORO) console.log('[DEBUG_AFORO] fallback NO aplicado: cabecera actual no válida pero fila siguiente no mejora o destruiría columnas. headerRowIdx:', headerRowIdx);
      }
    } else {
      if (DEBUG_AFORO && !validHeader) console.log('[DEBUG_AFORO] fallback NO aplicado: cabecera no válida; no hay fila siguiente o classKeys no pobre. headerRowIdx:', headerRowIdx);
    }
  }

  if (DEBUG_AFORO) {
    console.log('[DEBUG_AFORO] headers_source_sheet:', sheetName);
    if (headers.length > 0 && headers[0] && !hasAforoHeaderKeywords(headers)) {
      console.warn('[DEBUG_AFORO] SHEET_HEADER_MISMATCH: cabecera sin sentido/movimiento/periodo; posible hoja incorrecta.');
    }
  }

  const { nonDataKeys } = buildNonDataKeysAndClassKeys(headers);
  const colIndex = new Map(headers.map((h, i) => [h, i]).filter(([h]) => h));

  const getCell = (row, key) => {
    const i = colIndex.get(key);
    return i != null ? row?.[i] : null;
  };
  const findKey = (pred) => {
    for (const [k] of colIndex) {
      if (pred(k)) return k;
    }
    return null;
  };

  const sentidoKey = findKey(h => h === 'sentido' || h.includes('sentido')) || findKey(h => h.includes('direccion'));
  const rangoHoraKey = findKey(h => h.includes('rango') && h.includes('hora')) || findKey(h => h.includes('franja')) || findKey(h => h.includes('intervalo')) || findKey(h => h.includes('periodo'));
  const horaInicioKey = findKey(h => h.includes('hora') && h.includes('inicio'));
  const horaFinKey = findKey(h => h.includes('hora') && h.includes('fin'));
  const horaKey = findKey(h => h === 'hora' || (h.includes('hora') && !h.includes('fin') && !h.includes('inicio')));
  const totalKey = findKey(h => h.includes('mixt') || h === 'total' || h.includes('total'));
  const observKey = findKey(h => h.includes('observacion') || h.includes('conflicto') || h.includes('nota'));
  const movementKey = findKey(h => h.includes('movimiento') || h === 'giro' || h.includes('giro'));

  if (DEBUG_AFORO) {
    console.log('[DEBUG_AFORO] sheetName:', sheetName);
    console.log('[DEBUG_AFORO] headerRowIdx:', headerRowIdx);
    console.log('[DEBUG_AFORO] headers normalizados:', headers);
    console.log('[DEBUG_AFORO] classKeys finales:', classKeys);
    console.log('[DEBUG_AFORO] movementKey detectado:', movementKey ?? '(ninguno)');
  }

  const rows = [];
  for (let r = headerRowIdx + 1; r < selectedTable.length; r++) {
    const row = selectedTable[r];
    if (!Array.isArray(row)) continue;
    const sentido = sentidoKey ? String(getCell(row, sentidoKey) ?? '').trim() : null;
    if (!sentido) continue;

    let horaRango = null;
    if (rangoHoraKey) horaRango = String(getCell(row, rangoHoraKey) ?? '').trim();
    else if (horaInicioKey && horaFinKey) {
      const hi = formatTime(XLSX, getCell(row, horaInicioKey));
      const hf = formatTime(XLSX, getCell(row, horaFinKey));
      if (hi && hf) horaRango = `${hi} - ${hf}`;
    } else if (horaKey) horaRango = formatTime(XLSX, getCell(row, horaKey)) || String(getCell(row, horaKey) ?? '').trim();
    if (!horaRango) continue;

    const totalCell = totalKey ? toNumber(getCell(row, totalKey)) : null;
    const classes = {};
    let sum = 0;
    for (const k of classKeys) {
      const v = toNumber(getCell(row, k));
      if (v != null) {
        classes[k] = v;
        sum += v;
      }
    }
    const total = totalCell != null ? totalCell : (sum > 0 ? sum : null);
    if (total == null) continue;

    const observ = observKey ? getCell(row, observKey) : null;
    const periodNum = periodToNumber(horaRango);
    const movementRaw = movementKey != null ? (getCell(row, movementKey) != null ? String(getCell(row, movementKey)).trim() : null) : null;
    const { minutes: intervalMinutes, inferred: intervalInferred } = parseIntervalMinutes(horaRango);
    rows.push({
      sentido,
      horaRango,
      periodNum,
      total,
      classes,
      observ: observ != null && String(observ).trim() ? String(observ).trim() : null,
      movement_raw: movementRaw || undefined,
      interval_minutes: intervalMinutes ?? undefined,
      interval_inferred: intervalInferred
    });
  }

  if (DEBUG_AFORO) {
    console.log('[DEBUG_AFORO] sample classes keys:', Object.keys(rows[0]?.classes || {}));
    if (movementKey) {
      const samples = rows.slice(0, 3).map(r => r.movement_raw ?? null);
      console.log('[DEBUG_AFORO] sample movement_raw (3 filas):', samples);
      const nonNull = rows.slice(0, 10).filter(r => r.movement_raw != null && String(r.movement_raw).trim() !== '');
      if (nonNull.length === 0) {
        console.log('[DEBUG_AFORO] no existen movement_raw no nulos en este Excel (columna movimiento/giro presente pero vacía o sin datos en primeras filas).');
      } else {
        console.log('[DEBUG_AFORO] ejemplos movement_raw no nulos:', nonNull.slice(0, 3).map(r => r.movement_raw));
      }
    } else {
      console.log('[DEBUG_AFORO] movementKey no detectado; no hay columna movimiento/giro en este Excel.');
    }
  }

  if (rows.length === 0) {
    const totalDataRows = selectedTable.length - headerRowIdx - 1;
    const reasons = [];
    if (classKeys.length === 0) reasons.push('sin columnas de clase');
    if (classKeys.length === 1 && classKeys[0] === 'pt') reasons.push('classKeysCount=1 (solo pt)');
    if (!findKey(h => h === 'sentido' || h.includes('sentido'))) reasons.push('no hay columna sentido');
    const rangoHoraK = findKey(h => h.includes('rango') && h.includes('hora')) || findKey(h => h.includes('franja')) || findKey(h => h.includes('intervalo')) || findKey(h => h.includes('periodo'));
    if (!rangoHoraK && !findKey(h => h.includes('hora') && h.includes('inicio'))) reasons.push('no hay columnas de tiempo/periodo');
    if (totalDataRows <= 0) reasons.push('no hay filas de datos');
    if (reasons.length === 0) reasons.push('sin filas válidas (revisar cabecera y columnas de tiempo/sentido)');
    const msg = `No se pudieron interpretar filas del aforo: ${reasons.join('; ')}.`;
    const noRowsReason = reasons.join('; ');
    const err = new Error(msg);
    err.quality = {
      sheetName,
      headerRowIdx,
      classKeysCount: classKeys.length,
      totalDataRows,
      noRowsReason
    };
    throw err;
  }

  const uniquePeriods = [...new Set(rows.map(r => r.periodNum).filter(n => n != null))].sort((a, b) => a - b);
  const WINDOW_SIZE = 4;
  let peakWindow = null;
  let peakSum = -Infinity;
  for (let i = 0; i <= uniquePeriods.length - WINDOW_SIZE; i++) {
    const window = uniquePeriods.slice(i, i + WINDOW_SIZE);
    const windowSet = new Set(window);
    const sum = rows.filter(r => windowSet.has(r.periodNum)).reduce((acc, r) => acc + r.total, 0);
    if (sum > peakSum) {
      peakSum = sum;
      peakWindow = window;
    }
  }
  if (!peakWindow || peakWindow.length !== WINDOW_SIZE) throw new Error('No se pudo calcular la hora pico (bloque de 4 periodos)');

  const peakWindowSet = new Set(peakWindow);
  const finMas15 = add15Min(peakWindow[3]);
  const peakHoraLabel = `${formatPeriodNum(peakWindow[0])}-${formatPeriodNum(finMas15)}`;

  const peakRows = rows.filter(r => peakWindowSet.has(r.periodNum));
  const byPeriodSentido = new Map();
  for (const r of peakRows) {
    const key = `${r.periodNum}-${r.sentido}`;
    if (!byPeriodSentido.has(key)) byPeriodSentido.set(key, []);
    byPeriodSentido.get(key).push(r);
  }
  for (const [, list] of byPeriodSentido) {
    list.sort((a, b) => a.total - b.total);
  }
  const sentidoDisplayKey = (sentido, blockIndex) => blockIndex === 0 ? sentido : `${sentido}${blockIndex}`;
  const bySentido = new Map();
  const classHeaders = [...new Set(rows.flatMap(r => Object.keys(r.classes || {})))].filter(k => classKeys.includes(k)).slice(0, 8);
  for (const r of peakRows) {
    const key = `${r.periodNum}-${r.sentido}`;
    const list = byPeriodSentido.get(key);
    const blockIndex = list.indexOf(r);
    const displayKey = sentidoDisplayKey(r.sentido, blockIndex);
    const ent = bySentido.get(displayKey) || { sentido: normalizeSentido(displayKey), total: 0 };
    ent.total += r.total;
    for (const [k, v] of Object.entries(r.classes || {})) {
      ent[k] = (ent[k] || 0) + v;
    }
    bySentido.set(displayKey, ent);
  }

  const distribucion_hora_pico = Array.from(bySentido.values()).sort((a, b) => a.sentido.localeCompare(b.sentido));
  const volumenTotalPico = distribucion_hora_pico.reduce((acc, ent) => acc + (ent.total ?? 0), 0);

  const historial_conflictos = [];
  for (const r of rows) {
    if (r.observ) {
      historial_conflictos.push({
        hora: r.horaRango,
        sentido: normalizeSentido(r.sentido),
        descripcion: r.observ
      });
    }
  }

  const resumen = {
    hora_pico_inicio: formatPeriodNum(peakWindow[0]),
    hora_pico_fin: formatPeriodNum(finMas15),
    hora_pico_rango: peakHoraLabel,
    volumen_total_pico: Math.round(volumenTotalPico)
  };

  // Extraer hoja de identificación (código vehículo, nombre, factor equivalencia)
  const hojaIdentificacion = extraerHojaIdentificacion(wb);

  const intervalDetected = !!(rangoHoraKey || (horaInicioKey && horaFinKey) || horaKey);
  const quality = {
    sheetScore: classKeys.length,
    headerConfidence: classKeys.length >= 3 ? 'high' : 'low',
    classKeysCount: classKeys.length,
    classKeys: [...classKeys],
    movementDetected: !!movementKey,
    intervalDetected,
    totalRows: selectedTable.length - headerRowIdx - 1,
    validRows: rows.length,
    warnings: [],
    checks: {}
  };

  // A1) Check suma hora pico (tolerancia 1 para redondeos)
  const PICO_TOL = 1;
  if (resumen.volumen_total_pico != null && Array.isArray(distribucion_hora_pico) && distribucion_hora_pico.length > 0) {
    const sumaDistrib = distribucion_hora_pico.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
    const delta = resumen.volumen_total_pico - sumaDistrib;
    const deltaAbs = Math.abs(delta);
    quality.checks.pico_resumen = resumen.volumen_total_pico;
    quality.checks.pico_suma_distrib = Math.round(sumaDistrib);
    quality.checks.pico_delta = Math.round(delta * 100) / 100;
    quality.checks.pico_delta_abs = Math.round(deltaAbs * 100) / 100;
    quality.checks.pico_tol = PICO_TOL;
    if (deltaAbs > PICO_TOL) {
      quality.warnings.push(`Hora pico inconsistente: resumen=${resumen.volumen_total_pico} vs sumaDistrib=${Math.round(sumaDistrib)} (delta=${quality.checks.pico_delta})`);
    }
  }

  // A2) Check intervalos: no asumir 15 fijo; inferir de data o diffs
  if (rows.length > 0) {
    const gapBySentido = {};
    let gapsTotal = 0;
    let intervalMinutesInferred = 15;
    let intervalMinutesSource = 'default15';

    const fromData = rows.filter((r) => r.interval_minutes != null && Number.isFinite(r.interval_minutes));
    if (fromData.length > 0) {
      const mode = (arr) => {
        const counts = {};
        for (const v of arr) {
          const k = String(v);
          counts[k] = (counts[k] || 0) + 1;
        }
        let max = 0;
        let val = 15;
        for (const [k, c] of Object.entries(counts)) {
          if (c > max) {
            max = c;
            val = parseInt(k, 10) || 15;
          }
        }
        return val;
      };
      intervalMinutesInferred = mode(fromData.map((r) => r.interval_minutes));
      intervalMinutesSource = 'data';
    } else {
      const diffs = [];
      const bySentido = new Map();
      for (const r of rows) {
        const s = String(r.sentido ?? '').trim().toUpperCase();
        if (!bySentido.has(s)) bySentido.set(s, []);
        bySentido.get(s).push(r);
      }
      for (const [, list] of bySentido) {
        const sorted = [...list].sort((a, b) => (a.periodNum ?? 0) - (b.periodNum ?? 0));
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1].periodNum;
          const curr = sorted[i].periodNum;
          if (prev != null && curr != null) {
            const d = curr - prev;
            if (d > 0) diffs.push(d);
          }
        }
      }
      if (diffs.length > 0) {
        const mode = (arr) => {
          const counts = {};
          for (const v of arr) {
            const k = String(v);
            counts[k] = (counts[k] || 0) + 1;
          }
          let max = 0;
          let val = 15;
          for (const [k, c] of Object.entries(counts)) {
            if (c > max) {
              max = c;
              val = parseInt(k, 10) || 15;
            }
          }
          return val;
        };
        intervalMinutesInferred = mode(diffs);
        intervalMinutesSource = 'inferred';
      }
    }

    quality.checks.interval_minutes_inferred = intervalMinutesInferred;
    quality.checks.interval_minutes_source = intervalMinutesSource;

    const groupKey = (r) => {
      const s = String(r.sentido ?? '').trim().toUpperCase();
      if (r.movement_raw != null && String(r.movement_raw).trim() !== '') {
        return `${s}|${String(r.movement_raw).trim()}`;
      }
      return s;
    };
    const groups = new Map();
    for (const r of rows) {
      const k = groupKey(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const [grp, list] of groups) {
      const sorted = [...list].sort((a, b) => (a.periodNum ?? 0) - (b.periodNum ?? 0));
      const sentidoLabel = (sorted[0]?.sentido != null ? String(sorted[0].sentido).trim().toUpperCase() : grp.split('|')[0]) || '?';
      let count = 0;
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1].periodNum;
        const curr = sorted[i].periodNum;
        if (prev != null && curr != null) {
          const diff = curr - prev;
          if (diff > intervalMinutesInferred) {
            count++;
          }
        }
      }
      if (count > 0) {
        gapBySentido[sentidoLabel] = count;
        gapsTotal += count;
      }
    }
    quality.checks.gaps_total = gapsTotal;
    quality.checks.gaps_by_sentido = gapBySentido;
    if (gapsTotal > 0) {
      const bySent = Object.entries(gapBySentido).map(([s, n]) => `${s}:${n}`).join(', ');
      quality.warnings.push(`Huecos de intervalo detectados (${gapsTotal}, intervalo=${intervalMinutesInferred}min): ${bySent}. Revisar periodos consecutivos.`);
    }
  }

  // A3) Check clases (solo pt)
  quality.checks.classKeysRaw = [...classKeys];
  quality.checks.classHeaders = classHeaders?.length ? classHeaders : undefined;
  if (classKeys.length === 1 && classKeys[0] === 'pt') {
    quality.warnings.push('Solo 1 clase detectada (pt).');
  }

  return {
    resumen,
    distribucion_hora_pico,
    class_headers: classHeaders.map(k => ({ key: k, label: normalizeClaseVehiculo(k) || titleCase(k) })),
    historial_conflictos,
    vol_data_completo: rows.map(r => ({ ...r, sentido: normalizeSentido(r.sentido) })),
    hoja_identificacion: hojaIdentificacion,
    quality
  };
}

/**
 * Busca hoja "Identificación" (o similar) y extrae código vehículo, nombre, factor equivalencia
 */
function extraerHojaIdentificacion(wb) {
  const names = wb.SheetNames || [];
  const identSheet = names.find(n => {
    const s = String(n).toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s === 'identificacion' || s.includes('identificacion') || s === 'identificación';
  });
  if (!identSheet) return [];

  const ws = wb.Sheets[identSheet];
  const table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (!Array.isArray(table) || table.length < 2) return [];

  const headerRow = (table[0] || []).map(v => normalizeHeader(String(v ?? '')));
  const codigoKey = headerRow.find(h => h === 'codigo' || h === 'codigo_vehiculo' || (h && h.includes('codigo')));
  const nombreKey = headerRow.find(h => h === 'nombre' || h === 'nombre_vehiculo' || (h && (h.includes('nombre') || h.includes('tipo'))));
  const factorKey = headerRow.find(h => h === 'factor' || h === 'factor_equivalencia' || (h && (h.includes('factor') || h.includes('equivalencia'))));

  if (!codigoKey && !nombreKey && !factorKey) return [];

  const colIdx = (key) => key ? headerRow.indexOf(key) : -1;
  const codigoIdx = colIdx(codigoKey);
  const nombreIdx = colIdx(nombreKey);
  const factorIdx = colIdx(factorKey);

  const out = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!Array.isArray(row)) continue;
    const codigo = codigoIdx >= 0 ? (row[codigoIdx] != null ? String(row[codigoIdx]).trim() : '') : '';
    const nombre = nombreIdx >= 0 ? (row[nombreIdx] != null ? String(row[nombreIdx]).trim() : '') : '';
    const factorRaw = factorIdx >= 0 ? row[factorIdx] : null;
    const factor = factorRaw != null && factorRaw !== '' ? (typeof factorRaw === 'number' ? factorRaw : parseFloat(String(factorRaw).replace(',', '.'))) : null;
    if (codigo || nombre || (factor != null && Number.isFinite(factor))) {
      out.push({
        codigo_vehiculo: codigo || null,
        nombre_vehiculo: nombre || null,
        factor_equivalencia: Number.isFinite(factor) ? factor : null
      });
    }
  }
  return out;
}

/**
 * Diagnóstico por hoja (solo lectura). Para debug_dim_workbook_sheets.js.
 * @param {import('xlsx').WorkBook} wb
 * @returns {{ sheetName: string, headerRowIdx: number, headers: string[], hasSentido: boolean, hasPeriodo: boolean, hasMovimiento: boolean, classKeysCount: number }[]}
 */
export function getWorkbookSheetsDiagnostics(wb) {
  const names = wb.SheetNames || [];
  const out = [];
  for (const name of names) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!Array.isArray(table) || table.length < 2) continue;
    const headerRowIdx = detectHeaderRowIndex(table);
    const headers = (table[headerRowIdx] || []).map(v => normalizeHeader(v));
    const { classKeys } = buildNonDataKeysAndClassKeys(headers);
    const hasSentido = headers.some(h => h === 'sentido' || (h && h.includes('sentido')));
    const hasPeriodo = headers.some(h => h && (h.includes('periodo') || h.includes('hora') || h.includes('rango') || h.includes('intervalo') || h.includes('franja')));
    const hasMovimiento = headers.some(h => h && (h.includes('movimiento') || h.includes('acceso') || h.includes('giro')));
    out.push({
      sheetName: name,
      headerRowIdx,
      headers: headers.filter(Boolean),
      hasSentido,
      hasPeriodo,
      hasMovimiento,
      classKeysCount: classKeys.length
    });
  }
  return out;
}

export { selectBestSheet };
