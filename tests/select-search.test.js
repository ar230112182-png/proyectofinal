const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'select-search.js'), 'utf8');

test('search filters options by name or ID while preserving the selected value', () => {
  const handlers = {};
  const elements = [];
  let observerCallback;
  const document = {
    createElement() {
      const element = {
        value: '', textContent: '', disabled: false,
        setAttribute(name, value) { this[name] = value; },
        addEventListener(name, callback) { handlers[`search-${name}`] = callback; },
        insertAdjacentElement(_where, child) { elements.push(child); },
      };
      return element;
    },
  };
  const select = {
    dataset: {}, disabled: false,
    focus() { this.focused = true; },
    hasAttribute: () => false,
    setAttribute(name, value) { this[name] = value; },
    options: [
      { value: '', textContent: 'Selecciona...', hidden: false, selected: true },
      { value: '81', textContent: 'Álvaro', hidden: false, selected: false },
      { value: '12', textContent: 'Casa norte', hidden: false, selected: false },
      { value: '99', textContent: 'Oculto', hidden: true, selected: false },
    ],
    insertAdjacentElement(_where, child) { elements.push(child); },
    addEventListener(name, callback) { handlers[`select-${name}`] = callback; },
  };
  const context = vm.createContext({
    document,
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
    },
    select,
  });
  vm.runInContext(source, context);
  vm.runInContext("enableSelectSearch(select, 'Vendedor')", context);
  const [search, status] = elements;
  assert.equal(search['aria-label'], 'Buscar Vendedor');
  search.value = 'alvaro';
  handlers['search-input']();
  assert.equal(select.options[1].hidden, false);
  assert.equal(select.options[2].hidden, true);
  assert.equal(select.options[3].hidden, true);
  let prevented = false;
  handlers['search-keydown']({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(select.focused, true);

  search.value = '12';
  handlers['search-input']();
  assert.equal(select.options[1].hidden, true);
  assert.equal(select.options[2].hidden, false);
  select.options[1].selected = true;
  handlers['search-input']();
  assert.equal(select.options[1].hidden, false);

  search.value = 'inexistente';
  handlers['search-input']();
  assert.equal(status.textContent, 'Sin coincidencias.');
  search.value = '';
  handlers['search-input']();
  assert.equal(select.options[2].hidden, false);
  assert.equal(select.options[3].hidden, true);

  search.value = 'nuevo';
  select.options = [{ value: '4', textContent: 'Nuevo registro', hidden: false, selected: false }];
  observerCallback();
  assert.equal(select.options[0].hidden, false);
  assert.equal(status.textContent, '');
  handlers['select-change']();
  assert.equal(search.value, '');
});
