const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const secret = 'tenant-download-test-secret';
process.env.JWT_SECRET = secret;
const contract = {
  id_contrato: '12', nombre_cliente: 'Cliente Ejemplo', correo_cliente: 'cliente@example.test',
  nombre_vendedor: 'Asesor Ejemplo', correo_vendedor: 'asesor@example.test',
  titulo_propiedad: 'Casa', calle: 'Calle', ciudad: 'Ciudad', estado: 'Estado',
  fecha_contrato: '2026-01-01', fecha_inicio: '2026-01-01', fecha_fin: null,
  frente_metros: '5', fondo_metros: '10', superficie_m2: '50', renta_mensual: '1000',
  latitud: null, longitud: null, observaciones: 'Ejemplo',
};
const database = {
  async query(sql, values) {
    if (sql.includes('FROM contratos contract')) {
      assert.match(sql, /client\.id_usuario = \$2/);
      assert.match(sql, /contract\.tipo_operacion = 'RENTA'/);
      return values[0] === '12' && values[1] === 11
        ? { rowCount: 1, rows: [contract] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes('FROM acceso_documentos_inquilino access')) {
      assert.match(sql, /c\.id_usuario = \$1/);
      assert.match(sql, /LOWER\(r\.estado\) = 'activa'/);
      return values[0] === 11 && values[1] === '5'
        ? { rowCount: 1, rows: [{ nombre_archivo: 'compartido.txt', mime_type: 'text/plain', contenido: Buffer.from('documento') }] }
        : { rowCount: 0, rows: [] };
    }
    throw new Error('Unexpected query');
  },
};
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const app = express();
app.use(express.json());
app.use('/api/workflows', require('../server/routes/workflows'));
app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));

test('only the tenant can download own rental contract and shared documents', async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/workflows/tenant`;
  const tenant = jwt.sign({ id_usuario: 11, rol: 'cliente' }, secret);
  const otherTenant = jwt.sign({ id_usuario: 12, rol: 'cliente' }, secret);
  const get = (path, token) => fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await get('/contracts/12/file')).status, 401);
  assert.equal((await get('/contracts/12/file', otherTenant)).status, 404);
  assert.equal((await get('/contracts/invalid/file', tenant)).status, 404);
  const pdf = await get('/contracts/12/file', tenant);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.match(pdf.headers.get('content-disposition'), /contrato-renta-12\.pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await get('/documents/5/file', otherTenant)).status, 404);
  assert.equal((await get('/documents/6/file', tenant)).status, 404);
  const document = await get('/documents/5/file', tenant);
  assert.equal(document.status, 200);
  assert.equal(await document.text(), 'documento');
});
