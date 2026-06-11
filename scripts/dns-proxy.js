// Local HTTP/HTTPS forward proxy that resolves hostnames via DNS-over-HTTPS (1.1.1.1).
// Workaround for broken system DNS: npm/electron downloads are routed through it.
const http = require('http');
const https = require('https');
const net = require('net');

const cache = new Map();

function resolveDoH(name) {
  if (cache.has(name)) return Promise.resolve(cache.get(name));
  if (net.isIP(name)) return Promise.resolve(name);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: '1.1.1.1',
      servername: 'cloudflare-dns.com',
      path: `/dns-query?name=${encodeURIComponent(name)}&type=A`,
      headers: { accept: 'application/dns-json', host: 'cloudflare-dns.com' },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const a = (j.Answer || []).find((r) => r.type === 1);
          if (!a) return reject(new Error('no A record for ' + name));
          cache.set(name, a.data);
          resolve(a.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  // plain HTTP forwarding
  const u = new URL(req.url);
  resolveDoH(u.hostname).then((ip) => {
    const p = http.request({
      host: ip, port: u.port || 80, path: u.pathname + u.search,
      method: req.method, headers: { ...req.headers, host: u.host },
    }, (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
    p.on('error', () => res.destroy());
    req.pipe(p);
  }).catch(() => { res.writeHead(502); res.end('dns fail'); });
});

server.on('connect', (req, clientSocket, head) => {
  const [host, port] = req.url.split(':');
  resolveDoH(host).then((ip) => {
    const upstream = net.connect(Number(port) || 443, ip, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  }).catch(() => {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
});

server.listen(8231, '127.0.0.1', () => console.log('doh-proxy listening on 127.0.0.1:8231'));
