/**
 * Diagnóstico de conectividad: dos targets (ArcGIS + Datos Abiertos KMZ).
 * Para cada target: DNS, TCP:443, TLS, HTTP. Tabla final Markdown.
 * Exit 0 si al menos un origen de Agéndate está disponible (ArcGIS OK, KMZ URL OK, o AGENDATE_KMZ_FILE existe).
 * Exit 1 si ninguno disponible.
 */

import dns from 'dns';
import net from 'net';
import tls from 'tls';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../../..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const DEFAULT_TIMEOUT_MS = parseInt(process.env.AGENDATE_TIMEOUT_MS || '15000', 10);
const AGENDATE_ARCGIS_LAYER_URL =
  process.env.AGENDATE_ARCGIS_LAYER_URL ||
  'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer/4';
const DEFAULT_KMZ_URL =
  'https://datosabiertos.bogota.gov.co/dataset/71c46905-c085-47cb-9f22-e743e455fb1d/resource/68c7aa64-deb5-4efd-b329-07a88828c1c5/download/lugar_evento_agendate.kmz';
const AGENDATE_KMZ_URL = process.env.AGENDATE_KMZ_URL || DEFAULT_KMZ_URL;

function parseUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

async function dnsLookup(host) {
  const resolver = dns.promises;
  try {
    const [v4, v6] = await Promise.allSettled([
      resolver.resolve4(host),
      resolver.resolve6(host).catch(() => []),
    ]);
    const a = v4.status === 'fulfilled' ? v4.value : [];
    const aaaa = v6.status === 'fulfilled' ? v6.value : [];
    if (a.length || aaaa.length) return { ok: true, ip: (a[0] || aaaa[0] || ''), err: null };
    return { ok: false, ip: null, err: 'No addresses' };
  } catch (err) {
    return { ok: false, ip: null, err: err.code || err.message || String(err) };
  }
}

function tcpConnect(host, port = 443, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, latencyMs: null, err: 'TCP timeout ' + timeoutMs + ' ms' });
    }, timeoutMs);
    socket.setTimeout(timeoutMs);
    socket.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, latencyMs: null, err: (err.code || err.message) + (err.message ? ' - ' + err.message : '') });
    });
    socket.on('timeout', () => {
      socket.destroy();
      clearTimeout(timer);
      resolve({ ok: false, latencyMs: null, err: 'TCP timeout' });
    });
    socket.connect(port, host, () => {
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      socket.end();
      resolve({ ok: true, latencyMs, err: null });
    });
  });
}

function tlsHandshake(host, port = 443, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: true },
      () => {
        const cert = socket.getPeerCertificate();
        const cn = cert && cert.subject ? (cert.subject.CN || '') : '';
        const validTo = cert && cert.valid_to ? cert.valid_to : '';
        socket.end();
        resolve({ ok: true, cn, validTo, err: null });
      }
    );
    socket.setTimeout(timeoutMs);
    socket.on('error', (err) => resolve({ ok: false, cn: null, validTo: null, err: (err.code || err.message) + (err.message ? ' - ' + err.message : '') }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ ok: false, cn: null, validTo: null, err: 'TLS timeout' });
    });
  });
}

async function httpRequest(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status, bytes: null, err: 'HTTP ' + res.status };
    const buf = await res.arrayBuffer();
    return { ok: true, status: res.status, bytes: buf.byteLength, err: null };
  } catch (err) {
    clearTimeout(t);
    const detail = [err.name, err.code, err.message].filter(Boolean).join(' ');
    const cause = err.cause ? (err.cause.message || err.cause.code || '') : '';
    return { ok: false, status: null, bytes: null, err: detail + (cause ? ' (cause: ' + cause + ')' : '') };
  }
}

function proxyEnv() {
  const vars = ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'];
  let hasProxy = false;
  for (const v of vars) {
    const val = process.env[v];
    if (val) {
      const safe = val.replace(/:[^:@\/]+@/, ':****@');
      console.log('[DIAG]   ', v + ':', safe.slice(0, 80) + (safe.length > 80 ? '...' : ''));
      if (/PROXY/i.test(v) && !/NO_PROXY|no_proxy/i.test(v)) hasProxy = true;
    }
  }
  if (hasProxy) {
    console.log('[DIAG]   Recomendación: comprueba que NO_PROXY incluya serviciosgis.catastrobogota.gov.co o que el proxy permite CONNECT a este host.');
  }
}

