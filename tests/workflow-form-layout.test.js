const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('long forms group all their original controls once, including the map', () => {
  const context = vm.createContext({
    optionData: { clients: [] },
    document: { createElement: (tag) => ({ tag, children: [], append(...children) { this.children.push(...children); } }) },
    renderField: (field) => ({ name: field[0] }),
    renderMapLocationField: () => ({ name: 'ubicacion_mapa' }),
  });
  vm.runInContext(extract('const forms = {', 'const fieldRules = {'), context);
  vm.runInContext(extract('function renderFormSections(', '// Configura el formulario solicitado'), context);
  const expected = {
    property: ['titulo', 'categoria', 'tipo_operacion', 'costo_adquisicion', 'precio', 'descripcion', 'superficie', 'frente_metros', 'fondo_metros', 'habitaciones', 'banos', 'estacionamientos', 'calle', 'numero', 'colonia', 'ciudad', 'estado', 'codigo_postal', 'ubicacion_mapa', 'imagen'],
    client: ['nombre', 'apellido_paterno', 'apellido_materno', 'curp', 'correo', 'telefono', 'direccion', 'ciudad', 'estado', 'codigo_postal'],
    lead: ['nombre', 'correo', 'telefono', 'ciudad', 'tipo', 'operacion', 'precio_min', 'precio_max', 'habitaciones_min'],
    maintenance: ['id_propiedad', 'id_renta', 'titulo', 'descripcion', 'prioridad', 'asignado_a', 'costo_estimado', 'fecha_limite'],
    seller: ['nombre', 'apellido_paterno', 'apellido_materno', 'correo', 'telefono', 'password', 'rol'],
    user: ['nombre', 'apellido_paterno', 'apellido_materno', 'correo', 'telefono', 'password', 'rol'],
  };
  for (const [kind, names] of Object.entries(expected)) {
    const groups = vm.runInContext(`renderFormSections(forms.${kind}.fields)`, context);
    const actual = Array.from(groups).flatMap((group) => group.children[1].children.map((field) => field.name));
    assert.ok(groups.length > 1, kind);
    assert.deepEqual(actual, names, kind);
    assert.equal(new Set(actual).size, actual.length, kind);
  }
});

test('property category toggles the residential fields without disabling other controls', () => {
  const names = ['titulo', 'habitaciones', 'banos', 'estacionamientos', 'calle', 'numero', 'colonia', 'ciudad', 'estado', 'codigo_postal'];
  const inputs = Object.fromEntries(names.map((name) => {
    const wrapper = {};
    return [name, { value: 'sample', wrapper, closest: () => wrapper }];
  }));
  const category = { value: 'Casa', addEventListener(_type, callback) { this.change = callback; } };
  const form = { querySelector: (selector) => selector === '[name="categoria"]' ? category : inputs[selector.match(/name="([^"]+)"/)[1]] };
  const context = vm.createContext({ form });
  vm.runInContext(extract('function configurePropertyForm(', '// Limita las rentas seleccionables'), context);
  vm.runInContext('configurePropertyForm(form)', context);
  assert.equal(inputs.titulo.required, true);
  category.value = 'Lote baldío';
  category.change();
  for (const input of Object.values(inputs)) {
    assert.equal(input.wrapper.hidden, true);
    assert.equal(input.disabled, true);
  }
  category.value = 'Casa';
  category.change();
  assert.equal(inputs.calle.wrapper.hidden, false);
  assert.equal(inputs.calle.disabled, false);
  assert.equal(inputs.calle.required, true);
});

test('maintenance resets the rental selection when its property changes', () => {
  const property = { value: '1', addEventListener(_type, callback) { this.change = callback; } };
  const rental = { dispatchEvent() { this.changes = (this.changes || 0) + 1; } };
  const form = { querySelector: (selector) => selector.includes('id_propiedad') ? property : rental };
  const context = vm.createContext({
    form, optionData: { rentals: [{ id: 8, nombre: 'Renta A', id_propiedad: 1 }, { id: 9, nombre: 'Renta B', id_propiedad: 2 }] },
    escapeHtml: String,
    Event: class {},
  });
  vm.runInContext(extract('function configureMaintenanceForm(', 'function configureCommissionForm('), context);
  vm.runInContext('configureMaintenanceForm(form)', context);
  assert.match(rental.innerHTML, /Renta A/);
  assert.doesNotMatch(rental.innerHTML, /Renta B/);
  property.value = '2';
  property.change();
  assert.match(rental.innerHTML, /Renta B/);
  assert.doesNotMatch(rental.innerHTML, /Renta A/);
  assert.equal(rental.changes, 2);
});
