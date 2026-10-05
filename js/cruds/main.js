const api = {
  token: localStorage.getItem('habita_token'),
  async request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(url, { ...options, headers });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(payload?.error || 'No se pudo completar la solicitud.');
    return payload;
  },
  login(correo, contrasena) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ correo, contrasena }),
    }).then((payload) => {
      this.token = payload.token;
      localStorage.setItem('habita_token', this.token);
      localStorage.setItem('habita_user', JSON.stringify(payload.user));
      return payload.user;
    });
  },
  get(resource) {
    return this.request(`/api/workflows/${resource}`);
  },
  create(resource, values) {
    return this.request(`/api/workflows/${resource}`, {
      method: 'POST',
      body: values instanceof FormData ? values : JSON.stringify(values),
    });
  },
  update(resource, id, values) {
    return this.request(`/api/workflows/${resource}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  },
  logout() {
    this.token = null;
    localStorage.removeItem('habita_token');
    localStorage.removeItem('habita_user');
  },
};

window.habitaApi = api;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>\'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));
const formatMoney = (value) => Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const optionData = { clients: [], properties: [], users: [], categories: [], leads: [], rentals: [] };
const records = {};

const tableConfig = {
  properties: { title: 'Propiedades registradas', columns: [['titulo', 'Propiedad'], ['categoria', 'Categoría'], ['tipo_operacion', 'Operación'], ['precio', 'Precio'], ['estado_propiedad', 'Estado']], actions: ['edit', 'archive'] },
  clients: { title: 'Clientes', columns: [['nombre', 'Nombre'], ['apellido_paterno', 'Apellido'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['ciudad', 'Ciudad']] },
  leads: { title: 'Prospectos', columns: [['nombre', 'Prospecto'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['origen', 'Origen'], ['estado', 'Estado']], actions: ['status'] },
  visits: { title: 'Agenda de visitas', columns: [['fecha_cita', 'Fecha'], ['cliente', 'Cliente'], ['propiedad', 'Propiedad'], ['agente', 'Agente'], ['estado', 'Estado']], actions: ['status'] },
  matches: { title: 'Coincidencias guardadas', columns: [['lead', 'Prospecto'], ['propiedad', 'Propiedad'], ['puntuacion', 'Puntuación'], ['creada_en', 'Fecha']] },
  documents: { title: 'Expedientes y resguardos', columns: [['nombre_archivo', 'Documento'], ['tipo', 'Tipo'], ['estado', 'Estado'], ['tamano_bytes', 'Tamaño'], ['creado_en', 'Fecha']], actions: ['download'] },
  offers: { title: 'Ofertas', columns: [['propiedad', 'Propiedad'], ['cliente', 'Usuario'], ['monto', 'Monto'], ['tipo', 'Tipo'], ['estado', 'Estado']], actions: ['status'] },
  sales: { title: 'Ventas cerradas', columns: [['propiedad', 'Propiedad'], ['cliente', 'Cliente'], ['precio_venta', 'Precio'], ['fecha_venta', 'Fecha']] },
  commissions: { title: 'Comisiones', columns: [['propiedad', 'Propiedad'], ['porcentaje_agencia', '% agencia'], ['monto_operacion', 'Operación'], ['monto_total', 'Comisión'], ['creado_en', 'Fecha']] },
  rentals: { title: 'Contratos de renta', columns: [['propiedad', 'Propiedad'], ['cliente', 'Cliente'], ['renta_mensual', 'Renta mensual'], ['fecha_inicio', 'Inicio'], ['fecha_fin', 'Fin'], ['estado', 'Estado']], actions: ['status'] },
  payments: { title: 'Cobros de renta', columns: [['propiedad', 'Propiedad'], ['periodo', 'Periodo'], ['monto', 'Monto'], ['estado', 'Estado'], ['pagado_en', 'Pagado']] , actions: ['status'] },
  contracts: { title: 'Contratos registrados', columns: [['tipo_operacion', 'Operación'], ['cliente', 'Cliente'], ['vendedor', 'Vendedor'], ['propiedad', 'Lote'], ['precio_total', 'Precio'], ['superficie_m2', 'Superficie m²'], ['fecha_contrato', 'Fecha']], actions: ['document', 'map'] },
  users: { title: 'Usuarios del sistema', columns: [['nombre', 'Nombre'], ['apellido_paterno', 'Apellido'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['rol', 'Rol']] },
};

const forms = {
  property: { title: 'Nueva propiedad', resource: 'properties', fields: [
    ['titulo', 'Título', 'text', true], ['categoria', 'Categoría', 'text', true], ['tipo_operacion', 'Operación', 'select', true, ['VENTA', 'RENTA']],
    ['precio', 'Precio', 'number', true], ['descripcion', 'Descripción', 'textarea'], ['superficie', 'Superficie m²', 'number'],
    ['habitaciones', 'Habitaciones', 'number'], ['banos', 'Baños', 'number'], ['estacionamientos', 'Estacionamientos', 'number'],
    ['calle', 'Calle', 'text', true], ['numero', 'Número', 'text'], ['colonia', 'Colonia', 'text'], ['ciudad', 'Ciudad', 'text', true], ['estado', 'Estado', 'text', true], ['codigo_postal', 'Código postal', 'text'],
  ] },
  client: { title: 'Nuevo cliente', resource: 'clients', fields: [['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true], ['apellido_materno', 'Apellido materno', 'text'], ['correo', 'Correo', 'email', true], ['telefono', 'Teléfono', 'tel'], ['curp', 'CURP', 'text'], ['direccion', 'Dirección', 'text'], ['ciudad', 'Ciudad', 'text'], ['estado', 'Estado', 'text'], ['codigo_postal', 'Código postal', 'text']] },
  lead: { title: 'Nuevo prospecto', resource: 'leads', fields: [['nombre', 'Nombre', 'text', true], ['correo', 'Correo', 'email'], ['telefono', 'Teléfono', 'tel'], ['ciudad', 'Ciudad preferida', 'text'], ['precio_min', 'Precio mínimo', 'number'], ['precio_max', 'Precio máximo', 'number'], ['habitaciones_min', 'Habitaciones mínimas', 'number'], ['tipo', 'Categoría', 'text'], ['operacion', 'Operación', 'select', false, ['VENTA', 'RENTA']]] },
  visit: { title: 'Agendar visita', resource: 'visits', fields: [['id_cliente', 'Cliente', 'options', true, 'clients'], ['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['fecha_cita', 'Fecha y hora', 'datetime-local', true], ['motivo', 'Motivo', 'text']] },
  offer: { title: 'Registrar oferta', resource: 'offers', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['monto', 'Monto ofrecido', 'number', true], ['tipo', 'Tipo de oferta', 'select', true, ['OFERTA', 'CONTRAPROPUESTA']], ['notas', 'Notas', 'textarea']] },
  document: { title: 'Cargar resguardo', resource: 'documents', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['tipo', 'Tipo de documento', 'select', true, ['Escritura', 'Identificación', 'Predial', 'Contrato', 'Otro']], ['archivo', 'Archivo (PDF, DOC o imagen; máximo 10 MB)', 'file', true]] },
  sale: { title: 'Cerrar venta', resource: 'sales', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['id_cliente', 'Cliente', 'options', true, 'clients'], ['id_agente', 'Agente responsable', 'options', true, 'users'], ['precio_venta', 'Precio de cierre', 'number', true], ['fecha_venta', 'Fecha de cierre', 'date']] },
  commission: { title: 'Registrar comisión', resource: 'commissions', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['porcentaje_agencia', 'Porcentaje de agencia', 'number'], ['monto_operacion', 'Monto de operación', 'number', true], ['monto_total', 'Monto de comisión', 'number', true]] },
  rental: { title: 'Nueva renta', resource: 'rentals', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['id_cliente', 'Cliente', 'options', true, 'clients'], ['renta_mensual', 'Renta mensual', 'number', true], ['fecha_inicio', 'Fecha de inicio', 'date', true], ['fecha_fin', 'Fecha de término', 'date']] },
  payment: { title: 'Registrar cobro', resource: 'payments', fields: [['id_renta', 'Contrato de renta', 'options', true, 'rentals'], ['periodo', 'Periodo de pago', 'date', true], ['monto', 'Monto recibido', 'number', true], ['estado', 'Estado del pago', 'select', true, ['PAGADO', 'PENDIENTE']]] },
  user: { title: 'Agregar usuario o vendedor', resource: 'users', fields: [['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true], ['apellido_materno', 'Apellido materno', 'text'], ['correo', 'Correo', 'email', true], ['telefono', 'Teléfono', 'tel'], ['password', 'Contraseña inicial (mínimo 12 caracteres)', 'password', true], ['rol', 'Rol de acceso', 'select', true, [{ id: 'vendedor', nombre: 'Vendedor' }, { id: 'administrador', nombre: 'Administrador' }]]] },
  contract: { title: 'Registrar cliente y contrato', resource: 'contracts', fields: [
    ['tipo_operacion', 'Tipo de operación', 'select', true, ['VENTA', 'RENTA']],
    ['id_propiedad', 'Lote / propiedad', 'options', true, 'properties'],
    ['id_cliente', 'Cliente', 'select', true, [{ id: 'nuevo', nombre: 'Registrar nuevo cliente' }, ...optionData.clients]],
    ['cliente_nombre', 'Nombre del cliente', 'text', true], ['cliente_apellido_paterno', 'Apellido paterno', 'text', true],
    ['cliente_apellido_materno', 'Apellido materno', 'text'], ['cliente_correo', 'Correo del cliente', 'email', true],
    ['cliente_telefono', 'Teléfono', 'tel'], ['cliente_curp', 'CURP', 'text'],
    ['cliente_direccion', 'Domicilio del cliente', 'text'], ['cliente_ciudad', 'Ciudad del cliente', 'text'],
    ['cliente_estado', 'Estado del cliente', 'text'], ['cliente_codigo_postal', 'Código postal del cliente', 'text'],
    ['precio_total', 'Precio total acordado', 'number', true], ['fecha_contrato', 'Fecha del contrato', 'date'],
    ['frente_metros', 'Medida de frente (m)', 'number', true], ['fondo_metros', 'Medida de fondo (m)', 'number', true],
    ['superficie_m2', 'Superficie total (m²)', 'number', true],
    ['latitud', 'Latitud (obligatoria en venta)', 'number'], ['longitud', 'Longitud (obligatoria en venta)', 'number'],
    ['renta_mensual', 'Renta mensual', 'number'], ['fecha_inicio', 'Inicio de renta', 'date'],
    ['fecha_fin', 'Fin de renta', 'date'], ['observaciones', 'Condiciones y observaciones', 'textarea'],
  ] },
};

function showLogin() {
  document.getElementById('auth-overlay').hidden = false;
}

function hideLogin() {
  document.getElementById('auth-overlay').hidden = true;
}

function showToast(message, isError = false) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.toggle('toast-error', isError);
  element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 2600);
}

function ensureDialog() {
  let dialog = document.getElementById('workflow-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'workflow-dialog';
  dialog.className = 'workflow-dialog';
  dialog.innerHTML = '<form id="workflow-form" method="dialog"><div class="workflow-dialog-heading"><h2></h2><button type="button" class="icon-button" data-dialog-close aria-label="Cerrar">×</button></div><div class="workflow-fields"></div><p class="form-error" role="alert"></p><div class="workflow-dialog-actions"><button class="outline-button" type="button" data-dialog-close>Cancelar</button><button class="primary-button" type="submit">Guardar</button></div></form>';
  document.body.append(dialog);
  return dialog;
}

function renderField(field) {
  const [name, label, type, required, options] = field;
  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else if (type === 'select' || type === 'options') {
    input = document.createElement('select');
    const values = type === 'options'
      ? optionData[options]
      : options.map((value) => typeof value === 'string' ? { id: value, nombre: value } : value);
    input.innerHTML = `<option value="">Selecciona...</option>${values.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nombre)}</option>`).join('')}`;
  } else {
    input = document.createElement('input');
    input.type = type;
    if (type === 'number') input.step = 'any';
    if (type === 'file') input.accept = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp';
  }
  input.name = name;
  input.required = Boolean(required);
  if (name === 'password') input.minLength = 12;
  const wrapper = document.createElement('label');
  wrapper.className = 'workflow-field';
  wrapper.innerHTML = `<span>${escapeHtml(label)}</span>`;
  wrapper.append(input);
  return wrapper;
}

