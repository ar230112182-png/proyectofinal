// Conserva las secciones de acceso y cuenta, junto con la clave de sesion local.
const loginForm = document.getElementById('tenant-login');
const accountSection = document.getElementById('tenant-account');
const logoutButton = document.getElementById('tenant-logout');
const tokenKey = 'habita_tenant_token';

// Protege los valores del servidor antes de mostrarlos en la cuenta privada.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

// Convierte importes de renta y pagos al formato de pesos mexicanos.
function formatMoney(value) {
  return Number(value || 0).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN', maximumFractionDigits: 0,
  });
}

// Presenta fechas y trata las fechas sin hora como fechas locales.
function formatDate(value) {
  if (!value) return 'Sin fecha de término';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const date = new Date(dateOnly ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString('es-MX');
}

// Agrega autenticacion a las solicitudes y transforma errores del API.
async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = localStorage.getItem(tokenKey);
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error || 'No se pudo completar la solicitud.');
  return payload;
}

// Construye las secciones privadas de rentas, pagos, contratos y documentos.
function renderAccount(data) {
  const { client, rentals, contracts, payments, documents } = data;
  const paymentRows = payments.map((payment) => `
    <tr><td>${escapeHtml(payment.propiedad)}</td><td>${escapeHtml(formatDate(payment.periodo))}</td>
      <td>${escapeHtml(formatMoney(payment.monto))}</td><td>${escapeHtml(payment.estado)}</td>
      <td>${escapeHtml(payment.pagado_en ? formatDate(payment.pagado_en) : '—')}</td></tr>
  `).join('');
  const rentalCards = rentals.map((rental) => `
    <article class="tenant-card"><h3>${escapeHtml(rental.propiedad)}</h3>
      <p>${escapeHtml(rental.direccion || 'Dirección no disponible')}</p>
      <dl><div><dt>Renta mensual</dt><dd>${escapeHtml(formatMoney(rental.renta_mensual))}</dd></div>
        <div><dt>Inicio</dt><dd>${escapeHtml(formatDate(rental.fecha_inicio))}</dd></div>
        <div><dt>Término</dt><dd>${escapeHtml(formatDate(rental.fecha_fin))}</dd></div>
        <div><dt>Estado</dt><dd>${escapeHtml(rental.estado)}</dd></div></dl>
    </article>
  `).join('');
  const contractRows = contracts.map((contract) => `
    <li><strong>${escapeHtml(contract.tipo_operacion)} · ${escapeHtml(contract.propiedad)}</strong>
      <span>Registrado ${escapeHtml(formatDate(contract.fecha_contrato))}</span>
      <span>Vigencia: ${escapeHtml(formatDate(contract.fecha_inicio))} — ${escapeHtml(formatDate(contract.fecha_fin))}</span>
    </li>
  `).join('');
  const documentRows = documents.map((documentRecord) => `
    <li><span><strong>${escapeHtml(documentRecord.nombre_archivo)}</strong><small>${escapeHtml(documentRecord.tipo)} · ${escapeHtml(formatDate(documentRecord.creado_en))}</small></span>
      <button type="button" class="text-button" data-tenant-download="${escapeHtml(documentRecord.id_documento)}">Descargar</button>
    </li>
  `).join('');

  accountSection.innerHTML = `
    <div class="tenant-welcome"><div><p class="eyebrow">Tu cuenta</p><h2>Hola, ${escapeHtml(client.nombre)} ${escapeHtml(client.apellido_paterno)}</h2></div></div>
    <section class="tenant-section"><h2>Mis rentas</h2>
      ${rentalCards ? `<div class="tenant-rentals">${rentalCards}</div>` : '<p class="portal-empty">No tienes rentas registradas en esta cuenta.</p>'}
    </section>
    <section class="tenant-section"><h2>Historial de pagos</h2>
      ${paymentRows ? `<div class="property-table-wrap"><table class="data-table"><thead><tr><th>Propiedad</th><th>Periodo</th><th>Monto</th><th>Estado</th><th>Fecha de pago</th></tr></thead><tbody>${paymentRows}</tbody></table></div>` : '<p class="portal-empty">Aún no hay pagos registrados.</p>'}
    </section>
    <section class="tenant-section"><h2>Contratos</h2>
      ${contractRows ? `<ul class="tenant-list">${contractRows}</ul>` : '<p class="portal-empty">No hay contratos disponibles.</p>'}
    </section>
    <section class="tenant-section"><h2>Documentos compartidos</h2>
      ${documentRows ? `<ul class="history-document-list">${documentRows}</ul>` : '<p class="portal-empty">Tu asesor aún no ha compartido documentos.</p>'}
    </section>`;
}

// Recupera la cuenta activa o restablece el formulario si la sesion no es valida.
async function loadAccount() {
  try {
    const result = await request('/api/workflows/tenant/me');
    renderAccount(result.data);
    accountSection.hidden = false;
    loginForm.hidden = true;
    logoutButton.hidden = false;
  } catch (error) {
    localStorage.removeItem(tokenKey);
    loginForm.hidden = false;
    accountSection.hidden = true;
    logoutButton.hidden = true;
    if (error.message !== 'Se requiere autenticacion.' && !/sesion no es valida/i.test(error.message)) {
      document.getElementById('tenant-login-error').textContent = error.message;
    }
  }
}

// Valida que el acceso corresponda a un inquilino y carga su informacion.
loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('tenant-login-error');
  error.textContent = '';
  const values = Object.fromEntries(new FormData(loginForm));
  try {
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(values),
    });
    if (result.user.rol !== 'cliente') throw new Error('Este acceso es exclusivo para cuentas de inquilino.');
    localStorage.setItem(tokenKey, result.token);
    await loadAccount();
  } catch (requestError) {
    error.textContent = requestError.message;
  }
});

// Cierra la sesion local y devuelve la pagina al formulario de acceso.
logoutButton.addEventListener('click', () => {
  localStorage.removeItem(tokenKey);
  accountSection.replaceChildren();
  accountSection.hidden = true;
  loginForm.reset();
  loginForm.hidden = false;
  logoutButton.hidden = true;
});

// Descarga documentos autorizados con el token de la cuenta actual.
accountSection.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-tenant-download]');
  if (!button) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/workflows/tenant/documents/${button.dataset.tenantDownload}/file`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(tokenKey)}` },
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || 'No se pudo descargar el documento.');
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = button.parentElement.querySelector('strong').textContent;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
});

// Restaura la cuenta al abrir la pagina cuando existe un token guardado.
if (localStorage.getItem(tokenKey)) loadAccount();
