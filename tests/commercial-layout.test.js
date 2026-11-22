const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));

test('commercial tabs show only their selected table, regardless of load order', () => {
  const tabs = ['contracts', 'offers', 'sales', 'rentals'].map((name) => ({
    dataset: { contractTab: name },
    setAttribute(key, value) { this[key] = value; },
  }));
  const panels = ['rentals', 'sales', 'contracts', 'offers'].map((name) => ({
    dataset: { recordPanel: name },
    setAttribute(key, value) { this[key] = value; },
  }));
  const view = { querySelectorAll: (selector) => selector === '[data-contract-tab]' ? tabs : panels };
  const context = vm.createContext({ document: { getElementById: () => view } });
  vm.runInContext("let contractTableTab = 'contracts';", context);
  vm.runInContext(section('function syncContractTabs()', '// Renderiza tablas'), context);
  for (const name of ['contracts', 'offers', 'sales', 'rentals']) {
    vm.runInContext(`contractTableTab = '${name}'; syncContractTabs()`, context);
    assert.deepEqual(panels.filter((panel) => !panel.hidden).map((panel) => panel.dataset.recordPanel), [name]);
    assert.equal(tabs.find((tab) => tab.dataset.contractTab === name)['aria-selected'], 'true');
    assert.equal(panels.find((panel) => panel.dataset.recordPanel === name)['aria-labelledby'], `contract-tab-${name}`);
  }
  assert.match(index, /id="contract-tab-rentals"[^>]*aria-controls="contract-panel-rentals"/);
});

test('column chooser hides and restores columns for any table resource', () => {
  const context = vm.createContext({
    tableColumns: { clients: new Set(['nombre', 'correo']) },
  });
  vm.runInContext(section('function getTableColumns(', '// Define los campos'), context);
  const columns = [['fecha_cita', 'Fecha'], ['cliente', 'Cliente'], ['propiedad', 'Propiedad']];
  const cells = columns.map(([key]) => ({ dataset: { columnKey: key }, hidden: false }));
  const controls = columns.map(([key]) => ({ dataset: { tableColumn: key }, checked: true }));
  const scope = {
    querySelectorAll(selector) {
      return selector === '[data-column-key]' ? cells : controls;
    },
  };
  context.scope = scope;
  context.visitColumns = columns;
  vm.runInContext("setTableColumnVisibility(scope, 'visits', visitColumns, 'cliente', false)", context);
  assert.deepEqual(cells.map((cell) => cell.hidden), [false, true, false]);
  assert.deepEqual(controls.map((input) => input.checked), [true, false, true]);
  vm.runInContext("setTableColumnVisibility(scope, 'visits', visitColumns, 'cliente', true)", context);
  assert.deepEqual(cells.map((cell) => cell.hidden), [false, false, false]);
  assert.deepEqual(controls.map((input) => input.checked), [true, true, true]);
  assert.deepEqual(
    Array.from(vm.runInContext("getTableColumns('clients', [['nombre'], ['correo'], ['telefono']])", context)),
    ['nombre', 'correo'],
  );
  assert.deepEqual(
    Array.from(vm.runInContext("getTableColumns('visits', visitColumns)", context)),
    ['fecha_cita', 'propiedad', 'cliente'],
  );
});

test('rental tables keep search, dates, status and pagination independent', () => {
  const makePanel = (key) => ({
    dataset: { recordPanel: 'rentals', ...(key ? { filterKey: key } : {}) },
    rows: [
      { dataset: { recordText: 'casa ana', recordDate: '2026-01-05', recordStatus: 'Activa' } },
      { dataset: { recordText: 'casa luis', recordDate: '2026-02-05', recordStatus: 'Finalizada' } },
      { dataset: { recordText: 'departamento ana', recordDate: '2026-03-05', recordStatus: 'Activa' } },
    ],
    querySelectorAll(selector) { return selector === 'tbody tr[data-record-text]' ? this.rows : []; },
    querySelector() { return null; },
  });
  const commercial = makePanel('contract-rentals');
  const collections = makePanel();
  const context = vm.createContext({
    commercial, collections,
    document: { getElementById: () => null },
    clientTableTab: 'todos',
    recordFilters: {
      'contract-rentals': { search: 'ana', from: '2026-02-01', to: '', status: 'Activa' },
      rentals: { search: 'luis', from: '', to: '', status: 'Finalizada' },
    },
    paginatePanel(panel, resource, reset) { panel.paginated = [resource, reset]; },
  });
  vm.runInContext(section('function applyRecordFilters(', '// Aplica busqueda'), context);
  vm.runInContext("applyRecordFilters(commercial, 'rentals'); applyRecordFilters(collections, 'rentals')", context);
  assert.deepEqual(commercial.rows.map((row) => row.hidden), [true, true, false]);
  assert.deepEqual(collections.rows.map((row) => row.hidden), [true, false, true]);
  assert.deepEqual(commercial.paginated, ['rentals', true]);
  assert.deepEqual(collections.paginated, ['rentals', true]);
});

