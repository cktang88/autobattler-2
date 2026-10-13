// Static file serving from public/ with MIME types and path-traversal protection.

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Resolve a URL pathname to a file inside `root`, or null when it escapes / is hidden / is malformed. */
export function resolveStatic(root: string, pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  const segs = decoded.split('/').filter(Boolean);
  // reject parent refs and dotfiles outright rather than relying on normalization alone
  if (segs.some((s) => s === '..' || s.startsWith('.'))) return null;
  const rootAbs = path.resolve(root);
  const full = path.resolve(rootAbs, ...segs);
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) return null;
  return full;
}

export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }
  let file = resolveStatic(root, pathname);
  if (!file) { notFound(res, 400, 'Bad Request'); return; }
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
    if (st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file); }
  } catch { notFound(res); return; }
  if (!st.isFile()) { notFound(res); return; }
  // Guard against symlinks pointing outside the root.
  try {
    const real = fs.realpathSync(file);
    const realRoot = fs.realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) { notFound(res); return; }
  } catch { notFound(res); return; }

  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const ext = path.extname(file).toLowerCase();
  const headers: Record<string, string | number> = {
    'Content-Type': mimeFor(file),
    'Content-Length': st.size,
    ETag: etag,
    'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' || ext === '.map' ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] as string });
    res.end();
    return;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function notFound(res: ServerResponse, code = 404, msg = 'Not Found'): void {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}
