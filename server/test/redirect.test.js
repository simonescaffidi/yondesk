'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

process.env.SITE_URL = 'https://yondesk.com';
const { app } = require('../src/index');

function req(host, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const r = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
        res.resume();
        res.on('end', () => { server.close(); resolve(res); });
      });
      r.on('error', (e) => { server.close(); reject(e); });
      r.end();
    });
  });
}

test('yondesk.net reindirizza 301 a yondesk.com mantenendo il path', async () => {
  const res = await req('yondesk.net', '/it/download.html');
  assert.strictEqual(res.statusCode, 301);
  assert.strictEqual(res.headers.location, 'https://yondesk.com/it/download.html');
});

test('www.yondesk.com reindirizza 301 a yondesk.com', async () => {
  const res = await req('www.yondesk.com', '/');
  assert.strictEqual(res.statusCode, 301);
  assert.strictEqual(res.headers.location, 'https://yondesk.com/');
});

test('il dominio canonico yondesk.com non viene reindirizzato', async () => {
  const res = await req('yondesk.com', '/');
  assert.strictEqual(res.statusCode, 302); // / -> /it/
  assert.strictEqual(res.headers.location, '/it/');
});
