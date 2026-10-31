// Centraliza las peticiones HTTP, la sesion y las operaciones comunes del API.
const api = {
  token: localStorage.getItem('habita_token'),
  async request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(url, { ...options, headers });
    const payload = response.status === 204 ? null : await response.json();
    if (response.status === 401) {
      this.logout();
      showLogin();
    }
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
  async getAllPages(url, pageSize = 200) {
    const separator = url.includes('?') ? '&' : '?';
    const rows = [];
    let page = 1;
    let totalPages = 1;
    do {
      const payload = await this.request(`${url}${separator}page=${page}&limit=${pageSize}`);
      if (!payload.meta) return payload;
      rows.push(...payload.data);
      totalPages = payload.meta.totalPages;
      page += 1;
    } while (page <= totalPages);
    return { data: rows };
  },
  get(resource) {
    return this.getAllPages(`/api/workflows/${resource}`);
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
    if (notificationPollingTimer) {
      window.clearInterval(notificationPollingTimer);
      notificationPollingTimer = null;
    }
  },
};

// Expone el cliente para otras funciones cargadas en la pagina.
window.habitaApi = api;

// Comprueba el rol actual para mostrar acciones exclusivas de administracion.
function isCurrentUserAdmin() {
  try {
    const user = JSON.parse(localStorage.getItem('habita_user') || '{}');
    return ['administrador', 'admin'].includes(String(user.rol || user.role || '').toLowerCase());
  } catch { return false; }
}
window.isCurrentUserAdmin = isCurrentUserAdmin;

