const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
const mapFunctions = source.slice(
  source.indexOf('function coordinatesFromMapLocation('),
  source.indexOf('// Configura el formulario solicitado'),
);

test('extracts pin coordinates without confusing them with the map center', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(mapFunctions, context);
  const read = (value) => {
    context.value = value;
    const result = vm.runInContext('coordinatesFromMapLocation(value)', context);
    return result && [result.latitud, result.longitud];
  };
  assert.deepEqual(read('19.4326, -99.1332'), ['19.4326', '-99.1332']);
  assert.deepEqual(read('0, 0'), ['0', '0']);
  assert.deepEqual(read('https://www.google.com/maps/place/Casa/@20,-100,17z/data=!3m1!4b1!3d19.4326!4d-99.1332?entry=ttu'), ['19.4326', '-99.1332']);
  assert.deepEqual(read('https://www.google.com/maps/search/?api=1&query=19.4326%2C-99.1332'), ['19.4326', '-99.1332']);
  assert.deepEqual(read('https://www.google.com/maps/place/19.4326%2C-99.1332/'), ['19.4326', '-99.1332']);
  for (const invalid of ['91, 0', '0, -181', 'NaN, 0', 'https://maps.app.goo.gl/example',
    'https://www.google.com/maps/@19.4326,-99.1332,17z', 'https://example.com/maps?q=19,-99']) {
    assert.equal(read(invalid), null, invalid);
  }
});

test('map input updates, clears and validates coordinates before saving', () => {
  let onInput;
  const input = {
    value: '',
    addEventListener(_type, callback) { onInput = callback; },
    setCustomValidity(message) { this.error = message; },
  };
  const latitude = {};
  const longitude = {};
  const status = {};
  const wrapper = {
    querySelector(selector) {
      return {
        '[data-map-location]': input,
        '[name="latitud"]': latitude,
        '[name="longitud"]': longitude,
        '#map-location-status': status,
      }[selector];
    },
  };
  const context = vm.createContext({ URL, document: { createElement: () => wrapper } });
  vm.runInContext(mapFunctions, context);
  vm.runInContext('renderMapLocationField()', context);
  assert.match(wrapper.innerHTML, /href="https:\/\/www\.google\.com\/maps"/);
  input.value = '0, -99.5';
  onInput();
  assert.equal(latitude.value, '0');
  assert.equal(longitude.value, '-99.5');
  assert.equal(input.error, '');
  assert.match(status.textContent, /0, -99.5/);
  input.value = 'https://maps.app.goo.gl/short';
  onInput();
  assert.equal(latitude.value, '');
  assert.equal(longitude.value, '');
  assert.notEqual(input.error, '');
  input.value = '';
  onInput();
  assert.equal(input.error, '');
  assert.equal(status.textContent, '');
});
