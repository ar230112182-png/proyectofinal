const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function setup(rows, filters) {
  const search = { value: filters.search || '' };
  const category = { value: filters.category || '' };
  const count = {};
  const panel = {
    querySelector(selector) {
      if (selector === '[data-property-search]') return search;
      if (selector === '[data-property-category]') return category;
      if (selector === '[data-property-result-count]') return count;
      return null;
    },
    querySelectorAll: () => rows,
  };
  const calls = [];
  const context = vm.createContext({
    panel,
    propertyFilters: { search: '', category: '', exactId: filters.exactId || '' },
    recordFilters: { properties: { search: '', from: filters.from || '', to: filters.to || '' } },
    paginatePanel(_panel, resource, reset) { calls.push([resource, reset]); },
  });
  vm.runInContext(section('function applyPropertyFilters(', '// Reune los campos'), context);
  return { context, panel, rows, search, category, count, calls };
}

const row = (id, title, type, date) => ({
  dataset: {
    propertyId: String(id),
    propertyTitle: title,
    propertyCategory: type,
    recordDate: date,
  },
  hidden: false,
});

test('property search matches names and ID substrings case-insensitively', () => {
  const rows = [row(18, 'Casa del Lago', 'Casa', '2026-01-01'), row(8, 'Departamento Centro', 'Departamento', '2026-01-02')];
  const testContext = setup(rows, { search: 'CASA' });
  vm.runInContext('applyPropertyFilters(panel)', testContext.context);
  assert.deepEqual(rows.map((item) => item.hidden), [false, true]);
  testContext.search.value = '18';
  vm.runInContext('applyPropertyFilters(panel)', testContext.context);
  assert.deepEqual(rows.map((item) => item.hidden), [false, true]);
});

test('property category and date boundaries combine with text search', () => {
  const rows = [
    row(1, 'Casa norte', 'Casa', '2026-01-01'),
    row(2, 'Casa centro', 'Casa', '2026-01-15'),
    row(3, 'Casa sur', 'Casa', '2026-02-01'),
    row(4, 'Casa sur', 'Departamento', '2026-01-15'),
  ];
  const testContext = setup(rows, { search: 'casa', category: 'Casa', from: '2026-01-01', to: '2026-01-31' });
  vm.runInContext('applyPropertyFilters(panel)', testContext.context);
  assert.deepEqual(rows.map((item) => item.hidden), [false, false, true, true]);
  assert.equal(testContext.count.textContent, '2 propiedades de 4');
  assert.deepEqual(testContext.calls, [['properties', true]]);
});

test('exact property ID takes precedence over a broader text match', () => {
  const rows = [row(8, 'Casa compartida', 'Casa', '2026-01-01'), row(18, 'Casa compartida', 'Casa', '2026-01-01')];
  const testContext = setup(rows, { search: 'casa', exactId: '8' });
  vm.runInContext('applyPropertyFilters(panel)', testContext.context);
  assert.deepEqual(rows.map((item) => item.hidden), [false, true]);
});

test('property filter reports empty results and restores all rows when cleared', () => {
  const rows = [row(1, 'Casa', 'Casa', '2026-01-01'), row(2, 'Oficina', 'Oficina', '2026-01-02')];
  const testContext = setup(rows, { search: 'sin resultados' });
  vm.runInContext('applyPropertyFilters(panel)', testContext.context);
  assert.deepEqual(rows.map((item) => item.hidden), [true, true]);
  assert.equal(testContext.count.textContent, '0 propiedades de 2');
  testContext.search.value = '';
  vm.runInContext('applyPropertyFilters(panel)', testContext.context);
  assert.deepEqual(rows.map((item) => item.hidden), [false, false]);
  assert.equal(testContext.count.textContent, '2 propiedades');
});
