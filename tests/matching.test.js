const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { regenerateMatches } = require('../server/matching');

const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));

test('explanations describe partial matches and unavailable data', () => {
  const context = vm.createContext({ formatMoney: (value) => `$${value}` });
  vm.runInContext(section('function explainMatch(', 'async function loadMatchPage('), context);
  context.input = {
    ciudad: { cumple: true, esperado: 'Puebla', actual: 'Puebla' },
    presupuesto: { cumple: true, minimo: null, maximo: 500, actual: 400 },
    habitaciones: { cumple: false, minimo: 3, actual: 2 },
    categoria: { cumple: false, esperado: 'Casa', actual: null },
  };
  const lines = Array.from(vm.runInContext('explainMatch(input)', context));
  assert.match(lines[0], /coincide/);
  assert.match(lines[1], /cumple/);
  assert.match(lines[2], /se requieren 3, tiene 2/);
  assert.match(lines[3], /no hay datos/);
});

test('sharing validates phone numbers and includes only an explicitly configured public link', async () => {
  const messages = [];
  const target = { location: {}, close() { this.closed = true; } };
  const context = vm.createContext({
    URLSearchParams, encodeURIComponent,
    MATCHING_EMAIL_ACCOUNT: 'saul391302@gmail.com',
    formatMoney: (value) => `$${value}`,
    api: { request: async () => ({ portalUrl: null }) },
    window: { open: () => target, location: {} },
    showToast: (...args) => messages.push(args),
    match: { id_propiedad: 7, propiedad: 'Casa', tipo_operacion: 'VENTA', precio: 500,
      ciudad: 'Puebla', telefono: '2221234567', correo: 'ana@example.test' },
  });
  vm.runInContext(section('function matchingPhone(', 'async function loadMatchingExtra('), context);
  assert.equal(context.matchingPhone('222 123 4567'), '522221234567');
  assert.equal(context.matchingPhone('+1 (202) 555-0123'), '12025550123');
  assert.equal(context.matchingPhone('123'), null);
  await context.shareMatch(context.match, 'whatsapp');
  assert.match(target.location.href, /^https:\/\/wa\.me\/522221234567\?text=/);
  assert.doesNotMatch(decodeURIComponent(target.location.href), /localhost/);
  assert.match(messages.pop()[0], /sin enlace/);
  context.api.request = async () => ({ portalUrl: 'https://example.test/portal.html' });
  await context.shareMatch(context.match, 'correo');
  const gmail = new URL(target.location.href);
  assert.equal(gmail.hostname, 'mail.google.com');
  assert.equal(gmail.searchParams.get('authuser'), 'saul391302@gmail.com');
  assert.equal(gmail.searchParams.get('to'), 'ana@example.test');
  assert.match(gmail.searchParams.get('body'), /https:\/\/example\.test\/portal\.html\?propiedad=7/);
  context.match.telefono = '123';
  await context.shareMatch(context.match, 'whatsapp');
  assert.match(messages.pop()[0], /teléfono no es válido/);
});

