const listingContainer = document.getElementById('portal-properties');
const statusElement = document.getElementById('portal-status');
let listings = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}

function renderListings() {
  const query = document.getElementById('portal-search').value.trim().toLocaleLowerCase();
  const operation = document.getElementById('portal-operation').value;
  const visible = listings.filter((item) => {
    const text = `${item.titulo} ${item.direccion} ${item.categoria}`.toLocaleLowerCase();
    return text.includes(query) && (!operation || item.tipo_operacion.toLocaleUpperCase() === operation);
  });
  statusElement.textContent = `${visible.length} propiedades disponibles`;
  listingContainer.innerHTML = visible.length ? visible.map((item) => `
    <article class="portal-listing">
      <div class="portal-listing-mark">${escapeHtml(item.categoria?.slice(0, 1) || 'H')}</div>
      <div class="portal-listing-content"><p class="eyebrow">${escapeHtml(item.categoria)} · ${escapeHtml(item.tipo_operacion)}</p>
        <h2>${escapeHtml(item.titulo)}</h2><p>${escapeHtml(item.direccion)}</p>
        <div class="portal-listing-details"><span>${escapeHtml(item.habitaciones || 0)} habitaciones</span><span>${escapeHtml(item.superficie || '—')} m²</span></div>
        <strong>${formatMoney(item.precio)}${item.tipo_operacion.toLocaleUpperCase() === 'RENTA' ? ' / mes' : ''}</strong>
      </div>
    </article>`).join('') : '<p class="portal-empty">No encontramos propiedades con esos filtros.</p>';
}

async function loadListings() {
  statusElement.textContent = 'Cargando inventario…';
  try {
    const response = await fetch('/api/workflows/public/properties');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'No se pudo cargar el inventario.');
    listings = payload.data;
    renderListings();
  } catch (error) {
    statusElement.textContent = error.message;
  }
}

document.getElementById('portal-search').addEventListener('input', renderListings);
document.getElementById('portal-operation').addEventListener('change', renderListings);
document.getElementById('lead-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = document.getElementById('lead-result');
  const values = Object.fromEntries(new FormData(form));
  values.consentimiento_datos = form.elements.consentimiento_datos.checked;
  ['precio_min', 'precio_max'].forEach((key) => { if (values[key]) values[key] = Number(values[key]); });
  try {
    const response = await fetch('/api/workflows/public/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'No se pudo enviar la solicitud.');
    result.textContent = 'Solicitud registrada. Un asesor se pondrá en contacto contigo.';
    result.classList.remove('portal-error');
    form.reset();
  } catch (error) {
    result.textContent = error.message;
    result.classList.add('portal-error');
  }
});

loadListings();
