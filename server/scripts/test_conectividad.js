/**
 * Prueba conectividad a sitios externos (SDP, SECOP, etc.).
 * Con PROXY_URL (ej. socks5://127.0.0.1:9150) usa Tor.
 *
 * Uso: node server/scripts/test_conectividad.js
 *      npm run test:conectividad
 *      PROXY_URL=socks5://127.0.0.1:9150 npm run test:conectividad
 */

import axios from 'axios';
import { crearProxyAgent } from '../utils/crearProxyAgent.js';

const SITES = [
  { name: 'sdp.gov.co', url: 'https://www.sdp.gov.co/' },
  { name: 'datos.gov.co', url: 'https://www.datos.gov.co/' },
  { name: 'community.secop.gov.co', url: 'https://community.secop.gov.co/' },
];

async function main() {
  const agent = crearProxyAgent(process.env.PROXY_URL);
  if (process.env.PROXY_URL) {
    console.log('Usando proxy:', process.env.PROXY_URL);
  }
  for (const site of SITES) {
    try {
      const res = await axios.get(site.url, {
        timeout: 15000,
        httpsAgent: agent,
        headers: { 'User-Agent': 'PanoramaAforos/1.0' },
        validateStatus: () => true,
      });
      console.log(res.status >= 200 && res.status < 400 ? '✅' : '❌', site.name, '→', res.status);
    } catch (err) {
      console.log('❌', site.name, '→', err.message);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