function openForm(kind, titleOverride) {
  const config = forms[kind];
  if (!config) return;
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = kind;
  dialog.querySelector('h2').textContent = titleOverride || config.title;
  dialog.querySelector('.form-error').textContent = '';
  const fields = dialog.querySelector('.workflow-fields');
  fields.replaceChildren(...config.fields.map(renderField));
  if (kind === 'contract') configureContractForm(form);
  dialog.showModal();
}

function actionButtons(resource, record) {
  const actions = tableConfig[resource]?.actions || [];
  return actions.map((action) => {
    if (action === 'document') return `<button class="text-button" data-contract-document="${escapeHtml(record.id_contrato)}">Descargar contrato</button>`;
    if (action === 'map') return `<button class="text-button" data-contract-map="${escapeHtml(record.id_contrato)}">Google Maps</button>`;
    if (action === 'download') return `<button class="text-button" data-download-document="${escapeHtml(record.id_documento)}">Descargar</button>`;
    const idKey = { properties: 'id_propiedad', leads: 'id_lead', visits: 'id_cita', offers: 'id_oferta', rentals: 'id_renta', payments: 'id_pago' }[resource];
    const actionName = action === 'archive' ? 'Archivar' : action === 'edit' ? 'Editar' : 'Cambiar estado';
    return `<button class="text-button" data-record-action="${action}" data-resource="${resource}" data-record-id="${escapeHtml(record[idKey])}">${actionName}</button>`;
  }).join(' ');
}