// Escapa valores antes de incluirlos en HTML y prepara formatos compartidos.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>\'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));
// Formatea importes en pesos mexicanos y fechas con claves locales estables.
const formatMoney = (value) => Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
// Produce claves de calendario locales para comparar fechas sin hora.
const localDateKey = (date = new Date()) => [date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
// Convierte fechas de alertas a un formato legible sin perder la hora disponible.
const formatAlertDate = (value) => {
  const text = String(value ?? '');
  if (!text) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const date = new Date(dateOnly ? `${text}T12:00:00` : text);
  if (Number.isNaN(date.getTime())) return text;
  const formattedDate = date.toLocaleDateString('es-MX');
  return dateOnly ? formattedDate : `${formattedDate} ${date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
};
const optionData = { clients: [], properties: [], users: [], categories: [], leads: [], rentals: [] };
// Conserva en memoria los registros que alimentan las vistas y sus formularios.
const records = {
  properties: [], clients: [], leads: [], visits: [], matches: [], documents: [], offers: [],
  sales: [], commissions: [], rentals: [], payments: [], contracts: [], sellers: [], reports: [],
  users: [], activity: [],
};
const reportDateFilter = { from: '', to: '' };
const propertyFilters = { search: '', category: '' };
const recordFilters = {};

// Relaciona cada recurso con su campo de fecha para ordenar y filtrar registros.
const dateFieldByResource = {
  properties: 'fecha_publicacion',
  clients: 'fecha_registro',
  leads: 'creado_en',
  offers: 'creado_en',
  visits: 'fecha_cita',
  matches: 'creada_en',
  documents: 'creado_en',
  sales: 'fecha_venta',
  commissions: 'creado_en',
  rentals: 'fecha_inicio',
  payments: 'pagado_en',
  maintenance: 'creado_en',
  contracts: 'fecha_contrato',
  users: 'fecha_registro',
  reports: 'fecha',
};

const tableConfig = {
  properties: { title: 'Propiedades registradas', columns: [['id_propiedad', 'ID'], ['titulo', 'Propiedad'], ['categoria', 'Categoría'], ['tipo_operacion', 'Operación'], ['precio', 'Precio'], ['estado_propiedad', 'Estado']], actions: ['edit', 'delete', 'map'] },
  clients: { title: 'Clientes', columns: [['nombre', 'Nombre'], ['apellido_paterno', 'Apellido'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['ciudad', 'Ciudad'], ['activo', 'Estado'], ['fecha_registro', 'Fecha de registro']], actions: ['history', 'portal-access', 'status'] },
  leads: { title: 'Clientes potenciales', columns: [['nombre', 'Cliente potencial'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['origen', 'Origen'], ['estado', 'Estado'], ['creado_en', 'Fecha de registro']], actions: ['status'] },
  visits: { title: 'Agenda de visitas', columns: [['fecha_cita', 'Fecha'], ['cliente', 'Cliente'], ['propiedad', 'Propiedad'], ['agente', 'Agente'], ['estado', 'Estado']], actions: ['status'] },
  matches: { title: 'Coincidencias guardadas', columns: [['lead', 'Cliente potencial'], ['propiedad', 'Propiedad'], ['puntuacion', 'Puntuación'], ['creada_en', 'Fecha']] },
  documents: { title: 'Expedientes y resguardos', columns: [['nombre_archivo', 'Documento'], ['tipo', 'Tipo'], ['estado', 'Estado'], ['tamano_bytes', 'Tamaño'], ['creado_en', 'Fecha']], actions: ['download'] },
  offers: { title: 'Ofertas', columns: [['propiedad', 'Propiedad'], ['cliente', 'Usuario'], ['monto', 'Monto'], ['tipo', 'Tipo'], ['estado', 'Estado']], actions: ['status'] },
  sales: { title: 'Ventas cerradas', columns: [['propiedad', 'Propiedad'], ['cliente', 'Cliente'], ['precio_venta', 'Precio'], ['fecha_venta', 'Fecha']] },
  commissions: { title: 'Comisiones', columns: [['propiedad', 'Propiedad'], ['porcentaje_agencia', '% agencia'], ['monto_operacion', 'Operación'], ['monto_total', 'Comisión'], ['estado', 'Pago'], ['creado_en', 'Fecha']], actions: ['status'] },
  rentals: { title: 'Contratos de renta', columns: [['propiedad', 'Propiedad'], ['cliente', 'Cliente'], ['renta_mensual', 'Renta mensual'], ['fecha_inicio', 'Inicio'], ['fecha_fin', 'Fin'], ['estado', 'Estado']], actions: ['status'] },
  payments: { title: 'Cobros de renta', columns: [['propiedad', 'Propiedad'], ['cliente', 'Cliente'], ['periodo', 'Periodo'], ['monto', 'Monto'], ['estado', 'Estado'], ['pagado_en', 'Pagado']] , actions: ['status', 'receipt'] },
  maintenance: { title: 'Solicitudes de mantenimiento', columns: [['propiedad', 'Propiedad'], ['titulo', 'Solicitud'], ['prioridad', 'Prioridad'], ['estado', 'Estado'], ['asignado', 'Responsable'], ['costo_estimado', 'Costo estimado'], ['costo_final', 'Costo final'], ['fecha_limite', 'Fecha límite']], actions: ['status'] },
  contracts: { title: 'Contratos registrados', columns: [['tipo_operacion', 'Operación'], ['cliente', 'Cliente'], ['vendedor', 'Vendedor'], ['propiedad', 'Lote'], ['precio_total', 'Precio'], ['superficie_m2', 'Superficie m²'], ['fecha_contrato', 'Fecha']], actions: ['document', 'map'] },
  sellers: { title: 'Vendedores', columns: [['nombre', 'Nombre'], ['apellido_paterno', 'Apellido'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['rol', 'Rol'], ['activo', 'Estado'], ['comision_mes', 'Comisión del mes']], actions: ['edit', 'status', 'delete'] },
  users: { title: 'Usuarios y administradores', columns: [['nombre', 'Nombre'], ['apellido_paterno', 'Apellido'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['rol', 'Función'], ['activo', 'Estado'], ['fecha_registro', 'Fecha de registro']], actions: ['edit', 'status', 'delete'] },
  reports: { title: 'Reportes de vendedores', columns: [['id', 'ID'], ['vendedor', 'Vendedor'], ['cobros', 'Cobros'], ['operacion', 'Operación'], ['propiedad', 'Propiedad'], ['fecha', 'Fecha'], ['actividad', 'Actividad']] },
};

// Define los campos y recursos asociados a cada formulario del sistema.
const forms = {
  property: { title: 'Nueva propiedad', resource: 'properties', fields: [
    ['titulo', 'Título', 'text', true], ['categoria', 'Categoría', 'select', true, ['Casa', 'Lote baldío']], ['tipo_operacion', 'Operación', 'select', true, ['VENTA', 'RENTA']],
    ['precio', 'Precio', 'number', true], ['descripcion', 'Descripción', 'textarea'], ['superficie', 'Superficie m²', 'number'],
    ['habitaciones', 'Habitaciones', 'number'], ['banos', 'Baños', 'number'], ['estacionamientos', 'Estacionamientos', 'number'],
    ['imagen_url', 'Imagen de la propiedad (URL)', 'url'], ['latitud', 'Latitud de Google Maps', 'number'], ['longitud', 'Longitud de Google Maps', 'number'],
    ['calle', 'Calle', 'text', true], ['numero', 'Número', 'text'], ['colonia', 'Colonia', 'text'], ['ciudad', 'Ciudad', 'text', true], ['estado', 'Estado', 'text', true], ['codigo_postal', 'Código postal', 'text'],
  ] },
  client: { title: 'Nuevo cliente', resource: 'clients', fields: [['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true], ['apellido_materno', 'Apellido materno', 'text'], ['correo', 'Correo', 'email', true], ['telefono', 'Teléfono', 'tel'], ['curp', 'CURP', 'text'], ['direccion', 'Dirección', 'text'], ['ciudad', 'Ciudad', 'text'], ['estado', 'Estado', 'text'], ['codigo_postal', 'Código postal', 'text']] },
  lead: { title: 'Nuevo cliente potencial', resource: 'leads', fields: [['nombre', 'Nombre', 'text', true], ['correo', 'Correo', 'email'], ['telefono', 'Teléfono', 'tel'], ['ciudad', 'Ciudad preferida', 'text'], ['precio_min', 'Precio mínimo', 'number'], ['precio_max', 'Precio máximo', 'number'], ['habitaciones_min', 'Habitaciones mínimas', 'number'], ['tipo', 'Categoría', 'text'], ['operacion', 'Operación', 'select', false, ['VENTA', 'RENTA']]] },
  visit: { title: 'Agendar visita', resource: 'visits', fields: [['id_cliente', 'Cliente', 'options', true, 'clients'], ['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['fecha_cita', 'Fecha y hora', 'datetime-local', true], ['motivo', 'Motivo', 'text']] },
  offer: { title: 'Registrar oferta', resource: 'offers', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['monto', 'Monto ofrecido', 'number', true], ['tipo', 'Tipo de oferta', 'select', true, ['OFERTA', 'CONTRAPROPUESTA']], ['notas', 'Notas', 'textarea']] },
  document: { title: 'Cargar resguardo', resource: 'documents', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['tipo', 'Tipo de documento', 'select', true, ['Escritura', 'Identificación', 'Predial', 'Contrato', 'Otro']], ['archivo', 'Archivo (PDF, DOC o imagen; máximo 10 MB)', 'file', true]] },
  sale: { title: 'Cerrar venta', resource: 'sales', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['id_cliente', 'Cliente', 'options', true, 'clients'], ['id_agente', 'Agente responsable', 'options', true, 'users'], ['precio_venta', 'Precio de cierre', 'number', true], ['fecha_venta', 'Fecha de cierre', 'date']] },
  commission: { title: 'Registrar comisión', resource: 'commissions', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['porcentaje_agencia', 'Porcentaje de agencia', 'number'], ['monto_operacion', 'Monto de operación', 'number', true], ['monto_total', 'Monto de comisión', 'number', true]] },
  rental: { title: 'Nueva renta', resource: 'rentals', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['id_cliente', 'Cliente', 'options', true, 'clients'], ['renta_mensual', 'Renta mensual', 'number', true], ['fecha_inicio', 'Fecha de inicio', 'date', true], ['fecha_fin', 'Fecha de término', 'date']] },
  maintenance: { title: 'Nueva solicitud de mantenimiento', resource: 'maintenance', fields: [
    ['id_propiedad', 'Propiedad', 'options', true, 'properties'],
    ['id_renta', 'Contrato de renta (opcional)', 'options', false, 'rentals'],
    ['titulo', 'Asunto', 'text', true], ['descripcion', 'Descripción', 'textarea', true],
    ['prioridad', 'Prioridad', 'select', true, ['baja', 'normal', 'alta', 'urgente']],
    ['asignado_a', 'Asignar a', 'options', false, 'users'],
    ['costo_estimado', 'Costo estimado', 'number'], ['fecha_limite', 'Fecha límite', 'date'],
  ] },
  payment: { title: 'Registrar cobro', resource: 'payments', fields: [['id_renta', 'Contrato de renta', 'options', true, 'rentals'], ['periodo', 'Periodo de pago', 'date', true], ['monto', 'Monto recibido', 'number', true], ['estado', 'Estado del pago', 'select', true, ['PAGADO', 'PENDIENTE']]] },
  seller: { title: 'Agregar vendedor', resource: 'users', fields: [['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true], ['apellido_materno', 'Apellido materno', 'text'], ['correo', 'Correo', 'email', true], ['telefono', 'Teléfono', 'tel'], ['password', 'Contraseña inicial (mínimo 12 caracteres)', 'password', true], ['rol', 'Función', 'select', true, [{ id: 'vendedor', nombre: 'Vendedor' }]]] },
  user: { title: 'Agregar usuario o administrador', resource: 'users', fields: [['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true], ['apellido_materno', 'Apellido materno', 'text'], ['correo', 'Correo', 'email', true], ['telefono', 'Teléfono', 'tel'], ['password', 'Contraseña inicial (mínimo 12 caracteres)', 'password', true], ['rol', 'Función', 'select', true, [{ id: 'usuario', nombre: 'Usuario' }, { id: 'administrador', nombre: 'Administrador' }]]] },
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

// Controla la visibilidad de acceso y los mensajes breves de resultado.
function showLogin() {
  document.getElementById('auth-overlay').hidden = false;
}

// Oculta la ventana de acceso despues de autenticar al usuario.
function hideLogin() {
  document.getElementById('auth-overlay').hidden = true;
}

// Muestra mensajes temporales de exito o error en la interfaz.
function showToast(message, isError = false) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.toggle('toast-error', isError);
  element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 2600);
}

// Crea una sola ventana de formulario y construye sus controles reutilizables.
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

// Crea un control HTML segun la definicion del campo del formulario.
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

// Configura el formulario solicitado y aplica los comportamientos propios del tipo.
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
  if (kind === 'property') configurePropertyForm(form);
  if (kind === 'contract') configureContractForm(form);
  if (kind === 'maintenance') configureMaintenanceForm(form);
  dialog.showModal();
}

// Oculta campos residenciales cuando se registra un lote baldio.
function configurePropertyForm(form) {
  const category = form.querySelector('[name="categoria"]');
  const houseFields = ['titulo', 'habitaciones', 'banos', 'estacionamientos', 'calle', 'numero', 'colonia', 'ciudad', 'estado', 'codigo_postal'];
  const toggleResidentialFields = () => {
    const isVacantLot = category.value === 'Lote baldío';
    houseFields.forEach((name) => {
      const input = form.querySelector(`[name="${name}"]`);
      const wrapper = input.closest('.workflow-field');
      wrapper.hidden = isVacantLot;
      input.disabled = isVacantLot;
      if (isVacantLot) input.value = '';
      input.required = !isVacantLot && ['titulo', 'calle', 'ciudad', 'estado'].includes(name);
    });
  };
  category.addEventListener('change', toggleResidentialFields);
  toggleResidentialFields();
}

// Limita las rentas seleccionables a las que pertenecen a la propiedad elegida.
function configureMaintenanceForm(form) {
  const propertySelect = form.querySelector('[name="id_propiedad"]');
  const rentalSelect = form.querySelector('[name="id_renta"]');
  const updateRentals = () => {
    const rentals = optionData.rentals.filter((rental) => String(rental.id_propiedad) === propertySelect.value);
    rentalSelect.innerHTML = `<option value="">Sin contrato asociado</option>${rentals.map((rental) => `<option value="${escapeHtml(rental.id)}">${escapeHtml(rental.nombre)}</option>`).join('')}`;
  };
  propertySelect.addEventListener('change', updateRentals);
  updateRentals();
}

// Genera los controles disponibles para cada fila de las tablas.
function actionButtons(resource, record) {
  const actions = tableConfig[resource]?.actions || [];
  return actions.map((action) => {
    if (resource === 'payments' && action === 'receipt') {
      return String(record.estado).toUpperCase() === 'PAGADO'
        ? `<button type="button" class="text-button" data-payment-receipt="${escapeHtml(record.id_pago)}">Recibo</button>`
        : '<span class="text-muted">Sin recibo</span>';
    }
    if (resource === 'clients' && action === 'history') {
      return `<button type="button" class="text-button" data-client-history="${escapeHtml(record.id_cliente)}">Historial</button>`;
    }
    if (resource === 'clients' && action === 'portal-access' && isCurrentUserAdmin()) {
      return `<button type="button" class="text-button" data-client-credentials="${escapeHtml(record.id_cliente)}">Acceso portal</button>`;
    }
    if (action === 'document') return `<button type="button" class="text-button" data-contract-document="${escapeHtml(record.id_contrato)}">Descargar contrato</button>`;
    if (action === 'map') {
      const mapAttribute = resource === 'properties' ? 'data-property-map' : 'data-contract-map';
      const mapId = resource === 'properties' ? record.id_propiedad : record.id_contrato;
      return `<button type="button" class="text-button" ${mapAttribute}="${escapeHtml(mapId)}">Google Maps</button>`;
    }
    if (action === 'download') return `<button type="button" class="text-button" data-download-document="${escapeHtml(record.id_documento)}">Descargar</button>`;
    if (resource === 'properties' && action === 'delete') {
      return `<button type="button" class="text-button danger-button" data-record-action="delete" data-resource="properties" data-record-id="${escapeHtml(record.id_propiedad)}">Borrar</button>`;
    }
    if (resource === 'sellers' && action === 'delete') {
      return `<button type="button" class="text-button danger-button" data-record-action="delete" data-resource="sellers" data-record-id="${escapeHtml(record.id_usuario)}">Eliminar</button>`;
    }
    if (resource === 'users' && action === 'delete') {
      return `<button type="button" class="text-button danger-button" data-record-action="delete" data-resource="users" data-record-id="${escapeHtml(record.id_usuario)}">Eliminar</button>`;
    }
    const idKey = { properties: 'id_propiedad', clients: 'id_cliente', leads: 'id_lead', visits: 'id_cita', offers: 'id_oferta', rentals: 'id_renta', payments: 'id_pago', commissions: 'id_comision', sellers: 'id_usuario', users: 'id_usuario' }[resource];
    const actionName = action === 'archive' ? 'Archivar' : action === 'edit' ? 'Editar' : 'Cambiar estado';
    return `<button type="button" class="text-button" data-record-action="${action}" data-resource="${resource}" data-record-id="${escapeHtml(record[idKey])}">${actionName}</button>`;
  }).join(' ');
}

// Conecta las acciones de administracion de usuarios y vendedores.
function bindUserRecordActions(panel, resource) {
  if (!['sellers', 'users'].includes(resource)) return;
  panel.querySelectorAll('[data-record-action]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const { recordAction: action, recordId } = button.dataset;
      if (action === 'edit') {
        return resource === 'sellers' ? openSellerEdit(recordId) : openUserEdit(recordId);
      }
      if (action === 'status') {
        return resource === 'sellers' ? openSellerStatus(recordId) : openUserStatus(recordId);
      }
      if (action !== 'delete') return;
      const label = resource === 'sellers' ? 'vendedor' : 'usuario';
      if (!window.confirm(`¿Eliminar este ${label}? Esta acción no se puede deshacer.`)) return;
      try {
        await api.request(`/api/workflows/users/${recordId}`, { method: 'DELETE' });
        showToast(`${resource === 'sellers' ? 'Vendedor' : 'Usuario'} eliminado.`);
        await loadWorkspace();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });
}

// Convierte valores de la base de datos a texto seguro y legible para las tablas.
function formatCell(resource, key, value, record) {
  if (key === 'precio' || key === 'precio_total' || key === 'monto' || key === 'monto_total' || key === 'monto_operacion' || key === 'precio_venta' || key === 'renta_mensual' || key === 'cobros' || key === 'comision_mes' || key === 'costo_estimado' || key === 'costo_final') return value === null || value === undefined ? '—' : escapeHtml(formatMoney(value));
  if (key === 'tamano_bytes') return `${(Number(value || 0) / 1024).toFixed(1)} KB`;
  if (key === 'puntuacion') return `${escapeHtml(value)}%`;
  if (key === 'fecha_cita' || key === 'fecha_venta' || key === 'fecha_contrato' || key === 'creado_en' || key === 'pagado_en' || key === 'fecha_inicio' || key === 'fecha_fin' || key === 'fecha_limite' || key === 'periodo' || key === 'fecha') {
    if (!value) return '—';
    const dateOnly = ['fecha_venta', 'fecha_contrato', 'fecha_inicio', 'fecha_fin', 'fecha_limite', 'periodo'].includes(key)
      && /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const date = new Date(dateOnly ? `${value}T12:00:00` : value);
    return Number.isNaN(date.getTime()) ? escapeHtml(value)
      : escapeHtml(dateOnly ? date.toLocaleDateString('es-MX') : date.toLocaleString('es-MX'));
  }
  if (key === 'tipo_operacion') return value === 'VENTA' ? 'Venta' : value === 'RENTA' ? 'Renta' : escapeHtml(value || '—');
  if (key === 'rol') return value === 'administrador' || value === 'admin' ? 'Administrador' : value === 'vendedor' || value === 'agente' ? 'Vendedor' : escapeHtml(value || '—');
  if (key === 'activo') return value === true || value === 'true' ? 'Activo' : 'Inactivo';
  if (resource === 'properties' && key === 'titulo') return `<strong>${escapeHtml(value)}</strong><small class="record-subtitle">${escapeHtml(record.direccion)}</small>`;
  return escapeHtml(value || '—');
}

// Renderiza tablas, filtros, acciones y contenido adicional de cada modulo.
function renderRecords(resource, viewId, data = []) {
  const view = document.getElementById(viewId);
  const config = tableConfig[resource];
  if (!view || !config) return;
  const visibleData = resource === 'reports' ? filterReportsByDate(data) : data;
  const filterState = recordFilters[resource] || (recordFilters[resource] = { search: '', from: '', to: '' });
  let panel = view.querySelector(`[data-record-panel="${resource}"]`);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'panel persisted-panel';
    panel.dataset.recordPanel = resource;
    view.append(panel);
  }
  const filterOptions = {
    visits: ['Todas', 'Pendiente', 'Confirmada', 'Completada', 'Cancelada'],
    rentals: ['Todas', 'Activa', 'Finalizada', 'Cancelada'],
    maintenance: ['Todas', 'pendiente', 'en_proceso', 'completada', 'cancelada'],
    commissions: ['Todas', 'PAGADA', 'PENDIENTE'],
    reports: ['Todas', 'comprar', 'vender', 'rentar'],
  }[resource];
  const propertyCategories = resource === 'properties'
    ? [...new Set(data.map((property) => property.categoria).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'))
    : [];
  const reportFilter = resource === 'reports' ? `
    <div class="report-date-filter" aria-label="Filtrar reportes por fechas">
      <label>Desde <input type="date" data-report-date="from" value="${reportDateFilter.from}"></label>
      <label>Hasta <input type="date" data-report-date="to" value="${reportDateFilter.to}"></label>
    </div>` : '';
  const searchValue = panel.querySelector('[data-record-search]')?.value ?? filterState.search;
  filterState.search = searchValue;
  const recordSearch = resource === 'properties' ? '' : `<label class="record-search"><span>Buscar</span><input type="search" data-record-search="${resource}" placeholder="Nombre, correo o texto" value="${escapeHtml(searchValue)}" autocomplete="off"></label>`;
  const dateField = dateFieldByResource[resource];
  const dateFilter = dateField && resource !== 'reports' ? `<div class="record-date-filter" aria-label="Filtrar por fechas"><label>Desde <input type="date" data-record-date="from" value="${escapeHtml(filterState.from)}"></label><label>Hasta <input type="date" data-record-date="to" value="${escapeHtml(filterState.to)}"></label></div>` : '';
  if (resource === 'properties') {
    propertyFilters.search = panel.querySelector('[data-property-search]')?.value || propertyFilters.search;
    propertyFilters.category = panel.querySelector('[data-property-category]')?.value || propertyFilters.category;
  }
  const propertySearch = resource === 'properties'
    ? `<label class="property-search"><span>Buscar propiedad</span><input type="search" data-property-search placeholder="Nombre o ID" value="${escapeHtml(propertyFilters.search)}" autocomplete="off"></label>`
    : '';
  const propertyCategory = resource === 'properties'
    ? `<label class="record-filter"><span>Categoría</span><select data-property-category><option value="">Todas</option>${propertyCategories.map((category) => `<option value="${escapeHtml(category)}"${propertyFilters.category === category ? ' selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></label>`
    : '';
  const filter = filterOptions ? `<label class="record-filter"><span>Filtrar</span><select data-record-filter="${resource}">${filterOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select></label>` : '';
  const propertyResultCount = resource === 'properties' ? ' data-property-result-count' : '';
  const resultLabel = resource === 'properties' ? 'propiedades' : 'registros';
  panel.innerHTML = `<div class="panel-heading"><div><h2>${config.title}</h2><p${propertyResultCount}>${visibleData.length} ${resultLabel}${resource === 'reports' && visibleData.length !== data.length ? ` de ${data.length}` : ''}</p></div><div class="panel-heading-actions">${recordSearch}${propertySearch}${propertyCategory}${dateFilter}${reportFilter}${filter}</div></div><div class="property-table-wrap"><table class="data-table"><thead><tr>${config.columns.map(([, label]) => `<th>${label}</th>`).join('')}<th>Acciones</th></tr></thead><tbody>${visibleData.length ? visibleData.map((record) => `<tr data-record-text="${escapeHtml(getRecordSearchText(record))}" data-record-date="${escapeHtml(dateField ? record[dateField] : '')}"${resource === 'properties'   ? ` data-property-title="${escapeHtml(record.titulo)}" data-property-id="${escapeHtml(record.id_propiedad)}" data-property-category="${escapeHtml(record.categoria)}"` : ''}>${config.columns.map(([key]) => `<td>${formatCell(resource, key, record[key], record)}</td>`).join('')}<td>${actionButtons(resource, record)}</td></tr>`).join('') : `<tr><td colspan="${config.columns.length + 1}" class="empty-records">No hay registros para mostrar.</td></tr>`}</tbody></table></div>`;
  bindUserRecordActions(panel, resource);
  if (resource === 'properties') applyPropertyFilters(panel);
  if (resource !== 'properties') applyRecordFilters(panel, resource);
  if (resource === 'visits') renderVisitCalendar(panel, data);
}

// Normaliza campos de un registro para la busqueda dentro de una tabla.
function getRecordSearchText(record) {
  return Object.values(record).filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase();
}

// Divide las filas visibles en paginas y conserva el numero por recurso.
const PAGE_SIZE = 20;
const tablePages = {};

// Recorta filas segun la pagina seleccionada y sincroniza los controles.
function paginatePanel(panel, resource, resetPage = false) {
  if (!panel) return;
  if (resetPage) tablePages[resource] = 1;
  const rows = [...panel.querySelectorAll('tbody tr[data-record-text]')].filter((row) => !row.hidden);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, tablePages[resource] || 1), totalPages);
  tablePages[resource] = page;
  const start = (page - 1) * PAGE_SIZE;
  panel.querySelectorAll('tbody tr[data-record-text]').forEach((row) => { row.dataset.pageHidden = 'true'; });
  rows.slice(start, start + PAGE_SIZE).forEach((row) => { delete row.dataset.pageHidden; });
  let nav = panel.querySelector('[data-pagination]');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'table-pagination';
    nav.dataset.pagination = resource;
    nav.setAttribute('aria-label', 'Paginación');
    panel.querySelector('.property-table-wrap')?.after(nav);
  }
  nav.hidden = rows.length <= PAGE_SIZE;
  nav.innerHTML = `<button type="button" class="text-button" data-page-nav="prev"${page <= 1 ? ' disabled' : ''}>Anterior</button><span>Página ${page} de ${totalPages} · ${rows.length} registros</span><button type="button" class="text-button" data-page-nav="next"${page >= totalPages ? ' disabled' : ''}>Siguiente</button>`;
}

