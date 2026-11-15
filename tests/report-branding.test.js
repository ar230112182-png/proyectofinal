const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { jsPDF } = require('jspdf');
const { autoTable } = require('jspdf-autotable');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'cruds', 'main.js'), 'utf8');
const reportFunction = source.slice(
  source.indexOf('async function downloadPdfReport('),
  source.indexOf('// Exporta tablas y documentos a archivos descargables.'),
);
const jpeg = fs.readFileSync(path.join(root, 'estilo', 'Logo_bienes.jpeg'));

function createReportContext(resource, logoError = false) {
  const result = { toasts: [], images: [], saved: false, csv: false };
  const logo = { naturalWidth: 1408, naturalHeight: 768 };
  const rows = Array.from({ length: 100 }, (_, index) => ({
    fecha: '2026-01-01', creado_en: '2026-01-01', vendedor: 'Asesor',
    operacion: 'VENTA', propiedad: `Propiedad ${index}`, cobros: 1000,
    monto_total: 50, monto_operacion: 1000, estado: 'PENDIENTE',
  }));
  function Pdf(options) {
    const doc = new jsPDF(options);
    const addImage = doc.addImage.bind(doc);
    doc.addImage = (image, ...args) => {
      result.images.push({ image, format: args[0], width: args[3], height: args[4] });
      return addImage(image === logo ? jpeg : image, ...args);
    };
    doc.save = (name) => {
      result.saved = true;
      result.name = name;
      result.pages = doc.internal.pages.slice(1).map((page) => page.join('\n'));
      result.pdf = doc.output('arraybuffer');
    };
    return doc;
  }
  const context = vm.createContext({
    window: { jspdf: { jsPDF: Pdf, autoTable } },
    document: { querySelector: () => null },
    records: { [resource]: rows },
    reportDateFilter: { from: '', to: '' },
    filterReportsByDate: (data) => data,
    formatMoney: (value) => `$${value || 0}`,
    formatCommissionMoney: (value) => `$${value || 0}`,
    preloadLogo: async () => {
      if (logoError) throw new Error('No se pudo cargar el logotipo para el reporte.');
      return logo;
    },
    showToast: (message, error) => result.toasts.push({ message, error }),
    downloadCsv: () => { result.csv = true; },
    console: { error() {} },
  });
  vm.runInContext(reportFunction, context);
  return { context, result };
}

for (const resource of ['reports', 'commissions']) {
  test(`${resource} PDF includes a translucent logo on every page`, async () => {
    const { context, result } = createReportContext(resource);
    await vm.runInContext(`downloadPdfReport('${resource}')`, context);
    assert.equal(result.saved, true);
    assert.ok(result.pdf.byteLength > 0);
    assert.doesNotMatch(Buffer.from(result.pdf).toString('latin1'), /github/i);
    assert.ok(result.pages.length > 1);
    assert.equal(result.images.length, result.pages.length + 1);
    for (const image of result.images) {
      assert.equal(image.format, 'JPEG');
      assert.ok(Math.abs(image.height / image.width - 768 / 1408) < 1e-10);
    }
    for (const page of result.pages) {
      assert.match(page, /\/I\d+ Do/);
      assert.match(page, /\/GS\d+ gs/);
    }
    assert.equal(result.csv, false);
  });
}

test('the report loads the company logo', async () => {
  const logoFunction = source.slice(
    source.indexOf('let cachedLogoImage = null;'),
    source.indexOf('// Genera un reporte oficial en formato PDF'),
  );
  class ImageMock {
    set src(value) {
      this.path = value;
      this.onload();
    }
  }
  const context = vm.createContext({ Image: ImageMock });
  vm.runInContext(logoFunction, context);
  const logo = await vm.runInContext('preloadLogo()', context);
  assert.equal(logo.path, 'estilo/Logo_bienes.jpeg');
});

test('a missing logo is reported instead of saving an unbranded report', async () => {
  const { context, result } = createReportContext('reports', true);
  await vm.runInContext("downloadPdfReport('reports')", context);
  assert.equal(result.saved, false);
  assert.equal(result.csv, false);
  assert.match(result.toasts.at(-1).message, /logotipo/);
  assert.equal(result.toasts.at(-1).error, true);
});

test('individual report selects the operation and ID even with conflicting filters', async () => {
  const { context, result } = createReportContext('reports');
  context.records.reports = [
    { id: 7, operacion: 'VENTA', propiedad: 'Venta seleccionada', vendedor: 'Asesor', fecha: '2026-01-02', cobros: 100 },
    { id: 7, operacion: 'RENTA', propiedad: 'Renta distinta', vendedor: 'Asesor', fecha: '2026-01-03', cobros: 200 },
  ];
  context.reportDateFilter.from = '2027-01-01';
  context.reportDateFilter.to = '2026-01-01';
  context.document.querySelector = () => ({ querySelector: () => ({ value: 'no coincide' }) });
  await vm.runInContext("downloadPdfReport('reports', { id: '7', operacion: 'VENTA' })", context);
  assert.equal(result.saved, true);
  assert.match(result.name, /^reporte-venta-7-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.match(result.pages[0], /Venta seleccionada/);
  assert.doesNotMatch(result.pages[0], /Renta distinta/);
  assert.match(result.pages[0], /\(7\)/);
  assert.match(result.pages[0], /02\/01\/2026/);
});

test('individual report shows an error when the selected operation no longer exists', async () => {
  const { context, result } = createReportContext('reports');
  context.records.reports = [{ id: 7, operacion: 'RENTA' }];
  await vm.runInContext("downloadPdfReport('reports', { id: '7', operacion: 'VENTA' })", context);
  assert.equal(result.saved, false);
  assert.match(result.toasts.at(-1).message, /No se encontró/);
  assert.equal(result.toasts.at(-1).error, true);
});

test('purchase costs are reported separately from sale and rental revenue', async () => {
  const { context, result } = createReportContext('reports');
  context.records.reports = [
    { id: 1, operacion: 'VENTA', cobros: 100, propiedad: 'Venta' },
    { id: 1, operacion: 'RENTA', cobros: 200, propiedad: 'Renta' },
    { id: 1, operacion: 'COMPRA', cobros: 500, propiedad: '[DEMO] Compra' },
  ];
  await vm.runInContext("downloadPdfReport('reports')", context);
  assert.equal(result.saved, true);
  assert.match(result.pages[0], /\(COBROS\)/);
  assert.match(result.pages[0], /\(\$300\)/);
  assert.match(result.pages[0], /\(\$500\)/);
  assert.doesNotMatch(result.pages[0], /\(\$800\)/);
  assert.match(result.pages[0], /Costo compras/);
});