function formatCell(resource, key, value, record) {
  if (key === 'precio' || key === 'precio_total' || key === 'monto' || key === 'monto_total' || key === 'monto_operacion' || key === 'precio_venta' || key === 'renta_mensual') return escapeHtml(formatMoney(value));
  if (key === 'tamano_bytes') return `${(Number(value || 0) / 1024).toFixed(1)} KB`;
  if (key === 'puntuacion') return `${escapeHtml(value)}%`;
  if (key === 'fecha_cita' || key === 'fecha_venta' || key === 'fecha_contrato' || key === 'creado_en' || key === 'pagado_en' || key === 'fecha_inicio' || key === 'fecha_fin') {
    return value ? escapeHtml(new Date(value).toLocaleString('es-MX')) : '—';
  }
  if (key === 'tipo_operacion') return value === 'VENTA' ? 'Venta' : value === 'RENTA' ? 'Renta' : escapeHtml(value || '—');
  if (key === 'rol') return value === 'administrador' || value === 'admin' ? 'Administrador' : value === 'vendedor' || value === 'agente' ? 'Vendedor' : escapeHtml(value || '—');
  if (resource === 'properties' && key === 'titulo') return `<strong>${escapeHtml(value)}</strong><small class="record-subtitle">${escapeHtml(record.direccion)}</small>`;
  return escapeHtml(value || '—');
}

function renderRecords(resource, viewId, data) {
  const view = document.getElementById(viewId);
  const config = tableConfig[resource];
  if (!view || !config) return;
  let panel = view.querySelector(`[data-record-panel="${resource}"]`);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'panel persisted-panel';
    panel.dataset.recordPanel = resource;
    view.append(panel);
  }
  panel.innerHTML = `<div class="panel-heading"><div><h2>${config.title}</h2><p>${data.length} registros guardados</p></div></div><div class="property-table-wrap"><table class="data-table"><thead><tr>${config.columns.map(([, label]) => `<th>${label}</th>`).join('')}<th>Acciones</th></tr></thead><tbody>${data.length ? data.map((record) => `<tr>${config.columns.map(([key]) => `<td>${formatCell(resource, key, record[key], record)}</td>`).join('')}<td>${actionButtons(resource, record)}</td></tr>`).join('') : `<tr><td colspan="${config.columns.length + 1}" class="empty-records">Todavía no hay registros.</td></tr>`}</tbody></table></div>`;
}

