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
  const { client, rentals, contracts, payments, documents, reports } = data;
  const activeRentals = rentals.filter((rental) => String(rental.estado).toLowerCase() === 'activa' && !rental.eliminado);
  const rentalOptions = activeRentals.map((rental) => `
    <option value="${escapeHtml(rental.id_renta)}">${escapeHtml(rental.propiedad)}</option>
  `).join('');
  const reportRows = reports.map((report) => `
    <li><strong>${escapeHtml(report.titulo)}</strong>
      <span>${escapeHtml(report.propiedad)} · ${escapeHtml(formatDate(report.creado_en))}</span>
      <span>Prioridad: ${escapeHtml(report.prioridad)} · Estado: ${escapeHtml(report.estado.replaceAll('_', ' '))}</span>
      <p class="tenant-report-description">${escapeHtml(report.descripcion)}</p>
    </li>
  `).join('');
  const paymentRows = payments.map((payment) => `
    <tr><td>${escapeHtml(payment.id_pago)}</td><td>${escapeHtml(payment.propiedad)}</td><td>${escapeHtml(formatDate(payment.periodo))}</td>
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
      <button type="button" class="text-button" data-tenant-contract="${escapeHtml(contract.id_contrato)}">Descargar formato PDF</button>
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
    <section class="tenant-section">
      <h2>Reportar un problema</h2>
      <p class="tenant-section-intro">Cuéntanos qué sucede en tu propiedad. El equipo recibirá una notificación para dar seguimiento.</p>
      ${activeRentals.length ? `
        <form id="tenant-report-form" class="portal-form">
          <label>Renta o propiedad<select name="id_renta" required><option value="">Selecciona una renta</option>${rentalOptions}</select></label>
          <label>Asunto<input name="titulo" maxlength="180" required></label>
          <label>Descripción<textarea name="descripcion" maxlength="2000" rows="4" required></textarea></label>
          <label>Prioridad<select name="prioridad" required>
            <option value="normal">Normal</option><option value="baja">Baja</option>
            <option value="alta">Alta</option><option value="urgente">Urgente</option>
          </select></label>
          <p id="tenant-report-result" class="tenant-report-result" role="status" aria-live="polite"></p>
          <button class="primary-button" type="submit">Enviar reporte</button>
        </form>` : '<p class="portal-empty">Necesitas una renta activa para enviar un reporte.</p>'}
    </section>
    <section class="tenant-section"><h2>Mis reportes</h2>
      ${reportRows ? `<ul class="tenant-list">${reportRows}</ul>` : '<p class="portal-empty">Aún no has enviado reportes.</p>'}
    </section>
    <section class="tenant-section"><h2>Historial de pagos</h2>
      ${paymentRows ? `<div class="property-table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Propiedad</th><th>Periodo</th><th>Monto</th><th>Estado</th><th>Fecha de pago</th></tr></thead><tbody>${paymentRows}</tbody></table></div>` : '<p class="portal-empty">Aún no hay pagos registrados.</p>'}
    </section>
    <section class="tenant-section"><h2>Contratos</h2>
      ${contractRows ? `<p class="tenant-section-intro">El PDF es un formato con los datos registrados; no es una copia firmada.</p><ul class="tenant-list">${contractRows}</ul>` : '<p class="portal-empty">No hay contratos disponibles.</p>'}
    </section>
    <section class="tenant-section"><h2>Documentos compartidos</h2>
      ${documentRows ? `<ul class="history-document-list">${documentRows}</ul>` : '<p class="portal-empty">Tu asesor aún no ha compartido documentos.</p>'}
    </section>`;
  const rentalSelect = accountSection.querySelector('#tenant-report-form [name="id_renta"]');
  if (rentalSelect) enableSearchableSelect(rentalSelect, 'Renta o propiedad');
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

accountSection.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id !== 'tenant-report-form') return;
  event.preventDefault();
  const result = form.querySelector('#tenant-report-result');
  const values = Object.fromEntries(new FormData(form));
  if (!values.titulo.trim() || !values.descripcion.trim()) {
    result.textContent = 'El asunto y la descripción no pueden estar vacíos.';
    result.classList.add('portal-error');
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  result.textContent = '';
  result.classList.remove('portal-error');
  try {
    await request('/api/workflows/tenant/reports', { method: 'POST', body: JSON.stringify(values) });
  } catch (error) {
    result.textContent = error.message;
    result.classList.add('portal-error');
    button.disabled = false;
    return;
  }
  form.reset();
  result.textContent = 'Reporte enviado. El equipo recibirá una notificación.';
  button.disabled = false;
  try {
    const account = await request('/api/workflows/tenant/me');
    renderAccount(account.data);
    accountSection.querySelector('#tenant-report-result').textContent = 'Reporte enviado. El equipo recibirá una notificación.';
  } catch (error) {
    result.textContent = `Reporte enviado, pero no se pudo actualizar el historial: ${error.message}`;
    result.classList.add('portal-error');
  }
});

// Descarga contratos propios o documentos autorizados con el token de la cuenta.
accountSection.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-tenant-download], [data-tenant-contract]');
  if (!button) return;
  button.disabled = true;
  try {
    const isContract = Boolean(button.dataset.tenantContract);
    const id = isContract ? button.dataset.tenantContract : button.dataset.tenantDownload;
    const resource = isContract ? 'contracts' : 'documents';
    const response = await fetch(`/api/workflows/tenant/${resource}/${id}/file`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(tokenKey)}` },
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error || 'No se pudo descargar el documento.');
    }
    const link = document.createElement('a');
    const url = URL.createObjectURL(await response.blob());
    link.href = url;
    link.download = isContract ? `contrato-renta-${id}.pdf` : button.parentElement.querySelector('strong').textContent;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
});

// Restaura la cuenta al abrir la pagina cuando existe un token guardado.
if (localStorage.getItem(tokenKey)) loadAccount();