// Aplica texto, fechas y estado al conjunto de registros del modulo.
function applyRecordFilters(panel, resource) {
  if (!panel) return;
  const state = recordFilters[resource] || (recordFilters[resource] = { search: '', from: '', to: '' });
  const rows = [...panel.querySelectorAll('tbody tr[data-record-text]')];
  const query = state.search.trim().toLocaleLowerCase();
  const matches = rows.filter((row) => {
    const date = String(row.dataset.recordDate || '').slice(0, 10);
    const match = (!query || row.dataset.recordText.includes(query))
      && (!state.from || date >= state.from)
      && (!state.to || date <= state.to);
    row.hidden = !match;
    return match;
  }).length;
  const count = panel.querySelector('[data-property-result-count]') || panel.querySelector('.panel-heading p');
  if (count) count.textContent = `${matches} registros${matches !== rows.length ? ` de ${rows.length}` : ''}`;
  paginatePanel(panel, resource, true);
}

// Aplica busqueda, categoria y fecha al inventario de propiedades.
function applyPropertyFilters(panel) {
  if (!panel) return;
  const search = panel.querySelector('[data-property-search]');
  const category = panel.querySelector('[data-property-category]');
  propertyFilters.search = search?.value || '';
  propertyFilters.category = category?.value || '';
  const query = propertyFilters.search.trim().toLocaleLowerCase();
  const selectedCategory = propertyFilters.category.toLocaleLowerCase();
  const state = recordFilters.properties || (recordFilters.properties = { search: '', from: '', to: '' });
  const rows = [...panel.querySelectorAll('tbody tr[data-property-title]')];
  const matches = rows.filter((row) => {
    const date = String(row.dataset.recordDate || '').slice(0, 10);
    const match = (!query || row.dataset.propertyTitle.toLocaleLowerCase().includes(query) || row.dataset.propertyId.includes(query))
      && (!selectedCategory || row.dataset.propertyCategory.toLocaleLowerCase() === selectedCategory)
      && (!state.from || date >= state.from)
      && (!state.to || date <= state.to);
    row.hidden = !match;
    return match;
  }).length;
  const count = panel.querySelector('[data-property-result-count]');
  if (count) count.textContent = `${matches} propiedades${matches !== rows.length ? ` de ${rows.length}` : ''}`;
  const recordSearchInput = panel.querySelector('[data-record-search]');
  if (recordSearchInput) state.search = recordSearchInput.value;
  paginatePanel(panel, 'properties', true);
}