function configureContractForm(form) {
  const fields = form.querySelector('.workflow-fields');
  const clientSelect = fields.querySelector('[name="id_cliente"]');
  const operationSelect = fields.querySelector('[name="tipo_operacion"]');
  const propertySelect = fields.querySelector('[name="id_propiedad"]');
  const contractDate = fields.querySelector('[name="fecha_contrato"]');
  ['precio_total', 'frente_metros', 'fondo_metros', 'superficie_m2', 'renta_mensual'].forEach((name) => {
    fields.querySelector(`[name="${name}"]`).min = '0.01';
  });
  fields.querySelector('[name="latitud"]').min = '-90';
  fields.querySelector('[name="latitud"]').max = '90';
  fields.querySelector('[name="longitud"]').min = '-180';
  fields.querySelector('[name="longitud"]').max = '180';

  clientSelect.innerHTML = `<option value="nuevo">Registrar nuevo cliente</option>${optionData.clients.map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.nombre)}</option>`).join('')}`;
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  contractDate.value = now.toISOString().slice(0, 10);

  const toggleFields = () => {
    const isNewClient = clientSelect.value === 'nuevo';
    const isRental = operationSelect.value === 'RENTA';
    fields.querySelectorAll('[name^="cliente_"]').forEach((input) => {
      const wrapper = input.closest('.workflow-field');
      const required = ['cliente_nombre', 'cliente_apellido_paterno', 'cliente_correo'].includes(input.name);
      wrapper.hidden = !isNewClient;
      input.disabled = !isNewClient;
      input.required = isNewClient && required;
    });
    ['renta_mensual', 'fecha_inicio', 'fecha_fin'].forEach((name) => {
      const input = fields.querySelector(`[name="${name}"]`);
      input.closest('.workflow-field').hidden = !isRental;
      input.disabled = !isRental;
      input.required = isRental && ['renta_mensual', 'fecha_inicio'].includes(name);
    });
    const agreedPrice = fields.querySelector('[name="precio_total"]');
    agreedPrice.closest('.workflow-field').hidden = isRental;
    agreedPrice.disabled = isRental;
    agreedPrice.required = !isRental;
    ['latitud', 'longitud'].forEach((name) => {
      const input = fields.querySelector(`[name="${name}"]`);
      input.required = !isRental;
    });

    const selectedProperty = optionData.properties.find((item) => String(item.id) === propertySelect.value);
    if (selectedProperty) {
      const latitude = fields.querySelector('[name="latitud"]');
      const longitude = fields.querySelector('[name="longitud"]');
      const area = fields.querySelector('[name="superficie_m2"]');
      if (!latitude.value && selectedProperty.latitud !== null) latitude.value = selectedProperty.latitud;
      if (!longitude.value && selectedProperty.longitud !== null) longitude.value = selectedProperty.longitud;
      if (!area.value && selectedProperty.superficie) area.value = selectedProperty.superficie;
    }
  };

  operationSelect.addEventListener('change', () => {
    const available = optionData.properties.filter((item) => String(item.tipo_operacion).toUpperCase() === operationSelect.value);
    propertySelect.innerHTML = `<option value="">Selecciona...</option>${available.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nombre)}</option>`).join('')}`;
    toggleFields();
  });
  clientSelect.addEventListener('change', toggleFields);
  propertySelect.addEventListener('change', toggleFields);
  toggleFields();
}

function renderDashboardProperties(properties) {
  const body = document.querySelector('#property-table tbody');
  if (!body) return;
  body.innerHTML = properties.slice(0, 5).map((property) => `
    <tr><td><div class="property-name"><div class="property-photo photo-one"></div><span><strong>${escapeHtml(property.titulo)}</strong><small>${escapeHtml(property.direccion)}</small></span></div></td>
      <td>${escapeHtml(property.categoria)}</td><td><span class="status status-green">${escapeHtml(property.estado_propiedad)}</span></td>
      <td><strong>${escapeHtml(formatMoney(property.precio))}</strong></td><td>${escapeHtml(property.agente || 'Sin asignar')}</td>
      <td><button class="row-menu" type="button" aria-label="Acciones de propiedad" data-record-action="edit" data-resource="properties" data-record-id="${property.id_propiedad}">•••</button></td></tr>
  `).join('') || '<tr><td colspan="6" class="empty-records">Todavía no hay propiedades registradas.</td></tr>';
}

