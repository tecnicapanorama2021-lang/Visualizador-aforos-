/**
 * Crea agente HTTP/HTTPS para axios según PROXY_URL (Tor u otro proxy).
 * Uso: const agent = crearProxyAgent(process.env.PROXY_URL);
 *      axios.get(url, { httpsAgent: agent, timeout: 60000 })
 */

import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';

/**
 * @param {string | undefined} proxyUrl - PROXY_URL (ej. socks5://127.0.0.1:9150)
 * @returns {import('https').Agent | import('socks-proxy-agent').SocksProxyAgent | undefined}
 */
export function crearProxyAgent(proxyUrl) {
  if (!proxyUrl) {
    if (process.env.CKAN_INSECURE_TLS === '1') {
      return new https.Agent({ rejectUnauthorized: false });
    }
    return undefined;
  }
  if (proxyUrl.startsWith('socks')) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
}
