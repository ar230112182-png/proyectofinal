const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'select-search.js'), 'utf8');

function setup(options, selectedValue = '', required = true) {
  class Element {
    constructor() {
      this.children = [];
      this.handlers = {};
      this.attributes = {};
      this.value = '';
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); }
    dispatchEvent(event) { for (const callback of this.handlers[event.type] || []) callback(event); }
    insertAdjacentElement(_where, element) { wrapper.children.push(element); }
    replaceChildren(...children) { this.children = children; }
    setCustomValidity(message) { this.validationMessage = message; }
    scrollIntoView() {}
    focus() {}
    select() { this.textSelected = true; }
  }
  const wrapper = new Element();
  wrapper.contains = () => false;
  const select = new Element();
  select.dataset = {};
  select.name = 'id_cliente';
  select.required = required;
  select.options = options;
  select.value = selectedValue;
  select.closest = () => wrapper;
  Object.defineProperty(select, 'selectedOptions', {
    get() { return this.options.filter((option) => option.value === this.value); },
  });
  Object.defineProperty(select, 'selectedIndex', {
    set(index) { if (index === -1) this.value = ''; },
  });
  const context = vm.createContext({
    document: { createElement: () => new Element() },
    Event: class { constructor(type) { this.type = type; } },
    select,
  });
  vm.runInContext(source, context);
  vm.runInContext("enableSearchableSelect(select, 'Cliente')", context);
  const [input, list] = wrapper.children;
  const event = (type, extra = {}) => ({ type, preventDefault() { this.prevented = true; }, ...extra });
  return { select, input, list, event };
}

test('combined selector filters by name or ID and submits only the chosen value', () => {
  const { select, input, list, event } = setup([
    { value: 'nuevo', textContent: 'Registrar nuevo cliente' },
    { value: '12', textContent: 'Álvaro López' },
    { value: '45', textContent: 'María Ruiz' },
    { value: '46', textContent: 'María Ruiz' },
  ], 'nuevo');
  assert.equal(input.value, 'Registrar nuevo cliente');
  assert.equal(select.hidden, true);
  input.dispatchEvent(event('focus'));
  assert.equal(list.children.length, 4);
  assert.equal(input.textSelected, true);
  input.value = 'alvaro';
  input.dispatchEvent(event('input'));
  assert.equal(select.value, '');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].textContent, 'Álvaro López · ID 12');
  assert.match(input.validationMessage, /Selecciona/);
  list.children[0].dispatchEvent(event('click'));
  assert.equal(select.value, '12');
  assert.equal(input.value, 'Álvaro López · ID 12');
  assert.equal(input.validationMessage, '');

  input.value = '46';
  input.dispatchEvent(event('input'));
  assert.equal(list.children[0].textContent, 'María Ruiz · ID 46');
  input.dispatchEvent(event('keydown', { key: 'ArrowDown' }));
  input.dispatchEvent(event('keydown', { key: 'Enter' }));
  assert.equal(select.value, '46');
  assert.equal(input.value, 'María Ruiz · ID 46');
  input.value = 'no existe';
  input.dispatchEvent(event('input'));
  assert.equal(list.children[0].textContent, 'Sin coincidencias.');
  assert.equal(select.value, '');
  assert.notEqual(input.validationMessage, '');
});

test('changing the underlying selection resets the displayed value and validation', () => {
  const { select, input, list, event } = setup([
    { value: '1', textContent: 'Casa' },
    { value: '2', textContent: 'Local' },
  ], '1');
  input.value = 'sin resultado';
  input.dispatchEvent(event('input'));
  select.value = '';
  select.dispatchEvent(event('change'));
  assert.equal(input.value, '');
  assert.equal(input.validationMessage, '');
  assert.equal(list.hidden, true);
  assert.equal(input.required, true);
});

test('optional selectors allow clearing and choosing the empty option', () => {
  const { select, input, list, event } = setup([
    { value: '', textContent: 'Sin asignar' },
    { value: '12', textContent: 'Ana' },
  ], '12', false);
  assert.equal(input.value, 'Ana · ID 12');
  input.value = '';
  input.dispatchEvent(event('input'));
  assert.equal(select.value, '');
  assert.equal(input.validationMessage, '');
  assert.equal(input.required, false);
  assert.equal(list.children[0].textContent, 'Sin asignar');
  list.children[0].dispatchEvent(event('click'));
  assert.equal(input.value, 'Sin asignar');
  assert.equal(select.value, '');
  input.textSelected = false;
  input.dispatchEvent(event('click'));
  assert.equal(input.textSelected, true);
});
