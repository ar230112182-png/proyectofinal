const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const secret = 'internal-download-test-secret';
process.env.JWT_SECRET = secret;
const calls = [];
let file;
const database = {
  async query(sql) {
    calls.push(sql);
    if (sql.includes('FROM expedientes_legales')) {
      return file ? { rowCount: 1, rows: [file] } : { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  },
};
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const app = express();
app.use(express.json());
app.use('/api/workflows', require('../server/routes/workflows'));
let server;
let base;

test.before(async () => {
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}/api/workflows/documents`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function get(id) {
  const token = jwt.sign({ id_usuario: 7, rol: 'agente' }, secret);
  return fetch(`${base}/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
}

test('invalid document IDs are rejected before database access', async () => {
  calls.length = 0;
  assert.equal((await get('not-an-id')).status, 404);
  assert.equal(calls.length, 0);
});

test('internal document downloads use a UTF-8 content disposition', async () => {
  file = {
    nombre_archivo: 'contrato ñ.pdf',
    mime_type: 'application/pdf',
    contenido: Buffer.from('%PDF-test'),
  };
  calls.length = 0;
  const response = await get('12');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-disposition'), "attachment; filename*=UTF-8''contrato%20%C3%B1.pdf");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '%PDF-test');
});

test('missing document content returns not found', async () => {
  file = null;
  assert.equal((await get('13')).status, 404);
});