test('match actions show the phone number and link directly to Gmail compose', async () => {
  const container = {};
  const nav = {};
  const elements = {
    '[data-match-total]': {},
    '[data-match-leads]': {},
    '[data-match-average]': {},
    '[data-match-generation]': {},
    '[data-match-results]': container,
    '[data-match-pagination]': nav,
  };
  const view = { querySelector: (selector) => elements[selector] };
  const context = vm.createContext({
    URLSearchParams, encodeURIComponent,
    MATCHING_EMAIL_ACCOUNT: 'saul391302@gmail.com',
    matchingState: { page: 1, search: '', requestId: 0, filters: {} },
    records: { matches: [] },
    document: {
      getElementById: (id) => id === 'matching-view' ? view : null,
    },
    api: { request: async () => ({
      data: [{
        id_coincidencia: 1, id_propiedad: 8, lead: 'Ana', propiedad: 'Casa',
        puntuacion: 95, explicacion: {}, telefono: '2221234567',
        correo: 'ana@example.test', estado_propiedad: 'disponible',
      }],
      meta: { page: 1, totalPages: 1, total: 1, prospectos: 1, promedio: 95, generadaEn: null },
    }) },
    explainMatch: () => [],
    escapeHtml: String,
    formatMoney: (value) => `$${value}`,
  });
  vm.runInContext(section('async function loadMatchPage(', 'async function shareMatch('), context);
  await context.loadMatchPage(1);
  assert.match(container.innerHTML, /<span class="matching-phone">2221234567<\/span>/);
  assert.doesNotMatch(container.innerHTML, /href="tel:/);
  assert.match(container.innerHTML, /https:\/\/mail\.google\.com\/mail\/\?/);
  assert.match(container.innerHTML, /authuser.*saul391302/);
});

test('unavailable-property details render the requested property information', async () => {
  const content = {};
  const context = vm.createContext({
    document: { querySelector: () => ({ querySelector: () => content }) },
    matchingState: { generatedAt: '2026-01-01' },
    api: { request: async () => ({
      data: [{
        id_propiedad: 42, propiedad: 'Casa Puebla', estado_propiedad: 'vendida',
        precio: 1250000, tipo_operacion: 'VENTA', ubicacion: 'Calle 1, Puebla',
      }],
      meta: { totalPages: 1 },
    }) },
    escapeHtml: String,
    formatMoney: (value) => `$${value}`,
  });
  vm.runInContext(section('async function loadMatchingExtra(', 'async function runMatchingGeneration('), context);
  await context.loadMatchingExtra('changes');
  assert.match(content.innerHTML, /Casa Puebla/);
  assert.match(content.innerHTML, /ID 42/);
  assert.match(content.innerHTML, /vendida/);
  assert.match(content.innerHTML, /\$1250000/);
  assert.match(content.innerHTML, /VENTA/);
  assert.match(content.innerHTML, /Calle 1, Puebla/);
});

test('matching demo history sections identify seeded records', async () => {
  const content = {};
  const context = vm.createContext({
    document: { querySelector: () => ({ querySelector: () => content }) },
    matchingState: { generatedAt: '2026-01-01' },
    api: { request: async (url) => {
      if (url.includes('/history')) return { data: [{
        es_demo: true, generada_en: '2026-01-01', usuario: 'Agente', total: 0,
        nuevos: 0, modificados: 0, retirados: 1, propiedades_nuevas: 0,
        propiedades_no_disponibles: 1,
      }], meta: { totalPages: 1 } };
      if (url.includes('/retired')) return { data: [{
        es_demo: true, lead: 'Lead Demo 01', propiedad: '[DEMO] Inmueble retirado',
        no_disponible: true, favorito: true, contactado: true, id_lead: 1, id_propiedad: 2,
      }], meta: { totalPages: 1 } };
      return { data: [{
        es_demo: true, propiedad: '[DEMO] Inmueble retirado', id_propiedad: 2,
        estado_propiedad: 'Vendida', precio: 100, tipo_operacion: 'VENTA',
        ubicacion: 'Ciudad de Mexico', eliminado: false,
      }], meta: { totalPages: 1 } };
    } },
    escapeHtml: String,
    formatAlertDate: String,
    formatMoney: (value) => `$${value}`,
  });
  vm.runInContext(section('async function loadMatchingExtra(', 'async function runMatchingGeneration('), context);
  for (const kind of ['history', 'retired', 'changes']) {
    await context.loadMatchingExtra(kind);
    assert.match(content.innerHTML, /DEMO/);
  }
});

test('empty matching sections explain which action will populate each history', async () => {
  const content = {};
  const context = vm.createContext({
    document: { querySelector: () => ({ querySelector: () => content }) },
    matchingState: { generatedAt: null },
    api: { request: async () => ({ data: [], meta: { totalPages: 1 } }) },
  });
  vm.runInContext(section('async function loadMatchingExtra(', 'async function runMatchingGeneration('), context);
  await context.loadMatchingExtra('changes');
  assert.match(content.innerHTML, /Genera coincidencias para iniciar/);
  await context.loadMatchingExtra('retired');
  assert.match(content.innerHTML, /Marca una como favorita o contactada/);
  await context.loadMatchingExtra('history');
  assert.match(content.innerHTML, /Usa “Generar coincidencias”/);
});

test('generation reports progress and restores the button on success', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const status = {};
  const button = {
    textContent: 'Generar coincidencias',
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
  };
  const messages = [];
  const context = vm.createContext({
    button, document: { querySelector: () => status, querySelectorAll: () => [] },
    api: { request: () => pending },
    loadMatchPage: async () => { status.textContent = 'Resultados actualizados'; },
    showToast: (...args) => messages.push(args), loadNotifications: async () => {},
  });
  vm.runInContext(section('async function runMatchingGeneration(', 'function openMatchVisit('), context);
  const running = context.runMatchingGeneration(button);
  assert.equal(button.disabled, true);
  assert.equal(button['aria-busy'], 'true');
  assert.match(button.textContent, /Generando/);
  assert.match(status.textContent, /puede tardar/);
  finish();
  await running;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Generar coincidencias');
  assert.equal(button['aria-busy'], undefined);
  assert.equal(status.textContent, 'Resultados actualizados');
  assert.deepEqual(messages[0], ['Coincidencias actualizadas.']);
});