// Reune los campos de usuario usados para filtrar la lista administrativa.
function getUserSearchText(user) {
  return [user.nombre, user.apellido_paterno, user.apellido_materno].filter(Boolean).join(' ');
}

// Actualiza la lista de vendedores segun el texto de busqueda.
function applyUserSearch(input) {
  if (!input) return;
  const panel = input.closest('.persisted-panel');
  const query = input.value.trim().toLocaleLowerCase();
  const rows = [...panel.querySelectorAll('tbody tr[data-user-name]')];
  const matches = rows.filter((row) => {
    const match = !query || row.dataset.userName.toLocaleLowerCase().includes(query);
    row.hidden = !match;
    return match;
  }).length;
  const count = panel.querySelector('[data-user-result-count]');
  if (count) count.textContent = `${matches} resultados${query ? ` de ${rows.length}` : ''}`;
}

// Filtra reportes por el intervalo de fechas seleccionado.
function filterReportsByDate(data) {
  return data.filter((report) => {
    const date = String(report.fecha || '').slice(0, 10);
    return (!reportDateFilter.from || date >= reportDateFilter.from)
      && (!reportDateFilter.to || date <= reportDateFilter.to);
  });
}

// Presenta las citas de la semana en una vista agrupada por dia.
function renderVisitCalendar(panel, visits) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    const dayVisits = visits.filter((visit) => String(visit.fecha_cita).slice(0, 10) === key);
    return `<article class="visit-day"><header><strong>${date.toLocaleDateString('es-MX', { weekday: 'short' })}</strong><span>${date.getDate()}</span></header>${dayVisits.length ? dayVisits.map((visit) => `<div class="visit-event"><time>${new Date(visit.fecha_cita).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</time><strong>${escapeHtml(visit.propiedad)}</strong><small>${escapeHtml(visit.cliente)} · ${escapeHtml(visit.estado)}</small></div>`).join('') : '<p class="empty-calendar">Sin visitas</p>'}</article>`;
  }).join('');
  panel.insertAdjacentHTML('beforeend', `<div class="calendar-heading"><h3>Calendario de visitas</h3><span>Próximos 7 días</span></div><div class="visit-calendar">${days}</div>`);
}

// Filtra filas con el control desplegable del modulo activo.
function applyRecordFilter(select) {
  const value = select.value.toLocaleLowerCase();
  const panel = select.closest('.persisted-panel');
  panel?.querySelectorAll('tbody tr').forEach((row) => {
    row.hidden = value !== 'todas' && !row.textContent.toLocaleLowerCase().includes(value);
  });
  if (panel) paginatePanel(panel, panel.dataset.recordPanel, true);
}

// Adapta los campos del formulario de contrato a venta o renta y al cliente elegido.
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

// Dibuja las propiedades recientes que aparecen en el panel principal.
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

// Actualiza indicadores generales y cifras resumidas de cada modulo.
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
    'clients-view': [['Clientes', records.clients.length], ['Nuevos clientes potenciales', countStatus(records.leads, 'estado', ['nuevo'])], ['Clientes potenciales activos', records.leads.filter((lead) => !['convertido', 'descartado', 'cerrado', 'perdido'].includes(String(lead.estado).toLowerCase())).length], ['Con preferencias', new Set(records.matches.map((item) => String(item.id_lead))).size]],
    'matching-view': [['Coincidencias guardadas', records.matches.length], ['Clientes potenciales evaluados', new Set(records.matches.map((item) => String(item.id_lead))).size], ['Puntuación promedio', `${records.matches.length ? Math.round(records.matches.reduce((sum, item) => sum + Number(item.puntuacion), 0) / records.matches.length) : 0}%`], ['Clientes potenciales', records.leads.length]],
    'visits-view': [['Visitas registradas', records.visits.length], ['Hoy', records.visits.filter((item) => new Date(item.fecha_cita).toDateString() === new Date().toDateString()).length], ['Confirmadas', countStatus(records.visits, 'estado', ['confirmada'])], ['Completadas', countStatus(records.visits, 'estado', ['completada'])]],
    'portal-view': [['Propiedades publicables', records.properties.filter((item) => String(item.estado_propiedad).toLowerCase() === 'disponible').length], ['Solicitudes recibidas', records.leads.filter((item) => item.origen === 'portal').length], ['Clientes potenciales con consentimiento', records.leads.filter((item) => item.consentimiento_datos).length], ['Favoritos', records.favorites?.length || 0]],
    'legal-view': [['Documentos guardados', records.documents.length], ['Por validar', countStatus(records.documents, 'estado', ['pendiente'])], ['Validados', countStatus(records.documents, 'estado', ['validado', 'aprobado'])], ['Propiedades documentadas', new Set(records.documents.map((item) => String(item.id_propiedad))).size]],
    'contracts-view': [['Contratos registrados', records.contracts.length], ['Ventas', records.contracts.filter((item) => item.tipo_operacion === 'VENTA').length], ['Rentas', records.contracts.filter((item) => item.tipo_operacion === 'RENTA').length], ['Operaciones del mes', records.contracts.filter((item) => new Date(item.fecha_contrato).getMonth() === new Date().getMonth()).length]],
    'finance-view': [['Comisiones registradas', records.commissions.length], ['Total comisión', formatMoney(records.commissions.reduce((sum, item) => sum + Number(item.monto_total || 0), 0))], ['Operaciones comisionadas', new Set(records.commissions.map((item) => String(item.id_propiedad))).size], ['Ventas registradas', records.sales.length]],
    'rents-view': [['Contratos activos', countStatus(records.rentals, 'estado', ['activa'])], ['Cobros recibidos', countStatus(records.payments, 'estado', ['pagado'])], ['Adeudos vencidos', records.payments.filter((item) => String(item.estado).toUpperCase() === 'VENCIDO' || (String(item.estado).toUpperCase() === 'PENDIENTE' && String(item.periodo).slice(0, 10) <= localDateKey())).length], ['Saldo pendiente', formatMoney(records.payments.filter((item) => ['pendiente', 'vencido'].includes(String(item.estado).toLowerCase())).reduce((sum, item) => sum + Number(item.monto || 0), 0))]],
    'maintenance-view': [['Solicitudes abiertas', records.maintenance.filter((item) => ['pendiente', 'en_proceso'].includes(item.estado)).length], ['Urgentes', records.maintenance.filter((item) => item.prioridad === 'urgente' && ['pendiente', 'en_proceso'].includes(item.estado)).length], ['En proceso', countStatus(records.maintenance, 'estado', ['en_proceso'])], ['Costo final registrado', formatMoney(records.maintenance.reduce((sum, item) => sum + Number(item.costo_final || 0), 0))]],
    'sellers-view': [['Vendedores registrados', records.sellers.length], ['Vendedores activos', countStatus(records.sellers, 'activo', [true, 'true'])], ['Comisiones del mes', formatMoney(records.sellers.reduce((sum, item) => sum + Number(item.comision_mes || 0), 0))], ['Rol requerido', 'Administrador']],
    'users-view': [['Usuarios registrados', records.users.filter((item) => item.rol === 'usuario').length], ['Administradores', countStatus(records.users, 'rol', ['admin', 'administrador'])], ['Usuarios activos', countStatus(records.users, 'activo', [true, 'true'])], ['Rol requerido', 'Administrador']],
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

// Convierte los grupos de alertas de la API en elementos navegables.
function renderFollowUpAlerts(groups) {
  const container = document.getElementById('follow-up-alerts');
  if (!container) return;
  const total = groups.reduce((sum, group) => sum + Number(group.total || 0), 0);
  container.innerHTML = total
    ? groups.filter((group) => group.total > 0).map((group) => `
      <section class="follow-up-group">
        <div class="follow-up-group-heading"><h3>${escapeHtml(group.label)}</h3><span>${Number(group.total)}</span></div>
        <ul>${group.items.map((item) => `
          <li>
            <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}${['leads', 'visits'].includes(group.type) && item.date ? ` · ${escapeHtml(formatAlertDate(item.date))}` : ''}</small></div>
            <button type="button" class="text-button" data-open-view="${escapeHtml(group.view)}">Revisar</button>
          </li>
        `).join('')}</ul>
      </section>
    `).join('')
    : '<p class="empty-records">No hay seguimientos pendientes por ahora.</p>';
}