function updateMetrics(summary) {
  const values = [summary.propiedades, summary.clientes, summary.visitas, formatMoney(summary.ingresos)];
  document.querySelectorAll('.metric-grid article > strong').forEach((element, index) => {
    if (values[index] !== undefined) element.textContent = values[index];
  });
  document.querySelectorAll('.metric-foot').forEach((element) => {
    element.textContent = 'Datos actuales desde PostgreSQL';
  });
  const countStatus = (items, key, valuesToCount) => items.filter((item) => valuesToCount.includes(String(item[key] || '').toLocaleLowerCase())).length;
  const metrics = {
    'properties-view': [['En inventario', records.properties.length], ['Disponibles', countStatus(records.properties, 'estado_propiedad', ['disponible'])], ['En proceso', countStatus(records.properties, 'estado_propiedad', ['reservada'])], ['Vendidas / rentadas', countStatus(records.properties, 'estado_propiedad', ['vendida', 'rentada'])]],
    'clients-view': [['Clientes', records.clients.length], ['Prospectos nuevos', countStatus(records.leads, 'estado', ['nuevo'])], ['Prospectos activos', records.leads.filter((lead) => !['cerrado', 'perdido'].includes(String(lead.estado).toLowerCase())).length], ['Con preferencias', new Set(records.matches.map((item) => String(item.id_lead))).size]],
    'matching-view': [['Coincidencias guardadas', records.matches.length], ['Prospectos evaluados', new Set(records.matches.map((item) => String(item.id_lead))).size], ['Puntuación promedio', `${records.matches.length ? Math.round(records.matches.reduce((sum, item) => sum + Number(item.puntuacion), 0) / records.matches.length) : 0}%`], ['Prospectos', records.leads.length]],
    'visits-view': [['Visitas registradas', records.visits.length], ['Hoy', records.visits.filter((item) => new Date(item.fecha_cita).toDateString() === new Date().toDateString()).length], ['Confirmadas', countStatus(records.visits, 'estado', ['confirmada'])], ['Completadas', countStatus(records.visits, 'estado', ['completada'])]],
    'portal-view': [['Propiedades publicables', records.properties.filter((item) => String(item.estado_propiedad).toLowerCase() === 'disponible').length], ['Solicitudes recibidas', records.leads.filter((item) => item.origen === 'portal').length], ['Prospectos con consentimiento', records.leads.filter((item) => item.consentimiento_datos).length], ['Favoritos', records.favorites?.length || 0]],
    'legal-view': [['Documentos guardados', records.documents.length], ['Por validar', countStatus(records.documents, 'estado', ['pendiente'])], ['Validados', countStatus(records.documents, 'estado', ['validado', 'aprobado'])], ['Propiedades documentadas', new Set(records.documents.map((item) => String(item.id_propiedad))).size]],
    'contracts-view': [['Contratos registrados', records.contracts.length], ['Ventas', records.contracts.filter((item) => item.tipo_operacion === 'VENTA').length], ['Rentas', records.contracts.filter((item) => item.tipo_operacion === 'RENTA').length], ['Operaciones del mes', records.contracts.filter((item) => new Date(item.fecha_contrato).getMonth() === new Date().getMonth()).length]],
    'finance-view': [['Comisiones registradas', records.commissions.length], ['Total comisión', formatMoney(records.commissions.reduce((sum, item) => sum + Number(item.monto_total || 0), 0))], ['Operaciones comisionadas', new Set(records.commissions.map((item) => String(item.id_propiedad))).size], ['Ventas registradas', records.sales.length]],
    'rents-view': [['Contratos activos', countStatus(records.rentals, 'estado', ['activa'])], ['Pagos recibidos', countStatus(records.payments, 'estado', ['pagado'])], ['Pagos pendientes', countStatus(records.payments, 'estado', ['pendiente', 'vencido'])], ['Saldo pendiente', formatMoney(records.payments.filter((item) => ['pendiente', 'vencido'].includes(String(item.estado).toLowerCase())).reduce((sum, item) => sum + Number(item.monto || 0), 0))]],
    'users-view': [['Usuarios registrados', records.users.length], ['Administradores', countStatus(records.users, 'rol', ['admin', 'administrador'])], ['Vendedores', countStatus(records.users, 'rol', ['agente', 'vendedor'])], ['Eventos auditados', records.activity?.length || 0]],
    'reports-view': [['Propiedades', records.properties.length], ['Clientes', records.clients.length], ['Operaciones cerradas', records.sales.length], ['Documentos', records.documents.length]],
  };
  Object.entries(metrics).forEach(([viewId, items]) => {
    const cells = document.querySelectorAll(`#${viewId} .mini-stat-grid > div`);
    items.forEach(([label, value], index) => {
      if (!cells[index]) return;
      cells[index].querySelector('small').textContent = label;
      cells[index].querySelector('strong').textContent = value;
    });
  });
  const dateLabel = document.querySelector('#dashboard-view .page-intro .eyebrow');
  if (dateLabel) dateLabel.textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const user = JSON.parse(localStorage.getItem('habita_user') || '{}');
  const greeting = document.querySelector('#dashboard-view h1 span');
  if (greeting) greeting.textContent = user.nombre || '';
  const profile = document.querySelector('.profile-row');
  if (profile && user.nombre) {
    profile.querySelector('strong').textContent = `${user.nombre} ${user.apellido || ''}`.trim();
    profile.querySelector('small').textContent = user.rol || '';
  }
  const propertyCount = document.querySelector('[data-view="properties"] .nav-count');
  if (propertyCount) propertyCount.textContent = records.properties.length;
}

function renderActivity(activity) {
  const list = document.querySelector('#dashboard-view .activity-list');
  if (!list) return;
  list.innerHTML = activity.length ? activity.map((item) => `
    <div class="activity-item"><span class="activity-icon">${escapeHtml(item.accion.slice(0, 1).toLocaleUpperCase())}</span>
      <div><p><strong>${escapeHtml(item.accion)} · ${escapeHtml(item.entidad)}</strong></p>
        <p>${escapeHtml(item.usuario)} ${escapeHtml(item.detalle?.titulo || item.detalle?.nombre || '')}</p>
        <small>${escapeHtml(new Date(item.creado_en).toLocaleString('es-MX'))}</small></div></div>
  `).join('') : '<p class="empty-records">Todavía no hay actividad registrada.</p>';
}

function renderDictionary(schema) {
  const entityList = document.querySelector('.entity-list');
  if (!entityList || !schema.length) return;
  const tables = [...new Set(schema.map((column) => column.table_name))];
  entityList.innerHTML = `<strong>Entidades</strong>${tables.map((table, index) => `<button class="entity${index === 0 ? ' active' : ''}" type="button" data-table-name="${escapeHtml(table)}">${escapeHtml(table)} <span>${schema.filter((column) => column.table_name === table).length}</span></button>`).join('')}`;
  const showTable = (tableName) => {
    const columns = schema.filter((column) => column.table_name === tableName);
    const heading = document.querySelector('.schema-title h2');
    const description = document.querySelector('.schema-title p');
    const body = document.querySelector('.schema-table tbody');
    if (heading) heading.textContent = tableName;
    if (description) description.textContent = `${columns.length} campos en la base de datos conectada`;
    if (body) body.innerHTML = columns.map((column) => `<tr><td><strong>${escapeHtml(column.column_name)}</strong></td><td><code>${escapeHtml(column.data_type)}</code></td><td>${escapeHtml(column.clave)}</td><td>${column.is_nullable === 'NO' ? 'Obligatorio' : 'Opcional'}</td></tr>`).join('');
  };
  showTable(tables[0]);
  entityList.querySelectorAll('[data-table-name]').forEach((button) => button.addEventListener('click', () => {
    entityList.querySelectorAll('.entity').forEach((item) => item.classList.toggle('active', item === button));
    showTable(button.dataset.tableName);
  }));
}

