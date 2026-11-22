const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const jwt = require('jsonwebtoken');

const secret = 'maintenance-priority-test-secret';
process.env.JWT_SECRET = secret;
const calls = [];
const database = {
  async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('information_schema.columns')) return { rows: [{ has_detail: true }] };
    if (sql.includes('INSERT INTO solicitudes_mantenimiento')) {
      return { rowCount: 1, rows: [{ id_solicitud: 42, titulo: 'Reparación' }] };
    }
    if (sql.startsWith('UPDATE solicitudes_mantenimiento')) return { rowCount: 1, rows: [{ id_solicitud: 42 }] };
    return { rowCount: 1, rows: [] };
  },
};
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const router = require('../server/routes/workflows');
const app = express();
app.use(express.json());
app.use('/api/workflows', router);
app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

test('maintenance creation and edits preserve manual priority or activate automatic mode', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/workflows/maintenance`;
  const token = jwt.sign({ id_usuario: 1, rol: 'administrador' }, secret);
  const send = (method, body, suffix = '') => fetch(base + suffix, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  const body = { id_propiedad: 1, titulo: 'Reparación', descripcion: 'Descripción', prioridad: 'automatica', fecha_limite: '2027-01-02' };
  assert.equal((await send('POST', body)).status, 201);
  let call = calls.find(({ sql }) => sql.includes('INSERT INTO solicitudes_mantenimiento'));
  assert.equal(call.values[6], 'normal');
  assert.equal(call.values[7], true);
  assert.equal(call.values[9], '2027-01-02');

  calls.length = 0;
  assert.equal((await send('POST', { ...body, prioridad: 'baja' })).status, 201);
  call = calls.find(({ sql }) => sql.includes('INSERT INTO solicitudes_mantenimiento'));
  assert.equal(call.values[6], 'baja');
  assert.equal(call.values[7], false);

  calls.length = 0;
  assert.equal((await send('PATCH', { prioridad: 'automatica', fecha_limite: '' }, '/42')).status, 200);
  call = calls.find(({ sql }) => sql.startsWith('UPDATE solicitudes_mantenimiento'));
  assert.match(call.sql, /prioridad_automatica = \$1, fecha_limite = \$2/);
  assert.deepEqual(call.values, [true, null, '42']);

  calls.length = 0;
  assert.equal((await send('PATCH', { prioridad: 'baja', estado: 'completada' }, '/42')).status, 200);
  call = calls.find(({ sql }) => sql.startsWith('UPDATE solicitudes_mantenimiento'));
  assert.match(call.sql, /prioridad = \$1, prioridad_automatica = \$2, estado = \$3/);
  assert.deepEqual(call.values, ['baja', false, 'completada', '42']);

  calls.length = 0;
  for (const invalid of [{ prioridad: 'inmediata' }, { fecha_limite: '2027-02-30' }]) {
    assert.equal((await send('PATCH', invalid, '/42')).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('priority grouping honors pagination and combined status and search filters', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const heading = (priority) => ({ dataset: { priorityHeading: priority }, hidden: false });
  const row = (priority, status, text) => ({ dataset: { priority, recordStatus: status, recordText: text, recordDate: '2026-01-01' }, hidden: false });
  const headings = [heading('urgente'), heading('normal')];
  const rows = [...Array.from({ length: 18 }, () => row('urgente', 'pendiente', 'fuga')), row('normal', 'completada', 'puerta')];
  const filter = { value: 'Todas' };
  const count = {};
  const nav = {};
  const panel = {
    querySelectorAll(selector) { return selector === '[data-priority-heading]' ? headings : rows; },
    querySelector(selector) {
      if (selector === '[data-record-filter="maintenance"]') return filter;
      if (selector === '[data-pagination]') return nav;
      if (selector === '.panel-heading p') return count;
      return null;
    },
  };
  const context = vm.createContext({
    panel,
    maintenancePriorityTab: 'todas',
    recordFilters: { maintenance: { search: '', from: '', to: '' } },
  });
  vm.runInContext(section('const PAGE_SIZE =', '// Aplica busqueda, categoria'), context);
  vm.runInContext("applyRecordFilters(panel, 'maintenance')", context);
  assert.deepEqual(headings.map((item) => item.hidden), [false, true]);
  vm.runInContext("tablePages.maintenance = 4; paginatePanel(panel, 'maintenance')", context);
  assert.deepEqual(headings.map((item) => item.hidden), [true, false]);
  filter.value = 'completada';
  context.recordFilters.maintenance.search = 'puerta';
  vm.runInContext("applyRecordFilters(panel, 'maintenance')", context);
  assert.deepEqual(headings.map((item) => item.hidden), [true, false]);
  assert.equal(count.textContent, '1 registros de 19');
  context.recordFilters.maintenance.search = 'fuga';
  vm.runInContext("applyRecordFilters(panel, 'maintenance')", context);
  assert.deepEqual(headings.map((item) => item.hidden), [true, true]);
  assert.equal(count.textContent, '0 registros de 19');

  filter.value = 'Todas';
  context.recordFilters.maintenance.search = '';
  context.maintenancePriorityTab = 'urgente';
  vm.runInContext("applyRecordFilters(panel, 'maintenance')", context);
  assert.equal(count.textContent, '18 registros de 19');
  assert.ok(rows.filter((item) => item.dataset.priority === 'normal').every((item) => item.hidden));
  context.maintenancePriorityTab = 'alta';
  vm.runInContext("applyRecordFilters(panel, 'maintenance')", context);
  assert.equal(count.textContent, '0 registros de 19');
});

test('maintenance priority tabs show counts and synchronize selected state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const tabs = ['todas', 'urgente', 'alta', 'normal', 'baja'].map((priority) => ({
    dataset: { maintenancePriority: priority },
    count: { textContent: '' },
    querySelector() { return this.count; },
    setAttribute(name, value) { this[name] = value; },
  }));
  const panel = { setAttribute(name, value) { this[name] = value; } };
  const view = {
    querySelectorAll: () => tabs,
    querySelector: () => panel,
  };
  const context = vm.createContext({
    document: { getElementById: () => view },
    records: { maintenance: [
      { prioridad: 'urgente' }, { prioridad: 'alta' }, { prioridad: 'normal' },
    ] },
    maintenancePriorityTab: 'alta',
  });
  vm.runInContext(section('function syncMaintenanceTabs()', '// Renderiza tablas'), context);
  vm.runInContext('syncMaintenanceTabs()', context);
  assert.deepEqual(tabs.map((tab) => tab['aria-selected']), ['false', 'false', 'true', 'false', 'false']);
  assert.deepEqual(tabs.map((tab) => tab.tabIndex), [-1, -1, 0, -1, -1]);
  assert.deepEqual(tabs.map((tab) => tab.count.textContent), ['3', '1', '1', '1', '0']);
  assert.equal(panel['aria-labelledby'], 'maintenance-tab-alta');
});

test('maintenance status filters do not add a duplicate searchable dropdown', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
  assert.match(source, /querySelectorAll\('select:not\(\[data-record-filter\]\)'\)/);
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(index, /data-maintenance-priority="urgente"/);
  assert.match(index, /data-maintenance-priority="baja"/);
});

test('PostgreSQL computes exact date boundaries independently of status', { skip: !process.env.TEST_MAINTENANCE_DB }, async () => {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`
      SELECT estado, days, prioridad_mantenimiento('baja', automatica, CURRENT_DATE + days) AS prioridad
      FROM (VALUES
        ('pendiente', 8, true), ('pendiente', 7, true), ('pendiente', 2, true),
        ('pendiente', 1, true), ('pendiente', 0, true), ('cancelada', -1, true),
        ('completada', 1, true), ('pendiente', NULL::int, true), ('pendiente', 0, false)
      ) AS cases(estado, days, automatica)
    `);
    assert.deepEqual(rows.map((item) => item.prioridad),
      ['normal', 'alta', 'alta', 'urgente', 'urgente', 'urgente', 'urgente', 'normal', 'baja']);
  } finally {
    await pool.end();
  }
});
