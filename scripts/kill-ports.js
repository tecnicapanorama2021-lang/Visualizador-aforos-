/**
 * Libera los puertos 5173 (Vite) y 3001 (API) para que npm run dev siempre use los mismos.
 * Windows: netstat + taskkill. Unix: lsof + kill.
 * Sale con 0 aunque no haya proceso (para no fallar en el primer arranque).
 */
import { execSync, spawnSync } from 'child_process';
import { platform } from 'os';

const PORTS = [5173, 3001];
const isWin = platform() === 'win32';

function killPort(port) {
  try {
    if (isWin) {
      let out;
      try {
        out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (_) {
        return; // findstr sale con 1 si no hay coincidencias
      }
      const pids = new Set();
      for (const line of (out || '').split('\n')) {
        const m = line.trim().match(/\s+(\d+)\s*$/);
        if (m && m[1] !== '0') pids.add(m[1]);
      }
      for (const pid of pids) {
        const r = spawnSync('taskkill', ['/F', '/PID', pid], { encoding: 'utf8', shell: true });
        if (r.status === 0) {
          console.log(`[kill-ports] Puerto ${port}: proceso ${pid} cerrado`);
        } else {
          const msg = (r.stderr || r.stdout || '').trim() || `código ${r.status}`;
          console.warn(`[kill-ports] Puerto ${port}: no se pudo cerrar PID ${pid} (${msg}). Prueba como administrador o ciérralo a mano.`);
        }
      }
    } else {
      const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
      if (pid) {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        console.log(`[kill-ports] Puerto ${port}: proceso ${pid} cerrado`);
      }
    }
  } catch (_) {
    // No hay proceso en el puerto (lsof falla)
  }
}

for (const port of PORTS) {
  killPort(port);
}
