// Conserva las referencias del inventario publico y la propiedad seleccionada.
const listingContainer = document.getElementById('portal-properties');
const statusElement = document.getElementById('portal-status');
const detailContainer = document.getElementById('property-detail');
const leadForm = document.getElementById('lead-form');
let listings = [];
const selectedPropertyId = new URLSearchParams(window.location.search).get('propiedad');
const listingPageSize = 24;
let currentPage = 1;

// Escapa contenido dinamico antes de insertarlo en el HTML del portal.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

// Presenta precios en pesos mexicanos con el formato regional del sitio.
function formatMoney(value) {
  return Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
}

// Acepta imagenes con protocolos web seguros y descarta direcciones invalidas.
function safeImageUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

// Muestra la foto del inmueble o un marcador cuando no hay imagen disponible.
function propertyImage(item, className = '') {
  const image = safeImageUrl(item.imagen_url);
  return image
    ? `<img class="${className}" src="${escapeHtml(image)}" alt="Fotografía de ${escapeHtml(item.titulo)}" loading="lazy" onerror="this.remove()">`
    : `<div class="portal-listing-mark ${className}" aria-hidden="true">${escapeHtml(item.categoria?.slice(0, 1) || 'H')}</div>`;
}

// Filtra el inventario, pagina resultados y dibuja las tarjetas de propiedades.
function renderListings() {
  const query = document.getElementById('portal-search').value.trim().toLocaleLowerCase();
  const operation = document.getElementById('portal-operation').value;
  const category = document.getElementById('portal-category').value;
  const minPrice = Number(document.getElementById('portal-price-min').value) || 0;
  const maxPrice = Number(document.getElementById('portal-price-max').value) || Infinity;
  const minRooms = Number(document.getElementById('portal-rooms').value) || 0;
  const filtered = listings.filter((item) => {
    const text = `${item.titulo} ${item.direccion} ${item.categoria}`.toLocaleLowerCase();
    return text.includes(query)
      && (!operation || item.tipo_operacion.toLocaleUpperCase() === operation)
      && (!category || item.categoria === category)
      && Number(item.precio) >= minPrice
      && Number(item.precio) <= maxPrice
      && Number(item.habitaciones || 0) >= minRooms;
  });
  if (minPrice && maxPrice !== Infinity && minPrice > maxPrice) {
    statusElement.textContent = 'El presupuesto mínimo no puede superar el máximo.';
    listingContainer.replaceChildren();
    document.getElementById('portal-pagination').hidden = true;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / listingPageSize));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const start = (currentPage - 1) * listingPageSize;
  const visible = filtered.slice(start, start + listingPageSize);
  statusElement.textContent = `${filtered.length} ${filtered.length === 1 ? 'propiedad disponible' : 'propiedades disponibles'}`;
  listingContainer.innerHTML = visible.length ? visible.map((item) => `
    <article class="portal-listing">
      <a class="portal-listing-image" href="/portal.html?propiedad=${encodeURIComponent(item.id_propiedad)}" aria-label="Ver ${escapeHtml(item.titulo)}">
        ${propertyImage(item)}
      </a>
      <div class="portal-listing-content"><p class="eyebrow">${escapeHtml(item.categoria)} · ${item.tipo_operacion === 'RENTA' ? 'Renta' : 'Venta'}</p>
        <h2><a href="/portal.html?propiedad=${encodeURIComponent(item.id_propiedad)}">${escapeHtml(item.titulo)}</a></h2>
        <p>${escapeHtml(item.direccion)}</p>
        <div class="portal-listing-details"><span>${escapeHtml(item.habitaciones || 0)} habitaciones</span><span>${escapeHtml(item.superficie || '—')} m²</span></div>
        <strong>${formatMoney(item.precio)}${item.tipo_operacion.toLocaleUpperCase() === 'RENTA' ? ' / mes' : ''}</strong>
        <a class="outline-button portal-detail-link" href="/portal.html?propiedad=${encodeURIComponent(item.id_propiedad)}">Ver detalles</a>
      </div>
    </article>`).join('') : '<p class="portal-empty">No encontramos propiedades con esos filtros.</p>';
  const pagination = document.getElementById('portal-pagination');
  pagination.hidden = filtered.length <= listingPageSize;
  pagination.innerHTML = `<button type="button" class="outline-button" data-portal-page="prev"${currentPage <= 1 ? ' disabled' : ''}>Anterior</button><span>Página ${currentPage} de ${totalPages}</span><button type="button" class="outline-button" data-portal-page="next"${currentPage >= totalPages ? ' disabled' : ''}>Siguiente</button>`;
}

// Reinicia la paginacion al cambiar los criterios de busqueda.
function applyFilters() {
  currentPage = 1;
  renderListings();
}

// Construye las opciones de categoria a partir del inventario recibido.
function populateCategories() {
  const categorySelect = document.getElementById('portal-category');
  const categories = [...new Set(listings.map((item) => item.categoria).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'es'));
  categorySelect.innerHTML = '<option value="">Todos</option>' + categories
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
}

