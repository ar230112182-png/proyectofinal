const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cruds', 'main.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const dateInDays = (days) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};
const localDateKey = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

test('collections overview applies the configured collection and renewal date windows', () => {
  const container = {};
  const context = vm.createContext({
    document: { querySelector: () => container },
    records: {
      payments: [
        { id_pago: 1, estado: 'PENDIENTE', periodo: dateInDays(10), cliente: 'Cobro límite posterior', propiedad: 'Casa A', monto: 100 },
        { id_pago: 2, estado: 'PENDIENTE', periodo: dateInDays(11), cliente: 'Cobro fuera de rango', propiedad: 'Casa B', monto: 200 },
        { id_pago: 3, estado: 'PAGADO', periodo: dateInDays(2), cliente: 'Ya pagado', propiedad: 'Casa C', monto: 300 },
        { id_pago: 4, estado: 'VENCIDO', periodo: dateInDays(-10), cliente: 'Cobro límite anterior', propiedad: 'Casa D', monto: 400 },
        { id_pago: 5, estado: 'VENCIDO', periodo: dateInDays(-11), cliente: 'Adeudo anterior a ventana', propiedad: 'Casa E', monto: 500 },
      ],
      rentals: [
        { id_renta: 1, estado: 'Activa', fecha_fin: dateInDays(10), cliente: 'Renovación límite posterior', propiedad: 'Casa F', renta_mensual: 600 },
        { id_renta: 2, estado: 'Activa', fecha_fin: dateInDays(11), cliente: 'Renovación fuera de rango', propiedad: 'Casa G', renta_mensual: 700 },
        { id_renta: 3, estado: 'Cancelada', fecha_fin: dateInDays(-15), cliente: 'Renovación cancelada reciente', propiedad: 'Casa H', renta_mensual: 800 },
        { id_renta: 4, estado: 'Cancelada', fecha_fin: dateInDays(-16), cliente: 'Renovación cancelada anterior', propiedad: 'Casa I', renta_mensual: 900 },
        { id_renta: 5, estado: 'Finalizada', fecha_fin: dateInDays(5), cliente: 'Contrato terminado', propiedad: 'Casa J', renta_mensual: 1000 },
      ],
    },
    localDateKey,
    formatAlertDate: String,
    formatMoney: (value) => `$${value}`,
    escapeHtml: String,
  });
  vm.runInContext(section('function renderCollectionsOverview()', '// Pre-carga del logotipo'), context);
  vm.runInContext('renderCollectionsOverview()', context);

  const html = container.innerHTML;
  const upcoming = html.slice(html.indexOf('Próximos cobros'), html.indexOf('Renovaciones por atender'));
  const renewals = html.slice(html.indexOf('Renovaciones por atender'));
  const overdue = html.slice(html.indexOf('Adeudos vencidos'), html.indexOf('Próximos cobros'));
  assert.match(upcoming, /Cobro límite anterior|Cobro límite posterior/);
  assert.doesNotMatch(upcoming, /Cobro fuera de rango|Ya pagado|Adeudo anterior a ventana/);
  assert.match(overdue, /Adeudo anterior a ventana/);
  assert.match(renewals, /Renovación límite posterior|Renovación cancelada reciente/);
  assert.doesNotMatch(renewals, /Renovación fuera de rango|Renovación cancelada anterior|Contrato terminado/);
});
