import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function parseArgs(argv) {
  const args = { port: 4173, base: '/' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]) || args.port;
    else if (argv[i] === '--base') args.base = argv[++i] || '/';
  }
  let base = '/' + String(args.base).replace(/^\/+|\/+$/g, '');
  base = base === '/' ? '/' : `${base}/`;
  return { port: args.port, base };
}

const { port, base } = parseArgs(process.argv.slice(2));

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request\n');
    return;
  }

  if (base !== '/' && pathname !== base.slice(0, -1) && !pathname.startsWith(base)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Not found. This preview serves the site under ${base}\n`);
    return;
  }

  const relative = base === '/' ? pathname : pathname.slice(base.length - 1);
  let target = path.resolve(rootDir, `.${relative}`);

  if (target !== rootDir && !target.startsWith(rootDir + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden\n');
    return;
  }

  if (!path.extname(target) && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }

  fs.readFile(target, (error, buffer) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found\n');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
    res.end(buffer);
  });
});

server.listen(port, '127.0.0.1', () => {
  const shown = base === '/' ? '' : base;
  console.log(`ATR Phase 1 Research preview running at http://localhost:${port}${shown}`);
  console.log('Open that address in Chrome. Press Ctrl+C to stop.');
});
