const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'property-image-test-secret';
const calls = [];
let failImage = false;
let storedImage = null;
const database = {
  async connect() {
    return {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes('INSERT INTO propiedad_imagenes')) {
          if (failImage) throw new Error('image storage failed');
          storedImage = { contenido: values[1], tipo_mime: values[2] };
        }
        if (sql.includes('INSERT INTO categorias')) return { rowCount: 1, rows: [{ id_categoria: 3 }] };
        if (sql.includes('SELECT id_categoria FROM categorias WHERE nombre')) {
          return values[0] === 'Oficinas'
            ? { rowCount: 1, rows: [{ id_categoria: 7 }] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes('INSERT INTO propiedades') || sql.includes('UPDATE propiedades')) {
          return { rowCount: 1, rows: [{ id_propiedad: 42, imagen_url: null }] };
        }
        return { rowCount: 1, rows: [] };
      },
      release() { calls.push({ sql: 'RELEASE' }); },
    };
  },
  async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('COUNT(*)::int AS total FROM propiedades')) return { rows: [{ total: 0 }] };
    if (sql.includes('SELECT p.id_propiedad')) return { rows: [] };
    return storedImage ? { rowCount: 1, rows: [storedImage] } : { rowCount: 0, rows: [] };
  },
};
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const app = express();
app.use(express.json());
app.use('/api/properties', require('../server/routes/properties'));
app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

test('property images are validated, stored atomically and served from the database', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/properties`;
  const token = jwt.sign({ id_usuario: 1, rol: 'administrador' }, process.env.JWT_SECRET);
  const auth = { Authorization: `Bearer ${token}` };
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  function form(bytes, type = 'image/png') {
    const data = new FormData();
    data.set('categoria', 'Lote baldío');
    data.set('tipo_operacion', 'VENTA');
    data.set('precio', '100');
    data.set('costo_adquisicion', '60.50');
    data.set('superficie', '100');
    data.set('frente_metros', '10');
    data.set('fondo_metros', '10');
    if (bytes) data.set('imagen', new Blob([bytes], { type }), 'foto.png');
    return data;
  }
  const post = (body, headers = auth) => fetch(base, { method: 'POST', headers, body });

  assert.equal((await post(form(png), {})).status, 401);
  assert.equal((await post(form(Buffer.from('not an image')))).status, 400);
  assert.equal((await post(form(png, 'text/html'))).status, 400);
  assert.equal((await post(form(Buffer.alloc(10 * 1024 * 1024 + 1)))).status, 413);
  assert.equal(calls.length, 0);

  const created = await post(form(png));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).data.imagen_url, '/api/properties/42/image');
  assert.equal(calls.find((call) => call.sql.includes('INSERT INTO propiedades')).values[17], '60.50');
  assert.deepEqual(calls.find((call) => call.sql.includes('INSERT INTO propiedad_imagenes')).values.slice(1), [png, 'image/png']);
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  const image = await fetch(`${base}/42/image`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);

  calls.length = 0;
  const edit = new FormData();
  edit.set('titulo', 'Casa');
  edit.set('precio', '200');
  edit.set('costo_adquisicion', '75.25');
  edit.set('imagen', new Blob([png], { type: 'image/png' }), 'foto.png');
  assert.equal((await fetch(`${base}/42`, { method: 'PUT', headers: auth, body: edit })).status, 200);
  assert.equal(calls.find((call) => call.sql.includes('UPDATE propiedades')).values[9], '75.25');
  assert.ok(calls.some((call) => call.sql.includes('INSERT INTO propiedad_imagenes')));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));

  calls.length = 0;
  failImage = true;
  assert.equal((await post(form(png))).status, 500);
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some((call) => call.sql === 'COMMIT'));
  failImage = false;

  calls.length = 0;
  assert.equal((await post(form())).status, 201);
  assert.ok(!calls.some((call) => call.sql.includes('INSERT INTO propiedad_imagenes')));

  const office = form();
  office.set('categoria', 'Oficinas');
  office.set('titulo', 'Oficina');
  office.set('calle', 'Calle');
  office.set('ciudad', 'Ciudad');
  office.set('estado', 'Estado');
  calls.length = 0;
  assert.equal((await post(office)).status, 201);
  assert.equal(calls.find((call) => call.sql.includes('INSERT INTO propiedades')).values[0], 7);
  office.set('categoria', 'Categoría inexistente');
  calls.length = 0;
  assert.equal((await post(office)).status, 400);
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some((call) => call.sql.includes('INSERT INTO propiedades')));
});

test('new properties require a valid acquisition cost; existing costs can remain unknown', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/properties`;
  const token = jwt.sign({ id_usuario: 1, rol: 'administrador' }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const payload = { categoria: 'Lote baldío', tipo_operacion: 'VENTA', precio: 100,
    superficie: 100, frente_metros: 10, fondo_metros: 10 };
  for (const cost of [undefined, '', 0, -1, '1.001', '1000000000000', 'abc']) {
    const response = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ ...payload, costo_adquisicion: cost }) });
    assert.equal(response.status, 400, String(cost));
  }
  const oldProperty = await fetch(`${base}/42`, { method: 'PUT', headers, body: JSON.stringify({ titulo: 'Existente' }) });
  assert.equal(oldProperty.status, 200);
  const badEdit = await fetch(`${base}/42`, { method: 'PUT', headers, body: JSON.stringify({ costo_adquisicion: -2 }) });
  assert.equal(badEdit.status, 400);
});

