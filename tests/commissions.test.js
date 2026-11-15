const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'commission-test-secret';
const calls = [];
let available = true;
const database = {
  async connect() {
    return {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes('INSERT INTO comisiones')) {
          return available
            ? { rowCount: 1, rows: [{ id_comision: 42, monto_operacion: '100.10', monto_total: '5.01', porcentaje_agencia: '5.00' }] }
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
const app = express();
app.use(express.json());
app.use('/api/workflows', require('../server/routes/workflows'));
app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

test('commission creation requires an administrator and calculates from the property', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/workflows/commissions`;
  const admin = jwt.sign({ id_usuario: 1, rol: 'administrador' }, process.env.JWT_SECRET);
  const seller = jwt.sign({ id_usuario: 2, rol: 'vendedor' }, process.env.JWT_SECRET);
  const post = (body, token) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const payload = { id_propiedad: 3, id_cliente: 4, id_agente_vendedor: 5 };
  assert.equal((await post(payload, seller)).status, 403);
  assert.equal((await post({ ...payload, id_cliente: true }, admin)).status, 400);
  assert.equal(calls.length, 0);

  available = false;
  assert.equal((await post(payload, admin)).status, 400);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  calls.length = 0;
  available = true;
  const response = await post({ ...payload, monto_total: 999, monto_operacion: 999, porcentaje_agencia: 99 }, admin);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.monto_total, '5.01');
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO comisiones'));
  assert.deepEqual(insert.values, [3, 4, 5]);
  assert.match(insert.sql, /ROUND\(p\.precio \* 0\.05, 2\)/);
  assert.match(insert.sql, /seller\.activo = TRUE/);
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('commission preview uses the selected property and rounds to cents', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
  const code = source.slice(source.indexOf('function configureCommissionForm('), source.indexOf('// Genera los controles disponibles'));
  let onChange;
  const select = { value: '', addEventListener(_type, callback) { onChange = callback; } };
  const summary = { setAttribute() {} };
  const fields = { append() {} };
  const form = { querySelector: (selector) => selector === '[name="id_propiedad"]' ? select : fields };
  const context = vm.createContext({
    document: { createElement: () => summary },
    optionData: { properties: [{ id: 1, nombre: 'Casa', precio: '100.10' }, { id: 2, nombre: 'Inválida', precio: '0' }] },
    escapeHtml: String,
    formatCommissionMoney: (value) => Number(value).toFixed(2),
    form,
  });
  vm.runInContext(code, context);
  vm.runInContext('configureCommissionForm(form)', context);
  assert.match(summary.textContent, /Selecciona una propiedad/);
  assert.doesNotMatch(select.innerHTML, /Inválida/);
  select.value = '1';
  onChange();
  assert.match(summary.textContent, /100\.10/);
  assert.match(summary.textContent, /5\.01/);
  select.value = '';
  onChange();
  assert.match(summary.textContent, /Selecciona una propiedad/);
});