// Consulta notificaciones, actualiza el indicador y muestra el contenido reciente.
async function loadNotifications() {
  const menu = document.getElementById('notification-menu');
  const list = document.getElementById('notification-list');
  const badge = document.querySelector('.notification-count');
  if (!menu || !list || !api.token) return;
  const result = await api.get('notifications');
  const notifications = result.data || [];
  const unread = Number(result.unread_count || 0);
  if (badge) {
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.setAttribute('aria-label', `${unread} notificaciones sin leer`);
  }
  list.innerHTML = notifications.length ? notifications.map((item) => `
    <button type="button" class="notification-entry${item.leido_en ? '' : ' unread'}"
      data-notification-id="${escapeHtml(item.id_notificacion)}"
      data-entity="${escapeHtml(item.entidad)}">
      <strong>${escapeHtml(item.titulo)}</strong>
      <span>${escapeHtml(item.detalle)}</span>
      <small>${escapeHtml(formatHistoryDate(item.creado_en))}${item.leido_en ? ' · Leída' : ' · Marcar como leída'}</small>
    </button>
  `).join('') : '<p class="notification-empty">No tienes notificaciones pendientes.</p>';
}

let notificationPollingTimer;

// Refresca notificaciones en intervalos mientras exista una sesion activa.
function startNotificationPolling() {
  if (notificationPollingTimer) return;
  notificationPollingTimer = window.setInterval(() => {
    loadNotifications().catch((error) => console.error('No se pudieron actualizar las notificaciones:', error));
  }, 60000);
}

// Guarda una nota o tarea de seguimiento desde el historial del cliente.
async function submitClientActivity(form) {
  const values = Object.fromEntries(new FormData(form));
  if (values.asignado_a) values.asignado_a = Number(values.asignado_a);
  else delete values.asignado_a;
  const submit = form.querySelector('[type="submit"]');
  const error = document.getElementById('client-history-error');
  submit.disabled = true;
  error.textContent = '';
  try {
    await api.request(`/api/workflows/clients/${form.dataset.clientId}/activities`, {
      method: 'POST',
      body: JSON.stringify(values),
    });
    await openClientHistory(form.dataset.clientId);
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    submit.disabled = false;
  }
}

// Muestra los eventos recientes del sistema con una descripcion amigable.
function renderActivity(activity) {
  const list = document.querySelector('#dashboard-view .activity-list');
  if (!list) return;
  const actionLabels = { crear: 'registró', actualizar: 'actualizó', eliminar: 'eliminó', archivar: 'archivó', ejecutar: 'ejecutó' };
  const entityLabels = { usuarios: 'un usuario', clientes: 'un cliente', contratos: 'un contrato', propiedades: 'una propiedad', leads: 'un cliente potencial', citas: 'una cita', ventas: 'una venta', rentas: 'una renta', pagos_renta: 'un pago', comisiones: 'una comisión', coincidencias: 'coincidencias' };
  list.innerHTML = activity.length ? activity.map((item) => `
    <div class="activity-item"><span class="activity-icon">${escapeHtml(item.accion.slice(0, 1).toLocaleUpperCase())}</span>
      <div><p><strong>${escapeHtml(item.usuario)}</strong> ${escapeHtml(actionLabels[item.accion] || 'realizó una acción en')} ${escapeHtml(entityLabels[item.entidad] || 'el sistema')}</p>
        <p>${escapeHtml(item.detalle?.titulo || item.detalle?.nombre || item.detalle?.correo || '')}</p>
        <small>${escapeHtml(new Date(item.creado_en).toLocaleString('es-MX'))}</small></div></div>
  `).join('') : '<p class="empty-records">Todavía no hay actividad registrada.</p>';
}

// Carga los datos, aplica permisos por rol y actualiza cada vista del espacio.
async function loadWorkspace() {
  try {
    const [propertiesResult, summaryResult, optionsResult] = await Promise.allSettled([
      api.getAllPages('/api/properties'), api.get('summary'), api.get('options'),
    ]);
    if (propertiesResult.status === 'rejected') throw propertiesResult.reason;
    if (summaryResult.status === 'rejected') throw summaryResult.reason;
    if (optionsResult.status === 'rejected') throw optionsResult.reason;
    Object.assign(optionData, optionsResult.value.data);
    records.properties = propertiesResult.value.data;
    const currentUser = JSON.parse(localStorage.getItem('habita_user') || '{}');
    const role = String(currentUser.rol || currentUser.role || '').toLowerCase();
    const isAdmin = ['administrador', 'admin'].includes(role);
    const usersNavigation = document.querySelector('[data-view="users"]');
    const sellersNavigation = document.querySelector('[data-view="sellers"]');
    const financeNavigation = document.querySelector('[data-view="finance"]');
    if (usersNavigation) usersNavigation.hidden = !isAdmin;
    if (sellersNavigation) sellersNavigation.hidden = !isAdmin;
    if (financeNavigation) financeNavigation.hidden = !isAdmin;
    const financeView = document.getElementById('finance-view');
    if (financeView) financeView.hidden = !isAdmin;
    const usersView = document.getElementById('users-view');
    const sellersView = document.getElementById('sellers-view');
    if (usersView) usersView.hidden = !isAdmin;
    if (sellersView) sellersView.hidden = !isAdmin;
    const resources = Object.keys(tableConfig).filter((resource) => resource !== 'properties'
      && (resource !== 'users' || isAdmin)
      && (resource !== 'sellers' || isAdmin)
      && (resource !== 'commissions' || isAdmin));
    const responses = await Promise.allSettled(resources.map((resource) => api.get(resource)));
    resources.forEach((resource, index) => {
      const result = responses[index];
      if (result.status === 'fulfilled') {
        records[resource] = Array.isArray(result.value.data) ? result.value.data : [];
      } else {
        records[resource] = [];
        console.error(`No se pudo cargar la tabla ${resource}:`, result.reason);
      }
    });
    if (!isAdmin) records.users = [];
    if (!isAdmin) records.sellers = [];
    if (!isAdmin) records.commissions = [];
    const activityResult = await api.get('activity').catch((error) => {
      console.error('No se pudo cargar la actividad:', error);
      return { data: [] };
    });
    records.activity = activityResult.data;
    await loadNotifications().catch((error) => console.error('No se pudieron cargar las notificaciones:', error));
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
    renderRecords('maintenance', 'maintenance-view', records.maintenance);
    renderRecords('contracts', 'contracts-view', records.contracts);
    renderRecords('reports', 'reports-view', records.reports);
    if (isAdmin) renderRecords('users', 'users-view', records.users);
    if (isAdmin) renderRecords('sellers', 'sellers-view', records.sellers);
    renderActivity(records.activity);
    updateMetrics(summaryResult.value.data);
    renderCollectionsOverview();
    renderFollowUpAlerts(summaryResult.value.data.alerts || []);
  } catch (error) {
    console.error(error);
    if (/sesion|autenticacion/i.test(error.message)) showLogin();
    else showToast(error.message, true);
  }
}

// Agrega acciones secundarias a las cabeceras de los modulos.
function addSecondaryActions() {
  const actions = {
    'clients-view': [['client', 'Agregar cliente']],
    'legal-view': [['contract', 'Generar contrato']],
    'finance-view': [['commission', 'Registrar comisión']],
    'rents-view': [['rental', 'Nueva renta']],
  };
  Object.entries(actions).forEach(([viewId, buttons]) => {
    const intro = document.querySelector(`#${viewId} .page-intro`);
    if (!intro) return;
    let actionGroup = intro.querySelector('.page-intro-actions');
    if (!actionGroup) {
      actionGroup = document.createElement('div');
      actionGroup.className = 'page-intro-actions';
      const existingAction = intro.querySelector(':scope > [data-open-form]');
      if (existingAction) actionGroup.append(existingAction);
      const exportButton = intro.querySelector(':scope > .outline-button');
      if (exportButton) actionGroup.append(exportButton);
      const primaryAction = intro.querySelector(':scope > .primary-button');
      if (primaryAction) actionGroup.append(primaryAction);
      intro.append(actionGroup);
    }
    buttons.forEach(([kind, label]) => {
      actionGroup.querySelectorAll(`[data-open-form="${kind}"]`).forEach((button) => button.remove());
      const button = document.createElement('button');
      button.className = 'outline-button';
      button.dataset.openForm = kind;
      button.dataset.secondaryAction = kind;
      button.textContent = label;
      actionGroup.append(button);
    });
  });
}