test('generation and result-loading errors are reported separately', async () => {
  const status = {};
  const button = { textContent: 'Generar', setAttribute() {}, removeAttribute() {} };
  const messages = [];
  const context = vm.createContext({
    document: { querySelector: () => status },
    api: { request: async () => { throw new Error('red'); } },
    loadMatchPage: async () => {},
    showToast: (...args) => messages.push(args),
  });
  vm.runInContext(section('async function runMatchingGeneration(', 'function openMatchVisit('), context);
  await context.runMatchingGeneration(button);
  assert.match(status.textContent, /No se pudo confirmar/);
  assert.match(messages.pop()[0], /No se pudo generar.*red/);
  assert.equal(button.disabled, false);
  context.api.request = async () => {};
  context.loadMatchPage = async () => { throw new Error('consulta'); };
  await context.runMatchingGeneration(button);
  assert.match(status.textContent, /Se generaron.*no se pudieron cargar/);
  assert.match(messages.pop()[0], /Coincidencias generadas.*consulta/);
  assert.equal(button.disabled, false);
});

test('matched visit locks the selected client and property and requires a unique registered client', () => {
  const hiddenFields = [];
  const selections = Object.fromEntries(['id_propiedad', 'id_cliente'].map((name) => [name, {
    dispatchEvent() {},
    setAttribute() {},
    closest: () => ({ append: (field) => hiddenFields.push(field) }),
  }]));
  const messages = [];
  let openCount = 0;
  const context = vm.createContext({
    optionData: { properties: [{ id: 8 }] },
    records: { clients: [{ id_cliente: 7, nombre: 'Ana', correo: 'ana@example.test' }] },
    window: { confirm: () => true },
    openForm() { openCount += 1; },
    showToast: (...args) => messages.push(args),
    document: {
      getElementById: () => ({ querySelector: (selector) => selections[selector.match(/name="([^"]+)"/)[1]] }),
      createElement: () => ({}),
    },
    Event: class {},
    match: { id_propiedad: 8, correo: ' ANA@example.test ' },
  });
  vm.runInContext(section('function openMatchVisit(', '// Presenta las citas'), context);
  vm.runInContext('openMatchVisit(match)', context);
  assert.equal(selections.id_propiedad.value, '8');
  assert.equal(selections.id_propiedad.disabled, true);
  assert.equal(selections.id_cliente.value, '7');
  assert.equal(selections.id_cliente.disabled, true);
  assert.deepEqual(hiddenFields.map(({ name, value }) => [name, value]), [['id_propiedad', '8'], ['id_cliente', '7']]);
  context.window.confirm = () => false;
  vm.runInContext('openMatchVisit(match)', context);
  assert.equal(openCount, 1);
  context.records.clients.push({ id_cliente: 9, correo: 'ana@example.test' });
  vm.runInContext('openMatchVisit(match)', context);
  assert.equal(openCount, 1);
  assert.match(messages.pop()[0], /único cliente registrado/);
});

test('opening a matched property isolates its exact ID', () => {
  const rows = ['8', '18'].map((id) => ({
    dataset: { propertyTitle: 'Casa', propertyId: id, propertyCategory: 'Casa', recordDate: '' },
  }));
  const panel = {
    querySelector(selector) {
      if (selector === '[data-property-search]') return { value: '8' };
      return null;
    },
    querySelectorAll: () => rows,
  };
  const context = vm.createContext({
    panel, propertyFilters: { search: '', category: '', exactId: '8' },
    recordFilters: {}, paginatePanel() {},
  });
  vm.runInContext(section('function applyPropertyFilters(', '// Reune los campos'), context);
  vm.runInContext('applyPropertyFilters(panel)', context);
  assert.deepEqual(rows.map((row) => row.hidden), [false, true]);
  context.propertyFilters.exactId = '';
  vm.runInContext('applyPropertyFilters(panel)', context);
  assert.deepEqual(rows.map((row) => row.hidden), [false, false]);
});

test('concurrent generation is rejected and rolled back', async () => {
  const calls = [];
  const client = { async query(sql) {
    calls.push(sql);
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: false }] };
    return { rows: [] };
  } };
  await assert.rejects(regenerateMatches(client, 1, () => {}), (error) => error.status === 409);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.some((sql) => sql.includes('DELETE FROM coincidencias')), false);
});

