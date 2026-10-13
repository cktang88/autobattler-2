// Ironclad Assembly server: static files from public/ + JSON API for async PvP.
// Run: node src/server/main.ts   (PORT, DATA_DIR, PUBLIC_DIR, TRUST_PROXY env vars)

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api, type ApiOptions } from './api.ts';
import { serveStatic } from './static.ts';
import { Store } from './store.ts';

export interface ServerOptions extends ApiOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  publicDir?: string;
  /** persistence debounce (ms) */
  saveDebounceMs?: number;
}

export interface RunningServer {
  port: number;
  api: Api;
  store: Store;
  close(): Promise<void>;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const dataDir = path.resolve(opts.dataDir ?? path.join(ROOT, 'data'));
  const publicDir = path.resolve(opts.publicDir ?? path.join(ROOT, 'public'));
  const store = new Store(dataDir, opts.saveDebounceMs ?? 250);
  store.load();
  const api = new Api(store, opts);

  const server = http.createServer((req, res) => {
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      api.handle(req, res, url).catch((e) => {
        console.error('[server] unhandled', e);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":"Internal server error"}');
      });
    } else {
      try { serveStatic(publicDir, req, res, url.pathname); } catch (e) {
        console.error('[server] static error', e);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;

  const housekeeping = setInterval(() => {
    try { api.sweepStale(); api.prune(); } catch (e) { console.error('[server] housekeeping', e); }
  }, 10 * 60 * 1000);
  housekeeping.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 8080, opts.host, () => { server.off('error', reject); resolve(); });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 8080);

  let closed = false;
  return {
    port, api, store,
    close: () => new Promise<void>((resolve) => {
      if (closed) { resolve(); return; }
      closed = true;
      clearInterval(housekeeping);
      store.flush();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  const srv = await startServer({
    port,
    dataDir: process.env.DATA_DIR,
    publicDir: process.env.PUBLIC_DIR,
    trustProxy: process.env.TRUST_PROXY === '1',
  });
  console.log(`Ironclad Assembly server on http://localhost:${srv.port}`);
  const shutdown = () => { srv.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