// Resume adeudos, cobros proximos y contratos que requieren renovacion.
function renderCollectionsOverview() {
  const container = document.querySelector('[data-collections-overview]');
  if (!container) return;
  const today = new Date();
  const todayKey = localDateKey(today);
  const inDays = (days) => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')].join('-');
  };
  const openPayments = records.payments.filter((payment) => (
    ['PENDIENTE', 'VENCIDO'].includes(String(payment.estado).toUpperCase())
  ));
  const overduePayments = openPayments.filter((payment) => (
    String(payment.estado).toUpperCase() === 'VENCIDO'
    || String(payment.periodo).slice(0, 10) <= todayKey
  ));
  const upcomingPayments = openPayments.filter((payment) => {
    const due = String(payment.periodo).slice(0, 10);
    return String(payment.estado).toUpperCase() === 'PENDIENTE'
      && due > todayKey && due <= inDays(30);
  });
  const expiringRentals = records.rentals.filter((rental) => {
    const end = String(rental.fecha_fin || '').slice(0, 10);
    return String(rental.estado).toLowerCase() === 'activa'
      && end >= todayKey && end <= inDays(60);
  });
  const paymentItem = (payment) => `<li><div><strong>${escapeHtml(payment.cliente)}</strong>
    <span>${escapeHtml(payment.propiedad)} · ${escapeHtml(formatAlertDate(payment.periodo))}</span></div>
    <strong>${escapeHtml(formatMoney(payment.monto))}</strong>
    <button type="button" class="text-button" data-record-action="status" data-resource="payments" data-record-id="${escapeHtml(payment.id_pago)}">Actualizar</button></li>`;
  const rentalItem = (rental) => `<li><div><strong>${escapeHtml(rental.cliente)}</strong>
    <span>${escapeHtml(rental.propiedad)} · Vence ${escapeHtml(formatAlertDate(rental.fecha_fin))}</span></div>
    <strong>${escapeHtml(formatMoney(rental.renta_mensual))} / mes</strong></li>`;
  container.innerHTML = `
    <div class="collection-alert-grid">
      <section class="collection-alert-card"><div class="collection-alert-heading"><h3>Adeudos vencidos</h3><span>${overduePayments.length}</span></div>
        <ul>${overduePayments.length ? overduePayments.slice(0, 5).map(paymentItem).join('') : '<li class="collection-empty">No hay adeudos vencidos.</li>'}</ul>
      </section>
      <section class="collection-alert-card"><div class="collection-alert-heading"><h3>Próximos cobros</h3><span>${upcomingPayments.length}</span></div>
        <ul>${upcomingPayments.length ? upcomingPayments.slice(0, 5).map(paymentItem).join('') : '<li class="collection-empty">No hay cobros próximos en los siguientes 30 días.</li>'}</ul>
      </section>
      <section class="collection-alert-card"><div class="collection-alert-heading"><h3>Renovaciones por atender</h3><span>${expiringRentals.length}</span></div>
        <ul>${expiringRentals.length ? expiringRentals.slice(0, 5).map(rentalItem).join('') : '<li class="collection-empty">No hay contratos por vencer en los siguientes 60 días.</li>'}</ul>
      </section>
    </div>`;
}

