const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'index.js');

async function startTestServer(t) {
  const stats = { requests: 0, active: 0, maxActive: 0, finished: 0 };
  const server = http.createServer((request, response) => {
    stats.requests += 1;
    stats.active += 1;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    response.once('finish', () => {
      stats.finished += 1;
    });
    response.once('close', () => {
      stats.active -= 1;
    });

    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/slow' });
      response.end();
      return;
    }

    if (request.url === '/missing') {
      response.writeHead(404, 'Not Found');
      response.write('missing ');
      setTimeout(() => response.end('body'), 150);
      return;
    }

    if (request.url === '/drop') {
      response.destroy();
      return;
    }

    if (request.url === '/empty') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.url === '/large') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const chunk = Buffer.alloc(128 * 1024, 65);
      for (let index = 0; index < 8; index += 1) {
        response.write(chunk);
      }
      response.end();
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.write('abc');
    setTimeout(() => response.end('def'), 20);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.close();
    server.closeAllConnections?.();
  });

  const { port } = server.address();
  return { stats, url: `http://127.0.0.1:${port}` };
}

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd: path.join(__dirname, '..') });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('downloads ten complete responses sequentially and totals their bytes', async (t) => {
  const { stats, url } = await startTestServer(t);
  const result = await runScript([`${url}/slow`]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Requests completed: 10/);
  assert.match(result.stdout, /Total response data: 60 bytes/);
  assert.match(result.stdout, /Average request time: \d+\.\d{2} ms/);
  assert.match(result.stdout, /Average download speed: \d+\.\d{4} MB\/s/);
  assert.equal(stats.requests, 10);
  assert.equal(stats.finished, 10);
  assert.equal(stats.maxActive, 1);
});

test('follows redirects and measures the final response body', async (t) => {
  const { stats, url } = await startTestServer(t);
  const result = await runScript([`${url}/redirect`]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Requests completed: 10/);
  assert.match(result.stdout, /Total response data: 60 bytes/);
  assert.equal(stats.requests, 20);
  assert.equal(stats.maxActive, 1);
});

test('counts a multi-chunk binary response without changing its byte total', async (t) => {
  const { url } = await startTestServer(t);
  const result = await runScript([`${url}/large`]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Total response data: 10485760 bytes \(10\.49 MB\)/);
});

test('handles successful empty responses', async (t) => {
  const { url } = await startTestServer(t);
  const result = await runScript([`${url}/empty`]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Requests completed: 10/);
  assert.match(result.stdout, /Total response data: 0 bytes \(0\.00 MB\)/);
  assert.match(result.stdout, /Average download speed: 0\.0000 MB\/s/);
});

test('reports non-success HTTP responses and exits with an error', async (t) => {
  const { stats, url } = await startTestServer(t);
  const result = await runScript([`${url}/missing`]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /HTTP 404 Not Found/);
  assert.equal(result.stdout, '');
  assert.equal(stats.requests, 1);
  assert.equal(stats.finished, 1);
});

test('reports a connection interrupted before the response completes', async (t) => {
  const { stats, url } = await startTestServer(t);
  const result = await runScript([`${url}/drop`]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Request 1\/10 failed:/);
  assert.equal(stats.requests, 1);
});

test('rejects a missing URL and unsupported protocols', async () => {
  const missingUrl = await runScript([]);
  const unsupportedProtocol = await runScript(['file:///tmp/test']);

  assert.equal(missingUrl.code, 1);
  assert.match(missingUrl.stderr, /Usage: node index\.js/);
  assert.equal(unsupportedProtocol.code, 1);
  assert.match(unsupportedProtocol.stderr, /URL must use the http: or https: protocol/);
});
