const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const errorHandler = require('../server/error-handler');

const secret = 'workflow-status-test-secret';
process.env.JWT_SECRET = secret;
const state = {
  calls: [],
  assigneeAvailable: true,
  updateRowCount: 1,
};
const database = {
  async query(sql, values) {
    state.calls.push({ sql, values });
    if (sql.includes('information_schema.columns')) return { rows: [{ has_detail: true }] };
    if (sql.includes('FROM usuarios') && sql.includes('activo = TRUE')) {
      return state.assigneeAvailable ? { rowCount: 1, rows: [{}] } : { rowCount: 0, rows: [] };
    }
    if (sql.startsWith('UPDATE ') && sql.includes('RETURNING *')) {
      return {
        rowCount: state.updateRowCount,
        rows: state.updateRowCount ? [{ id: values[values.length - 1] }] : [],
      };
    }
    return { rowCount: 1, rows: [] };
  },
};
const dbPath = require.resolve('../server/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: database };
const app = express();
app.use(express.json());
app.use('/api/workflows', require('../server/routes/workflows'));
app.use(errorHandler);
let server;
let base;

test.before(async () => {
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}/api/workflows`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function patch(resource, body, role = 'agente') {
  const token = jwt.sign({ id_usuario: 7, rol: role }, secret);
  return fetch(`${base}/${resource}/42`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function reset() {
  state.calls.length = 0;
  state.assigneeAvailable = true;
  state.updateRowCount = 1;
}

test('only staff may use generic status updates', async () => {
  reset();
  const response = await patch('leads', { estado: 'CONTACTADO' }, 'cliente');
  assert.equal(response.status, 403);
  assert.equal(state.calls.length, 0);
});

test('unknown workflow resources are rejected without database access', async () => {
  reset();
  const response = await patch('properties', { estado_propiedad: 'Vendida' });
  assert.equal(response.status, 404);
  assert.equal(state.calls.length, 0);
});

test('contract option queries include property dimensions', async () => {
  reset();
  const token = jwt.sign({ id_usuario: 7, rol: 'agente' }, secret);
  const response = await fetch(`${base}/options`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  const propertyQuery = state.calls.find((call) => call.sql.includes('p.titulo ||'));
  assert.match(propertyQuery.sql, /p\.frente_metros, p\.fondo_metros, p\.precio/);
});

test('updates with no permitted fields are rejected', async () => {
  reset();
  const response = await patch('leads', { id_usuario: 99, extra: true });
  assert.equal(response.status, 400);
  assert.equal(state.calls.length, 0);
});

test('non-object update bodies return a client error', async () => {
  reset();
  const token = jwt.sign({ id_usuario: 7, rol: 'agente' }, secret);
  for (const body of ['null', '[]']) {
    const response = await fetch(`${base}/leads/42`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(state.calls.length, 0);
});

test('valid lead statuses are persisted', async () => {
  reset();
  const response = await patch('leads', { estado: 'CALIFICADO' });
  assert.equal(response.status, 200);
  const update = state.calls.find((call) => call.sql.startsWith('UPDATE leads'));
  assert.deepEqual(update.values, ['CALIFICADO', '42']);
});

test('the vendedor role alias can update internal workflow records', async () => {
  reset();
  const response = await patch('leads', { estado: 'CONTACTADO' }, 'vendedor');
  assert.equal(response.status, 200);
});

test('invalid lead statuses are rejected before writing', async () => {
  reset();
  const response = await patch('leads', { estado: 'PENDIENTE' });
  assert.equal(response.status, 400);
  assert.equal(state.calls.length, 0);
});

test('visit state and date validation reject invalid values', async () => {
  reset();
  const invalidState = await patch('visits', { estado: 'Agendada' });
  const invalidDate = await patch('visits', { fecha_cita: 'no-es-fecha' });
  assert.equal(invalidState.status, 400);
  assert.equal(invalidDate.status, 400);
  assert.equal(state.calls.length, 0);
});

test('offer statuses are restricted to the supported transitions', async () => {
  reset();
  const valid = await patch('offers', { estado: 'ACEPTADA' });
  assert.equal(valid.status, 200);
  const update = state.calls.find((call) => call.sql.startsWith('UPDATE ofertas'));
  assert.deepEqual(update.values, ['ACEPTADA', '42']);

  reset();
  const invalid = await patch('offers', { estado: 'CERRADA' });
  assert.equal(invalid.status, 400);
  assert.equal(state.calls.length, 0);
});

test('rental end dates must be real ISO calendar dates', async () => {
  reset();
  const response = await patch('rentals', { fecha_fin: '2026-02-30' });
  assert.equal(response.status, 400);
  assert.equal(state.calls.length, 0);
});

test('payment state is normalized and payment timestamp follows the state', async () => {
  reset();
  const paid = await patch('payments', { estado: 'pagado' });
  assert.equal(paid.status, 200);
  let update = state.calls.find((call) => call.sql.startsWith('UPDATE pagos_renta'));
  assert.deepEqual(update.values, ['PAGADO', true, '42']);
  assert.match(update.sql, /pagado_en = CASE WHEN \$2/);

  reset();
  const overdue = await patch('payments', { estado: 'vencido' });
  assert.equal(overdue.status, 200);
  update = state.calls.find((call) => call.sql.startsWith('UPDATE pagos_renta'));
  assert.deepEqual(update.values, ['VENCIDO', false, '42']);
});

test('commission status allowlist applies to administrators too', async () => {
  reset();
  const response = await patch('commissions', { estado: 'ANULADA' }, 'administrador');
  assert.equal(response.status, 400);
  assert.equal(state.calls.length, 0);
});

test('only administrators can update commissions', async () => {
  reset();
  const response = await patch('commissions', { estado: 'PAGADA' }, 'agente');
  assert.equal(response.status, 403);
  assert.equal(state.calls.length, 0);
});

test('valid commission statuses remain editable by administrators', async () => {
  reset();
  const response = await patch('commissions', { estado: 'PAGADA' }, 'administrador');
  assert.equal(response.status, 200);
  const update = state.calls.find((call) => call.sql.startsWith('UPDATE comisiones'));
  assert.deepEqual(update.values, ['PAGADA', '42']);
});

test('maintenance rejects invalid state, priority, and date values', async () => {
  reset();
  for (const body of [
    { estado: 'abierta' },
    { prioridad: 'critica' },
    { fecha_limite: '2026-13-01' },
  ]) {
    assert.equal((await patch('maintenance', body)).status, 400);
  }
  assert.equal(state.calls.length, 0);
});

test('maintenance automatic priority maps to its database flag', async () => {
  reset();
  const response = await patch('maintenance', { prioridad: 'automatica', fecha_limite: '' });
  assert.equal(response.status, 200);
  const update = state.calls.find((call) => call.sql.startsWith('UPDATE solicitudes_mantenimiento'));
  assert.match(update.sql, /prioridad_automatica = \$1, fecha_limite = \$2/);
  assert.deepEqual(update.values, [true, null, '42']);
});

test('maintenance assignment requires an active staff account', async () => {
  reset();
  state.assigneeAvailable = false;
  const response = await patch('maintenance', { asignado_a: 12 });
  assert.equal(response.status, 400);
  assert.equal(state.calls.filter((call) => call.sql.startsWith('UPDATE solicitudes_mantenimiento')).length, 0);
});

test('missing workflow records return not found', async () => {
  reset();
  state.updateRowCount = 0;
  const response = await patch('leads', { estado: 'CONTACTADO' });
  assert.equal(response.status, 404);
});