test('property dimensions enforce form limits and persist on edits', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/properties`;
  const token = jwt.sign({ id_usuario: 1, rol: 'administrador' }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const payload = {
    categoria: 'Lote baldío',
    tipo_operacion: 'VENTA',
    precio: 100,
    costo_adquisicion: 50,
    superficie: 100,
    frente_metros: 10,
    fondo_metros: 10,
  };

  calls.length = 0;
  for (const invalid of [
    { superficie: undefined },
    { frente_metros: 0 },
    { fondo_metros: -1 },
    { superficie: 1000000 },
    { frente_metros: 'Infinity' },
  ]) {
    const response = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, ...invalid }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /medidas/);
  }
  assert.equal(calls.length, 0);

  const maximumDimensions = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...payload,
      superficie: 999999.99,
      frente_metros: 999999.99,
      fondo_metros: 999999.99,
    }),
  });
  assert.equal(maximumDimensions.status, 201);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO propiedades'));
  assert.deepEqual(insert.values.slice(5, 8), [999999.99, 999999.99, 999999.99]);

  const update = await fetch(`${base}/42`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ superficie: 150.25, frente_metros: 12.5, fondo_metros: 15 }),
  });
  assert.equal(update.status, 200);
  const updateCall = calls.find((call) => call.sql.includes('UPDATE propiedades'));
  assert.deepEqual(updateCall.values.slice(10, 13), [150.25, 12.5, 15]);

  const callsBeforeInvalidEdit = calls.length;
  const invalidUpdate = await fetch(`${base}/42`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ fondo_metros: 1000000 }),
  });
  assert.equal(invalidUpdate.status, 400);
  assert.equal(calls.length, callsBeforeInvalidEdit);
});

test('property creation and editing only accept supported states', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/properties`;
  const token = jwt.sign({ id_usuario: 1, rol: 'administrador' }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const payload = {
    categoria: 'Lote baldío',
    tipo_operacion: 'VENTA',
    precio: 100,
    costo_adquisicion: 50,
    superficie: 100,
    frente_metros: 10,
    fondo_metros: 10,
  };

  calls.length = 0;
  const invalidCreate = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, estado_propiedad: 'EN PROCESO' }),
  });
  assert.equal(invalidCreate.status, 400);
  assert.equal(calls.length, 0);

  const created = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, estado_propiedad: 'Reservada' }),
  });
  assert.equal(created.status, 201);
  const insert = calls.find((call) => call.sql.includes('INSERT INTO propiedades'));
  assert.equal(insert.values[12], 'Reservada');

  const callsBeforeInvalidEdit = calls.length;
  const invalidEdit = await fetch(`${base}/42`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ estado_propiedad: 'EN PROCESO' }),
  });
  assert.equal(invalidEdit.status, 400);
  assert.equal(calls.length, callsBeforeInvalidEdit);

  const edited = await fetch(`${base}/42`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ estado_propiedad: 'Vendida' }),
  });
  assert.equal(edited.status, 200);
  const update = calls.find((call) => call.sql.includes('UPDATE propiedades'));
  assert.equal(update.values[3], 'Vendida');
});

test('property listing only exposes acquisition cost to internal roles', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/properties`;
  for (const [role, allowed] of [['cliente', false], ['agente', true], ['administrador', true]]) {
    calls.length = 0;
    const token = jwt.sign({ id_usuario: 1, rol: role }, process.env.JWT_SECRET);
    const response = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const listing = calls.find((call) => call.sql.includes('SELECT p.id_propiedad'));
    assert.equal(listing.values[2], allowed);
    assert.match(listing.sql, /p\.tipo_operacion, p\.superficie, p\.frente_metros, p\.fondo_metros/);
  }
});

test('new-property category and operation do not get extra search controls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
  const code = source.slice(source.indexOf('const forms = {'), source.indexOf('const fieldRules = {'));
  const context = vm.createContext({ optionData: { clients: [] } });
  vm.runInContext(`${code}\nthis.propertyFields = forms.property.fields;`, context);
  const fields = context.propertyFields;
  assert.equal(fields.find((field) => field[0] === 'categoria')[5], false);
  assert.equal(fields.find((field) => field[0] === 'tipo_operacion')[5], false);
  assert.equal(fields.find((field) => field[0] === 'imagen')[2], 'file');
  assert.equal(fields.some((field) => field[0] === 'imagen_url'), false);
});

test('new-property category dropdown uses registered category names without exposing IDs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
  const code = source.slice(source.indexOf('function renderField('), source.indexOf('function enableWorkflowSearchableSelects('));
  const context = vm.createContext({
    optionData: { categories: [{ id: 7, nombre: 'Oficinas' }, { id: 8, nombre: 'Lote baldío' }] },
    document: { createElement: () => ({ dataset: {}, append(child) { this.child = child; } }) },
    escapeHtml: String,
    applyFieldRules() {},
  });
  vm.runInContext(code, context);
  const field = vm.runInContext("renderField(['categoria', 'Categoría', 'options', true, 'categories', false])", context);
  assert.match(field.child.innerHTML, /value="Oficinas">Oficinas/);
  assert.match(field.child.innerHTML, /value="Lote baldío">Lote baldío/);
  assert.doesNotMatch(field.child.innerHTML, /value="7"/);
  assert.equal(field.child.dataset.searchableSelect, undefined);
});

test('editing a property validates the selected image before submission', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
  const code = source.slice(source.indexOf('function validateWorkflowForm('), source.indexOf('// Oculta campos residenciales'));
  const error = {};
  const form = {
    dataset: { kind: 'property-edit' },
    closest: () => ({ querySelector: () => error }),
    querySelector: () => ({ files: [{ size: 10 * 1024 * 1024 + 1, type: 'image/png' }] }),
  };
  const context = vm.createContext({ form, FormData: class { get() { return ''; } } });
  vm.runInContext(code, context);
  assert.equal(vm.runInContext('validateWorkflowForm(form)', context), false);
  assert.match(error.textContent, /10 MB/);
});
