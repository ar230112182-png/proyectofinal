const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const secret = 'tenant-report-test-secret';
process.env.JWT_SECRET = secret;
const calls = [];
const database = {
  async connect() {
    return {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes('INSERT INTO solicitudes_mantenimiento')) {
          return Number(values[1]) === 5 && values[0] === 11
            ? { rowCount: 1, rows: [{ id_solicitud: '42', estado: 'pendiente' }] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes('information_schema.columns')) return { rows: [{ has_detail: true }] };
        return { rowCount: 1, rows: [] };
      },
      release() { calls.push({ sql: 'RELEASE' }); },
    };
  },
};
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const router = require('../server/routes/workflows');
const app = express();
app.use(express.json());
app.use('/api/workflows', router);
app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

test('tenant reports validate input, role and rental ownership', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/workflows/tenant/reports`;
  const tenant = jwt.sign({ id_usuario: 11, rol: 'cliente' }, secret);
  const otherTenant = jwt.sign({ id_usuario: 12, rol: 'cliente' }, secret);
  const admin = jwt.sign({ id_usuario: 1, rol: 'administrador' }, secret);
  const payload = { id_renta: 5, titulo: 'Fuga', descripcion: 'Fuga en la cocina', prioridad: 'normal' };
  const post = (body, token) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  assert.equal((await post(payload)).status, 401);
  assert.equal((await post(payload, admin)).status, 403);
  for (const invalid of [
    { ...payload, id_renta: true },
    { ...payload, titulo: '  ' },
    { ...payload, descripcion: ' '.repeat(5) },
    { ...payload, descripcion: 'x'.repeat(2001) },
    { ...payload, prioridad: 'inmediata' },
  ]) {
    assert.equal((await post(invalid, tenant)).status, 400);
  }
  assert.equal(calls.length, 0);

  assert.equal((await post(payload, otherTenant)).status, 404);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  calls.length = 0;
  const response = await post({ ...payload, titulo: '  Fuga  ' }, tenant);
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).data, { id_solicitud: '42', estado: 'pendiente' });
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO solicitudes_mantenimiento'));
  assert.match(insert.sql, /c\.id_usuario = \$1/);
  assert.match(insert.sql, /LOWER\(r\.estado\) = 'activa'/);
  assert.deepEqual(insert.values, [11, 5, 'Fuga', 'Fuga en la cocina', 'normal']);
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO auditoria')));
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});