// Exporta tablas y documentos a archivos descargables.
function downloadCsv(resource) {
  const data = resource === 'reports'
    ? filterReportsByDate(records[resource] || [])
    : records[resource] || [];
  if (resource === 'reports' && reportDateFilter.from && reportDateFilter.to && reportDateFilter.from > reportDateFilter.to) {
    return showToast('La fecha inicial no puede ser posterior a la fecha final.', true);
  }
  if (!data.length) return showToast('No hay registros para exportar.', true);
  const columns = Object.keys(data[0]);
  const csv = [columns.join(','), ...data.map((record) => columns.map((key) => `"${String(record[key] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  link.download = `${resource}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Exporta datos recibidos a un archivo CSV con nombre personalizado.
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

// Descarga un archivo legal usando la sesion autenticada.
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

// Construye una vista imprimible con la informacion registrada del contrato.
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

// Genera y descarga el formato imprimible de un contrato.
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

// Genera un comprobante imprimible solo para pagos marcados como pagados.
// Prepara y descarga el recibo del pago de renta seleccionado.
function downloadPaymentReceipt(id) {
  const payment = records.payments.find((item) => String(item.id_pago) === String(id));
  if (!payment || String(payment.estado).toUpperCase() !== 'PAGADO') {
    showToast('Solo se puede generar recibo de un pago registrado como pagado.', true);
    return;
  }
  const receipt = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Recibo de pago ${escapeHtml(payment.id_pago)}</title>
    <style>body{max-width:680px;margin:50px auto;padding:32px;font:16px Arial;color:#193b3a;border:1px solid #ccd8d3}h1{font-size:24px}small{color:#66736f}dl{display:grid;grid-template-columns:1fr 1fr;gap:12px}dt{color:#66736f}dd{margin:4px 0 0;font-weight:700}.amount{font-size:24px;color:#193b3a}.print{padding:10px 16px;color:white;background:#193b3a;border:0;border-radius:6px;cursor:pointer}@media print{.print{display:none}body{margin:0 auto;border:0}}</style>
    <body><small>BIENES Y NEGOCIOS RENATO · RECIBO DE PAGO</small><h1>Comprobante de renta</h1>
    <p>Recibo #${escapeHtml(payment.id_pago)}</p><dl>
      <div><dt>Cliente</dt><dd>${escapeHtml(payment.cliente)}</dd></div>
      <div><dt>Correo</dt><dd>${escapeHtml(payment.correo)}</dd></div>
      <div><dt>Propiedad</dt><dd>${escapeHtml(payment.propiedad)}</dd></div>
      <div><dt>Periodo cubierto</dt><dd>${escapeHtml(formatAlertDate(payment.periodo))}</dd></div>
      <div><dt>Fecha de pago</dt><dd>${escapeHtml(formatAlertDate(payment.pagado_en))}</dd></div>
      <div><dt>Estado</dt><dd>Pagado</dd></div>
    </dl><p class="amount">${escapeHtml(formatMoney(payment.monto))}</p>
    <button class="print" onclick="window.print()">Imprimir / Guardar como PDF</button></body></html>`;
  const url = URL.createObjectURL(new Blob([receipt], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `recibo-renta-${payment.id_pago}.html`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Abre formularios de estado y edicion para registros existentes.
function openStatusForm(resource, id) {
  const options = {
    leads: ['NUEVO', 'CONTACTADO', 'CALIFICADO', 'CONVERTIDO', 'DESCARTADO'],
    visits: ['Pendiente', 'Confirmada', 'Completada', 'Cancelada'],
    offers: ['PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'CANCELADA'],
    rentals: ['Activa', 'Finalizada', 'Cancelada'],
    payments: ['PENDIENTE', 'PAGADO', 'VENCIDO'],
    commissions: ['PENDIENTE', 'PAGADA'],
    maintenance: ['pendiente', 'en_proceso', 'completada', 'cancelada'],
  }[resource];
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'status';
  form.dataset.resource = resource;
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Actualizar estado';
  dialog.querySelector('.form-error').textContent = '';
  const fields = [renderField(['estado', 'Estado', 'select', true, options])];
  if (resource === 'maintenance') {
    const record = records.maintenance.find((item) => String(item.id_solicitud) === String(id));
    const costField = renderField(['costo_final', 'Costo final', 'number']);
    const assigneeField = renderField(['asignado_a', 'Responsable', 'options', false, 'users']);
    costField.querySelector('input').value = record?.costo_final ?? '';
    assigneeField.querySelector('select').value = record?.asignado_a ?? '';
    fields.push(costField, assigneeField);
  }
  dialog.querySelector('.workflow-fields').replaceChildren(...fields);
  dialog.showModal();
}

// Abre el formulario de edicion con los valores actuales de una propiedad.
function openPropertyEdit(id) {
  const record = records.properties.find((property) => String(property.id_propiedad) === String(id));
  if (!record) return;
  const currentUser = JSON.parse(localStorage.getItem('habita_user') || '{}');
  const isAdmin = ['administrador', 'admin'].includes(currentUser.rol);
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'property-edit';
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Editar propiedad';
  dialog.querySelector('.form-error').textContent = '';
  const fields = [
    ['titulo', 'Título', 'text', true], ['descripcion', 'Descripción', 'textarea'],
    ['precio', 'Precio', 'number', true], ['imagen_url', 'Imagen de la propiedad (URL)', 'url'],
    ['latitud', 'Latitud de Google Maps', 'number'], ['longitud', 'Longitud de Google Maps', 'number'],
    ['estado_propiedad', 'Estado', 'select', true, ['Disponible', 'Reservada', 'Vendida', 'Rentada', 'Inactiva']],
    ...(isAdmin ? [['id_categoria', 'Categoría', 'options', true, 'categories']] : []),
  ].map((definition) => {
    const element = renderField(definition);
    const input = element.querySelector('input, textarea, select');
    input.value = definition[0] === 'id_categoria' ? record.id_categoria : record[definition[0]] ?? '';
    return element;
  });
  dialog.querySelector('.workflow-fields').replaceChildren(...fields);
  dialog.showModal();
}

// Prepara los dialogos para editar usuarios, vendedores y clientes.
function openSellerEdit(id) {
  const record = records.sellers.find((seller) => String(seller.id_usuario) === String(id));
  if (!record) return;
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'seller-edit';
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Editar vendedor';
  dialog.querySelector('.form-error').textContent = '';
  const fields = [
    ['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true],
    ['apellido_materno', 'Apellido materno', 'text'], ['correo', 'Correo', 'email', true],
    ['telefono', 'Teléfono', 'tel'], ['password', 'Nueva contraseña (opcional)', 'password'],
  ].map((definition) => {
    const element = renderField(definition);
    const input = element.querySelector('input, textarea, select');
    input.value = record[definition[0]] ?? '';
    return element;
  });
  dialog.querySelector('.workflow-fields').replaceChildren(...fields);
  dialog.showModal();
}

// Abre el formulario de edicion de una cuenta de usuario.
function openUserEdit(id) {
  const record = records.users.find((user) => String(user.id_usuario) === String(id));
  if (!record) {
    showToast('No se encontró el usuario seleccionado. Recarga la lista e inténtalo de nuevo.', true);
    return;
  }
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'user-edit';
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Editar usuario o administrador';
  dialog.querySelector('.form-error').textContent = '';
  const fields = [
    ['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true],
    ['apellido_materno', 'Apellido materno', 'text'], ['correo', 'Correo', 'email', true],
    ['telefono', 'Teléfono', 'tel'], ['password', 'Nueva contraseña (opcional)', 'password'],
    ['rol', 'Función', 'select', true, [
      { id: 'cliente', nombre: 'Cliente' },
      { id: 'usuario', nombre: 'Usuario' },
      { id: 'vendedor', nombre: 'Vendedor' },
      { id: 'administrador', nombre: 'Administrador' },
    ]],
  ].map((definition) => {
    const element = renderField(definition);
    const input = element.querySelector('input, textarea, select');
    if (definition[0] === 'rol') input.value = record.rol === 'admin' ? 'administrador' : record.rol;
    else input.value = record[definition[0]] ?? '';
    return element;
  });
  dialog.querySelector('.workflow-fields').replaceChildren(...fields);
  dialog.showModal();
}

// Permite cambiar la activacion de una cuenta de usuario.
function openUserStatus(id) {
  const record = records.users.find((user) => String(user.id_usuario) === String(id));
  if (!record) {
    showToast('No se encontró el usuario seleccionado. Recarga la lista e inténtalo de nuevo.', true);
    return;
  }
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'user-status';
  form.dataset.resource = 'users';
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Actualizar estado del usuario / administrador';
  dialog.querySelector('.form-error').textContent = '';
  const field = renderField(['activo', 'Estado', 'select', true, [
    { id: 'true', nombre: 'Activo' }, { id: 'false', nombre: 'Inactivo' },
  ]]);
  field.querySelector('select').value = String(record.activo !== false);
  dialog.querySelector('.workflow-fields').replaceChildren(field);
  dialog.showModal();
}

// Permite activar o desactivar una cuenta de vendedor.
function openSellerStatus(id) {
  const record = records.sellers.find((seller) => String(seller.id_usuario) === String(id));
  if (!record) {
    showToast('No se encontró el vendedor seleccionado. Recarga la lista e inténtalo de nuevo.', true);
    return;
  }
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'user-status';
  form.dataset.resource = 'sellers';
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Actualizar estado del vendedor';
  dialog.querySelector('.form-error').textContent = '';
  const field = renderField(['activo', 'Estado', 'select', true, [
    { id: 'true', nombre: 'Activo' }, { id: 'false', nombre: 'Inactivo' },
  ]]);
  field.querySelector('select').value = String(record.activo !== false);
  dialog.querySelector('.workflow-fields').replaceChildren(field);
  dialog.showModal();
}

// Permite activar o desactivar un cliente sin eliminar su historial.
function openClientStatus(id) {
  const record = records.clients.find((client) => String(client.id_cliente) === String(id));
  if (!record) {
    showToast('No se encontró el cliente seleccionado.', true);
    return;
  }
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'client-status';
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Actualizar estado del cliente';
  dialog.querySelector('.form-error').textContent = '';
  const field = renderField(['activo', 'Estado', 'select', true, [
    { id: 'true', nombre: 'Activo' }, { id: 'false', nombre: 'Inactivo' },
  ]]);
  field.querySelector('select').value = String(record.activo !== false);
  dialog.querySelector('.workflow-fields').replaceChildren(field);
  dialog.showModal();
}

// Presenta el historial, seguimiento y permisos de documentos de un cliente.
function formatHistoryDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString('es-MX');
}

// Crea de forma diferida el dialogo donde se muestra el historial del cliente.
function ensureClientHistoryDialog() {
  let dialog = document.getElementById('client-history-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'client-history-dialog';
  dialog.className = 'workflow-dialog history-dialog';
  dialog.innerHTML = `
    <div class="history-dialog-content">
      <div class="workflow-dialog-heading"><h2>Historial del cliente</h2><button type="button" class="icon-button" data-history-close aria-label="Cerrar">×</button></div>
      <div id="client-history-content"></div>
      <p class="form-error" id="client-history-error" role="alert"></p>
    </div>`;
  document.body.append(dialog);
  return dialog;
}

// Combina eventos comerciales y tareas para construir la linea de tiempo.
function renderClientHistory(payload) {
  const client = payload.client;
  const history = [
    ...payload.timeline,
    ...payload.activities.map((activity) => ({
      id: activity.id_seguimiento,
      tipo: activity.tipo === 'tarea' ? 'Tarea de seguimiento' : 'Nota',
      contenido: activity.contenido,
      fecha: activity.creado_en,
      estado: activity.estado,
      fecha_limite: activity.fecha_limite,
      asignado: activity.asignado,
      seguimiento: activity.tipo === 'tarea',
    })),
  ].sort((left, right) => new Date(right.fecha) - new Date(left.fecha));
  const currentUserIsAdmin = isCurrentUserAdmin();
  return `
    <section class="history-client-summary">
      <strong>${escapeHtml(`${client.nombre} ${client.apellido_paterno} ${client.apellido_materno || ''}`.trim())}</strong>
      <span>${escapeHtml(client.correo)}${client.telefono ? ` · ${escapeHtml(client.telefono)}` : ''}</span>
    </section>
    <form id="client-activity-form" data-client-id="${escapeHtml(client.id_cliente)}">
      <h3>Agregar nota o seguimiento</h3>
      <div class="history-form-grid">
        <label>Tipo<select name="tipo"><option value="nota">Nota</option><option value="tarea">Tarea</option></select></label>
        <label data-task-date hidden>Fecha límite<input name="fecha_limite" type="datetime-local" disabled></label>
        <label class="history-assignee">Asignar a<select name="asignado_a"><option value="">Sin asignar</option>${optionData.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.nombre)}</option>`).join('')}</select></label>
        <label class="history-content">Nota o tarea<textarea name="contenido" rows="2" required maxlength="2000"></textarea></label>
      </div>
      <div class="workflow-dialog-actions"><button class="primary-button" type="submit">Guardar seguimiento</button></div>
    </form>
    <section class="history-section"><h3>Actividad</h3>
      ${history.length ? `<ol class="client-timeline">${history.map((item) => `
        <li><div><strong>${escapeHtml(item.tipo)}</strong><small>${escapeHtml(formatHistoryDate(item.fecha))}${item.asignado ? ` · Asignado a ${escapeHtml(item.asignado)}` : ''}${item.fecha_limite ? ` · Límite ${escapeHtml(formatHistoryDate(item.fecha_limite))}` : ''}</small><p>${escapeHtml(item.contenido)}</p></div>
          ${item.seguimiento && item.estado === 'pendiente' ? `<button type="button" class="text-button" data-complete-followup="${escapeHtml(item.id)}" data-client-id="${escapeHtml(client.id_cliente)}">Completar</button>` : ''}
        </li>`).join('')}</ol>` : '<p class="empty-records">Aún no hay actividad registrada.</p>'}
    </section>
    <section class="history-section"><h3>Documentos de rentas activas</h3>
      ${payload.documents.length ? `<ul class="history-document-list">${payload.documents.map((documentRecord) => `
        <li><span><strong>${escapeHtml(documentRecord.nombre_archivo)}</strong><small>${escapeHtml(documentRecord.tipo)}</small></span>
          ${currentUserIsAdmin ? `<button type="button" class="text-button" data-client-doc-toggle="${escapeHtml(documentRecord.id_documento)}" data-client-id="${escapeHtml(client.id_cliente)}" data-authorized="${documentRecord.autorizado}">${documentRecord.autorizado ? 'Revocar acceso' : 'Dar acceso'}</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="empty-records">No hay documentos asociados a una renta activa.</p>'}
    </section>`;
}

// Consulta y presenta el historial privado de un cliente seleccionado.
async function openClientHistory(id) {
  const dialog = ensureClientHistoryDialog();
  const content = dialog.querySelector('#client-history-content');
  const error = dialog.querySelector('#client-history-error');
  content.innerHTML = '<p class="empty-records">Cargando historial...</p>';
  error.textContent = '';
  dialog.showModal();
  try {
    const result = await api.get(`clients/${id}/history`);
    content.innerHTML = renderClientHistory(result.data);
  } catch (requestError) {
    error.textContent = requestError.message;
    content.replaceChildren();
  }
}

// Permite al administrador definir la contrasena inicial del portal de inquilinos.
function openClientCredentials(id) {
  const dialog = ensureDialog();
  const form = dialog.querySelector('#workflow-form');
  form.dataset.kind = 'client-credentials';
  form.dataset.recordId = id;
  dialog.querySelector('h2').textContent = 'Configurar acceso al portal de inquilinos';
  dialog.querySelector('.form-error').textContent = '';
  const field = renderField(['password', 'Contraseña inicial (mínimo 12 caracteres)', 'password', true]);
  field.querySelector('input').autocomplete = 'new-password';
  dialog.querySelector('.workflow-fields').replaceChildren(field);
  dialog.showModal();
}

// Valida y envia los formularios del sistema segun el tipo de operacion.
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
      if (form.dataset.resource === 'maintenance') {
        if (values.costo_final === '') delete values.costo_final;
        else values.costo_final = Number(values.costo_final);
        values.asignado_a = values.asignado_a || null;
      }
      await api.update(form.dataset.resource, form.dataset.recordId, values);
    } else if (kind === 'user-status') {
      const values = Object.fromEntries(new FormData(form));
      values.activo = values.activo === 'true';
      await api.request(`/api/workflows/users/${form.dataset.recordId}`, { method: 'PATCH', body: JSON.stringify(values) });
    } else if (kind === 'client-status') {
      const values = Object.fromEntries(new FormData(form));
      values.activo = values.activo === 'true';
      await api.request(`/api/workflows/clients/${form.dataset.recordId}`, { method: 'PATCH', body: JSON.stringify(values) });
    } else if (kind === 'client-credentials') {
      const values = Object.fromEntries(new FormData(form));
      await api.request(`/api/workflows/clients/${form.dataset.recordId}/credentials`, {
        method: 'PATCH',
        body: JSON.stringify(values),
      });
    } else if (kind === 'property-edit') {
      const values = Object.fromEntries(new FormData(form));
      values.precio = Number(values.precio);
      ['latitud', 'longitud'].forEach((key) => {
        if (values[key] === '') delete values[key];
        else if (values[key] !== undefined) values[key] = Number(values[key]);
      });
      if (!values.id_categoria) delete values.id_categoria;
      await api.request(`/api/properties/${form.dataset.recordId}`, { method: 'PUT', body: JSON.stringify(values) });
    } else if (kind === 'seller-edit') {
      const values = Object.fromEntries(new FormData(form));
      if (!values.password) delete values.password;
      await api.request(`/api/workflows/users/${form.dataset.recordId}`, { method: 'PATCH', body: JSON.stringify(values) });
    } else if (kind === 'user-edit') {
      const values = Object.fromEntries(new FormData(form));
      if (!values.password) delete values.password;
      await api.request(`/api/workflows/users/${form.dataset.recordId}`, { method: 'PATCH', body: JSON.stringify(values) });
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

// Resuelve acciones principales de cada vista, como abrir formularios o exportar.
async function handlePageAction(button) {
  const view = button.closest('.view');
  if (!view) return;
  const viewId = view.id;
  const action = {
    'dashboard-view': 'property', 'properties-view': 'property', 'clients-view': 'client',
    'visits-view': 'visit', 'contracts-view': 'offer', 'legal-view': 'document',
    'sellers-view': 'seller',
    'users-view': 'user',
  }[viewId];
  if (action) return openForm(action);
  if (viewId === 'portal-view') return window.open('/portal.html', '_blank', 'noopener');
  if (viewId === 'rents-view') return openForm('payment');
  if (viewId === 'finance-view') return downloadCsv('commissions');
  if (viewId === 'reports-view') return downloadCsv('reports');
}

// Gestiona el inicio de sesion y los eventos delegados de las tablas y ventanas.
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
    startNotificationPolling();
    await loadWorkspace();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});

document.addEventListener('click', async (event) => {
  const filter = event.target.closest('[data-record-filter]');
  if (filter) return;
  const openViewButton = event.target.closest('[data-open-view]');
  if (openViewButton) {
    const navigationButton = [...document.querySelectorAll('.nav-item')]
      .find((item) => item.dataset.view === openViewButton.dataset.openView);
    navigationButton?.click();
    return;
  }
  const profileButton = event.target.closest('.profile-row, [title="Mi perfil"]');
  if (profileButton) {
    const menu = document.querySelector('.session-menu');
    if (menu) {
      menu.hidden = !menu.hidden;
      profileButton.setAttribute('aria-expanded', String(!menu.hidden));
    }
    return;
  }
  const sessionAction = event.target.closest('[data-session-action]');
  if (sessionAction) {
    const message = sessionAction.dataset.sessionAction === 'suspend'
      ? '¿Suspender la sesión actual?'
      : '¿Salir de la sesión actual?';
    if (window.confirm(message)) {
      api.logout();
      document.querySelector('.session-menu')?.setAttribute('hidden', '');
      showLogin();
    }
    return;
  }
  const closeButton = event.target.closest('[data-dialog-close]');
  if (closeButton) return closeButton.closest('dialog').close();
  if (event.target.closest('[data-history-close]')) return document.getElementById('client-history-dialog')?.close();
  const historyButton = event.target.closest('[data-client-history]');
  if (historyButton) return openClientHistory(historyButton.dataset.clientHistory);
  const credentialsButton = event.target.closest('[data-client-credentials]');
  if (credentialsButton) return openClientCredentials(credentialsButton.dataset.clientCredentials);
  const completeFollowupButton = event.target.closest('[data-complete-followup]');
  if (completeFollowupButton) {
    try {
      await api.request(`/api/workflows/clients/${completeFollowupButton.dataset.clientId}/activities/${completeFollowupButton.dataset.completeFollowup}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: 'completada' }),
      });
      await openClientHistory(completeFollowupButton.dataset.clientId);
    } catch (error) {
      document.getElementById('client-history-error').textContent = error.message;
    }
    return;
  }
  const documentAccessButton = event.target.closest('[data-client-doc-toggle]');
  if (documentAccessButton) {
    const { clientId, clientDocToggle: documentId, authorized } = documentAccessButton.dataset;
    try {
      await api.request(`/api/workflows/clients/${clientId}/documents/${documentId}`, {
        method: authorized === 'true' ? 'DELETE' : 'POST',
      });
      await openClientHistory(clientId);
    } catch (error) {
      document.getElementById('client-history-error').textContent = error.message;
    }
    return;
  }
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
  const propertyMapButton = event.target.closest('[data-property-map]');
  if (propertyMapButton) {
    const mapWindow = window.open('', '_blank');
    try {
      const result = await api.get(`properties/${propertyMapButton.dataset.propertyMap}/map`);
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
  const paymentReceiptButton = event.target.closest('[data-payment-receipt]');
  if (paymentReceiptButton) return downloadPaymentReceipt(paymentReceiptButton.dataset.paymentReceipt);
  const recordButton = event.target.closest('[data-record-action]');
  if (recordButton) {
    const { recordAction: action, resource, recordId } = recordButton.dataset;
    if (action === 'edit' && resource === 'properties') return openPropertyEdit(recordId);
    if (action === 'edit' && resource === 'sellers') return openSellerEdit(recordId);
    if (action === 'edit' && resource === 'users') return openUserEdit(recordId);
    if (action === 'status' && resource === 'users') return openUserStatus(recordId);
    if (action === 'status' && resource === 'sellers') return openSellerStatus(recordId);
    if (action === 'status' && resource === 'clients') return openClientStatus(recordId);
    if (action === 'map' && resource === 'properties') {
      const mapWindow = window.open('', '_blank');
      try {
        const result = await api.get(`properties/${recordId}/map`);
        if (mapWindow) mapWindow.location.href = result.data.google_maps_url;
        else window.location.href = result.data.google_maps_url;
      } catch (error) {
        mapWindow?.close();
        showToast(error.message, true);
      }
      return;
    }
    if (action === 'delete' && resource === 'sellers') {
      if (!window.confirm('¿Eliminar este vendedor? Esta acción no se puede deshacer.')) return;
      try {
        await api.request(`/api/workflows/users/${recordId}`, { method: 'DELETE' });
        showToast('Vendedor eliminado.');
        await loadWorkspace();
      } catch (error) { showToast(error.message, true); }
      return;
    }
    if (action === 'delete' && resource === 'properties') {
      if (!window.confirm('¿Borrar esta propiedad? Dejará de aparecer en el listado.')) return;
      try {
        await api.request(`/api/properties/${recordId}`, { method: 'DELETE' });
        showToast('Propiedad borrada.');
        await loadWorkspace();
      } catch (error) { showToast(error.message, true); }
      return;
    }
    if (action === 'delete' && resource === 'users') {
      if (!window.confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
      try {
        await api.request(`/api/workflows/users/${recordId}`, { method: 'DELETE' });
        showToast('Usuario eliminado.');
        await loadWorkspace();
      } catch (error) { showToast(error.message, true); }
      return;
    }
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
  const notificationButton = event.target.closest('[title="Notificaciones"]');
  if (notificationButton) {
    const menu = document.getElementById('notification-menu');
    if (menu) {
      menu.hidden = !menu.hidden;
      notificationButton.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) loadNotifications();
    }
    return;
  }
  const notificationItem = event.target.closest('[data-notification-id]');
  if (notificationItem) {
    try {
      await api.request(`/api/workflows/notifications/${notificationItem.dataset.notificationId}/read`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      const destination = {
        leads: 'clients', visits: 'visits', payments: 'rents', rentals: 'rents',
        maintenance: 'maintenance', clients: 'clients',
      }[notificationItem.dataset.entity];
      await loadNotifications();
      document.getElementById('notification-menu').hidden = true;
      if (destination) document.querySelector(`.nav-item[data-view="${destination}"]`)?.click();
    } catch (error) {
      showToast(error.message, true);
    }
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
  if (event.target.id === 'client-activity-form') {
    event.preventDefault();
    submitClientActivity(event.target);
  }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('#client-activity-form [name="tipo"]')) {
    const form = event.target.form;
    const dueDate = form.querySelector('[data-task-date]');
    const input = dueDate.querySelector('input');
    const isTask = event.target.value === 'tarea';
    dueDate.hidden = !isTask;
    input.disabled = !isTask;
    input.required = isTask;
  }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-record-filter]')) applyRecordFilter(event.target);
  if (event.target.matches('[data-property-category]')) applyPropertyFilters(event.target.closest('.persisted-panel'));
  if (event.target.matches('[data-record-date]')) {
    const panel = event.target.closest('.persisted-panel');
    const resource = panel?.dataset.recordPanel;
    if (resource) {
      const state = recordFilters[resource] || (recordFilters[resource] = { search: '', from: '', to: '' });
      state[event.target.dataset.recordDate] = event.target.value;
      if (resource === 'properties') applyPropertyFilters(panel);
      else applyRecordFilters(panel, resource);
    }
  }
  if (event.target.matches('[data-report-date]')) {
    reportDateFilter[event.target.dataset.reportDate] = event.target.value;
    if (reportDateFilter.from && reportDateFilter.to && reportDateFilter.from > reportDateFilter.to) {
      showToast('La fecha inicial no puede ser posterior a la fecha final.', true);
    }
    renderRecords('reports', 'reports-view', records.reports);
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-record-search]')) {
    const panel = event.target.closest('.persisted-panel');
    const resource = event.target.dataset.recordSearch;
    const state = recordFilters[resource] || (recordFilters[resource] = { search: '', from: '', to: '' });
    state.search = event.target.value;
    applyRecordFilters(panel, resource);
  }
  if (event.target.matches('[data-property-search]')) applyPropertyFilters(event.target.closest('.persisted-panel'));
});

const search = document.getElementById('global-search');
search?.addEventListener('input', () => {
  const query = search.value.toLocaleLowerCase();
  document.querySelectorAll('.persisted-panel tbody tr, #property-table tbody tr').forEach((row) => {
    row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
  });
  document.querySelectorAll('.persisted-panel[data-record-panel]').forEach((panel) => {
    paginatePanel(panel, panel.dataset.recordPanel, true);
  });
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page-nav]');
  if (!button) return;
  const panel = button.closest('.persisted-panel');
  const resource = panel?.dataset.recordPanel;
  if (!resource) return;
  tablePages[resource] = (tablePages[resource] || 1) + (button.dataset.pageNav === 'next' ? 1 : -1);
  paginatePanel(panel, resource);
});

if (api.token) {
  hideLogin();
  addSecondaryActions();
  startNotificationPolling();
  loadWorkspace();
} else {
  showLogin();
}
