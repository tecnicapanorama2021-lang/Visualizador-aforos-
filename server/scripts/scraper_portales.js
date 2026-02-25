/**
 * Scraper de portales SDM/SDP: descubre enlaces a PDF/XLSX/CSV de estudios de tránsito
 * y los registra en archivos_fuente. Primero intenta axios; si 403/timeout/socket hang up
 * usa Playwright headless (máx. 5 seeds por ejecución).
 *
 * Entrada: server/scripts/data/portales_seeds.json
 * Uso: node server/scripts/scraper_portales.js
 *      node server/scripts/scraper_portales.js --download
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { query, closePool } from '../db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '../..');
const SEEDS_PATH = path.join(__dirname, 'data', 'portales_seeds.json');
const DOWNLOAD_BASE = path.join(PROJECT_ROOT, 'data', 'sdm', 'anexos');
const PLAYWRIGHT_SEEDS_LIMIT = 5;

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

function getTipoFromFilename(nombre) {
  const ext = path.extname(nombre).toLowerCase();
  if (['.xlsx', '.xls'].includes(ext)) return 'XLSX';
  if (ext === '.csv') return 'CSV';
  if (ext === '.pdf') return 'PDF';
  return 'PDF';
}

/**
 * True si el nombre del archivo coincide con algún patrón de la seed (case-insensitive).
 */
function nombreCoincidePatrones(nombreArchivo, patronesNombre) {
  const nombre = String(nombreArchivo || '').toLowerCase();
  const patrones = Array.isArray(patronesNombre) ? patronesNombre : [];
  if (patrones.length === 0) return true;
  return patrones.some((p) => nombre.includes(String(p).toLowerCase()));
}

async function ensureUrlRemotaColumn() {
  const r = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'url_remota'`
  );
  if (!r.rows[0]) {
    console.warn('[scraper-portales] Columna url_remota no existe. Ejecuta: npm run db:migrate');
    return false;
  }
  return true;
}

/**
 * Registra o ignora un archivo en archivos_fuente (por url_remota + origen para evitar duplicados).
 */
async function registrarArchivo(origen, nombre_archivo, tipo, url_remota) {
  const hasUrl = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'archivos_fuente' AND column_name = 'url_remota'`
  ).then((r) => r.rows[0]);
  if (!hasUrl) return { action: 'skip', reason: 'no_url_remota' };

  const existing = await query(
    'SELECT id FROM archivos_fuente WHERE url_remota = $1 AND origen = $2 LIMIT 1',
    [url_remota, origen]
  );
  if (existing.rows[0]) return { action: 'skip', id: existing.rows[0].id };

  await query(
    `INSERT INTO archivos_fuente (tipo, origen, nombre_archivo, hash, procesado, url_remota, updated_at)
     VALUES ($1, $2, $3, NULL, FALSE, $4, NOW())`,
    [tipo, origen, nombre_archivo, url_remota]
  );
  const r = await query('SELECT id FROM archivos_fuente WHERE url_remota = $1 AND origen = $2 LIMIT 1', [url_remota, origen]);
  return { action: 'registered', id: r.rows[0].id };
}

function needsPlaywrightFallback(err) {
  const status = err.response?.status;
  if (status === 403) return true;
  if (status === 404) return false;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('etimedout') || msg.includes('socket hang up') || err.code === 'ECONNABORTED';
}

