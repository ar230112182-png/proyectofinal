const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
const tenant = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'tenant-portal.js'), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('record tables render the ID from each resource and preserve row actions', () => {
  const panels = new Map();
  const view = {
    querySelector(selector) {
      const match = selector.match(/"(.+?)"/);
      return match ? panels.get(match[1]) || null : null;
    },
    querySelectorAll: () => [],
    append(panel) { panels.set(panel.dataset.recordPanel, panel); },
  };
  const context = vm.createContext({
    document: {
      getElementById: () => view,
      createElement: () => ({ dataset: {}, setAttribute: () => {}, querySelector: () => null, querySelectorAll: () => [] }),
    },
    escapeHtml: (value) => String(value ?? ''),
    formatMoney: String,
    formatCommissionMoney: String,
    isCurrentUserAdmin: () => false,
    recordFilters: {},
    propertyFilters: { search: '', category: '' },
    reportDateFilter: { from: '', to: '' },
    dateFieldByResource: {},
    filterReportsByDate: (data) => data,
    getRecordSearchText: () => '',
    bindUserRecordActions: () => {},
    applyPropertyFilters: () => {},
    applyRecordFilters: () => {},
    renderVisitCalendar: () => {},
    updateMetrics: () => {},
  });
  vm.runInContext(section(main, 'const tableConfig = {', '// Define los campos'), context);
  vm.runInContext(section(main, 'function actionButtons(', '// Conecta las acciones'), context);
  vm.runInContext(section(main, 'function formatCell(', '// Normaliza campos'), context);

  const ids = {
    properties: 'id_propiedad', clients: 'id_cliente', leads: 'id_lead', visits: 'id_cita',
    matches: 'id_coincidencia', documents: 'id_documento', offers: 'id_oferta',
    sales: 'id_venta', commissions: 'id_comision', rentals: 'id_renta', payments: 'id_pago',
    maintenance: 'id_solicitud', contracts: 'id_contrato', sellers: 'id_usuario',
    users: 'id_usuario', reports: 'id',
  };
  for (const [resource, idKey] of Object.entries(ids)) {
    context.resource = resource;
    context.record = { [idKey]: '123', estado: 'PENDIENTE' };
    vm.runInContext("renderRecords(resource, 'view', [record])", context);
    const html = panels.get(resource).innerHTML;
    assert.match(html, /<thead><tr><th(?: [^>]*)?>ID<\/th>/, resource);
    assert.match(html, resource === 'maintenance'
      ? /<tbody><tr[^>]*data-priority-heading="normal"[^>]*>[\s\S]*?<tr[^>]*><td>123<\/td>/
      : /<tbody><tr[^>]*><td(?: [^>]*)?>123<\/td>/, resource);
  }
  assert.match(panels.get('clients').innerHTML, /data-client-history="123"/);
  assert.match(panels.get('clients').innerHTML, /class="client-row-actions"/);
  assert.match(panels.get('clients').innerHTML, /data-column-key="ciudad" hidden/);
  assert.doesNotMatch(panels.get('clients').innerHTML, /data-record-action="portal-access"/);
  context.isCurrentUserAdmin = () => true;
  assert.match(vm.runInContext("actionButtons('clients', { id_cliente: 123 })", context), /data-client-credentials="123"/);
  assert.match(panels.get('leads').innerHTML, /data-record-id="123"/);
  assert.match(panels.get('reports').innerHTML, /data-download-report-id="123"/);
  assert.equal(panels.get('clients').tabIndex, -1);
  assert.equal(panels.get('leads').tabIndex, -1);
});

test('client tabs switch the table and update the active-client filter', async () => {
  let handler;
  let synced = 0;
  let filtered = 0;
  const panel = {};
  const context = vm.createContext({
    clientTableTab: 'todos',
    document: {
      addEventListener(_type, callback) { handler = callback; },
      querySelector: () => panel,
      querySelectorAll: () => [],
    },
    syncClientTabs() { synced += 1; },
    applyRecordFilters(target, resource) {
      assert.equal(target, panel);
      assert.equal(resource, 'clients');
      filtered += 1;
    },
  });

  vm.runInContext(section(main, "document.addEventListener('click', async (event) => {", "document.addEventListener('submit'"), context);
  for (const name of ['activos', 'inactivos', 'potenciales', 'todos']) {
    const event = { target: { closest: (selector) => selector === '[data-client-tab]' ? { dataset: { clientTab: name } } : null } };
    await handler(event);
    assert.equal(context.clientTableTab, name);
  }
  assert.equal(synced, 4);
  assert.equal(filtered, 4);
});