async function loadWorkspace() {
  try {
    const [properties, summary, options] = await Promise.all([
      api.request('/api/properties'), api.get('summary'), api.get('options'),
    ]);
    Object.assign(optionData, options.data);
    records.properties = properties.data;
    const currentUser = JSON.parse(localStorage.getItem('habita_user') || '{}');
    const isAdmin = ['administrador', 'admin'].includes(currentUser.rol);
    const usersNavigation = document.querySelector('[data-view="users"]');
    if (usersNavigation) usersNavigation.hidden = !isAdmin;
    const resources = Object.keys(tableConfig).filter((resource) => resource !== 'properties' && (resource !== 'users' || isAdmin));
    const responses = await Promise.all(resources.map((resource) => api.get(resource)));
    resources.forEach((resource, index) => { records[resource] = responses[index].data; });
    if (!isAdmin) records.users = [];
    const [activity, schema] = await Promise.all([
      api.get('activity'), api.get('schema'),
    ]);
    records.activity = activity.data;
    records.schema = schema.data;
    renderDashboardProperties(records.properties);
    renderRecords('properties', 'properties-view', records.properties);
    renderRecords('clients', 'clients-view', records.clients);
    renderRecords('leads', 'clients-view', records.leads);
    renderRecords('visits', 'visits-view', records.visits);
    renderRecords('matches', 'matching-view', records.matches);
    renderRecords('documents', 'legal-view', records.documents);
    renderRecords('offers', 'contracts-view', records.offers);
    renderRecords('sales', 'contracts-view', records.sales);
    renderRecords('commissions', 'finance-view', records.commissions);
    renderRecords('rentals', 'rents-view', records.rentals);
    renderRecords('payments', 'rents-view', records.payments);
    renderRecords('contracts', 'contracts-view', records.contracts);
    if (isAdmin) renderRecords('users', 'users-view', records.users);
    renderActivity(records.activity);
    renderDictionary(records.schema);
    updateMetrics(summary.data);
  } catch (error) {
    console.error(error);
    if (/sesion|autenticacion/i.test(error.message)) showLogin();
    else showToast(error.message, true);
  }
}

function addSecondaryActions() {
  const actions = {
    'clients-view': [['lead', 'Nuevo prospecto']],
    'finance-view': [['commission', 'Registrar comisión']],
    'rents-view': [['rental', 'Nueva renta']],
  };
  Object.entries(actions).forEach(([viewId, buttons]) => {
    const intro = document.querySelector(`#${viewId} .page-intro`);
    if (!intro) return;
    buttons.forEach(([kind, label]) => {
      const button = document.createElement('button');
      button.className = 'outline-button';
      button.dataset.openForm = kind;
      button.textContent = label;
      intro.append(button);
    });
  });
}