async function extractLinksWithPlaywright(seed) {
  let chromium;
  try {
    const playwrightExtra = await import('playwright-extra');
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    chromium = playwrightExtra.chromium;
    chromium.use(StealthPlugin());
  } catch {
    const pw = await import('playwright');
    chromium = pw.chromium;
  }
  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.PROXY_URL ? { server: process.env.PROXY_URL } : undefined,
  });
  const links = [];
  try {
    const page = await browser.newPage();
    await page.goto(seed.baseUrl, { waitUntil: 'networkidle', timeout: 45000 });
    const patronLinks = seed.patronLinks || "a[href*='.pdf'], a[href*='.xlsx'], a[href*='.csv']";
    const hrefs = await page.$$eval(patronLinks, (as, baseHref) => {
      const base = new URL(baseHref);
      return as.map((a) => {
        const href = a.getAttribute('href');
        if (!href) return null;
        try {
          const abs = new URL(href, base).href;
          const nombre = (a.textContent || '').trim() || new URL(abs).pathname.split('/').pop() || 'documento.pdf';
          return { url: abs, nombre };
        } catch { return null; }
      }).filter(Boolean);
    }, seed.baseUrl);
    const patrones = seed.patronesNombre || ['aforo', 'conteo', 'estudio', 'tránsito', 'PMT'];
    for (const { url, nombre } of hrefs) {
      const nom = (nombre || path.basename(new URL(url).pathname)).toLowerCase();
      if (patrones.some((p) => nom.includes(String(p).toLowerCase()))) {
        links.push({ url, nombre: nombre || path.basename(new URL(url).pathname) });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return links;
}

async function processSeed(seed, doDownload, totalLinks, registered) {
  const origen = seed.origen || 'SDM';
  const patronLinks = seed.patronLinks || "a[href*='.pdf'], a[href*='.xlsx'], a[href*='.csv']";
  const patronesNombre = seed.patronesNombre || ['aforo', 'conteo', 'estudio', 'tránsito', 'PMT'];
  let hrefs = [];
  try {
    const res = await axios.get(seed.baseUrl, {
      timeout: 30000,
      responseType: 'text',
      headers: { 'User-Agent': 'PanoramaAforos/1.0 (scraper portales)' },
      maxRedirects: 5,
    });
    const $ = cheerio.load(res.data);
    const base = new URL(seed.baseUrl);
    const seen = new Set();
    $(patronLinks).each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const abs = new URL(href, base).href;
        if (seen.has(abs)) return;
        seen.add(abs);
        const nombre = path.basename(new URL(abs).pathname) || 'documento.pdf';
        if (!nombreCoincidePatrones(nombre, patronesNombre)) return;
        hrefs.push({ url: abs, nombre });
      } catch {}
    });
  } catch (err) {
    if (needsPlaywrightFallback(err)) {
      return { fallback: true, hrefs: [], totalLinks, registered };
    }
    if (err.response?.status === 404) console.warn('[scraper-portales] No encontrado (404):', seed.baseUrl);
    else console.warn('[scraper-portales] Error:', seed.baseUrl, err.message);
    return { fallback: false, hrefs: [], totalLinks, registered };
  }
  for (const { url, nombre } of hrefs) {
    totalLinks++;
    const tipo = getTipoFromFilename(nombre);
    const result = await registrarArchivo(origen, nombre, tipo, url);
    if (result.action === 'registered') {
      registered++;
      console.log('[scraper-portales] Registrado:', origen, nombre.slice(0, 50), url.slice(0, 60));
    }
    if (doDownload) {
      try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
        const dir = path.join(DOWNLOAD_BASE, origen);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, nombre.replace(/[<>:"/\\|?*]/g, '_')), res.data);
      } catch (e) {
        console.warn('[scraper-portales] Error descargando', url, e.message);
      }
    }
  }
  return { fallback: false, hrefs, totalLinks, registered };
}

async function main() {
  const doDownload = process.argv.includes('--download');

  if (!fs.existsSync(SEEDS_PATH)) {
    console.error('[scraper-portales] No encontrado:', SEEDS_PATH);
    process.exit(1);
  }

  const seeds = JSON.parse(fs.readFileSync(SEEDS_PATH, 'utf8'));
  if (!Array.isArray(seeds)) {
    console.error('[scraper-portales] portales_seeds.json debe ser un array.');
    process.exit(1);
  }

  const hasUrl = await ensureUrlRemotaColumn();
  if (!hasUrl) process.exit(1);

  let totalLinks = 0;
  let registered = 0;
  const fallbackSeeds = [];

  for (const seed of seeds) {
    const result = await processSeed(seed, doDownload, totalLinks, registered);
    totalLinks = result.totalLinks;
    registered = result.registered;
    if (result.fallback) fallbackSeeds.push(seed);
  }

  const toPlaywright = fallbackSeeds.slice(0, PLAYWRIGHT_SEEDS_LIMIT);
  if (toPlaywright.length > 0) {
    console.log('[scraper-portales] Fallback Playwright para', toPlaywright.length, 'seeds');
    for (const seed of toPlaywright) {
      try {
        const links = await extractLinksWithPlaywright(seed);
        const origen = seed.origen || 'SDM';
        for (const { url, nombre } of links) {
          totalLinks++;
          const tipo = getTipoFromFilename(nombre);
          const result = await registrarArchivo(origen, nombre, tipo, url);
          if (result.action === 'registered') {
            registered++;
            console.log('[scraper-portales] Registrado (Playwright):', origen, nombre.slice(0, 50));
          }
        }
      } catch (err) {
        console.warn('[scraper-portales] Playwright falló para', seed.baseUrl, err.message);
      }
    }
  }

  await closePool();
  console.log('[scraper-portales] Enlaces encontrados:', totalLinks, '| Registrados nuevos:', registered);
}

main().catch((err) => {
  console.error('[scraper-portales]', err.message);
  process.exit(1);
});
