/**
 * Extrae anexos (PDF/XLSX/CSV) desde páginas url_contrato de Colombia Compra usando
 * Playwright headless + stealth para evitar detección 403. Incluye fallback por API/colombiacompra.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { esAnexoAforo } from './utils_aforos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--window-size=1920,1080',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

let chromium;
try {
  const playwrightExtra = await import('playwright-extra');
  const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
  chromium = playwrightExtra.chromium;
  chromium.use(StealthPlugin());
} catch (e) {
  console.warn('[secop-playwright] playwright-extra/stealth no disponibles, usando playwright:', e.message);
  const pw = await import('playwright');
  chromium = pw.chromium;
}

/**
 * Intenta obtener anexos desde colombiacompra.gov.co o datos.gov cuando la ficha da 403.
 * @param {string} idProceso - numero_de_proceso
 * @returns {Promise<Array<{ nombre: string, url: string, tipo: string }>>}
 */
export async function tryFallbackAnexos(idProceso) {
  if (!idProceso) return [];
  const urlColombiaCompra = `https://www.colombiacompra.gov.co/tienda-virtual-del-estado-colombiano/todos/documentos?process=${encodeURIComponent(idProceso)}`;
  try {
    const res = await fetch(urlColombiaCompra, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = await res.text();
    const anexos = [];
    const re = /<a[^>]+href\s*=\s*["']([^"']*\.(pdf|xlsx|xls|csv))["'][^>]*>([^<]*)</gi;
    const base = new URL(urlColombiaCompra);
    let m;
    const seen = new Set();
    while ((m = re.exec(html)) !== null) {
      let href = m[1];
      try {
        if (href.startsWith('/')) href = new URL(href, base.origin).href;
        else if (!href.startsWith('http')) href = new URL(href, base).href;
        if (seen.has(href)) continue;
        seen.add(href);
        const nombre = (m[3] || path.basename(href)).trim().slice(0, 255);
        const ext = path.extname(href).toLowerCase();
        const tipo = ext === '.csv' ? 'CSV' : ext === '.pdf' ? 'PDF' : 'XLSX';
        if (esAnexoAforo(nombre || href)) anexos.push({ nombre: nombre || path.basename(href), url: href, tipo });
      } catch (_) {}
    }
    if (anexos.length) console.log('[secop-playwright] Fallback colombiacompra:', idProceso, '→', anexos.length, 'anexos');
    return anexos;
  } catch (err) {
    console.warn('[secop-playwright] Fallback sin acceso a anexos para', idProceso, err.message);
    return [];
  }
}

/**
 * Abre url_contrato en una page, extrae enlaces a .pdf/.xlsx/.xls/.csv, filtra con esAnexoAforo.
 * Browser más "humano": headers, viewport, delay aleatorio antes de navegar.
 */
export async function fetchAnexosDesdePagina(url, browserInstance) {
  if (!url || !browserInstance) return [];
  let page;
  try {
    page = await browserInstance.newPage();
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
    const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (nav && nav.status() === 403) {
      console.warn('[secop-playwright] 403 en', url.slice(0, 70) + '...');
      return [];
    }
    const anexos = await page.$$eval(
      "a[href*='.pdf'], a[href*='.xlsx'], a[href*='.xls'], a[href*='.csv']",
      (links, baseHref) => {
        const base = new URL(baseHref);
        const out = [];
        const seen = new Set();
        for (const a of links) {
          const href = a.getAttribute('href');
          if (!href) continue;
          try {
            const abs = new URL(href, base).href;
            const pathname = new URL(abs).pathname;
            const ext = pathname.toLowerCase().slice(pathname.lastIndexOf('.'));
            if (!['.pdf', '.xlsx', '.xls', '.csv'].includes(ext)) continue;
            if (seen.has(abs)) continue;
            seen.add(abs);
            const nombre = (a.textContent || pathname.split('/').pop() || 'anexo').trim().replace(/\s+/g, ' ').slice(0, 255);
            out.push({
              nombre: nombre || pathname.split('/').pop() || 'anexo',
              url: abs,
              tipo: ext === '.csv' ? 'CSV' : ext === '.pdf' ? 'PDF' : 'XLSX',
            });
          } catch (_) {}
        }
        return out;
      },
      url
    );
    const filtered = anexos.filter((a) => esAnexoAforo(a.nombre));
    return filtered;
  } catch (err) {
    console.warn('[secop-playwright] Error en', url.slice(0, 60) + '...', err.message);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/**
 * Procesa varias url_contrato en lotes con un solo browser (stealth + args humanos).
 */
export async function fetchAnexosBatch(urlContratosArray, { concurrency = 3, delayMs = 1500, idProcesosByUrl } = {}) {
  const result = {};
  for (const u of urlContratosArray) {
    result[u] = [];
  }
  if (urlContratosArray.length === 0) return result;

  // Catálogo: SECOP_PLAYWRIGHT_PROXY (solo navegación). Descargas: PROXY_URL (secop_descargar_anexos).
  const proxyUrl = process.env.SECOP_PLAYWRIGHT_PROXY || process.env.PROXY_URL;
  const browser = await chromium.launch({
    headless: true,
    args: BROWSER_ARGS,
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
  });
  try {
    for (let i = 0; i < urlContratosArray.length; i += concurrency) {
      const batch = urlContratosArray.slice(i, i + concurrency);
      const promises = batch.map((url) => fetchAnexosDesdePagina(url, browser));
      const arrays = await Promise.all(promises);
      batch.forEach((url, j) => {
        result[url] = arrays[j] || [];
      });
      if (i + concurrency < urlContratosArray.length) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (idProcesosByUrl) {
    for (const url of urlContratosArray) {
      if (result[url].length === 0 && idProcesosByUrl[url]) {
        const fallback = await tryFallbackAnexos(idProcesosByUrl[url]);
        result[url] = fallback;
      }
    }
  }
  return result;
}