function downloadCsv(resource) {
  const data = records[resource] || [];
  if (!data.length) return showToast('No hay registros para exportar.', true);
  const columns = Object.keys(data[0]);
  const csv = [columns.join(','), ...data.map((record) => columns.map((key) => `"${String(record[key] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = `${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadDataCsv(filename, data) {
  if (!data.length) return showToast('No hay registros para exportar.', true);
  const columns = Object.keys(data[0]);
  const csv = [columns.join(','), ...data.map((record) => columns.map((key) => `"${String(record[key] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function downloadDocument(id) {
  const response = await fetch(`/api/workflows/documents/${id}/file`, {
    headers: { Authorization: `Bearer ${api.token}` },
  });
  if (!response.ok) throw new Error('No se pudo descargar el documento.');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await response.blob());
  link.download = records.documents.find((documentRecord) => String(documentRecord.id_documento) === String(id))?.nombre_archivo || 'documento';
  link.click();
  URL.revokeObjectURL(link.href);
}

function contractDocument(record) {
  const operation = record.tipo_operacion === 'VENTA' ? 'compraventa' : 'arrendamiento';
  const amount = record.tipo_operacion === 'RENTA' ? record.renta_mensual : record.precio_total;
  const amountLabel = record.tipo_operacion === 'RENTA' ? 'Renta mensual acordada' : 'Precio total acordado';
  const address = [record.calle, record.numero, record.colonia, record.ciudad, record.estado, record.codigo_postal]
    .filter(Boolean).map(escapeHtml).join(', ');
  const coordinates = record.latitud !== null && record.longitud !== null
    ? `${escapeHtml(record.latitud)}, ${escapeHtml(record.longitud)}`
    : 'No registradas';
  const rentDates = record.tipo_operacion === 'RENTA'
    ? `<p><strong>Inicio:</strong> ${escapeHtml(record.fecha_inicio)} &nbsp; <strong>Fin:</strong> ${escapeHtml(record.fecha_fin || 'Sin fecha de término')}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contrato ${escapeHtml(record.id_contrato)} | Bienes y Negocios Renato</title>
<style>
body{max-width:820px;margin:32px auto;padding:34px;color:#17252a;font:15px/1.6 Arial,sans-serif}
header{display:flex;align-items:center;gap:18px;padding-bottom:20px;border-bottom:3px solid #193b3a}
header img{width:290px;max-width:100%}h1{margin:28px 0 5px;color:#193b3a;text-transform:capitalize}
.folio{color:#708083}.section{margin-top:22px;padding:18px;border:1px solid #dbe4e1;border-radius:8px}
.section h2{margin:0 0 10px;color:#28746b;font-size:17px}p{margin:6px 0}.notice{margin-top:25px;padding:14px;background:#fff5d6;font-size:12px}
.signatures{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin:70px 12px 0;text-align:center}
.signatures div{padding-top:10px;border-top:1px solid #65736f}
.print{position:fixed;right:20px;top:20px;padding:12px 18px;color:white;border:0;border-radius:7px;background:#193b3a;cursor:pointer}
@media print{body{margin:0 auto;padding:18px}.print{display:none}}
</style></head><body>
<button class="print" onclick="window.print()">Imprimir / Guardar como PDF</button>
<header><strong>BIENES Y NEGOCIOS RENATO</strong></header>
<h1>Formato de contrato de ${operation}</h1><p class="folio">Folio ${escapeHtml(record.id_contrato)} · ${escapeHtml(new Date(record.fecha_contrato).toLocaleDateString('es-MX'))}</p>
<p>Se registran los datos de las partes y del inmueble para documentar la operación indicada. Las partes deben revisar y completar cualquier condición legal necesaria antes de firmar.</p>
<section class="section"><h2>Cliente</h2><p><strong>Nombre:</strong> ${escapeHtml(record.nombre_cliente)}</p><p><strong>Correo:</strong> ${escapeHtml(record.correo_cliente)}</p><p><strong>Teléfono:</strong> ${escapeHtml(record.telefono_cliente || '—')}</p><p><strong>CURP:</strong> ${escapeHtml(record.curp_cliente || '—')}</p></section>
<section class="section"><h2>Vendedor</h2><p><strong>Nombre:</strong> ${escapeHtml(record.nombre_vendedor)}</p><p><strong>Correo:</strong> ${escapeHtml(record.correo_vendedor)}</p></section>
<section class="section"><h2>Ubicación y medidas del lote</h2><p><strong>Propiedad:</strong> ${escapeHtml(record.titulo_propiedad)}</p><p><strong>Domicilio:</strong> ${address || '—'}</p><p><strong>Frente:</strong> ${escapeHtml(record.frente_metros)} m · <strong>Fondo:</strong> ${escapeHtml(record.fondo_metros)} m · <strong>Superficie:</strong> ${escapeHtml(record.superficie_m2)} m²</p><p><strong>Coordenadas:</strong> ${coordinates}</p></section>
<section class="section"><h2>Condiciones registradas</h2><p><strong>Operación:</strong> ${operation}</p><p><strong>${amountLabel}:</strong> ${escapeHtml(formatMoney(amount))}</p>${rentDates}<p><strong>Observaciones:</strong> ${escapeHtml(record.observaciones || '—')}</p></section>
<p class="notice">Este documento es un formato generado a partir de los datos registrados en el sistema; no sustituye la revisión de un profesional legal ni incorpora cláusulas jurídicas no proporcionadas por las partes.</p>
<div class="signatures"><div>${escapeHtml(record.nombre_cliente)}<br>Cliente</div><div>${escapeHtml(record.nombre_vendedor)}<br>Vendedor</div></div></body></html>`;
}

function downloadContract(id) {
  const record = records.contracts.find((item) => String(item.id_contrato) === String(id));
  if (!record) return showToast('No se encontró el contrato para descargar.', true);
  const url = URL.createObjectURL(new Blob([contractDocument(record)], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `contrato-${record.id_contrato}.html`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Contrato descargado. Ábrelo y elige “Imprimir / Guardar como PDF”.');
}

function openStatusForm(resource, id) {
  const options = {
    leads: ['NUEVO', 'CONTACTADO', 'CALIFICADO', 'CONVERTIDO', 'DESCARTADO'],
    visits: ['Pendiente', 'Confirmada', 'Completada', 'Cancelada'],
    offers: ['PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'CANCELADA'],
    rentals: ['Activa', 'Finalizada', 'Cancelada'],
    payments: ['PENDIENTE', 'PAGADO', 'VENCIDO'],
  }[resource];
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'status';
  form.dataset.resource = resource;
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Actualizar estado';
  dialog.querySelector('.form-error').textContent = '';
  const field = renderField(['estado', 'Estado', 'select', true, options]);
  dialog.querySelector('.workflow-fields').replaceChildren(field);
  dialog.showModal();
}

function openPropertyEdit(id) {
  const record = records.properties.find((property) => String(property.id_propiedad) === String(id));
  if (!record) return;
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'property-edit';
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Editar propiedad';
  dialog.querySelector('.form-error').textContent = '';
  const fields = [
    ['titulo', 'Título', 'text', true], ['descripcion', 'Descripción', 'textarea'],
    ['precio', 'Precio', 'number', true], ['estado_propiedad', 'Estado', 'select', true, ['Disponible', 'Reservada', 'Vendida', 'Rentada', 'Inactiva']],
  ].map((definition) => {
    const element = renderField(definition);
    const input = element.querySelector('input, textarea, select');
    input.value = record[definition[0]] ?? '';
    return element;
  });
  dialog.querySelector('.workflow-fields').replaceChildren(...fields);
  dialog.showModal();
}

async function submitDialog(form) {
  const dialog = form.closest('dialog');
  const kind = form.dataset.kind;
  const config = forms[kind];
  const error = dialog.querySelector('.form-error');
  error.textContent = '';
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (kind === 'status') {
      const values = Object.fromEntries(new FormData(form));
      await api.update(form.dataset.resource, form.dataset.recordId, values);
    } else if (kind === 'property-edit') {
      const values = Object.fromEntries(new FormData(form));
      values.precio = Number(values.precio);
      await api.request(`/api/properties/${form.dataset.recordId}`, { method: 'PUT', body: JSON.stringify(values) });
    } else if (kind === 'document') {
      await api.create(config.resource, new FormData(form));
    } else {
      const values = Object.fromEntries(new FormData(form));
      form.querySelectorAll('input[type="number"]').forEach((input) => {
        if (values[input.name] !== undefined && values[input.name] !== '') values[input.name] = Number(values[input.name]);
      });
      if (kind === 'property' && values.amenidades) values.amenidades = values.amenidades.split(',').map((item) => item.trim()).filter(Boolean);
      if (kind === 'property') {
        await api.request('/api/properties', { method: 'POST', body: JSON.stringify(values) });
      } else if (kind === 'contract') {
        const clientId = values.id_cliente;
        delete values.id_cliente;
        values.id_cliente = clientId === 'nuevo' ? null : Number(clientId);
        values.cliente = {
          nombre: values.cliente_nombre,
          apellido_paterno: values.cliente_apellido_paterno,
          apellido_materno: values.cliente_apellido_materno,
          correo: values.cliente_correo,
          telefono: values.cliente_telefono,
          curp: values.cliente_curp,
          direccion: values.cliente_direccion,
          ciudad: values.cliente_ciudad,
          estado: values.cliente_estado,
          codigo_postal: values.cliente_codigo_postal,
        };
        Object.keys(values).filter((key) => key.startsWith('cliente_')).forEach((key) => delete values[key]);
        if (!values.latitud) delete values.latitud;
        if (!values.longitud) delete values.longitud;
        if (!values.renta_mensual) delete values.renta_mensual;
        if (!values.fecha_inicio) delete values.fecha_inicio;
        if (!values.fecha_fin) delete values.fecha_fin;
        if (!values.fecha_contrato) delete values.fecha_contrato;
        const result = await api.create(config.resource, values);
        dialog.close();
        await loadWorkspace();
        downloadContract(result.data.id_contrato);
        return;
      } else {
        await api.create(config.resource, values);
      }
    }
    dialog.close();
    showToast('Registro guardado.');
    await loadWorkspace();
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    submit.disabled = false;
  }
}

async function handlePageAction(button) {
  const view = button.closest('.view');
  if (!view) return;
  const viewId = view.id;
  const action = {
    'dashboard-view': 'property', 'properties-view': 'property', 'clients-view': 'client',
    'visits-view': 'visit', 'contracts-view': 'offer', 'legal-view': 'document',
    'users-view': 'user',
  }[viewId];
  if (action) return openForm(action);
  if (viewId === 'matching-view') {
    const result = await api.request('/api/workflows/matching/run', { method: 'POST', body: '{}' });
    showToast(`${result.count} coincidencias guardadas.`);
    return loadWorkspace();
  }
  if (viewId === 'portal-view') return window.open('/portal.html', '_blank', 'noopener');
  if (viewId === 'rents-view') return openForm('payment');
  if (viewId === 'finance-view') return downloadCsv('commissions');
  if (viewId === 'reports-view') {
    const { data } = await api.get('summary');
    return downloadDataCsv('resumen-operativo', [data]);
  }
  if (viewId === 'dictionary-view') return downloadCsv('schema');
}

const loginForm = document.getElementById('login-form');
loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorElement = document.getElementById('login-error');
  errorElement.textContent = '';
  const formData = new FormData(loginForm);
  try {
    await api.login(formData.get('correo'), formData.get('contrasena'));
    hideLogin();
    addSecondaryActions();
    await loadWorkspace();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});

document.addEventListener('click', async (event) => {
  const closeButton = event.target.closest('[data-dialog-close]');
  if (closeButton) return closeButton.closest('dialog').close();
  const openButton = event.target.closest('[data-open-form]');
  if (openButton) return openForm(openButton.dataset.openForm);
  const contractDocumentButton = event.target.closest('[data-contract-document]');
  if (contractDocumentButton) return downloadContract(contractDocumentButton.dataset.contractDocument);
  const contractMapButton = event.target.closest('[data-contract-map]');
  if (contractMapButton) {
  const mapWindow = window.open('', '_blank');
  try {
    const result = await api.get(`contracts/${contractMapButton.dataset.contractMap}/map`);
    if (mapWindow) mapWindow.location.href = result.data.google_maps_url;
    else window.location.href = result.data.google_maps_url;
  } catch (error) {
    mapWindow?.close();
    showToast(error.message, true);
  }
  return;
  }
  const downloadButton = event.target.closest('[data-download-document]');
  if (downloadButton) {
    try { await downloadDocument(downloadButton.dataset.downloadDocument); } catch (error) { showToast(error.message, true); }
    return;
  }
  const recordButton = event.target.closest('[data-record-action]');
  if (recordButton) {
    const { action, resource, recordId } = recordButton.dataset;
    if (action === 'edit' && resource === 'properties') return openPropertyEdit(recordId);
    if (action === 'status') return openStatusForm(resource, recordId);
    if (action === 'archive' && window.confirm('¿Archivar esta propiedad? El registro se conservará en la base de datos.')) {
      try {
        await api.request(`/api/properties/${recordId}`, { method: 'DELETE' });
        showToast('Propiedad archivada.');
        await loadWorkspace();
      } catch (error) { showToast(error.message, true); }
    }
    return;
  }
  if (event.target.closest('.profile-row, [title="Mi perfil"]')) {
    if (window.confirm('¿Cerrar la sesión actual?')) {
      api.logout();
      showLogin();
    }
    return;
  }
  if (event.target.closest('[title="Notificaciones"]')) {
    const latest = records.leads?.filter((lead) => lead.estado === 'NUEVO').length || 0;
    showToast(`Tienes ${latest} prospectos nuevos.`);
    return;
  }
  if (event.target.closest('.page-intro button, #new-property')) {
    event.preventDefault();
    try { await handlePageAction(event.target.closest('.page-intro button, #new-property')); }
    catch (error) { showToast(error.message, true); }
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'workflow-form') {
    event.preventDefault();
    submitDialog(event.target);
  }
});

const search = document.getElementById('global-search');
search?.addEventListener('input', () => {
  const query = search.value.toLocaleLowerCase();
  document.querySelectorAll('.persisted-panel tbody tr, #property-table tbody tr').forEach((row) => {
    row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
  });
});

if (api.token) {
  hideLogin();
  addSecondaryActions();
  loadWorkspace();
} else {
  showLogin();
}