async function runTarget(name, host, httpUrl, timeoutMs) {
  const result = { name: name.slice(0, 28), dns: '❌', tcp: '-', tls: '-', http: '-', result: '❌ bloqueado' };
  console.log('\n[DIAG] Target:', name);
  console.log('[DIAG]   Host:', host);

  const dnsRes = await dnsLookup(host);
  result.dns = dnsRes.ok ? '✅' : '❌ DNS FAIL';
  if (dnsRes.ok) console.log('[DIAG]   DNS:', dnsRes.ip);
  else console.log('[DIAG]   DNS FAIL:', dnsRes.err);

  if (!dnsRes.ok) {
    result.result = '❌ bloqueado (DNS)';
    return result;
  }

  const tcpRes = await tcpConnect(host, 443, timeoutMs);
  result.tcp = tcpRes.ok ? `✅ ${tcpRes.latencyMs}ms` : '❌ TO';
  if (tcpRes.ok) console.log('[DIAG]   TCP:443:', tcpRes.latencyMs + ' ms');
  else console.log('[DIAG]   TCP:443 FAIL:', tcpRes.err);

  if (!tcpRes.ok) {
    result.tcp = '❌ TO';
    result.result = '❌ bloqueado';
    return result;
  }

  const tlsRes = await tlsHandshake(host, 443, timeoutMs);
  result.tls = tlsRes.ok ? '✅' : '❌ TLS_FAIL';
  if (tlsRes.ok) console.log('[DIAG]   TLS: OK (CN:', (tlsRes.cn || '').slice(0, 40) + (tlsRes.validTo ? ', expiry ' + tlsRes.validTo : '') + ')');
  else console.log('[DIAG]   TLS FAIL:', tlsRes.err);

  if (!tlsRes.ok) {
    result.result = '❌ bloqueado (TLS)';
    return result;
  }

  const httpRes = await httpRequest(httpUrl, timeoutMs);
  result.http = httpRes.ok ? `✅ ${httpRes.status}` : '❌ HTTP_FAIL';
  if (httpRes.ok) console.log('[DIAG]   HTTP:', httpRes.status, (httpRes.bytes != null ? httpRes.bytes + ' bytes' : ''));
  else console.log('[DIAG]   HTTP FAIL:', httpRes.err);

  if (httpRes.ok) result.result = '✅ OK';
  else result.result = '❌ bloqueado (HTTP)';
  return result;
}

async function main() {
  console.log('Diagnóstico Agéndate: ArcGIS + Datos Abiertos (KMZ)');
  console.log('Timeout:', DEFAULT_TIMEOUT_MS, 'ms');

  proxyEnv();

  const arcgisUrl = AGENDATE_ARCGIS_LAYER_URL.replace(/\/?$/, '') + '?f=pjson';
  const arcgisHost = parseUrl(AGENDATE_ARCGIS_LAYER_URL)?.hostname || 'serviciosgis.catastrobogota.gov.co';

  const row1 = await runTarget('serviciosgis.catastrobogota.gov.co (ArcGIS)', arcgisHost, arcgisUrl, DEFAULT_TIMEOUT_MS);

  let row2 = { name: 'datosabiertos.bogota.gov.co (KMZ)', dns: '-', tcp: '-', tls: '-', http: '-', result: '-' };
  const kmzHost = parseUrl(AGENDATE_KMZ_URL)?.hostname;
  if (kmzHost) {
    row2 = await runTarget('datosabiertos.bogota.gov.co (KMZ)', kmzHost, AGENDATE_KMZ_URL, DEFAULT_TIMEOUT_MS);
  } else {
    console.log('\n[DIAG] Target 2: AGENDATE_KMZ_URL no definida o inválida; se omite.');
  }

  const kmzFile = process.env.AGENDATE_KMZ_FILE;
  let fileExists = false;
  if (kmzFile) {
    try {
      const stat = await fs.stat(kmzFile);
      fileExists = stat.isFile();
      console.log('\n[DIAG] AGENDATE_KMZ_FILE:', kmzFile, fileExists ? '✅ existe (' + stat.size + ' bytes)' : '❌ no es archivo');
    } catch {
      console.log('\n[DIAG] AGENDATE_KMZ_FILE:', kmzFile, '❌ no encontrado o no accesible');
    }
  }

  console.log('\n[DIAG] Resumen (tabla):');
  console.log('  TARGET                      | DNS | TCP:443   | TLS | HTTP   | RESULT');
  console.log('  ----------------------------+-----+-----------+-----+--------+------------------');
  console.log('  ' + row1.name.padEnd(28) + ' | ' + row1.dns.padEnd(3) + ' | ' + String(row1.tcp).padEnd(9) + ' | ' + String(row1.tls).padEnd(3) + ' | ' + String(row1.http).padEnd(6) + ' | ' + row1.result);
  console.log('  ' + row2.name.padEnd(28) + ' | ' + row2.dns.padEnd(3) + ' | ' + String(row2.tcp).padEnd(9) + ' | ' + String(row2.tls).padEnd(3) + ' | ' + String(row2.http).padEnd(6) + ' | ' + row2.result);
  if (kmzFile) {
    console.log('  AGENDATE_KMZ_FILE (local)   | ' + (fileExists ? '✅' : '❌') + '  | (no red)  | -   | -      | ' + (fileExists ? '✅ disponible' : '❌ no existe'));
  }

  const arcgisOk = row1.result === '✅ OK';
  const kmzUrlOk = row2.result === '✅ OK';
  const anyAvailable = arcgisOk || kmzUrlOk || fileExists;

  if (!anyAvailable) {
    console.error('\n[DIAG] No hay fuente de Agéndate disponible.');
    console.error('[DIAG] Descarga el KMZ manualmente y configura AGENDATE_KMZ_FILE.');
    process.exit(1);
  }
  console.log('\n[DIAG] Al menos una fuente disponible (ArcGIS, KMZ URL o KMZ local).');
  process.exit(0);
}

main();
