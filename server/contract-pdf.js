const { jsPDF } = require('jspdf');

function formatDate(value) {
  if (!value) return 'Sin fecha de término';
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('es-MX', { timeZone: 'UTC' });
}

function createRentalContractPdf(contract) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = width - margin * 2;
  let y = 20;
  const ensureSpace = (space) => {
    if (y + space > height - 20) {
      pdf.addPage();
      y = 20;
    }
  };
  const section = (title) => {
    ensureSpace(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(40, 116, 107);
    pdf.text(title, margin, y);
    y += 7;
  };
  const field = (label, value) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const lines = pdf.splitTextToSize(`${label}: ${value || '—'}`, contentWidth);
    lines.forEach((line) => {
      ensureSpace(6);
      pdf.setTextColor(30, 45, 45);
      pdf.text(line, margin, y);
      y += 5.5;
    });
  };
  pdf.setFillColor(25, 59, 58);
  pdf.rect(0, 0, width, 34, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('BIENES Y NEGOCIOS RENATO', margin, 16);
  pdf.setFontSize(11);
  pdf.text('Formato de contrato de arrendamiento', margin, 25);
  y = 43;
  field('Folio', String(contract.id_contrato));
  field('Fecha de contrato', formatDate(contract.fecha_contrato));
  y += 3;
  section('Cliente');
  field('Nombre', contract.nombre_cliente);
  field('Correo', contract.correo_cliente);
  field('Teléfono', contract.telefono_cliente);
  field('CURP', contract.curp_cliente);
  y += 3;
  section('Vendedor');
  field('Nombre', contract.nombre_vendedor);
  field('Correo', contract.correo_vendedor);
  y += 3;
  section('Propiedad');
  field('Inmueble', contract.titulo_propiedad);
  field('Dirección', [contract.calle, contract.numero, contract.colonia, contract.ciudad, contract.estado, contract.codigo_postal].filter(Boolean).join(', '));
  field('Frente', `${contract.frente_metros} m`);
  field('Fondo', `${contract.fondo_metros} m`);
  field('Superficie', `${contract.superficie_m2} m²`);
  if (contract.latitud !== null && contract.longitud !== null) {
    field('Coordenadas', `${contract.latitud}, ${contract.longitud}`);
  }
  y += 3;
  section('Condiciones registradas');
  field('Renta mensual', contract.renta_mensual === null || contract.renta_mensual === undefined
    ? 'No registrada'
    : Number(contract.renta_mensual).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }));
  field('Inicio', formatDate(contract.fecha_inicio));
  field('Fin', formatDate(contract.fecha_fin));
  field('Observaciones', contract.observaciones);
  y += 5;
  section('Aviso');
  field('Formato generado', 'Este documento refleja los datos registrados y no sustituye un contrato firmado ni la revisión de un profesional legal.');
  return Buffer.from(pdf.output('arraybuffer'));
}

module.exports = { createRentalContractPdf };
