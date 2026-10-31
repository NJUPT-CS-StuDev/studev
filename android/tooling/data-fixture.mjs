import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Test-only server: real shards, plus release aliases for activation/rollback checks.
const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.argv[2] || 18764);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const publicRoot = path.resolve(root, 'public');
const release = JSON.parse(fs.readFileSync(path.join(root, 'src/data/campus-release.json')));
let selected = release.version;
let available = true;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/__test_release') {
    selected = url.searchParams.get('version') || release.version;
    available = url.searchParams.get('missing') !== 'true';
    res.writeHead(200, {'Content-Type':'application/json'}).end('{}'); return;
  }
  if (pathname === '/search/') {
    res.writeHead(200, {'Content-Type':'text/html'}).end('<script src="/_astro/constants.fixture.js"></script>'); return;
  }
  if (pathname === '/_astro/constants.fixture.js') {
    res.writeHead(200, {'Content-Type':'application/javascript'}).end('export const release = ' + JSON.stringify({...release, version:selected, base:`/data/${selected}`})); return;
  }
  let localPath = pathname;
  if (selected !== release.version && pathname.startsWith(`/data/${selected}/`)) {
    if (!available) { res.writeHead(404).end(); return; }
    localPath = `/data/${release.version}/` + pathname.slice(`/data/${selected}/`.length);
  }
  const target = path.resolve(publicRoot, '.' + localPath);
  if (!target.startsWith(publicRoot + path.sep)) { res.writeHead(400).end(); return; }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'Content-Type': target.endsWith('.json') ? 'application/json' : 'application/octet-stream'});
  fs.createReadStream(target).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('Local data fixture on ' + port));