test('a generation failure rolls back instead of publishing partial results', async () => {
  const calls = [];
  const client = { async query(sql) {
    calls.push(sql);
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
    if (sql.includes('AS propiedades_no_disponibles')) return { rows: [{ total: 0, nuevos: 0, modificados: 0, retirados: 0, propiedades_nuevas: 0, propiedades_no_disponibles: 0 }] };
    if (sql.includes('INSERT INTO historial_generaciones_coincidencias')) return { rows: [{ id_generacion: 1 }] };
    if (sql.includes('INSERT INTO coincidencias')) throw new Error('database error');
    return { rows: [] };
  } };
  await assert.rejects(regenerateMatches(client, 1, () => {}), /database error/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
});

test('generation scores, replaces obsolete records and handles empty results', { skip: !process.env.TEST_MATCHING_DB }, async () => {
  require('dotenv').config();
  const pool = require('../server/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE leads (id_lead bigint PRIMARY KEY, estado text, nombre text, correo text, telefono text);
      CREATE TEMP TABLE preferencias_lead (id_preferencia bigint, id_lead bigint, ciudad text,
        precio_min numeric, precio_max numeric, habitaciones_min integer, tipo text, operacion text);
      CREATE TEMP TABLE propiedades (id_propiedad integer PRIMARY KEY, eliminado boolean, estado_propiedad text,
        tipo_operacion text, id_categoria integer, precio numeric, habitaciones integer, titulo text);
      CREATE TEMP TABLE categorias (id_categoria integer, nombre text);
      CREATE TEMP TABLE direcciones (id_direccion integer, id_propiedad integer, calle text, numero text,
        colonia text, ciudad text, estado text, codigo_postal text);
      CREATE TEMP TABLE coincidencias (id_coincidencia bigint GENERATED BY DEFAULT AS IDENTITY, id_lead bigint, id_propiedad integer, puntuacion numeric,
        explicacion jsonb, version_calculo integer, creada_en timestamptz, nueva boolean DEFAULT false,
        propiedad_nueva boolean DEFAULT false, UNIQUE (id_lead, id_propiedad));
      CREATE TEMP TABLE generaciones_coincidencias (id integer PRIMARY KEY, generada_en timestamptz, total bigint);
      CREATE TEMP TABLE seguimiento_coincidencias (id_usuario integer, id_lead bigint, id_propiedad integer,
        favorito boolean DEFAULT false, contactado boolean DEFAULT false, actualizado_en timestamptz DEFAULT now(),
        PRIMARY KEY (id_usuario, id_lead, id_propiedad));
      CREATE TEMP TABLE historial_generaciones_coincidencias (id_generacion bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        id_usuario integer, generada_en timestamptz DEFAULT now(), total bigint, nuevos bigint, modificados bigint,
        retirados bigint, propiedades_nuevas bigint, propiedades_no_disponibles bigint,
        es_demo boolean NOT NULL DEFAULT false);
      CREATE TEMP TABLE coincidencias_retiradas (id_generacion bigint, id_lead bigint, id_propiedad integer,
        no_disponible boolean, es_demo boolean NOT NULL DEFAULT false);
      CREATE TEMP TABLE usuarios (id_usuario integer, nombre text, rol text, activo boolean);
      CREATE TEMP TABLE notificaciones (id_usuario integer, dedupe_key text, titulo text, detalle text,
        entidad text, entidad_id text, UNIQUE (id_usuario, dedupe_key));
      INSERT INTO usuarios VALUES (1, 'Agente', 'agente', true), (2, 'Otro', 'vendedor', true);
      INSERT INTO leads VALUES (1, 'NUEVO', 'Ana', 'ana@example.test', NULL),
        (2, 'NUEVO', 'Luis', NULL, NULL), (3, 'CONVERTIDO', 'Otro', NULL, NULL);
      INSERT INTO preferencias_lead VALUES (1, 1, 'Puebla', NULL, 500, 3, 'Casa', 'VENTA');
      INSERT INTO categorias VALUES (1, 'Casa'), (2, 'Lote');
      INSERT INTO propiedades VALUES
        (1, false, 'disponible', 'VENTA', 1, 400, 3, 'Casa A'),
        (2, false, 'disponible', 'VENTA', 2, 400, 2, 'Lote B'),
        (3, false, 'disponible', 'RENTA', 1, 400, 3, 'Casa C');
      INSERT INTO direcciones VALUES (1, 1, 'Calle 1', '10', 'Centro', 'Puebla', 'Puebla', '72000'),
        (2, 2, 'Calle 2', '20', 'Norte', 'Otra', 'Puebla', '72001');
      INSERT INTO coincidencias (id_lead, id_propiedad, puntuacion, creada_en) VALUES (1, 3, 100, now());
    `);
    const wrapped = { query(sql, values) {
      if (sql.startsWith('BEGIN ')) return client.query('SAVEPOINT generation');
      if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT generation');
      if (sql === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT generation');
      return client.query(sql, values);
    } };
    const generate = async () => {
      const result = await regenerateMatches(wrapped, 1, async () => {});
      await client.query('DROP TABLE matching_candidates, matching_changes, matching_removed');
      return result;
    };
    assert.equal(Number((await generate()).total), 5);
    let rows = (await client.query('SELECT * FROM coincidencias ORDER BY id_lead, id_propiedad')).rows;
    assert.deepEqual(rows.map((row) => [Number(row.id_lead), row.id_propiedad, row.puntuacion]), [
      [1, 1, '100.00'], [1, 2, '38.71'], [2, 1, null], [2, 2, null], [2, 3, null],
    ]);
    assert.equal(rows[1].explicacion.habitaciones.actual, 2);
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const dbPath = require.resolve('../server/db');
    const originalDatabase = require.cache[dbPath];
    let queries = Promise.resolve();
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
      exports: { query(sql, values) {
        const result = queries.then(() => client.query(sql, values));
        queries = result.then(() => undefined, () => undefined);
        return result;
      } } };
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'matching-postgres-test';
    const app = express();
    app.use(express.json());
    app.use('/api/workflows', require('../server/routes/workflows'));
    app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
      const token = jwt.sign({ id_usuario: 1, rol: 'agente' }, process.env.JWT_SECRET);
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/workflows/matching/results?limit=1&page=2&search=Ana`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.meta.total, 2);
      assert.equal(result.meta.totalPages, 2);
      assert.equal(result.data[0].propiedad, 'Lote B');
      const base = `http://127.0.0.1:${server.address().port}/api/workflows/matching`;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const scored = await (await fetch(`${base}/results?puntuacion=0`, { headers })).json();
      assert.equal(scored.meta.total, 2);
      assert.ok(scored.data.every((row) => row.puntuacion !== null));
      const tracking = await fetch(`${base}/tracking/1/1`, {
        method: 'PATCH', headers, body: JSON.stringify({ favorito: true, contactado: true }),
      });
      assert.equal(tracking.status, 200);
      let filtered = await fetch(`${base}/results?favoritos=1&contacto=contactado&puntuacion=90&ciudad=Puebla&precio_min=300&precio_max=500&operacion=VENTA`, { headers });
      assert.equal(filtered.status, 200);
      let filteredData = await filtered.json();
      assert.equal(filteredData.meta.total, 1);
      assert.equal(filteredData.data[0].id_propiedad, 1);
      const otherToken = jwt.sign({ id_usuario: 2, rol: 'agente' }, process.env.JWT_SECRET);
      filtered = await fetch(`${base}/results?favoritos=1`, { headers: { Authorization: `Bearer ${otherToken}` } });
      filteredData = await filtered.json();
      assert.equal(filteredData.meta.total, 0);
      assert.equal((await fetch(`${base}/results?puntuacion=101`, { headers })).status, 400);
      assert.equal((await fetch(`${base}/results?precio_min=501&precio_max=500`, { headers })).status, 400);
      const unchanged = await generate();
      assert.equal(Number(unchanged.nuevos), 0);
      assert.equal(Number(unchanged.modificados), 0);
      assert.equal(Number(unchanged.retirados), 0);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM notificaciones')).rows[0].n, 2);
      const beforeFailure = (await client.query('SELECT COUNT(*)::int AS n FROM historial_generaciones_coincidencias')).rows[0].n;
      await assert.rejects(regenerateMatches(wrapped, 1, async () => { throw new Error('audit failed'); }), /audit failed/);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM historial_generaciones_coincidencias')).rows[0].n, beforeFailure);
      await client.query("UPDATE propiedades SET estado_propiedad = 'vendida' WHERE id_propiedad = 1");
      const changed = await generate();
      assert.equal(Number(changed.retirados), 2);
      assert.equal(Number(changed.propiedades_no_disponibles), 1);
      const retired = await (await fetch(`${base}/retired`, { headers })).json();
      assert.equal(retired.meta.total, 1);
      assert.equal(retired.data[0].favorito, true);
      assert.equal(retired.data[0].contactado, true);
      assert.equal(retired.data[0].no_disponible, true);
      const changes = await (await fetch(`${base}/changes`, { headers })).json();
      assert.ok(changes.meta, JSON.stringify(changes));
      assert.equal(changes.meta.total, 1);
      const history = await (await fetch(`${base}/history`, { headers })).json();
      assert.equal(Number(history.data[0].retirados), 2);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM notificaciones')).rows[0].n, 4);
      await client.query("UPDATE propiedades SET estado_propiedad = 'disponible' WHERE id_propiedad = 1");
      await generate();
      filtered = await fetch(`${base}/results?favoritos=1&contacto=contactado`, { headers });
      filteredData = await filtered.json();
      assert.equal(filteredData.meta.total, 1);
      assert.equal(filteredData.data[0].id_propiedad, 1);
      await client.query('UPDATE propiedades SET estado_propiedad = NULL WHERE id_propiedad = 2');
      const missingStatus = await generate();
      assert.equal(Number(missingStatus.retirados), 2);
      assert.equal(Number(missingStatus.propiedades_no_disponibles), 0);
      await client.query("UPDATE propiedades SET estado_propiedad = 'disponible' WHERE id_propiedad = 2");
      await generate();
    } finally {
      await new Promise((resolve) => server.close(resolve));
      require.cache[dbPath] = originalDatabase;
      if (originalSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalSecret;
    }
    await client.query("UPDATE propiedades SET estado_propiedad = 'vendida' WHERE id_propiedad = 1");
    assert.equal(Number((await generate()).total), 3);
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM coincidencias WHERE id_propiedad = 1')).rows[0].n, 0);
    await client.query("UPDATE propiedades SET estado_propiedad = 'vendida'");
    assert.equal(Number((await generate()).total), 0);
    rows = (await client.query('SELECT * FROM coincidencias')).rows;
    assert.equal(rows.length, 0);
    await client.query(`
      INSERT INTO leads SELECT n, 'NUEVO', 'Prospecto ' || n, NULL, NULL FROM generate_series(1000, 1119) n;
      INSERT INTO propiedades SELECT n, false, 'disponible', 'VENTA', 1, 400, 3, 'Propiedad ' || n
        FROM generate_series(1000, 1119) n;
    `);
    assert.equal(Number((await generate()).total), 14640);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