test('calendar is above the visits table and refreshes without duplicates', () => {
  const visitsView = index.slice(index.indexOf('id="visits-view"'), index.indexOf('id="contracts-view"'));
  assert.ok(visitsView.indexOf('data-visit-calendar') < visitsView.indexOf('class="mini-stat-grid"'));
  assert.match(main, /data-table-column="\$\{escapeHtml\(key\)\}"/);
  assert.match(index, /data-column-scope="dashboard-properties"/);
  assert.match(index, /href="\/portal-inquilinos\.html">Portal de inquilinos/);
  const panel = {};
  const context = vm.createContext({
    panel, escapeHtml: String,
    visitCalendarState: { mode: 'week', date: new Date() },
    localDateKey: (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
  });
  vm.runInContext(section('function renderVisitCalendar(', '// Filtra filas'), context);
  vm.runInContext('renderVisitCalendar(panel, []); renderVisitCalendar(panel, [])', context);
  assert.equal((panel.innerHTML.match(/Calendario de visitas/g) || []).length, 1);
  assert.equal((panel.innerHTML.match(/class="visit-day"/g) || []).length, 7);
});

test('monthly calendar displays the correct days and keeps visits on their local date', () => {
  const panel = {};
  const context = vm.createContext({
    panel, escapeHtml: String,
    visitCalendarState: { mode: 'month', date: new Date(2024, 1, 29, 12) },
    localDateKey: (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
    visits: [{ fecha_cita: new Date(2024, 1, 1, 0, 30).toISOString(), propiedad: 'Casa A', cliente: 'Ana', estado: 'Confirmada' }],
  });
  vm.runInContext(section('function moveVisitCalendar(', '// Filtra filas'), context);
  vm.runInContext('renderVisitCalendar(panel, visits)', context);
  assert.equal((panel.innerHTML.match(/class="visit-day"/g) || []).length, 29);
  assert.equal((panel.innerHTML.match(/class="visit-calendar-blank"/g) || []).length, 6);
  const firstDay = new Date(2024, 1, 1, 12).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  assert.ok(panel.innerHTML.includes(`aria-label="${firstDay}" tabindex="0"`));
  assert.match(panel.innerHTML, /Casa A/);
  assert.match(panel.innerHTML, /data-calendar-mode="month" aria-pressed="true"/);
  vm.runInContext('moveVisitCalendar(1); renderVisitCalendar(panel, visits)', context);
  assert.equal(context.visitCalendarState.date.getMonth(), 2);
  assert.equal(context.visitCalendarState.date.getDate(), 1);
  assert.equal((panel.innerHTML.match(/class="visit-day"/g) || []).length, 31);
  assert.doesNotMatch(panel.innerHTML, /Casa A/);
});

test('calendar navigates weeks and months across year boundaries', () => {
  const context = vm.createContext({
    visitCalendarState: { mode: 'week', date: new Date(2024, 11, 29, 12) },
  });
  vm.runInContext(section('function moveVisitCalendar(', '// Presenta las citas'), context);
  vm.runInContext('moveVisitCalendar(1)', context);
  assert.equal(context.visitCalendarState.date.getFullYear(), 2025);
  assert.equal(context.visitCalendarState.date.getMonth(), 0);
  assert.equal(context.visitCalendarState.date.getDate(), 5);
  context.visitCalendarState.mode = 'month';
  vm.runInContext('moveVisitCalendar(-1)', context);
  assert.equal(context.visitCalendarState.date.getFullYear(), 2024);
  assert.equal(context.visitCalendarState.date.getMonth(), 11);
});

test('pagination keeps remaining records accessible on subsequent pages', () => {
  const rows = Array.from({ length: 8 }, () => ({ dataset: {}, hidden: false }));
  const nav = {};
  const panel = {
    querySelectorAll: (selector) => selector === '[data-priority-heading]' ? [] : rows,
    querySelector: () => nav,
  };
  const context = vm.createContext({ panel });
  vm.runInContext(section('const PAGE_SIZE =', '// Aplica texto'), context);
  vm.runInContext("paginatePanel(panel, 'contracts')", context);
  assert.equal(rows.filter((row) => !row.dataset.pageHidden).length, 6);
  assert.equal(nav.hidden, false);
  vm.runInContext("tablePages.contracts = 2; paginatePanel(panel, 'contracts')", context);
  assert.equal(rows.filter((row) => !row.dataset.pageHidden).length, 2);
  assert.match(nav.innerHTML, /Página 2 de 2/);
});

test('pagination state is isolated between commercial and collections rentals', () => {
  const makePanel = (key) => {
    const rows = Array.from({ length: 8 }, () => ({ dataset: {}, hidden: false }));
    return {
      dataset: key ? { filterKey: key } : {},
      rows, nav: {},
      querySelectorAll(selector) { return selector === '[data-priority-heading]' ? [] : rows; },
      querySelector() { return this.nav; },
    };
  };
  const commercial = makePanel('contract-rentals');
  const collections = makePanel();
  const context = vm.createContext({ commercial, collections });
  vm.runInContext(section('const PAGE_SIZE =', '// Aplica texto'), context);
  vm.runInContext("paginatePanel(commercial, 'rentals'); tablePages['contract-rentals'] = 2; paginatePanel(commercial, 'rentals'); paginatePanel(collections, 'rentals')", context);
  assert.match(commercial.nav.innerHTML, /Página 2 de 2/);
  assert.match(collections.nav.innerHTML, /Página 1 de 2/);
});
