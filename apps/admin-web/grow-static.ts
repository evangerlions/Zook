import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface GrowStaticOptions { growEnabled?: boolean; growRoot?: string }
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const page = /^\/(?:|today|records(?:\/[a-zA-Z0-9_-]+)?|plans|planning|goals|actions|learning|practice|review|investments|growth|settings|forms)$/;

/** Loaded once at server creation: disabled mode performs no artifact I/O. */
export function createGrowStaticHandler(options: GrowStaticOptions = {}) {
  const enabled = options.growEnabled ?? process.env.GROW_WEB_ENABLED === '1';
  const assets = new Map<string, { body: Buffer; type: string; digest: string }>();
  let revision = '';
  if (enabled) {
    const root = realpathSync(resolve(options.growRoot ?? process.env.GROW_WEB_ROOT ?? 'static/grow'));
    const manifest = JSON.parse(readFileSync(resolve(root, 'grow-manifest.json'), 'utf8'));
    if (manifest.schema_version !== 1 || manifest.product !== 'lighttick' || !/^[a-f0-9]{40}$/.test(manifest.source_revision) || !/^[a-f0-9]{40}$/.test(manifest.contract_revision) || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw Error('Invalid Grow artifact manifest');
    revision = manifest.source_revision;
    let size = 0;
    const entries = Object.entries(manifest.files);
    if (entries.length > 500) throw Error('Grow artifact exceeds file limit');
    for (const [name, hash] of entries) {
      if (!/^(?:index\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(name) || !types[extname(name)]) throw Error('Invalid Grow asset path');
      const file = realpathSync(resolve(root, name));
      if (!file.startsWith(root + sep)) throw Error('Grow asset escapes artifact root');
      const length = statSync(file).size;
      size += length;
      if (size > 25 * 1024 * 1024) throw Error('Grow artifact exceeds size limit');
      const body = readFileSync(file), digest = createHash('sha256').update(body).digest('hex');
      if (digest !== hash) throw Error('Grow asset digest mismatch');
      assets.set('/' + name, { body, type: types[extname(name)], digest });
    }
    if (!assets.has('/index.html')) throw Error('Grow artifact has no index');
  }
  return (request: IncomingMessage, response: ServerResponse): boolean => {
    const raw = (request.url ?? '/').split('?')[0];
    if (raw !== '/grow' && !raw.startsWith('/grow/')) return false;
    const end = (status: number, text: string, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : text);
      return true;
    };
    if (!enabled) return end(503, 'Grow Web is not enabled.');
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.setHeader('Allow', 'GET, HEAD'); return end(405, 'Method not allowed'); }
    let pathname: string;
    try { pathname = decodeURIComponent(raw).slice(5); } catch { return end(400, 'Invalid path'); }
    if (pathname.includes('%') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(p => p === '.' || p === '..')) return end(400, 'Invalid path');
    if (!pathname) { response.writeHead(308, { Location: '/grow/', 'Cache-Control': 'no-store' }); response.end(); return true; }
    if (pathname === '/runtime-config.js') return end(200, `window.__GROW_CONFIG__=${JSON.stringify({ appId: 'lighttick', revision })};`, types['.js']);
    const asset = assets.get(page.test(pathname) ? '/index.html' : pathname);
    if (!asset) return end(404, 'Not found');
    response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'ETag': '"' + asset.digest + '"', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
    return true;
  };
}
