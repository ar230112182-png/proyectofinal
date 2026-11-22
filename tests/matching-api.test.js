const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'matching-api-test-secret';
const calls = [];
let locked = false;
const client = {
  async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: !locked }] };
    if (sql.includes('AS propiedades_no_disponibles')) return { rows: [{ total: '2', nuevos: '2', modificados: '0', retirados: '0', propiedades_nuevas: '1', propiedades_no_disponibles: '0' }] };
    if (sql.includes('INSERT INTO historial_generaciones_coincidencias')) return { rows: [{ id_generacion: 1, generada_en: '2026-01-01' }] };
    if (sql.includes('INSERT INTO coincidencias')) return { rowCount: 2, rows: [] };
    if (sql.includes('INSERT INTO generaciones_coincidencias')) return { rows: [{ total: '2', generada_en: '2026-01-01' }] };
    if (sql.includes('information_schema.columns')) return { rows: [{ has_detail: true }] };
    return { rows: [], rowCount: 0 };
  },
  release() {},
};
const database = {
  connect: async () => client,
  async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('UPDATE pagos_renta SET')) return {
      rows: [{ id_pago: 9, estado: values[0], pagado_en: values[1] ? '2026-01-01' : null }], rowCount: 1,
    };
    if (sql.includes('information_schema.columns')) return { rows: [{ has_detail: true }] };
    if (sql.includes('INSERT INTO seguimiento_coincidencias')) return { rows: [{ favorito: true, contactado: false }], rowCount: 1 };
    if (sql.includes('COUNT(DISTINCT m.id_lead)')) return { rows: [{ total: 2, prospectos: 1, promedio: '75' }] };
    if (sql.includes('FROM seguimiento_coincidencias s') && !sql.includes('COUNT(*)::int AS total')) return { rows: [{
      id_lead: 1, id_propiedad: 8, lead: 'Lead Demo', propiedad: '[DEMO] Inmueble',
      favorito: true, contactado: true, no_disponible: true, es_demo: true,
    }] };
    if (sql.includes('FROM historial_generaciones_coincidencias h')) return { rows: [{
      id_generacion: 1, generada_en: '2026-01-01', usuario: 'Agente', total: 0,
      nuevos: 0, modificados: 0, retirados: 1, propiedades_nuevas: 0,
      propiedades_no_disponibles: 1, es_demo: true,
    }] };
    if (sql.includes('AS ubicacion')) return { rows: [{
      id_propiedad: 8, propiedad: 'Casa Puebla', estado_propiedad: 'vendida',
      eliminado: false, precio: '1250000', tipo_operacion: 'VENTA', ubicacion: 'Calle 1, Puebla', es_demo: true,
    }] };
    if (sql.includes('COUNT(*)::int AS total') && sql.includes('historial_generaciones_coincidencias')) return { rows: [{ total: 1 }] };
    if (sql.includes('COUNT(*)::int AS total') && sql.includes('coincidencias_retiradas')) return { rows: [{ total: 1 }] };
    if (sql.includes('FROM generaciones_coincidencias')) return { rows: [{ generada_en: '2026-01-01' }] };
    return { rows: [{ id_coincidencia: 4 }] };
  },
};
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const app = express();
app.use(express.json());
app.use('/api/workflows', require('../server/routes/workflows'));
app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

test('generation and paginated results require staff and handle concurrency', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/workflows/matching`;
  const token = (rol) => jwt.sign({ id_usuario: 1, rol }, process.env.JWT_SECRET);
  const request = (path, role, method = 'GET') => fetch(base + path, {
    method, headers: { Authorization: `Bearer ${token(role)}` },
  });
  assert.equal((await request('/run', 'cliente', 'POST')).status, 403);
  assert.equal((await request('/results', 'cliente')).status, 403);
  assert.equal((await request('/tracking/1/1', 'cliente', 'PATCH')).status, 403);
  assert.equal((await request('/results?puntuacion=101', 'agente')).status, 400);
  assert.equal((await request('/results?precio_min=10&precio_max=5', 'agente')).status, 400);
  let response = await request('/run', 'agente', 'POST');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 2);
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  locked = true;
  response = await request('/run', 'administrador', 'POST');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /generando/);
  response = await request('/results?page=2&limit=1&search=Ana&global=Casa', 'agente');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.meta.totalPages, 2);
  assert.equal(result.meta.promedio, '75');
  const query = calls.find(({ sql }) => sql.includes('ORDER BY m.puntuacion DESC NULLS LAST'));
  assert.deepEqual(query.values, ['Ana', 'Casa', 1, null, '', null, null, '', false, '', 1, 1]);
  response = await request('/changes', 'agente');
  assert.equal(response.status, 200);
  const unavailable = await response.json();
  assert.equal(unavailable.data[0].propiedad, 'Casa Puebla');
  assert.equal(unavailable.data[0].ubicacion, 'Calle 1, Puebla');
  assert.equal(unavailable.data[0].estado_propiedad, 'vendida');
  assert.equal(unavailable.data[0].es_demo, true);
  assert.ok(calls.some(({ sql }) => sql.includes('removed.es_demo')));
  assert.ok(calls.some(({ sql }) => sql.includes('LEFT JOIN LATERAL') && sql.includes('ORDER BY id_direccion DESC')));
  response = await request('/retired', 'agente');
  assert.equal((await response.json()).data[0].es_demo, true);
  response = await request('/history', 'agente');
  assert.equal((await response.json()).data[0].es_demo, true);
  response = await fetch(`${base.replace('/matching', '')}/payments/9`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token('agente')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'VENCIDO' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.estado, 'VENCIDO');
  const paymentUpdate = calls.find(({ sql }) => sql.includes('UPDATE pagos_renta SET'));
  assert.deepEqual(paymentUpdate.values, ['VENCIDO', false, '9']);
  assert.match(paymentUpdate.sql, /pagado_en = CASE WHEN \$2/);
  response = await fetch(`${base.replace('/matching', '')}/payments/9`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token('agente')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'PAGADO' }),
  });
  assert.equal(response.status, 200);
  const paidUpdate = calls.filter(({ sql }) => sql.includes('UPDATE pagos_renta SET')).at(-1);
  assert.deepEqual(paidUpdate.values, ['PAGADO', true, '9']);
  response = await fetch(`${base}/tracking/4/5`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token('agente')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorito: true }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.find(({ sql }) => sql.includes('INSERT INTO seguimiento_coincidencias')).values, [1, '4', '5', true, null]);
  response = await fetch(`${base}/tracking/4/5`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token('agente')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorito: true, id_usuario: 2 }),
  });
  assert.equal(response.status, 400);
  const originalPublicUrl = process.env.PUBLIC_PORTAL_URL;
  t.after(() => {
    if (originalPublicUrl === undefined) delete process.env.PUBLIC_PORTAL_URL;
    else process.env.PUBLIC_PORTAL_URL = originalPublicUrl;
  });
  process.env.PUBLIC_PORTAL_URL = 'http://localhost:3007';
  assert.equal((await request('/config', 'agente')).status, 503);
  process.env.PUBLIC_PORTAL_URL = 'https://example.test';
  response = await request('/config', 'agente');
  assert.equal((await response.json()).portalUrl, 'https://example.test/portal.html');
});