// Solicita todas las paginas del inventario publico y actualiza la lista.
async function loadListings() {
  statusElement.textContent = 'Cargando inventario…';
  try {
    const pageSize = 200;
    let page = 1;
    let totalPages = 1;
    listings = [];
    do {
      const response = await fetch(`/api/workflows/public/properties?page=${page}&limit=${pageSize}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'No se pudo cargar el inventario.');
      listings = listings.concat(payload.data);
      totalPages = payload.meta?.totalPages || 1;
      page += 1;
    } while (page <= totalPages);
    populateCategories();
    renderListings();
  } catch (error) {
    statusElement.textContent = error.message;
  }
}

// Presenta informacion, ubicacion y contacto para una propiedad individual.
function renderPropertyDetail(item) {
  const operation = String(item.tipo_operacion).toUpperCase();
  const mapUrl = Number.isFinite(Number(item.latitud)) && Number.isFinite(Number(item.longitud))
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.latitud},${item.longitud}`)}`
    : '';
  detailContainer.hidden = false;
  listingContainer.hidden = true;
  document.getElementById('portal-pagination').hidden = true;
  document.querySelector('.portal-search').hidden = true;
  statusElement.textContent = 'Detalle de propiedad';
  document.title = `${item.titulo} | Bienes y Negocios Renato`;
  detailContainer.innerHTML = `
    <a class="text-button" href="/portal.html">← Volver al inventario</a>
    <article class="property-detail-card">
      <div class="property-detail-image">${propertyImage(item, 'property-detail-photo')}</div>
      <div class="property-detail-content"><p class="eyebrow">${escapeHtml(item.categoria)} · ${operation === 'RENTA' ? 'Renta' : 'Venta'}</p>
        <h2>${escapeHtml(item.titulo)}</h2><p>${escapeHtml(item.direccion)}</p>
        <strong class="property-detail-price">${formatMoney(item.precio)}${operation === 'RENTA' ? ' / mes' : ''}</strong>
        <dl class="property-detail-facts">
          <div><dt>Habitaciones</dt><dd>${escapeHtml(item.habitaciones || 0)}</dd></div>
          <div><dt>Baños</dt><dd>${escapeHtml(item.banos || 0)}</dd></div>
          <div><dt>Estacionamientos</dt><dd>${escapeHtml(item.estacionamientos || 0)}</dd></div>
          <div><dt>Superficie</dt><dd>${escapeHtml(item.superficie || '—')} m²</dd></div>
        </dl>
        ${item.descripcion ? `<div class="property-detail-description"><h3>Descripción</h3><p>${escapeHtml(item.descripcion)}</p></div>` : ''}
        ${mapUrl ? `<a class="text-button" href="${mapUrl}" target="_blank" rel="noopener noreferrer">Ver ubicación en Google Maps</a>` : ''}
        <a class="primary-button" href="#lead-form" data-contact-property="${escapeHtml(item.id_propiedad)}">Me interesa esta propiedad</a>
      </div>
    </article>`;
}

// Consulta el detalle publico por identificador y comunica errores al visitante.
async function loadPropertyDetail(id) {
  listingContainer.hidden = true;
  document.querySelector('.portal-search').hidden = true;
  detailContainer.hidden = false;
  statusElement.textContent = 'Cargando propiedad…';
  try {
    const response = await fetch(`/api/workflows/public/properties/${encodeURIComponent(id)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la propiedad.');
    renderPropertyDetail(payload.data);
  } catch (error) {
    detailContainer.innerHTML = '<a class="text-button" href="/portal.html">← Volver al inventario</a>';
    statusElement.textContent = error.message;
  }
}

// Conecta los controles de texto y precio con el filtrado del inventario.
['portal-search', 'portal-price-min', 'portal-price-max'].forEach((id) => {
  document.getElementById(id).addEventListener('input', applyFilters);
});
['portal-operation', 'portal-category', 'portal-rooms'].forEach((id) => {
  document.getElementById(id).addEventListener('change', applyFilters);
});

// Atiende paginacion y seleccion de propiedad para el formulario de contacto.
document.addEventListener('click', (event) => {
  const paginationButton = event.target.closest('[data-portal-page]');
  if (paginationButton) {
    currentPage += paginationButton.dataset.portalPage === 'next' ? 1 : -1;
    renderListings();
    window.scrollTo({ top: document.querySelector('.portal-search').offsetTop, behavior: 'smooth' });
    return;
  }
  const contactButton = event.target.closest('[data-contact-property]');
  if (!contactButton) return;
  leadForm.elements.id_propiedad.value = contactButton.dataset.contactProperty;
});

// Registra solicitudes publicas y presenta el resultado del envio.
leadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = document.getElementById('lead-result');
  const values = Object.fromEntries(new FormData(leadForm));
  values.consentimiento_datos = leadForm.elements.consentimiento_datos.checked;
  ['precio_min', 'precio_max'].forEach((key) => { if (values[key]) values[key] = Number(values[key]); });
  if (values.id_propiedad) values.id_propiedad = Number(values.id_propiedad);
  else delete values.id_propiedad;
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
    leadForm.reset();
  } catch (error) {
    result.textContent = error.message;
    result.classList.add('portal-error');
  }
});

// Abre el detalle solicitado por URL o carga el inventario completo.
if (selectedPropertyId) loadPropertyDetail(selectedPropertyId);
else loadListings();
