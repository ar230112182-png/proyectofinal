const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('the contract form groups every existing field without duplicating it', () => {
  const context = vm.createContext({
    optionData: { clients: [] },
    document: { createElement: (tag) => ({ tag, children: [], append(...children) { this.children.push(...children); } }) },
    renderField: (field) => ({ name: field[0] }),
  });
  vm.runInContext(section('const forms = {', 'const fieldRules = {'), context);
  vm.runInContext(section('function renderFormSections(', '// Configura el formulario solicitado'), context);
  const result = vm.runInContext('renderFormSections(forms.contract.fields)', context);
  const names = result.flatMap((group) => group.children[1].children.map((field) => field.name));
  assert.equal(result.length, 5);
  assert.equal(names.length, 24);
  assert.equal(new Set(names).size, names.length);
  for (const name of ['tipo_operacion', 'id_propiedad', 'id_cliente', 'cliente_nombre', 'precio_total',
    'renta_mensual', 'fecha_inicio', 'fecha_fin', 'frente_metros', 'fondo_metros',
    'superficie_m2', 'latitud', 'longitud', 'observaciones']) {
    assert.ok(names.includes(name), name);
  }
});

test('contract selections retain the existing client and rental rules', () => {
  const names = ['id_cliente', 'tipo_operacion', 'id_propiedad', 'fecha_contrato',
    'precio_total', 'frente_metros', 'fondo_metros', 'superficie_m2', 'renta_mensual',
    'fecha_inicio', 'fecha_fin', 'latitud', 'longitud',
    'cliente_nombre', 'cliente_apellido_paterno', 'cliente_correo', 'cliente_telefono'];
  const inputs = Object.fromEntries(names.map((name) => {
    const wrapper = {};
    return [name, {
      name, value: name === 'id_cliente' ? 'nuevo' : '', wrapper,
      closest: () => wrapper,
      addEventListener(_type, callback) { this.onChange = callback; },
      dispatchEvent() { this.onChange(); },
    }];
  }));
  const fields = {
    querySelector(selector) { return inputs[selector.match(/name="([^"]+)"/)[1]]; },
    querySelectorAll() { return Object.values(inputs).filter((input) => input.name.startsWith('cliente_')); },
  };
  const context = vm.createContext({
    form: { querySelector: () => fields },
    optionData: { clients: [{ id: 8, nombre: 'Cliente existente' }], properties: [
      { id: 2, nombre: 'Casa', tipo_operacion: 'VENTA', latitud: '19.4', longitud: '-99.1', superficie: '120' },
    ] },
    escapeHtml: String,
    Event: class {},
  });
  vm.runInContext(section('function configureContractForm(', '// Dibuja las propiedades recientes'), context);
  vm.runInContext('configureContractForm(form)', context);
  inputs.tipo_operacion.value = 'VENTA';
  inputs.tipo_operacion.onChange();
  inputs.id_propiedad.value = '2';
  inputs.id_propiedad.onChange();
  assert.equal(inputs.latitud.value, '19.4');
  assert.equal(inputs.longitud.value, '-99.1');
  assert.equal(inputs.superficie_m2.value, '120');
  assert.equal(inputs.latitud.required, true);
  assert.equal(inputs.renta_mensual.disabled, true);
  inputs.id_cliente.value = '8';
  inputs.id_cliente.onChange();
  assert.equal(inputs.cliente_nombre.wrapper.hidden, true);
  assert.equal(inputs.cliente_nombre.disabled, true);
  inputs.id_cliente.value = 'nuevo';
  inputs.id_cliente.onChange();
  assert.equal(inputs.cliente_nombre.wrapper.hidden, false);
  assert.equal(inputs.cliente_nombre.required, true);
  inputs.tipo_operacion.value = 'RENTA';
  inputs.tipo_operacion.onChange();
  assert.equal(inputs.precio_total.wrapper.hidden, true);
  assert.equal(inputs.precio_total.disabled, true);
  assert.equal(inputs.renta_mensual.wrapper.hidden, false);
  assert.equal(inputs.renta_mensual.required, true);
  assert.equal(inputs.latitud.required, false);
});