test('purchase filter combines with report search and pagination', () => {
  const rows = [
    { dataset: { recordActivity: 'comprar', recordText: 'compra demo', recordDate: '' } },
    { dataset: { recordActivity: 'vender', recordText: 'venta demo', recordDate: '' } },
    { dataset: { recordActivity: 'comprar', recordText: 'compra otra', recordDate: '' } },
  ];
  const count = {};
  const panel = {
    querySelectorAll: () => rows,
    querySelector: (selector) => selector === '[data-record-filter="reports"]' ? { value: 'comprar' } : selector === '.panel-heading p' ? count : null,
  };
  const context = vm.createContext({
    panel, recordFilters: { reports: { search: 'demo', from: '', to: '' } },
    document: {}, paginatePanel() {}, clientTableTab: 'todos',
  });
  vm.runInContext(section(main, 'function applyRecordFilters(', '// Aplica busqueda, categoria'), context);
  vm.runInContext("applyRecordFilters(panel, 'reports')", context);
  assert.deepEqual(rows.map((row) => row.hidden), [false, true, true]);
  assert.equal(count.textContent, '1 registros de 3');
});

test('active clients combine local and global search and retain pagination', () => {
  const rows = [
    { dataset: { recordActive: 'true', recordText: 'ana activa', recordDate: '2026-01-01' }, hidden: false },
    { dataset: { recordActive: 'false', recordText: 'ana inactiva', recordDate: '2026-01-01' }, hidden: false },
    { dataset: { recordActive: 'true', recordText: 'luis activo', recordDate: '2026-01-01' }, hidden: false },
  ];
  const count = {};
  const empty = {};
  const nav = {};
  const globalSearch = { value: 'ana' };
  const panel = {
    querySelectorAll(selector) { return selector === '[data-priority-heading]' ? [] : rows; },
    querySelector(selector) {
      if (selector === '[data-pagination]') return nav;
      if (selector === '.panel-heading p') return count;
      if (selector === '[data-client-empty]') return empty;
      return null;
    },
  };
  const context = vm.createContext({
    panel, clientTableTab: 'activos',
    recordFilters: { clients: { search: '', from: '', to: '' } },
    document: { getElementById: () => globalSearch },
  });
  vm.runInContext(section(main, 'const PAGE_SIZE = 20;', '// Aplica busqueda, categoria'), context);
  vm.runInContext("applyRecordFilters(panel, 'clients')", context);
  assert.deepEqual(rows.map((row) => row.hidden), [false, true, true]);
  assert.equal(count.textContent, '1 registros de 3');
  context.recordFilters.clients.search = 'luis';
  vm.runInContext("applyRecordFilters(panel, 'clients')", context);
  assert.equal(empty.hidden, false);
  globalSearch.value = '';
  vm.runInContext("applyRecordFilters(panel, 'clients')", context);
  assert.deepEqual(rows.map((row) => row.hidden), [true, true, false]);
  assert.equal(empty.hidden, true);
  context.clientTableTab = 'inactivos';
  context.recordFilters.clients.search = 'ana';
  vm.runInContext("applyRecordFilters(panel, 'clients')", context);
  assert.deepEqual(rows.map((row) => row.hidden), [true, false, true]);
  assert.equal(count.textContent, '1 registros de 3');
  context.recordFilters.clients.from = '2026-02-01';
  vm.runInContext("applyRecordFilters(panel, 'clients')", context);
  assert.equal(empty.hidden, false);
});

test('recent properties include the property ID and span all columns when empty', () => {
  const body = {};
  const context = vm.createContext({
    document: { querySelector: () => body },
    escapeHtml: (value) => String(value ?? ''),
    formatMoney: String,
  });
  vm.runInContext(section(main, 'function renderDashboardProperties(', 'let lastSummaryData'), context);
  context.properties = [{ id_propiedad: 31, titulo: 'Casa', precio: 100 }];
  vm.runInContext('renderDashboardProperties(properties)', context);
  assert.match(body.innerHTML, /<tr><td>31<\/td>/);
  vm.runInContext('renderDashboardProperties([])', context);
  assert.match(body.innerHTML, /colspan="7"/);
});

test('tenant payment history renders the payment ID', () => {
  const accountSection = { querySelector: () => null };
  const context = vm.createContext({ accountSection });
  vm.runInContext(section(tenant, 'function escapeHtml(', '// Agrega autenticacion'), context);
  vm.runInContext(section(tenant, 'function renderAccount(', '// Recupera la cuenta'), context);
  context.data = {
    client: { nombre: 'Ana', apellido_paterno: 'Ejemplo' },
    rentals: [], contracts: [], documents: [], reports: [],
    payments: [{ id_pago: 42, propiedad: 'Casa', periodo: '2026-01-01', monto: 100, estado: 'PAGADO' }],
  };
  vm.runInContext('renderAccount(data)', context);
  assert.match(accountSection.innerHTML, /<th>ID<\/th><th>Propiedad<\/th>/);
  assert.match(accountSection.innerHTML, /<tr><td>42<\/td><td>Casa<\/td>/);
});
