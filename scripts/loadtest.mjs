// Carga local com autocannon contra `wrangler dev` (workerd local, D1 em SQLite). Uso: pnpm loadtest
// Não mede produção (rede, 10 ms de CPU e limites do plano Free não existem aqui): serve para achar
// regressões, erros 5xx e gargalos óbvios. Resultado completo em docs/validation.md.
import { spawn } from 'node:child_process';
import autocannon from 'autocannon';

const BASE = 'http://localhost:8787';
const server = spawn('bash', ['e2e/start.sh'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* já encerrado */ } };
process.on('exit', stop);

async function ready() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('servidor não subiu');
}

const cases = [
  { name: 'GET /api/health', path: '/api/health', expect: [200] },
  { name: 'GET /api/config (1 leitura D1)', path: '/api/config', expect: [200] },
  { name: 'GET / (estático)', path: '/', expect: [200] },
  { name: 'GET /api/shared/<token inválido> (rate limit: 1 escrita D1)', path: `/api/shared/${'x'.repeat(43)}`, expect: [404, 429] },
  { name: 'GET /api/auth/me sem sessão', path: '/api/auth/me', expect: [401] },
];

await ready();
const out = [];
for (const c of cases) {
  const r = await autocannon({ url: BASE + c.path, connections: 10, duration: 8, headers: { 'CF-Connecting-IP': '198.51.100.7' } });
  const byStatus = { 200: r['2xx'], '4xx': r['4xx'], '5xx': r['5xx'], non2xx: r.non2xx, errors: r.errors, timeouts: r.timeouts };
  out.push({ name: c.name, rps: Math.round(r.requests.average), p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, ...byStatus });
}
stop();
console.table(out);
if (out.some((o) => o['5xx'] > 0 || o.errors > 0 || o.timeouts > 0)) { console.error('FALHA: erros 5xx/conexão'); process.exit(1); }
