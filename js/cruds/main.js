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
      if (payload.user.rol === 'cliente') {
        localStorage.setItem('habita_tenant_token', payload.token);
        this.token = null;
        localStorage.removeItem('habita_token');
        localStorage.removeItem('habita_user');
        return payload.user;
      }
      this.token = payload.token;
      localStorage.setItem('habita_token', this.token);
      localStorage.setItem('habita_user', JSON.stringify(payload.user));
      return payload.user;
    });
  },
  async getAllPages(url, pageSize = 200) {
    const separator = url.includes('?') ? '&' : '?';
    const first = await this.request(`${url}${separator}page=1&limit=${pageSize}`);
    if (!first.meta) return first;
    const rows = [...first.data];
    const remaining = [];
    for (let page = 2; page <= first.meta.totalPages; page += 1) {
      remaining.push(this.request(`${url}${separator}page=${page}&limit=${pageSize}`));
    }
    const pages = await Promise.all(remaining);
    pages.forEach((payload) => rows.push(...payload.data));
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
const formatCommissionMoney = (value) => Number(value).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
const optionData = { clients: [], properties: [], users: [], sellers: [], categories: [], leads: [], rentals: [] };
// Conserva en memoria los registros que alimentan las vistas y sus formularios.
const records = {
  properties: [], clients: [], leads: [], visits: [], matches: [], documents: [], offers: [],
  sales: [], commissions: [], rentals: [], payments: [], maintenance: [], contracts: [], sellers: [], reports: [],
  users: [], activity: [],
};
const reportDateFilter = { from: '', to: '' };
const propertyFilters = { search: '', category: '', exactId: '' };
const recordFilters = {};
const matchingState = { page: 1, search: '', requestId: 0, filters: {}, generatedAt: null };
const visitCalendarState = { mode: 'week', date: new Date() };
const MATCHING_EMAIL_ACCOUNT = 'saul391302@gmail.com';
const dashboardPropertyColumns = [
  ['titulo', 'Propiedad'], ['categoria', 'Tipo'], ['estado_propiedad', 'Estado'],
  ['precio', 'Precio'], ['agente', 'Responsable'],
];

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
  properties: { title: 'Propiedades registradas', columns: [['titulo', 'Propiedad'], ['categoria', 'Categoría'], ['tipo_operacion', 'Operación'], ['precio', 'Precio'], ['estado_propiedad', 'Estado']], actions: ['edit', 'delete', 'map'] },
  clients: { title: 'Clientes', columns: [['nombre', 'Nombre'], ['apellido_paterno', 'Apellido'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['ciudad', 'Ciudad'], ['activo', 'Estado'], ['fecha_registro', 'Fecha de registro']], actions: ['history', 'portal-access', 'status'] },
  leads: { title: 'Clientes potenciales', columns: [['nombre', 'Cliente potencial'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['origen', 'Origen'], ['estado', 'Estado'], ['creado_en', 'Fecha de registro']], actions: ['status'] },
  visits: { title: 'Agenda de visitas', columns: [['fecha_cita', 'Fecha'], ['cliente', 'Cliente'], ['propiedad', 'Propiedad'], ['agente', 'Agente'], ['estado', 'Estado']], actions: ['status'] },
  matches: { title: 'Coincidencias guardadas', columns: [['lead', 'Cliente potencial'], ['propiedad', 'Propiedad'], ['puntuacion', 'Puntuación'], ['creada_en', 'Fecha']] },
  documents: { title: 'Expedientes y resguardos', columns: [['nombre_archivo', 'Documento'], ['tipo', 'Tipo'], ['estado', 'Estado'], ['tamano_bytes', 'Tamaño'], ['creado_en', 'Fecha']], actions: ['download'] },
  offers: { title: 'Ofertas', columns: [['propiedad', 'Propiedad'], ['cliente', 'Usuario'], ['monto', 'Monto'], ['tipo', 'Tipo'], ['estado', 'Estado']], actions: ['status'] },
  sales: { title: 'Ventas cerradas', columns: [['propiedad', 'Propiedad'], ['cliente', 'Cliente'], ['precio_venta', 'Precio'], ['fecha_venta', 'Fecha']] },
  commissions: { title: 'Comisiones', columns: [['vendedor', 'Vendedor'], ['cliente', 'Cliente'], ['propiedad', 'Propiedad'], ['porcentaje_agencia', '% comisión'], ['monto_operacion', 'Valor propiedad'], ['monto_total', 'Comisión'], ['estado', 'Pago'], ['es_demo', 'Registro'], ['creado_en', 'Fecha']], actions: ['status'] },
  rentals: { title: 'Contratos de renta', columns: [['propiedad', 'Propiedad'], ['cliente', 'Cliente'], ['renta_mensual', 'Renta mensual'], ['fecha_inicio', 'Inicio'], ['fecha_fin', 'Fin'], ['estado', 'Estado']], actions: ['status'] },
  payments: { title: 'Cobros de renta', columns: [['propiedad', 'Propiedad'], ['cliente', 'Cliente'], ['periodo', 'Periodo'], ['monto', 'Monto'], ['estado', 'Estado'], ['pagado_en', 'Pagado']] , actions: ['status', 'receipt'] },
  maintenance: { title: 'Solicitudes de mantenimiento', columns: [['propiedad', 'Propiedad'], ['titulo', 'Solicitud'], ['descripcion', 'Descripción'], ['solicitante', 'Solicitante'], ['prioridad', 'Prioridad'], ['estado', 'Estado'], ['asignado', 'Responsable'], ['costo_estimado', 'Costo estimado'], ['costo_final', 'Costo final'], ['fecha_limite', 'Fecha límite']], actions: ['status'] },
  contracts: { title: 'Contratos registrados', columns: [['tipo_operacion', 'Operación'], ['cliente', 'Cliente'], ['vendedor', 'Vendedor'], ['propiedad', 'Lote'], ['precio_total', 'Precio'], ['superficie_m2', 'Superficie m²'], ['fecha_contrato', 'Fecha']], actions: ['document', 'map'] },
  sellers: { title: 'Vendedores', columns: [['nombre', 'Nombre'], ['apellido_paterno', 'Apellido'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['rol', 'Rol'], ['activo', 'Estado'], ['comision_mes', 'Comisión del mes']], actions: ['edit', 'status', 'delete'] },
  users: { title: 'Usuarios y administradores', columns: [['nombre', 'Nombre'], ['apellido_paterno', 'Apellido'], ['correo', 'Correo'], ['telefono', 'Teléfono'], ['rol', 'Función'], ['activo', 'Estado'], ['fecha_registro', 'Fecha de registro']], actions: ['edit', 'status', 'delete'] },
  reports: { title: 'Reportes de vendedores', columns: [['vendedor', 'Vendedor'], ['cobros', 'Monto'], ['operacion', 'Operación'], ['propiedad', 'Propiedad'], ['fecha', 'Fecha'], ['actividad', 'Actividad']], actions: ['report-pdf'] },
};
let clientTableTab = 'todos';
let contractTableTab = 'contracts';
let maintenancePriorityTab = 'todas';
const tableColumns = {
  clients: new Set(['nombre', 'correo', 'telefono', 'activo', 'fecha_registro']),
  leads: new Set(['nombre', 'correo', 'telefono', 'estado', 'creado_en']),
};

function getTableColumns(resource, columns) {
  if (!tableColumns[resource]) tableColumns[resource] = new Set(columns.map(([key]) => key));
  return tableColumns[resource];
}

function syncTableColumnControls(scope, resource, columns) {
  const visible = getTableColumns(resource, columns);
  scope.querySelectorAll('[data-column-key]').forEach((cell) => {
    cell.hidden = !visible.has(cell.dataset.columnKey);
  });
  scope.querySelectorAll('[data-table-column]').forEach((input) => {
    input.checked = visible.has(input.dataset.tableColumn);
  });
}

function setTableColumnVisibility(scope, resource, columns, key, isVisible) {
  if (!columns.some(([columnKey]) => columnKey === key)) return;
  const visible = getTableColumns(resource, columns);
  if (isVisible) visible.add(key);
  else visible.delete(key);
  syncTableColumnControls(scope, resource, columns);
}

// Define los campos y recursos asociados a cada formulario del sistema.
const forms = {
  property: { title: 'Nueva propiedad', resource: 'properties', fields: [
    ['', 'Datos de la propiedad', 'section'],
    ['titulo', 'Título', 'text', true], ['categoria', 'Categoría', 'options', true, 'categories', false], ['tipo_operacion', 'Operación', 'select', true, ['VENTA', 'RENTA'], false],
    ['costo_adquisicion', 'Costo de adquisición', 'number', true],
    ['precio', 'Precio de venta o renta', 'number', true], ['descripcion', 'Descripción', 'textarea'],
    ['', 'Características', 'section'],
    ['superficie', 'Superficie m²', 'number'],
    ['habitaciones', 'Habitaciones', 'number'], ['banos', 'Baños', 'number'], ['estacionamientos', 'Estacionamientos', 'number'],
    ['', 'Ubicación', 'section'],
    ['calle', 'Calle', 'text', true], ['numero', 'Número', 'text'], ['colonia', 'Colonia', 'text'], ['ciudad', 'Ciudad', 'text', true], ['estado', 'Estado', 'text', true], ['codigo_postal', 'Código postal', 'text'],
    ['ubicacion_mapa', 'Ubicación en Google Maps', 'map'],
    ['', 'Fotografía', 'section'],
    ['imagen', 'Imagen de la propiedad (JPEG, PNG o WebP; máximo 10 MB)', 'file'],
  ] },
  client: { title: 'Nuevo cliente', resource: 'clients', fields: [
    ['', 'Datos personales', 'section'],
    ['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true], ['apellido_materno', 'Apellido materno', 'text'], ['curp', 'CURP', 'text'],
    ['', 'Contacto', 'section'],
    ['correo', 'Correo', 'email', true], ['telefono', 'Teléfono', 'tel'],
    ['', 'Domicilio', 'section'],
    ['direccion', 'Dirección', 'text'], ['ciudad', 'Ciudad', 'text'], ['estado', 'Estado', 'text'], ['codigo_postal', 'Código postal', 'text'],
  ] },
  lead: { title: 'Nuevo cliente potencial', resource: 'leads', fields: [
    ['', 'Contacto', 'section'],
    ['nombre', 'Nombre', 'text', true], ['correo', 'Correo', 'email'], ['telefono', 'Teléfono', 'tel'],
    ['', 'Preferencias de búsqueda', 'section'],
    ['ciudad', 'Ciudad preferida', 'text'], ['tipo', 'Categoría', 'text'], ['operacion', 'Operación', 'select', false, ['VENTA', 'RENTA']],
    ['precio_min', 'Precio mínimo', 'number'], ['precio_max', 'Precio máximo', 'number'], ['habitaciones_min', 'Habitaciones mínimas', 'number'],
  ] },
  visit: { title: 'Agendar visita', resource: 'visits', fields: [['id_cliente', 'Cliente', 'options', true, 'clients'], ['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['fecha_cita', 'Fecha y hora', 'datetime-local', true], ['motivo', 'Motivo', 'text']] },
  offer: { title: 'Registrar oferta', resource: 'offers', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['monto', 'Monto ofrecido', 'number', true], ['tipo', 'Tipo de oferta', 'select', true, ['OFERTA', 'CONTRAPROPUESTA']], ['notas', 'Notas', 'textarea']] },
  document: { title: 'Cargar resguardo', resource: 'documents', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['tipo', 'Tipo de documento', 'select', true, ['Escritura', 'Identificación', 'Predial', 'Contrato', 'Otro']], ['archivo', 'Archivo (PDF, DOC o imagen; máximo 10 MB)', 'file', true]] },
  sale: { title: 'Cerrar venta', resource: 'sales', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['id_cliente', 'Cliente', 'options', true, 'clients'], ['id_agente', 'Agente responsable', 'options', true, 'users'], ['precio_venta', 'Precio de cierre', 'number', true], ['fecha_venta', 'Fecha de cierre', 'date']] },
  commission: { title: 'Registrar comisión', resource: 'commissions', fields: [['id_agente_vendedor', 'Vendedor', 'options', true, 'sellers'], ['id_cliente', 'Cliente', 'options', true, 'clients'], ['id_propiedad', 'Propiedad', 'options', true, 'properties']] },
  rental: { title: 'Nueva renta', resource: 'rentals', fields: [['id_propiedad', 'Propiedad', 'options', true, 'properties'], ['id_cliente', 'Cliente', 'options', true, 'clients'], ['renta_mensual', 'Renta mensual', 'number', true], ['fecha_inicio', 'Fecha de inicio', 'date', true], ['fecha_fin', 'Fecha de término', 'date']] },
  maintenance: { title: 'Nueva solicitud de mantenimiento', resource: 'maintenance', fields: [
    ['', 'Inmueble', 'section'],
    ['id_propiedad', 'Propiedad', 'options', true, 'properties'],
    ['id_renta', 'Contrato de renta (opcional)', 'options', false, 'rentals'],
    ['', 'Solicitud', 'section'],
    ['titulo', 'Asunto', 'text', true], ['descripcion', 'Descripción', 'textarea', true],
    ['prioridad', 'Prioridad', 'select', true, [{ id: 'automatica', nombre: 'Automática según fecha límite' }, 'baja', 'normal', 'alta', 'urgente']],
    ['asignado_a', 'Asignar a', 'options', false, 'users'],
    ['', 'Costo y plazo', 'section'],
    ['costo_estimado', 'Costo estimado', 'number'], ['fecha_limite', 'Fecha límite', 'date'],
  ] },
  payment: { title: 'Registrar cobro', resource: 'payments', fields: [['id_renta', 'Contrato de renta', 'options', true, 'rentals'], ['periodo', 'Periodo de pago', 'date', true], ['monto', 'Monto recibido', 'number', true], ['estado', 'Estado del pago', 'select', true, ['PAGADO', 'PENDIENTE']]] },
  seller: { title: 'Agregar vendedor', resource: 'users', fields: [
    ['', 'Datos personales', 'section'],
    ['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true], ['apellido_materno', 'Apellido materno', 'text'],
    ['', 'Contacto y acceso', 'section'],
    ['correo', 'Correo', 'email', true], ['telefono', 'Teléfono', 'tel'], ['password', 'Contraseña inicial (mínimo 12 caracteres)', 'password', true], ['rol', 'Función', 'select', true, [{ id: 'vendedor', nombre: 'Vendedor' }]],
  ] },
  user: { title: 'Agregar usuario o administrador', resource: 'users', fields: [
    ['', 'Datos personales', 'section'],
    ['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true], ['apellido_materno', 'Apellido materno', 'text'],
    ['', 'Contacto y acceso', 'section'],
    ['correo', 'Correo', 'email', true], ['telefono', 'Teléfono', 'tel'], ['password', 'Contraseña inicial (mínimo 12 caracteres)', 'password', true], ['rol', 'Función', 'select', true, [{ id: 'usuario', nombre: 'Usuario' }, { id: 'administrador', nombre: 'Administrador' }]],
  ] },
  contract: { title: 'Registrar cliente y contrato', resource: 'contracts', fields: [
    ['', 'Operación y propiedad', 'section'],
    ['tipo_operacion', 'Tipo de operación', 'select', true, ['VENTA', 'RENTA'], false],
    ['id_propiedad', 'Lote / propiedad', 'options', true, 'properties'],
    ['fecha_contrato', 'Fecha del contrato', 'date'],
    ['', 'Datos del cliente', 'section'],
    ['id_cliente', 'Cliente', 'select', true, [{ id: 'nuevo', nombre: 'Registrar nuevo cliente' }, ...optionData.clients], 'combobox'],
    ['cliente_nombre', 'Nombre del cliente', 'text', true], ['cliente_apellido_paterno', 'Apellido paterno', 'text', true],
    ['cliente_apellido_materno', 'Apellido materno', 'text'], ['cliente_correo', 'Correo del cliente', 'email', true],
    ['cliente_telefono', 'Teléfono', 'tel'], ['cliente_curp', 'CURP', 'text'],
    ['cliente_direccion', 'Domicilio del cliente', 'text'], ['cliente_ciudad', 'Ciudad del cliente', 'text'],
    ['cliente_estado', 'Estado del cliente', 'text'], ['cliente_codigo_postal', 'Código postal del cliente', 'text'],
    ['', 'Condiciones de la operación', 'section'],
    ['precio_total', 'Precio total acordado', 'number', true],
    ['renta_mensual', 'Renta mensual', 'number'], ['fecha_inicio', 'Inicio de renta', 'date'],
    ['fecha_fin', 'Fin de renta', 'date'],
    ['', 'Medidas de la propiedad', 'section'],
    ['frente_metros', 'Medida de frente (m)', 'number', true], ['fondo_metros', 'Medida de fondo (m)', 'number', true],
    ['superficie_m2', 'Superficie total (m²)', 'number', true],
    ['', 'Ubicación y observaciones', 'section'],
    ['latitud', 'Latitud (obligatoria en venta)', 'number'], ['longitud', 'Longitud (obligatoria en venta)', 'number'],
    ['observaciones', 'Condiciones y observaciones', 'textarea'],
  ] },
};

const fieldRules = {
  nombre: { maxLength: 80, autocomplete: 'given-name', personName: true },
  apellido_paterno: { maxLength: 80, autocomplete: 'family-name', personName: true },
  apellido_materno: { maxLength: 80, personName: true },
  cliente_nombre: { maxLength: 80, personName: true },
  cliente_apellido_paterno: { maxLength: 80, personName: true },
  cliente_apellido_materno: { maxLength: 80, personName: true },
  cliente_correo: { maxLength: 254, autocomplete: 'email' },
  correo: { maxLength: 254, autocomplete: 'email' },
  cliente_telefono: { maxLength: 20, pattern: '[+]?[0-9() .-]{7,20}', autocomplete: 'tel' },
  telefono: { maxLength: 20, pattern: '[+]?[0-9() .-]{7,20}', autocomplete: 'tel' },
  curp: { maxLength: 18, pattern: '[A-Za-z]{4}[0-9]{6}[HhMm][A-Za-z]{5}[A-Za-z0-9][0-9]', transform: 'uppercase' },
  cliente_curp: { maxLength: 18, pattern: '[A-Za-z]{4}[0-9]{6}[HhMm][A-Za-z]{5}[A-Za-z0-9][0-9]', transform: 'uppercase' },
  codigo_postal: { maxLength: 5, pattern: '[0-9]{5}', inputmode: 'numeric' },
  cliente_codigo_postal: { maxLength: 5, pattern: '[0-9]{5}', inputmode: 'numeric' },
  titulo: { maxLength: 200 },
  descripcion: { maxLength: 2000 },
  observaciones: { maxLength: 2000 },
  motivo: { maxLength: 500 },
  notas: { maxLength: 2000 },
  direccion: { maxLength: 250 },
  cliente_direccion: { maxLength: 250 },
  imagen_url: { maxLength: 2048 },
  precio: { min: '0.01', max: '999999999999.99', step: '0.01' },
  costo_adquisicion: { min: '0.01', max: '999999999999.99', step: '0.01' },
  precio_total: { min: '0.01', max: '999999999999.99', step: '0.01' },
  precio_venta: { min: '0.01', max: '999999999999.99', step: '0.01' },
  renta_mensual: { min: '0.01', max: '999999999999.99', step: '0.01' },
  monto: { min: '0.01', max: '999999999999.99', step: '0.01' },
  monto_operacion: { min: '0.01', max: '999999999999.99', step: '0.01' },
  monto_total: { min: '0.01', max: '999999999999.99', step: '0.01' },
  costo_estimado: { min: '0', max: '999999999999.99', step: '0.01' },
  costo_final: { min: '0', max: '999999999999.99', step: '0.01' },
  precio_min: { min: '0', max: '999999999999.99', step: '0.01' },
  precio_max: { min: '0', max: '999999999999.99', step: '0.01' },
  porcentaje_agencia: { min: '0', max: '100', step: '0.01' },
  superficie: { min: '0.01', max: '999999.99', step: '0.01' },
  superficie_m2: { min: '0.01', max: '999999.99', step: '0.01' },
  frente_metros: { min: '0.01', max: '999999.99', step: '0.01' },
  fondo_metros: { min: '0.01', max: '999999.99', step: '0.01' },
  habitaciones: { min: '0', max: '100', step: '1' },
  banos: { min: '0', max: '100', step: '1' },
  estacionamientos: { min: '0', max: '100', step: '1' },
  habitaciones_min: { min: '0', max: '100', step: '1' },
  latitud: { min: '-90', max: '90', step: 'any' },
  longitud: { min: '-180', max: '180', step: 'any' },
  password: { minLength: 12, maxLength: 128, autocomplete: 'new-password' },
  archivo: { maxSize: 10 * 1024 * 1024 },
};

function applyFieldRules(input, name) {
  const rules = fieldRules[name] || {};
  Object.entries(rules).forEach(([key, value]) => {
    if (key === 'minLength') input.minLength = value;
    else if (key === 'maxLength') input.maxLength = value;
    else if (key === 'min' || key === 'max' || key === 'step') input[key] = value;
    else if (key === 'pattern') input.pattern = value;
    else if (key === 'autocomplete') input.autocomplete = value;
    else if (key === 'inputmode') input.inputMode = value;
    else if (key === 'maxSize') input.dataset.maxSize = String(value);
  });
  if (!rules.maxLength && ['text', 'email', 'tel', 'url', 'password'].includes(input.type)) input.maxLength = 200;
  if (input.tagName === 'TEXTAREA' && !rules.maxLength) input.maxLength = 2000;
  if (name === 'archivo') input.title = 'El archivo no debe superar 10 MB.';
  if (rules.pattern) input.title = name.includes('telefono')
    ? 'Usa de 7 a 20 caracteres: números, espacios, paréntesis, guiones o +.'
    : name.includes('codigo_postal')
      ? 'El código postal debe contener 5 dígitos.'
      : 'Captura un CURP válido de 18 caracteres.';
  if (input.required && ['text', 'email', 'tel', 'url', 'password'].includes(input.type)) {
    input.addEventListener('input', () => {
      if (!input.value.trim()) input.setCustomValidity('Este campo es obligatorio.');
      else if (!rules.personName) input.setCustomValidity('');
    });
  }
  if (input.tagName === 'TEXTAREA' && input.required) {
    input.addEventListener('input', () => {
      input.setCustomValidity(input.value.trim() ? '' : 'Este campo es obligatorio.');
    });
  }
  if (rules.personName) {
    input.addEventListener('input', () => {
      const value = input.value.trim();
      input.setCustomValidity((input.required && !value)
        ? 'Este campo es obligatorio.'
        : (value && !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(value)
          ? 'Usa únicamente letras, espacios, apóstrofos, puntos o guiones.'
          : ''));
    });
  }
  if (rules.transform === 'uppercase') {
    input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
  }
}

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
  const [name, label, type, required, options, searchable = true] = field;
  let input;
  if (type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else if (type === 'select' || type === 'options') {
    input = document.createElement('select');
    const values = type === 'options'
      ? (name === 'categoria' && options === 'categories'
        ? optionData.categories.map((item) => ({ id: item.nombre, nombre: item.nombre }))
        : optionData[options])
      : options.map((value) => typeof value === 'string' ? { id: value, nombre: value } : value);
    input.innerHTML = `<option value="">Selecciona...</option>${values.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nombre)}</option>`).join('')}`;
  } else {
    input = document.createElement('input');
    input.type = type;
    if (type === 'number') input.step = 'any';
    if (type === 'file') input.accept = name === 'imagen' ? 'image/jpeg,image/png,image/webp' : '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp';
  }
  input.name = name;
  input.required = Boolean(required);
  applyFieldRules(input, name);
  const wrapper = document.createElement('label');
  wrapper.className = 'workflow-field';
  wrapper.innerHTML = `<span>${escapeHtml(label)}${required ? ' <span class="workflow-required" aria-hidden="true">*</span>' : ''}</span>`;
  wrapper.append(input);
  if (type === 'options' && searchable || searchable === 'combobox') input.dataset.searchableSelect = 'true';
  return wrapper;
}

function enableWorkflowSearchableSelects(container) {
  container.querySelectorAll('select[data-searchable-select]').forEach((select) => {
    const label = select.closest('.workflow-field').querySelector('span').textContent.replace(/\s*\*$/, '');
    enableSearchableSelect(select, label);
  });
}

function coordinatesFromMapLocation(value) {
  const text = value.trim();
  const number = '[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const pair = new RegExp(`^\\s*(${number})\\s*,\\s*(${number})\\s*$`);
  let match = text.match(pair);
  if (!match) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !/(^|\.)google\.(?:[a-z]{2,3}\.)?[a-z]{2,3}$/i.test(url.hostname)
      || !url.pathname.startsWith('/maps')) return null;
    match = url.href.match(new RegExp(`!3d(${number})!4d(${number})(?:[!?#]|$)`));
    if (!match) {
      const query = url.searchParams.get('query') || url.searchParams.get('q') || url.searchParams.get('ll');
      if (query) match = query.match(pair);
    }
    if (!match) {
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return null;
      }
      match = pathname.match(new RegExp(`/maps/(?:place|search)/(${number})\\s*,\\s*(${number})(?:/|$)`));
    }
  }
  if (!match || Math.abs(Number(match[1])) > 90 || Math.abs(Number(match[2])) > 180) return null;
  return { latitud: match[1], longitud: match[2] };
}

function renderMapLocationField() {
  const wrapper = document.createElement('div');
  wrapper.className = 'workflow-field workflow-map-field';
  wrapper.innerHTML = `<span>Ubicación en Google Maps (opcional)</span>
    <a class="outline-button" href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Abrir Google Maps</a>
    <label>Enlace o coordenadas del pin
      <input type="text" data-map-location maxlength="2048" placeholder="Ej. 19.4326, -99.1332" aria-describedby="map-location-hint map-location-status">
    </label>
    <small class="workflow-field-hint" id="map-location-hint">En Google Maps haz clic derecho en el lugar y copia sus coordenadas, o pega la dirección completa del navegador con el pin. Los enlaces cortos no son compatibles.</small>
    <small class="workflow-field-hint" id="map-location-status" role="status"></small>
    <input type="hidden" name="latitud"><input type="hidden" name="longitud">`;
  const input = wrapper.querySelector('[data-map-location]');
  const latitude = wrapper.querySelector('[name="latitud"]');
  const longitude = wrapper.querySelector('[name="longitud"]');
  const status = wrapper.querySelector('#map-location-status');
  input.addEventListener('input', () => {
    const text = input.value.trim();
    const coordinates = text ? coordinatesFromMapLocation(text) : null;
    latitude.value = coordinates ? coordinates.latitud : '';
    longitude.value = coordinates ? coordinates.longitud : '';
    input.setCustomValidity(text && !coordinates
      ? 'Pega coordenadas válidas o la dirección completa de Google Maps que incluya el pin.'
      : '');
    status.textContent = coordinates ? `Ubicación seleccionada: ${coordinates.latitud}, ${coordinates.longitud}` : '';
  });
  return wrapper;
}

function renderFormSections(definitions, render = renderField) {
  const sections = [];
  let grid;
  definitions.forEach((field) => {
    if (field[2] === 'section') {
      const section = document.createElement('section');
      section.className = 'workflow-form-section';
      const heading = document.createElement('h3');
      heading.textContent = field[1];
      grid = document.createElement('div');
      grid.className = 'workflow-form-grid';
      section.append(heading, grid);
      sections.push(section);
    } else {
      grid.append(field[2] === 'map' ? renderMapLocationField() : render(field));
    }
  });
  return sections;
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
  const content = config.fields.some((field) => field[2] === 'section')
    ? renderFormSections(config.fields)
    : config.fields.map((field) => field[2] === 'map' ? renderMapLocationField() : renderField(field));
  fields.replaceChildren(...content);
  form.noValidate = false;
  if (kind === 'property') configurePropertyForm(form);
  if (kind === 'contract') configureContractForm(form);
  if (kind === 'maintenance') {
    configureMaintenanceForm(form);
    form.querySelector('[name="prioridad"]').value = 'automatica';
  }
  if (kind === 'commission') configureCommissionForm(form);
  enableWorkflowSearchableSelects(form);
  dialog.showModal();
}

function validateWorkflowForm(form) {
  const kind = form.dataset.kind;
  const value = (name) => String(new FormData(form).get(name) || '').trim();
  const invalid = (message) => {
    const error = form.closest('dialog')?.querySelector('.form-error');
    if (error) error.textContent = message;
    return false;
  };
  const validDate = (date) => !date || /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

  if (kind === 'property') {
    const coordinates = [value('latitud'), value('longitud')];
    if (Boolean(coordinates[0]) !== Boolean(coordinates[1])) {
      return invalid('Captura latitud y longitud juntas o deja ambas vacías.');
    }
  }
  if (kind === 'property' || kind === 'property-edit') {
    const file = form.querySelector('[name="imagen"]')?.files?.[0];
    if (file && (file.size === 0 || file.size > 10 * 1024 * 1024)) {
      return invalid('La imagen debe tener contenido y no superar 10 MB.');
    }
    if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return invalid('Selecciona una imagen JPEG, PNG o WebP.');
    }
  }
  if (kind === 'lead') {
    const min = value('precio_min');
    const max = value('precio_max');
    if (min && max && Number(min) > Number(max)) {
      return invalid('El presupuesto mínimo no puede superar al máximo.');
    }
  }
  if (kind === 'rental') {
    const start = value('fecha_inicio');
    const end = value('fecha_fin');
    if (!validDate(start) || !validDate(end) || (start && end && end < start)) {
      return invalid('Revisa el periodo: la fecha de término debe ser igual o posterior al inicio.');
    }
  }
  if (kind === 'contract') {
    const isRental = value('tipo_operacion') === 'RENTA';
    const start = value('fecha_inicio');
    const end = value('fecha_fin');
    if (isRental && (!validDate(start) || !validDate(end) || (start && end && end < start))) {
      return invalid('Revisa el periodo de renta: la fecha de término debe ser igual o posterior al inicio.');
    }
    if (!isRental && (Boolean(value('latitud')) !== Boolean(value('longitud')))) {
      return invalid('Captura latitud y longitud juntas.');
    }
  }
  if (kind === 'document') {
    const file = form.querySelector('[name="archivo"]')?.files?.[0];
    if (file && file.size > 10 * 1024 * 1024) return invalid('El archivo no puede superar 10 MB.');
  }
  return true;
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
    rentalSelect.dispatchEvent(new Event('change', { bubbles: true }));
  };
  propertySelect.addEventListener('change', updateRentals);
  updateRentals();
}

function configureCommissionForm(form) {
  const propertySelect = form.querySelector('[name="id_propiedad"]');
  const properties = optionData.properties.filter((item) => Number(item.precio) > 0);
  propertySelect.innerHTML = `<option value="">Selecciona...</option>${properties.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nombre)}</option>`).join('')}`;
  const summary = document.createElement('p');
  summary.className = 'workflow-field-hint commission-preview';
  summary.setAttribute('role', 'status');
  form.querySelector('.workflow-fields').append(summary);
  const updatePreview = () => {
    const property = properties.find((item) => String(item.id) === propertySelect.value);
    if (!property) {
      summary.textContent = 'Selecciona una propiedad para calcular el 5 % de su valor.';
      return;
    }
    const cents = Math.round(Number(property.precio) * 100);
    const commission = Math.floor((cents * 5 + 50) / 100) / 100;
    summary.textContent = `Valor de la propiedad: ${formatCommissionMoney(property.precio)} · Comisión (5 %): ${formatCommissionMoney(commission)}. Se recalcula al guardar.`;
  };
  propertySelect.addEventListener('change', updatePreview);
  updatePreview();
}

// Genera los controles disponibles para cada fila de las tablas.
function actionButtons(resource, record) {
  const actions = tableConfig[resource]?.actions || [];
  return actions.map((action) => {
    if (resource === 'reports' && action === 'report-pdf') {
      return `<button type="button" class="text-button" data-download-report-id="${escapeHtml(record.id)}" data-report-operation="${escapeHtml(record.operacion)}" aria-label="Descargar reporte ${escapeHtml(record.operacion)} ${escapeHtml(record.id)} en PDF">Descargar PDF</button>`;
    }
    if (resource === 'payments' && action === 'receipt') {
      return String(record.estado).toUpperCase() === 'PAGADO'
        ? `<button type="button" class="text-button" data-payment-receipt="${escapeHtml(record.id_pago)}">Recibo</button>`
        : '<span class="text-muted">Sin recibo</span>';
    }
    if (resource === 'clients' && action === 'history') {
      return `<button type="button" class="text-button" data-client-history="${escapeHtml(record.id_cliente)}">Historial</button>`;
    }
    if (resource === 'clients' && action === 'portal-access') {
      return isCurrentUserAdmin() ? `<button type="button" class="text-button" data-client-credentials="${escapeHtml(record.id_cliente)}">Acceso portal</button>` : '';
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
    const idKey = { properties: 'id_propiedad', clients: 'id_cliente', leads: 'id_lead', visits: 'id_cita', offers: 'id_oferta', rentals: 'id_renta', payments: 'id_pago', maintenance: 'id_solicitud', commissions: 'id_comision', sellers: 'id_usuario', users: 'id_usuario' }[resource];
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
  if (resource === 'clients' && key === 'nombre') return escapeHtml([value, record.apellido_paterno, record.apellido_materno].filter(Boolean).join(' ') || '—');
  if (resource === 'commissions' && key === 'es_demo') return value ? 'Demo' : 'Normal';
  if (resource === 'commissions' && ['monto_operacion', 'monto_total'].includes(key)) return value === null || value === undefined ? '—' : escapeHtml(formatCommissionMoney(value));
  if (key === 'precio' || key === 'precio_total' || key === 'monto' || key === 'monto_total' || key === 'monto_operacion' || key === 'precio_venta' || key === 'renta_mensual' || key === 'cobros' || key === 'comision_mes' || key === 'costo_estimado' || key === 'costo_final') return value === null || value === undefined ? '—' : escapeHtml(formatMoney(value));
  if (key === 'tamano_bytes') return `${(Number(value || 0) / 1024).toFixed(1)} KB`;
  if (key === 'puntuacion') return `${escapeHtml(value)}%`;
  if (key === 'fecha_cita' || key === 'fecha_venta' || key === 'fecha_contrato' || key === 'fecha_registro' || key === 'creado_en' || key === 'pagado_en' || key === 'fecha_inicio' || key === 'fecha_fin' || key === 'fecha_limite' || key === 'periodo' || key === 'fecha') {
    if (!value) return '—';
    const dateOnly = ['fecha_venta', 'fecha_contrato', 'fecha_registro', 'fecha_inicio', 'fecha_fin', 'fecha_limite', 'periodo'].includes(key)
      && /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const date = new Date(dateOnly ? `${value}T12:00:00` : value);
    return Number.isNaN(date.getTime()) ? escapeHtml(value)
      : escapeHtml(dateOnly ? date.toLocaleDateString('es-MX') : date.toLocaleString('es-MX'));
  }
  if (resource === 'maintenance' && key === 'prioridad') {
    return `${escapeHtml(value || '—')} <small>(${record.prioridad_automatica ? 'automática' : 'manual'})</small>`;
  }
  if (key === 'tipo_operacion') return value === 'VENTA' ? 'Venta' : value === 'RENTA' ? 'Renta' : escapeHtml(value || '—');
  if (key === 'rol') return value === 'administrador' || value === 'admin' ? 'Administrador' : value === 'vendedor' || value === 'agente' ? 'Vendedor' : escapeHtml(value || '—');
  if (key === 'activo') return value === true || value === 'true' ? 'Activo' : 'Inactivo';
  if (resource === 'properties' && key === 'titulo') return `<strong>${escapeHtml(value)}</strong><small class="record-subtitle">${escapeHtml(record.direccion)}</small>`;
  return escapeHtml(value || '—');
}

function syncClientTabs() {
  const view = document.getElementById('clients-view');
  if (!view) return;
  view.querySelectorAll('[data-client-tab]').forEach((tab) => {
    const selected = tab.dataset.clientTab === clientTableTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  view.querySelectorAll('[data-record-panel="clients"], [data-record-panel="leads"]').forEach((panel) => {
    const selected = panel.dataset.recordPanel === (clientTableTab === 'potenciales' ? 'leads' : 'clients');
    panel.hidden = !selected;
    if (selected) panel.setAttribute('aria-labelledby', `client-tab-${clientTableTab}`);
  });
}

function syncContractTabs() {
  const view = document.getElementById('contracts-view');
  if (!view) return;
  view.querySelectorAll('[data-contract-tab]').forEach((tab) => {
    const selected = tab.dataset.contractTab === contractTableTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  view.querySelectorAll('[data-contracts-tables] [data-record-panel]').forEach((panel) => {
    const selected = panel.dataset.recordPanel === contractTableTab;
    panel.hidden = !selected;
    if (selected) panel.setAttribute('aria-labelledby', `contract-tab-${contractTableTab}`);
  });
}

function syncMaintenanceTabs() {
  const view = document.getElementById('maintenance-view');
  if (!view) return;
  const priorities = view.querySelectorAll('[data-maintenance-priority]');
  priorities.forEach((tab) => {
    const priority = tab.dataset.maintenancePriority;
    const selected = priority === maintenancePriorityTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const count = priority === 'todas'
      ? records.maintenance.length
      : records.maintenance.filter((item) => String(item.prioridad || 'normal').toLowerCase() === priority).length;
    const countLabel = tab.querySelector('[data-maintenance-count]');
    if (countLabel) countLabel.textContent = String(count);
  });
  const panel = view.querySelector('[data-record-panel="maintenance"]');
  if (panel) panel.setAttribute('aria-labelledby', `maintenance-tab-${maintenancePriorityTab}`);
}

// Renderiza tablas, filtros, acciones y contenido adicional de cada modulo.
function renderRecords(resource, viewId, data = []) {
  const view = document.getElementById(viewId);
  const config = tableConfig[resource];
  if (!view || !config) return;
  const visibleData = resource === 'reports' ? filterReportsByDate(data) : data;
  let panel = view.querySelector(`[data-record-panel="${resource}"]`);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'panel persisted-panel';
    panel.dataset.recordPanel = resource;
    if (resource === 'clients' || resource === 'leads') {
      panel.tabIndex = -1;
      panel.id = `client-panel-${resource}`;
      panel.setAttribute('role', 'tabpanel');
      (view.querySelector('[data-clients-tables]') || view).append(panel);
    } else if (viewId === 'contracts-view' && ['contracts', 'offers', 'sales', 'rentals'].includes(resource)) {
      panel.tabIndex = -1;
      panel.id = `contract-panel-${resource}`;
      panel.setAttribute('role', 'tabpanel');
      if (resource === 'rentals') panel.dataset.filterKey = 'contract-rentals';
      (view.querySelector('[data-contracts-tables]') || view).append(panel);
    } else if (resource === 'maintenance') {
      panel.tabIndex = -1;
      panel.id = 'maintenance-record-panel';
      panel.setAttribute('role', 'tabpanel');
      view.append(panel);
    } else view.append(panel);
  }
  const filterKey = panel.dataset.filterKey || resource;
  const filterState = recordFilters[filterKey] || (recordFilters[filterKey] = { search: '', from: '', to: '' });
  const isClientTable = resource === 'clients' || resource === 'leads';
  const visibleColumns = getTableColumns(resource, config.columns);
  panel.dataset.columnScope = resource;
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
  const filter = filterOptions ? `<label class="record-filter"><span>Filtrar</span><select data-record-filter="${resource}">${filterOptions.map((option) => `<option value="${escapeHtml(option)}"${resource === 'rentals' && filterState.status === option ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>` : '';
  const propertyResultCount = resource === 'properties' ? ' data-property-result-count' : '';
  const resultLabel = resource === 'properties' ? 'propiedades' : 'registros';
  const reportExportPdf = resource === 'reports'
    ? `<button type="button" class="primary-button small-button" data-download-report-pdf title="Descargar reporte en PDF con diseño profesional y marca de agua">📄 Descargar PDF</button>`
    : '';
  const columnControl = `<details class="table-column-control"><summary>Columnas</summary><div>${config.columns.map(([key, label]) => `<label><input type="checkbox" data-table-column="${escapeHtml(key)}" data-column-resource="${escapeHtml(resource)}"${visibleColumns.has(key) ? ' checked' : ''}> ${escapeHtml(label)}</label>`).join('')}</div></details>`;
  const columnAttributes = (key) => ` data-column-key="${escapeHtml(key)}"${visibleColumns.has(key) ? '' : ' hidden'}`;
  const renderRow = (record) => {
    const actions = actionButtons(resource, record);
    const actionCell = isClientTable ? `<details class="client-row-actions"><summary aria-label="Acciones de ${resource === 'clients' ? 'cliente' : 'cliente potencial'}">⋮</summary><div class="client-row-menu">${actions}</div></details>` : actions;
    return `<tr data-record-text="${escapeHtml(getRecordSearchText(record))}" data-record-date="${escapeHtml(dateField ? record[dateField] : '')}"${resource === 'clients' ? ` data-record-active="${record.activo === true || record.activo === 'true'}"` : ''}${resource === 'reports' ? ` data-record-activity="${escapeHtml(record.actividad)}"` : ''}${resource === 'maintenance' ? ` data-priority="${escapeHtml(record.prioridad || 'normal')}"` : ''}${['maintenance', 'rentals'].includes(resource) ? ` data-record-status="${escapeHtml(record.estado)}"` : ''}${resource === 'properties' ? ` data-property-title="${escapeHtml(record.titulo)}" data-property-id="${escapeHtml(record.id_propiedad)}" data-property-category="${escapeHtml(record.categoria)}"` : ''}>${config.columns.map(([key]) => `<td${columnAttributes(key)}>${formatCell(resource, key, record[key], record)}</td>`).join('')}<td>${actionCell}</td></tr>`;
  };
  const rows = resource === 'maintenance' && visibleData.length
    ? ['urgente', 'alta', 'normal', 'baja'].map((priority) => {
      const group = visibleData.filter((record) => (record.prioridad || 'normal') === priority);
      return group.length ? `<tr class="maintenance-priority-heading" data-priority-heading="${priority}"><th colspan="${config.columns.length + 1}" scope="rowgroup">Prioridad ${priority}</th></tr>${group.map(renderRow).join('')}` : '';
    }).join('')
    : visibleData.map(renderRow).join('');
  const rentalNote = viewId === 'contracts-view' && resource === 'rentals'
    ? '<p>Rentas de cobranza; el indicador superior cuenta contratos de renta.</p>' : '';
  panel.innerHTML = `<div class="panel-heading"><div><h2>${config.title}</h2><p${propertyResultCount}>${visibleData.length} ${resultLabel}${resource === 'reports' && visibleData.length !== data.length ? ` de ${data.length}` : ''}</p>${rentalNote}</div><div class="panel-heading-actions">${recordSearch}${propertySearch}${propertyCategory}${dateFilter}${reportFilter}${filter}${columnControl}${reportExportPdf}</div></div><div class="property-table-wrap"><table class="data-table"><thead><tr>${config.columns.map(([key, label]) => `<th${columnAttributes(key)}>${label}</th>`).join('')}<th>Acciones</th></tr></thead><tbody>${visibleData.length ? rows : `<tr><td colspan="${config.columns.length + 1}" class="empty-records">No hay registros para mostrar.</td></tr>`}${isClientTable && visibleData.length ? `<tr data-client-empty hidden><td colspan="${config.columns.length + 1}" class="empty-records">No hay registros que coincidan con los filtros.</td></tr>` : ''}</tbody></table></div>`;
  syncTableColumnControls(panel, resource, config.columns);
  panel.querySelectorAll('select:not([data-record-filter])').forEach((select) => enableSelectSearch(select, select.closest('label').querySelector('span').textContent));
  bindUserRecordActions(panel, resource);
  if (resource === 'properties') applyPropertyFilters(panel);
  if (resource !== 'properties') applyRecordFilters(panel, resource);
  if (isClientTable) syncClientTabs();
  if (viewId === 'contracts-view') syncContractTabs();
  if (resource === 'maintenance') syncMaintenanceTabs();
  if (resource === 'visits') renderVisitCalendar(view.querySelector('[data-visit-calendar]'), data);
  updateMetrics();
}

// Normaliza campos de un registro para la busqueda dentro de una tabla.
function getRecordSearchText(record) {
  return Object.values(record).filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase();
}

// Divide las filas visibles en paginas y conserva el numero por recurso.
const PAGE_SIZE = 6;
const tablePages = {};

// Recorta filas segun la pagina seleccionada y sincroniza los controles.
function paginatePanel(panel, resource, resetPage = false) {
  if (!panel) return;
  const pageKey = panel.dataset?.filterKey || resource;
  if (resetPage) tablePages[pageKey] = 1;
  const rows = [...panel.querySelectorAll('tbody tr[data-record-text]')].filter((row) => !row.hidden);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, tablePages[pageKey] || 1), totalPages);
  tablePages[pageKey] = page;
  const start = (page - 1) * PAGE_SIZE;
  panel.querySelectorAll('tbody tr[data-record-text]').forEach((row) => { row.dataset.pageHidden = 'true'; });
  rows.slice(start, start + PAGE_SIZE).forEach((row) => { delete row.dataset.pageHidden; });
  panel.querySelectorAll('[data-priority-heading]').forEach((heading) => {
    heading.hidden = !rows.slice(start, start + PAGE_SIZE).some((row) => row.dataset.priority === heading.dataset.priorityHeading);
  });
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
  const filterKey = panel.dataset?.filterKey || resource;
  const state = recordFilters[filterKey] || (recordFilters[filterKey] = { search: '', from: '', to: '' });
  const rows = [...panel.querySelectorAll('tbody tr[data-record-text]')];
  const query = state.search.trim().toLocaleLowerCase();
  const globalQuery = ['clients', 'leads'].includes(resource)
    ? (document.getElementById('global-search')?.value || '').trim().toLocaleLowerCase() : '';
  const status = resource === 'maintenance' ? panel.querySelector('[data-record-filter="maintenance"]')?.value
    : resource === 'rentals' ? state.status : '';
  const priority = resource === 'maintenance' ? maintenancePriorityTab : '';
  const activity = resource === 'reports' ? panel.querySelector('[data-record-filter="reports"]')?.value : '';
  const matches = rows.filter((row) => {
    const date = String(row.dataset.recordDate || '').slice(0, 10);
    const match = (!query || row.dataset.recordText.includes(query))
      && (!globalQuery || row.dataset.recordText.includes(globalQuery))
      && (!state.from || date >= state.from)
      && (!state.to || date <= state.to)
      && (resource !== 'clients' || clientTableTab !== 'activos' || row.dataset.recordActive === 'true')
      && (resource !== 'clients' || clientTableTab !== 'inactivos' || row.dataset.recordActive === 'false')
      && (!priority || priority === 'todas' || String(row.dataset.priority || 'normal').toLowerCase() === priority)
      && (!status || status === 'Todas' || String(row.dataset.recordStatus).toLocaleLowerCase() === status.toLocaleLowerCase());
    const matchesActivity = !activity || activity === 'Todas' || row.dataset.recordActivity === activity;
    row.hidden = !(match && matchesActivity);
    return match && matchesActivity;
  }).length;
  const count = panel.querySelector('[data-property-result-count]') || panel.querySelector('.panel-heading p');
  if (count) count.textContent = `${matches} registros${matches !== rows.length ? ` de ${rows.length}` : ''}`;
  const empty = panel.querySelector('[data-client-empty]');
  if (empty) empty.hidden = matches !== 0;
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
    const match = (!propertyFilters.exactId || row.dataset.propertyId === propertyFilters.exactId)
      && (!query || row.dataset.propertyTitle.toLocaleLowerCase().includes(query) || row.dataset.propertyId.includes(query))
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

function explainMatch(explanation) {
  const lines = [];
  const city = explanation.ciudad;
  if (city?.cumple !== null && city?.cumple !== undefined) {
    lines.push(city.actual == null ? 'Ciudad: la propiedad no tiene datos.' : city.cumple
      ? `Ciudad: coincide con ${city.esperado}.` : `Ciudad: se busca ${city.esperado}, la propiedad está en ${city.actual}.`);
  }
  const budget = explanation.presupuesto;
  if (budget?.cumple !== null && budget?.cumple !== undefined) {
    const range = [budget.minimo != null ? `desde ${formatMoney(budget.minimo)}` : '',
      budget.maximo != null ? `hasta ${formatMoney(budget.maximo)}` : ''].filter(Boolean).join(' ');
    lines.push(budget.actual == null ? `Presupuesto ${range}: la propiedad no tiene precio.`
      : `Presupuesto ${range}: ${budget.cumple ? 'cumple' : 'no cumple'} (precio ${formatMoney(budget.actual)}).`);
  }
  const rooms = explanation.habitaciones;
  if (rooms?.cumple !== null && rooms?.cumple !== undefined) {
    lines.push(rooms.actual == null ? `Habitaciones: se requieren ${rooms.minimo}; no hay datos.`
      : `Habitaciones: ${rooms.cumple ? 'cumple' : 'no cumple'} (se requieren ${rooms.minimo}, tiene ${rooms.actual}).`);
  }
  const category = explanation.categoria;
  if (category?.cumple !== null && category?.cumple !== undefined) {
    lines.push(category.actual == null ? `Categoría: se busca ${category.esperado}; no hay datos.`
      : `Categoría: ${category.cumple ? 'cumple' : 'no cumple'} (se busca ${category.esperado}, es ${category.actual}).`);
  }
  return lines;
}

async function loadMatchPage(page = matchingState.page) {
  const requestId = ++matchingState.requestId;
  const search = matchingState.search;
  const globalSearch = document.getElementById('global-search')?.value.trim() || '';
  const params = new URLSearchParams({ page, limit: 3, search, global: globalSearch, ...matchingState.filters });
  const result = await api.request(`/api/workflows/matching/results?${params}`);
  if (requestId !== matchingState.requestId) return;
  if (page > result.meta.totalPages) return loadMatchPage(result.meta.totalPages);
  matchingState.page = page;
  matchingState.generatedAt = result.meta.generadaEn;
  records.matches = result.data;
  const view = document.getElementById('matching-view');
  view.querySelector('[data-match-total]').textContent = result.meta.total;
  view.querySelector('[data-match-leads]').textContent = result.meta.prospectos;
  view.querySelector('[data-match-average]').textContent = result.meta.promedio == null ? '—' : `${result.meta.promedio}%`;
  view.querySelector('[data-match-generation]').textContent = result.meta.generadaEn
    ? `Última generación: ${new Date(result.meta.generadaEn).toLocaleString('es-MX')} · Los cambios posteriores requieren generar nuevamente.`
    : 'Aún no se han generado coincidencias con el cálculo actual.';
  const container = view.querySelector('[data-match-results]');
  container.innerHTML = result.data.length ? `<div class="matching-results">${result.data.map((match) => {
    const lines = explainMatch(match.explicacion);
    const phone = typeof match.telefono === 'string' && /^\+?[0-9() .-]{7,20}$/.test(match.telefono.trim())
      ? `<span class="matching-phone">${escapeHtml(match.telefono.trim())}</span>` : '';
    const email = typeof match.correo === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(match.correo.trim())
      ? `<a class="text-button" href="${escapeHtml(matchingEmailUrl(match.correo.trim()))}" target="_blank" rel="noopener noreferrer">Enviar correo</a>` : '';
    const available = !match.eliminado && String(match.estado_propiedad).toLowerCase() === 'disponible';
    return `<article class="matching-result"><div class="matching-result-heading">
      <h3>${escapeHtml(match.lead)} · ${escapeHtml(match.propiedad)}</h3>
      <strong>${match.puntuacion == null ? 'Sin puntuación' : `${escapeHtml(match.puntuacion)}%`}</strong></div>
      ${match.nueva ? '<span class="matching-badge">Nueva coincidencia</span>' : ''}
      ${match.propiedad_nueva ? '<span class="matching-badge">Propiedad nueva en el motor</span>' : ''}
      <span class="matching-badge">${match.contactado ? 'Contactado' : 'Pendiente de contacto'}</span>
      ${lines.length ? `<ul class="matching-explanation">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : '<p class="matching-note">Sugerencia general: el prospecto no indicó preferencias puntuables.</p>'}
      ${available ? '' : '<p class="matching-note">La propiedad ya no está disponible. Genera las coincidencias nuevamente.</p>'}
      <div class="matching-actions"><button type="button" class="text-button" data-match-property="${escapeHtml(match.id_propiedad)}">Ver propiedad</button>
      ${phone}${email}<button type="button" class="text-button" data-match-track="favorito" data-match-id="${escapeHtml(match.id_coincidencia)}" aria-pressed="${Boolean(match.favorito)}">${match.favorito ? 'Quitar favorito' : 'Marcar favorito'}</button>
      <button type="button" class="text-button" data-match-track="contactado" data-match-id="${escapeHtml(match.id_coincidencia)}" aria-pressed="${Boolean(match.contactado)}">${match.contactado ? 'Marcar pendiente' : 'Marcar contactado'}</button>
      <button type="button" class="text-button" data-match-share="whatsapp" data-match-id="${escapeHtml(match.id_coincidencia)}"${available ? '' : ' disabled'}>Compartir por WhatsApp</button>
      <button type="button" class="text-button" data-match-share="correo" data-match-id="${escapeHtml(match.id_coincidencia)}"${available ? '' : ' disabled'}>Compartir por correo</button>
      <button type="button" class="text-button" data-match-visit="${escapeHtml(match.id_coincidencia)}"${available ? '' : ' disabled'}>Agendar visita</button></div></article>`;
  }).join('')}</div>` : '<p class="empty-records">No hay coincidencias para mostrar.</p>';
  const nav = view.querySelector('[data-match-pagination]');
  nav.hidden = result.meta.totalPages <= 1;
  nav.innerHTML = `<button type="button" class="text-button" data-match-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>Anterior</button>
    <span>Página ${page} de ${result.meta.totalPages} · ${result.meta.total} resultados</span>
    <button type="button" class="text-button" data-match-page="${page + 1}"${page >= result.meta.totalPages ? ' disabled' : ''}>Siguiente</button>`;
}

function matchingPhone(phone) {
  const value = String(phone || '').trim();
  if (!/^\+?[0-9() .-]{7,20}$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return digits;
  return null;
}

function matchingEmailUrl(email, subject = '', body = '') {
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: email,
    authuser: MATCHING_EMAIL_ACCOUNT,
  });
  if (subject) params.set('su', subject);
  if (body) params.set('body', body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

async function shareMatch(match, channel) {
  const phone = matchingPhone(match.telefono);
  const email = String(match.correo || '').trim();
  if (channel === 'whatsapp' && !phone) return showToast('El teléfono no es válido para WhatsApp. Usa 10 dígitos o incluye el código de país con +.', true);
  if (channel === 'correo' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('El prospecto no tiene un correo válido.', true);
  const target = window.open('', '_blank');
  if (!target) return showToast(channel === 'whatsapp'
    ? 'Permite ventanas emergentes para abrir WhatsApp.'
    : 'Permite ventanas emergentes para abrir Gmail.', true);
  if (target) target.opener = null;
  try {
    const config = await api.request('/api/workflows/matching/config');
    const operation = match.tipo_operacion === 'RENTA' ? 'Renta' : 'Venta';
    const info = [match.propiedad, operation,
      match.precio == null ? '' : formatMoney(match.precio), match.ciudad || ''].filter(Boolean).join(' · ');
    const link = config.portalUrl ? `${config.portalUrl}?propiedad=${encodeURIComponent(match.id_propiedad)}` : '';
    const message = `Hola, te comparto esta propiedad: ${info}.${link ? `\n${link}` : ''}`;
    if (channel === 'whatsapp') target.location.href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    else target.location.href = matchingEmailUrl(email, 'Propiedad de interés', message);
    if (!link) showToast('Mensaje preparado sin enlace: no hay una dirección pública configurada.');
  } catch (error) {
    if (target) target.close();
    showToast(`No se pudo preparar el mensaje: ${error.message}`, true);
  }
}

async function loadMatchingExtra(kind, page = 1) {
  const details = document.querySelector(`[data-match-extra="${kind}"]`);
  const content = details.querySelector('[data-match-extra-content]');
  content.textContent = 'Cargando...';
  let result;
  try {
    result = await api.request(`/api/workflows/matching/${kind}?page=${page}&limit=6`);
  } catch (error) {
    content.textContent = 'No se pudieron cargar los datos.';
    throw error;
  }
  const rows = result.data.map((item) => {
    const demoBadge = item.es_demo ? '<span class="matching-badge">DEMO</span> ' : '';
    if (kind === 'history') return `<li>${demoBadge}${escapeHtml(formatAlertDate(item.generada_en))} · ${escapeHtml(item.usuario || 'Usuario no disponible')} · ${escapeHtml(item.total)} resultados: ${escapeHtml(item.nuevos)} nuevos, ${escapeHtml(item.modificados)} modificados, ${escapeHtml(item.retirados)} retirados; ${escapeHtml(item.propiedades_nuevas)} propiedades nuevas y ${escapeHtml(item.propiedades_no_disponibles)} no disponibles.</li>`;
    if (kind === 'changes') {
      const state = item.eliminado ? 'Eliminada' : item.estado_propiedad || 'Estado no registrado';
      const price = item.precio == null ? 'Sin precio registrado' : formatMoney(item.precio);
      return `<li>${demoBadge}<strong>${escapeHtml(item.propiedad)}</strong> · ID ${escapeHtml(item.id_propiedad)} · Estado: ${escapeHtml(state)} · Precio: ${escapeHtml(price)} · Operación: ${escapeHtml(item.tipo_operacion || 'Operación no registrada')} · Ubicación: ${escapeHtml(item.ubicacion || 'Ubicación no registrada')}.</li>`;
    }
    return `<li>${demoBadge}${escapeHtml(item.lead)} · ${escapeHtml(item.propiedad)} · ${item.no_disponible ? 'Propiedad no disponible' : item.estado_propiedad == null ? 'Disponibilidad no registrada' : 'Ya no cumple las condiciones'} · ${item.favorito ? 'Favorito' : 'Sin favorito'} · ${item.contactado ? 'Contactado' : 'Pendiente'}
      <button type="button" class="text-button" data-retired-track="favorito" data-lead-id="${escapeHtml(item.id_lead)}" data-property-id="${escapeHtml(item.id_propiedad)}" data-value="${!item.favorito}">${item.favorito ? 'Quitar favorito' : 'Marcar favorito'}</button>
      <button type="button" class="text-button" data-retired-track="contactado" data-lead-id="${escapeHtml(item.id_lead)}" data-property-id="${escapeHtml(item.id_propiedad)}" data-value="${!item.contactado}">${item.contactado ? 'Marcar pendiente' : 'Marcar contactado'}</button></li>`;
  });
  const emptyMessages = {
    changes: matchingState.generatedAt
      ? 'La última generación no registró propiedades que dejaran de estar disponibles.'
      : 'Genera coincidencias para iniciar el seguimiento de disponibilidad; los cambios aparecerán aquí.',
    retired: 'Aún no hay coincidencias retiradas en tu seguimiento. Marca una como favorita o contactada y vuelve a generar coincidencias para consultarla aquí.',
    history: 'Aún no hay generaciones registradas. Usa “Generar coincidencias” para crear la primera.',
  };
  content.innerHTML = rows.length ? `<ul>${rows.join('')}</ul>` : `<p class="matching-note">${emptyMessages[kind] || 'No hay registros para mostrar.'}</p>`;
  if (result.meta.totalPages > 1) content.insertAdjacentHTML('beforeend', `<nav class="table-pagination" aria-label="Paginación"><button type="button" class="text-button" data-match-extra-page="${page - 1}" data-match-extra-kind="${kind}"${page <= 1 ? ' disabled' : ''}>Anterior</button><span>Página ${page} de ${result.meta.totalPages}</span><button type="button" class="text-button" data-match-extra-page="${page + 1}" data-match-extra-kind="${kind}"${page >= result.meta.totalPages ? ' disabled' : ''}>Siguiente</button></nav>`);
}

async function runMatchingGeneration(button) {
  const status = document.querySelector('[data-match-generation]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Generando coincidencias...';
  button.setAttribute('aria-busy', 'true');
  status.textContent = 'Generando coincidencias. Esto puede tardar según la cantidad de registros.';
  try {
    try {
      await api.request('/api/workflows/matching/run', { method: 'POST' });
    } catch (error) {
      status.textContent = 'No se pudo confirmar la generación. Inténtalo nuevamente.';
      showToast(`No se pudo generar coincidencias: ${error.message}`, true);
      return;
    }
    try {
      await loadMatchPage(1);
      showToast('Coincidencias actualizadas.');
      document.querySelectorAll('[data-match-extra][open]').forEach((details) => {
        loadMatchingExtra(details.dataset.matchExtra).catch((error) => showToast(`No se pudo actualizar el historial: ${error.message}`, true));
      });
      loadNotifications().catch((error) => console.error('No se pudieron actualizar las notificaciones:', error));
    } catch (error) {
      status.textContent = 'Se generaron las coincidencias, pero no se pudieron cargar los resultados.';
      showToast(`Coincidencias generadas, pero no se pudieron cargar: ${error.message}`, true);
    }
  } finally {
    button.disabled = false;
    button.textContent = label;
    button.removeAttribute('aria-busy');
  }
}

function openMatchVisit(match) {
  const property = optionData.properties.find((item) => String(item.id) === String(match.id_propiedad));
  if (!property) {
    showToast('La propiedad ya no está disponible para agendar. Actualiza los datos.', true);
    return;
  }
  const email = String(match.correo || '').trim().toLowerCase();
  const clients = email ? records.clients.filter((client) => String(client.correo || '').trim().toLowerCase() === email) : [];
  if (clients.length !== 1) {
    showToast('Se requiere un único cliente registrado con el correo del prospecto antes de agendar.', true);
    return;
  }
  const client = clients[0];
  if (!window.confirm(`¿Agendar para el cliente registrado ${[client.nombre, client.apellido_paterno, client.apellido_materno].filter(Boolean).join(' ')} (${client.correo})?`)) return;
  openForm('visit');
  const form = document.getElementById('workflow-form');
  for (const [name, value] of [['id_propiedad', String(match.id_propiedad)], ['id_cliente', String(client.id_cliente)]]) {
    const select = form.querySelector(`[name="${name}"]`);
    select.value = value;
    select.disabled = true;
    select.setAttribute('aria-disabled', 'true');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = name;
    hidden.value = value;
    select.closest('.workflow-field').append(hidden);
  }
}

function moveVisitCalendar(amount) {
  const date = visitCalendarState.date;
  visitCalendarState.date = visitCalendarState.mode === 'month'
    ? new Date(date.getFullYear(), date.getMonth() + amount, 1, 12)
    : new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount * 7, 12);
}

// Presenta las citas agrupadas por dia en el periodo seleccionado.
function renderVisitCalendar(panel, visits) {
  if (!panel) return;
  const monthly = visitCalendarState.mode === 'month';
  const selected = visitCalendarState.date;
  const first = new Date(selected.getFullYear(), selected.getMonth(), monthly ? 1 : selected.getDate(), 12);
  const offset = monthly ? (first.getDay() + 6) % 7 : 0;
  const dayCount = monthly ? new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate() : 7;
  const slots = monthly ? Math.ceil((offset + dayCount) / 7) * 7 : 7;
  const visitsByDay = new Map();
  visits.forEach((visit) => {
    const date = new Date(visit.fecha_cita);
    if (Number.isNaN(date.getTime())) return;
    const key = localDateKey(date);
    if (!visitsByDay.has(key)) visitsByDay.set(key, []);
    visitsByDay.get(key).push(visit);
  });
  const days = Array.from({ length: slots }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > dayCount) return '<div class="visit-calendar-blank" aria-hidden="true"></div>';
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + day - 1, 12);
    const dayVisits = visitsByDay.get(localDateKey(date)) || [];
    const dateLabel = date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const events = dayVisits.map((visit) => `<div class="visit-event"><time>${new Date(visit.fecha_cita).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</time><strong>${escapeHtml(visit.propiedad)}</strong><small>${escapeHtml(visit.cliente)} · ${escapeHtml(visit.estado)}</small></div>`).join('');
    return `<article class="visit-day" aria-label="${escapeHtml(dateLabel)}"${dayVisits.length ? ' tabindex="0"' : ''}><header>${monthly ? '' : `<strong>${date.toLocaleDateString('es-MX', { weekday: 'short' })}</strong>`}<span>${date.getDate()}</span></header>${events || (monthly ? '' : '<p class="empty-calendar">Sin visitas</p>')}</article>`;
  }).join('');
  const end = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6, 12);
  const period = monthly ? first.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
    : `${first.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })} – ${end.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const weekdays = monthly ? ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => `<div class="calendar-weekday">${day}</div>`).join('') : '';
  panel.innerHTML = `<div class="calendar-heading"><h2>Calendario de visitas</h2>
    <div class="calendar-controls" aria-label="Controles del calendario">
      <div class="calendar-view-switch" role="group" aria-label="Vista del calendario">
        <button type="button" class="outline-button small-button" data-calendar-mode="week" aria-pressed="${!monthly}">Semana</button>
        <button type="button" class="outline-button small-button" data-calendar-mode="month" aria-pressed="${monthly}">Mes</button>
      </div>
      <div class="calendar-navigation">
        <button type="button" class="outline-button small-button" data-calendar-move="-1" aria-label="${monthly ? 'Mes' : 'Semana'} anterior">←</button>
        <button type="button" class="outline-button small-button" data-calendar-today>Hoy</button>
        <button type="button" class="outline-button small-button" data-calendar-move="1" aria-label="${monthly ? 'Mes' : 'Semana'} siguiente">→</button>
      </div>
    </div></div>
    <p class="calendar-period" aria-live="polite">${escapeHtml(period)}</p>
    <div class="visit-calendar${monthly ? ' visit-calendar-month' : ''}">${weekdays}${days}</div>`;
}

// Filtra filas con el control desplegable del modulo activo.
function applyRecordFilter(select) {
  const value = select.value.toLocaleLowerCase();
  const panel = select.closest('.persisted-panel');
  if (panel?.dataset.recordPanel === 'rentals') {
    const filterKey = panel.dataset.filterKey || 'rentals';
    const state = recordFilters[filterKey] || (recordFilters[filterKey] = { search: '', from: '', to: '' });
    state.status = select.value;
    applyRecordFilters(panel, 'rentals');
    return;
  }
  if (panel && ['maintenance', 'reports'].includes(panel.dataset.recordPanel)) {
    applyRecordFilters(panel, panel.dataset.recordPanel);
    return;
  }
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
    propertySelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  clientSelect.addEventListener('change', toggleFields);
  propertySelect.addEventListener('change', toggleFields);
  toggleFields();
}

// Dibuja las propiedades recientes que aparecen en el panel principal.
function renderDashboardProperties(properties) {
  const table = document.querySelector('#property-table');
  const body = document.querySelector('#property-table tbody');
  if (!body) return;
  body.innerHTML = properties.slice(0, 5).map((property) => `
    <tr><td data-column-key="titulo"><div class="property-name"><div class="property-photo photo-one"></div><span><strong>${escapeHtml(property.titulo)}</strong><small>${escapeHtml(property.direccion)}</small></span></div></td>
      <td data-column-key="categoria">${escapeHtml(property.categoria)}</td><td data-column-key="estado_propiedad"><span class="status status-green">${escapeHtml(property.estado_propiedad)}</span></td>
      <td data-column-key="precio"><strong>${escapeHtml(formatMoney(property.precio))}</strong></td><td data-column-key="agente">${escapeHtml(property.agente || 'Sin asignar')}</td>
      <td><button class="row-menu" type="button" aria-label="Acciones de propiedad" data-record-action="edit" data-resource="properties" data-record-id="${property.id_propiedad}">•••</button></td></tr>
  `).join('') || '<tr><td colspan="6" class="empty-records">Todavía no hay propiedades registradas.</td></tr>';
  const scope = table?.closest?.('[data-column-scope]');
  if (scope) syncTableColumnControls(scope, 'dashboard-properties', dashboardPropertyColumns);
}

let lastSummaryData = null;

// Actualiza indicadores generales y cifras resumidas de cada modulo.
function updateMetrics(summary = lastSummaryData) {
  if (summary) lastSummaryData = summary;
  const currentSummary = summary || lastSummaryData || {};
  const values = [currentSummary.propiedades, currentSummary.clientes, currentSummary.visitas, formatMoney(currentSummary.ingresos)];
  document.querySelectorAll('.metric-grid article > strong').forEach((element, index) => {
    if (values[index] !== undefined) {
      if (element.textContent !== String(values[index])) {
        element.textContent = values[index];
        element.classList.remove('data-updated');
        void element.offsetWidth;
        element.classList.add('data-updated');
      }
    }
  });
  document.querySelectorAll('.metric-foot').forEach((element) => {
    element.textContent = 'Datos actuales desde PostgreSQL';
  });
  const countStatus = (items, key, valuesToCount) => items.filter((item) => valuesToCount.includes(String(item[key] || '').toLocaleLowerCase())).length;
  const now = new Date();
  const leadsConvertidos = countStatus(records.leads, 'estado', ['convertido']);
  const conversionRate = records.leads.length ? `${Math.round((leadsConvertidos / records.leads.length) * 100)}%` : '0%';
  const comisionesMes = records.commissions.filter((item) => {
    const d = new Date(item.creado_en);
    return !isNaN(d) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });
  const totalComisionesMes = comisionesMes.reduce((sum, item) => sum + Number(item.monto_total || 0), 0);
  const totalPorLiquidar = records.commissions
    .filter((item) => String(item.estado).toUpperCase() === 'PENDIENTE')
    .reduce((sum, item) => sum + Number(item.monto_total || 0), 0);
  const cierresMes = records.sales.filter((item) => {
    const d = new Date(item.fecha_venta);
    return !isNaN(d) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  const metrics = {
    'properties-view': [
      ['Total en inventario', records.properties.length],
      ['Disponibles', countStatus(records.properties, 'estado_propiedad', ['disponible'])],
      ['En proceso', countStatus(records.properties, 'estado_propiedad', ['reservada'])],
      ['Vendidas / rentadas', countStatus(records.properties, 'estado_propiedad', ['vendida', 'rentada'])],
    ],
    'clients-view': [
      ['Clientes registrados', records.clients.length],
      ['Nuevos clientes potenciales', countStatus(records.leads, 'estado', ['nuevo'])],
      ['Clientes potenciales activos', records.leads.filter((lead) => !['convertido', 'descartado', 'cerrado', 'perdido'].includes(String(lead.estado).toLowerCase())).length],
      ['Conversión', conversionRate],
    ],
    'visits-view': [
      ['Visitas registradas', records.visits.length],
      ['Hoy', records.visits.filter((item) => new Date(item.fecha_cita).toDateString() === now.toDateString()).length],
      ['Confirmadas', countStatus(records.visits, 'estado', ['confirmada'])],
      ['Completadas', countStatus(records.visits, 'estado', ['completada'])],
    ],
    'portal-view': [
      ['Propiedades publicables', records.properties.filter((item) => String(item.estado_propiedad).toLowerCase() === 'disponible').length],
      ['Solicitudes recibidas', records.leads.filter((item) => item.origen === 'portal').length],
      ['Clientes potenciales con consentimiento', records.leads.filter((item) => item.consentimiento_datos).length],
      ['Favoritos', records.favorites?.length || 0],
    ],
    'legal-view': [
      ['Documentos guardados', records.documents.length],
      ['Por validar', countStatus(records.documents, 'estado', ['pendiente'])],
      ['Validados', countStatus(records.documents, 'estado', ['validado', 'aprobado'])],
      ['Propiedades documentadas', new Set(records.documents.map((item) => String(item.id_propiedad))).size],
    ],
    'contracts-view': [
      ['Contratos registrados', records.contracts.length],
      ['Ventas', records.contracts.filter((item) => String(item.tipo_operacion).toUpperCase() === 'VENTA').length],
      ['Rentas', records.contracts.filter((item) => String(item.tipo_operacion).toUpperCase() === 'RENTA').length],
      ['Contratos de este mes', records.contracts.filter((item) => {
        const d = new Date(item.fecha_contrato);
        return !isNaN(d) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }).length],
    ],
    'finance-view': [
      ['Comisiones del mes', formatCommissionMoney(totalComisionesMes || records.commissions.reduce((sum, item) => sum + Number(item.monto_total || 0), 0))],
      ['Por liquidar', formatCommissionMoney(totalPorLiquidar)],
      ['Cierres del mes', cierresMes || records.sales.length],
      ['Operaciones comisionadas', new Set(records.commissions.map((item) => String(item.id_propiedad))).size],
    ],
    'rents-view': [
      ['Contratos activos', countStatus(records.rentals, 'estado', ['activa'])],
      ['Cobros recibidos', countStatus(records.payments, 'estado', ['pagado'])],
      ['Adeudos vencidos', records.payments.filter((item) => String(item.estado).toUpperCase() === 'VENCIDO' || (String(item.estado).toUpperCase() === 'PENDIENTE' && String(item.periodo).slice(0, 10) <= localDateKey())).length],
      ['Saldo pendiente', formatMoney(records.payments.filter((item) => ['pendiente', 'vencido'].includes(String(item.estado).toLowerCase())).reduce((sum, item) => sum + Number(item.monto || 0), 0))],
    ],
    'maintenance-view': [
      ['Solicitudes abiertas', records.maintenance.filter((item) => ['pendiente', 'en_proceso'].includes(item.estado)).length],
      ['Urgentes', records.maintenance.filter((item) => item.prioridad === 'urgente' && ['pendiente', 'en_proceso'].includes(item.estado)).length],
      ['En proceso', countStatus(records.maintenance, 'estado', ['en_proceso'])],
      ['Costo final registrado', formatMoney(records.maintenance.reduce((sum, item) => sum + Number(item.costo_final || 0), 0))],
    ],
    'sellers-view': [
      ['Vendedores registrados', records.sellers.length],
      ['Vendedores activos', countStatus(records.sellers, 'activo', [true, 'true'])],
      ['Comisiones del mes', formatCommissionMoney(records.sellers.reduce((sum, item) => sum + Number(item.comision_mes || 0), 0))],
      ['Rol requerido', 'Administrador'],
    ],
    'users-view': [
      ['Usuarios registrados', records.users.filter((item) => item.rol === 'usuario').length],
      ['Administradores', countStatus(records.users, 'rol', ['admin', 'administrador'])],
      ['Usuarios activos', countStatus(records.users, 'activo', [true, 'true'])],
      ['Rol requerido', 'Administrador'],
    ],
    'reports-view': [
      ['Propiedades', records.properties.length],
      ['Clientes', records.clients.length],
      ['Operaciones cerradas', records.sales.length],
      ['Documentos', records.documents.length],
    ],
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
  const actionTypes = {
    crear: { abbreviation: 'C', label: 'registró', className: 'create' },
    insert: { abbreviation: 'C', label: 'registró', className: 'create' },
    actualizar: { abbreviation: 'A', label: 'actualizó', className: 'update' },
    update: { abbreviation: 'A', label: 'actualizó', className: 'update' },
    eliminar: { abbreviation: 'E', label: 'eliminó', className: 'delete' },
    delete: { abbreviation: 'E', label: 'eliminó', className: 'delete' },
    archivar: { abbreviation: 'Ar', label: 'archivó', className: 'archive' },
    ejecutar: { abbreviation: 'Ej', label: 'ejecutó', className: 'execute' },
    cargar: { abbreviation: 'Ca', label: 'cargó', className: 'upload' },
  };
  const entityLabels = { usuarios: 'un usuario', clientes: 'un cliente', contratos: 'un contrato', propiedades: 'una propiedad', leads: 'un cliente potencial', citas: 'una cita', ventas: 'una venta', rentas: 'una renta', pagos_renta: 'un pago', comisiones: 'una comisión', coincidencias: 'coincidencias' };
  list.innerHTML = activity.length ? activity.map((item) => {
    const action = actionTypes[String(item.accion || '').toLocaleLowerCase()] || {
      abbreviation: '?', label: 'realizó una acción en', className: 'other',
    };
    return `
    <div class="activity-item"><span class="activity-icon activity-icon-${action.className}" aria-label="${escapeHtml(action.label)}">${action.abbreviation}</span>
      <div><p><strong>${escapeHtml(item.usuario)}</strong> ${escapeHtml(action.label)} ${escapeHtml(entityLabels[item.entidad] || 'el sistema')}</p>
        <p>${escapeHtml(item.detalle?.titulo || item.detalle?.nombre || item.detalle?.correo || '')}</p>
        <small>${escapeHtml(new Date(item.creado_en).toLocaleString('es-MX'))}</small></div></div>
  `;
  }).join('') : '<p class="empty-records">Todavía no hay actividad registrada.</p>';
}

// Controla los indicadores y barras animadas de carga de datos en la interfaz.
function setWorkspaceLoading(isLoading, message = 'Sincronizando datos...') {
  const loader = document.getElementById('view-loading');
  const loadingText = document.getElementById('loading-text') || loader?.querySelector('span:not(.loading-spinner)');
  const topBar = document.getElementById('top-loading-bar');
  const metricGrid = document.querySelector('.metric-grid');

  if (isLoading) {
    if (loadingText) loadingText.textContent = message;
    if (loader) loader.classList.add('visible');
    if (topBar) {
      topBar.classList.remove('complete');
      topBar.classList.add('loading');
    }
    if (metricGrid) metricGrid.classList.add('is-loading-data');
  } else {
    if (metricGrid) metricGrid.classList.remove('is-loading-data');
    if (topBar) {
      topBar.classList.remove('loading');
      topBar.classList.add('complete');
      setTimeout(() => topBar.classList.remove('complete'), 450);
    }
    if (loader) {
      setTimeout(() => {
        loader.classList.remove('visible');
        if (loadingText) loadingText.textContent = 'Cargando vista';
      }, 200);
    }
  }
}

// Carga los datos, aplica permisos por rol y actualiza cada vista del espacio.
async function loadWorkspace() {
  setWorkspaceLoading(true, 'Cargando datos del sistema...');
  try {
    const currentUserForLoad = JSON.parse(localStorage.getItem('habita_user') || '{}');
    const roleForLoad = String(currentUserForLoad.rol || currentUserForLoad.role || '').toLowerCase();
    const adminForLoad = ['administrador', 'admin'].includes(roleForLoad);
    const resourcesToLoad = Object.keys(tableConfig).filter((resource) => resource !== 'properties' && resource !== 'matches'
      && (resource !== 'users' || adminForLoad)
      && (resource !== 'sellers' || adminForLoad)
      && (resource !== 'commissions' || adminForLoad));
    // Todas las peticiones salen a la vez; solo se espera lo critico para el primer pintado.
    const propertiesRequest = api.getAllPages('/api/properties');
    const summaryRequest = api.get('summary');
    const optionsRequest = api.get('options');
    const activityRequest = api.get('activity');
    const resourceRequests = resourcesToLoad.map((resource) => api.get(resource));
    [propertiesRequest, summaryRequest, optionsRequest, activityRequest, ...resourceRequests]
      .forEach((request) => request.catch(() => {}));
    preloadLogo().catch(() => {});
    loadNotifications().catch((error) => console.error('No se pudieron cargar las notificaciones:', error));
    const [propertiesResult, summaryResult, optionsResult] = await Promise.allSettled([
      propertiesRequest, summaryRequest, optionsRequest,
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
    if (!isAdmin) records.users = [];
    if (!isAdmin) records.sellers = [];
    if (!isAdmin) records.commissions = [];
    const resourceViews = {
      clients: 'clients-view', leads: 'clients-view', visits: 'visits-view',
      documents: 'legal-view', offers: 'contracts-view', sales: 'contracts-view',
      commissions: 'finance-view', rentals: 'rents-view', payments: 'rents-view',
      maintenance: 'maintenance-view', contracts: 'contracts-view', reports: 'reports-view',
      users: 'users-view', sellers: 'sellers-view',
    };
    const renderResource = (resource) => {
      if (resourceViews[resource] && (isAdmin || !['users', 'sellers', 'commissions'].includes(resource))) {
        renderRecords(resource, resourceViews[resource], records[resource]);
        if (resource === 'rentals') renderRecords(resource, 'contracts-view', records[resource]);
      }
    };
    const summaryData = summaryResult.value.data;
    renderDashboardProperties(records.properties);
    renderRecords('properties', 'properties-view', records.properties);
    updateMetrics(summaryData);
    renderFollowUpAlerts(summaryData.alerts || []);
    await Promise.all(resourcesToLoad.map(async (resource, index) => {
      try {
        const result = await resourceRequests[index];
        records[resource] = Array.isArray(result.data) ? result.data : [];
      } catch (error) {
        records[resource] = [];
        console.error(`No se pudo cargar la tabla ${resource}:`, error);
      }
      renderResource(resource);
    }));
    try {
      await loadMatchPage();
    } catch (error) {
      document.querySelector('[data-match-generation]').textContent = 'No se pudieron cargar las coincidencias.';
      showToast(`No se pudieron cargar las coincidencias: ${error.message}`, true);
    }
    try {
      records.activity = (await activityRequest).data;
    } catch (error) {
      console.error('No se pudo cargar la actividad:', error);
      records.activity = [];
    }
    // Segundo pase: los indicadores de cada vista combinan datos de varios recursos.
    resourcesToLoad.forEach(renderResource);
    updateMetrics(summaryData);
    renderActivity(records.activity);
    renderCollectionsOverview();
  } catch (error) {
    console.error(error);
    if (/sesion|autenticacion/i.test(error.message)) showLogin();
    else showToast(error.message, true);
  } finally {
    setWorkspaceLoading(false);
  }
}

// Agrega acciones secundarias a las cabeceras de los modulos.
function addSecondaryActions() {
  const actions = {
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
  const dateAtOffset = (days) => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  };
  const paymentWindowStart = dateAtOffset(-10);
  const paymentWindowEnd = dateAtOffset(10);
  const renewalWindowStart = dateAtOffset(-15);
  const renewalWindowEnd = dateAtOffset(10);
  const openPayments = records.payments.filter((payment) => (
    ['PENDIENTE', 'VENCIDO'].includes(String(payment.estado).toUpperCase())
  ));
  const overduePayments = openPayments.filter((payment) => (
    String(payment.estado).toUpperCase() === 'VENCIDO'
    || String(payment.periodo).slice(0, 10) <= todayKey
  ));
  const upcomingPayments = openPayments.filter((payment) => {
    const due = String(payment.periodo).slice(0, 10);
    return due >= paymentWindowStart && due <= paymentWindowEnd;
  }).sort((a, b) => String(a.periodo).localeCompare(String(b.periodo))
    || Number(b.id_pago || 0) - Number(a.id_pago || 0));
  const expiringRentals = records.rentals.filter((rental) => {
    const end = String(rental.fecha_fin || '').slice(0, 10);
    return ['activa', 'cancelada'].includes(String(rental.estado).toLowerCase())
      && end >= renewalWindowStart && end <= renewalWindowEnd;
  }).sort((a, b) => String(a.fecha_fin).localeCompare(String(b.fecha_fin))
    || Number(a.id_renta || 0) - Number(b.id_renta || 0));
  const paymentItem = (payment) => `<li><div><strong>${escapeHtml(payment.cliente)}</strong>
    <span>${escapeHtml(payment.propiedad)} · ${escapeHtml(formatAlertDate(payment.periodo))} · ${escapeHtml(payment.estado)}</span></div>
    <strong>${escapeHtml(formatMoney(payment.monto))}</strong>
    <button type="button" class="text-button" data-record-action="status" data-resource="payments" data-record-id="${escapeHtml(payment.id_pago)}">Actualizar</button></li>`;
  const rentalItem = (rental) => `<li><div><strong>${escapeHtml(rental.cliente)}</strong>
    <span>${escapeHtml(rental.propiedad)} · ${String(rental.fecha_fin).slice(0, 10) < todayKey ? 'Terminó' : 'Vence'} ${escapeHtml(formatAlertDate(rental.fecha_fin))} · ${escapeHtml(rental.estado)}</span></div>
    <strong>${escapeHtml(formatMoney(rental.renta_mensual))} / mes</strong></li>`;
  container.innerHTML = `
    <div class="collection-alert-grid">
      <section class="collection-alert-card"><div class="collection-alert-heading"><h3>Adeudos vencidos</h3><span>${overduePayments.length}</span></div>
        <ul>${overduePayments.length ? overduePayments.slice(0, 5).map(paymentItem).join('') : '<li class="collection-empty">No hay adeudos vencidos.</li>'}</ul>
      </section>
      <section class="collection-alert-card"><div class="collection-alert-heading"><h3>Próximos cobros</h3><span>${upcomingPayments.length}</span></div>
        <ul>${upcomingPayments.length ? upcomingPayments.slice(0, 5).map(paymentItem).join('') : '<li class="collection-empty">No hay cobros pendientes o vencidos dentro de la ventana de 10 días.</li>'}</ul>
      </section>
      <section class="collection-alert-card"><div class="collection-alert-heading"><h3>Renovaciones por atender</h3><span>${expiringRentals.length}</span></div>
        <ul>${expiringRentals.length ? expiringRentals.slice(0, 5).map(rentalItem).join('') : '<li class="collection-empty">No hay contratos activos o cancelados en la ventana de renovaciones.</li>'}</ul>
      </section>
    </div>`;
}

// Pre-carga del logotipo corporativo para su inserción en documentos PDF.
let cachedLogoImage = null;
function preloadLogo() {
  if (cachedLogoImage) return Promise.resolve(cachedLogoImage);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cachedLogoImage = img;
      resolve(img);
    };
    img.onerror = () => reject(new Error('No se pudo cargar el logotipo para el reporte.'));
    img.src = 'estilo/Logo_bienes.jpeg';
  });
}

// Genera un reporte oficial en formato PDF con diseño profesional y marca de agua.
async function downloadPdfReport(resource = 'reports', selection = null) {
  const jsPdfLib = window.jspdf?.jsPDF || window.jsPDF;
  if (!jsPdfLib) {
    return showToast('No se pudo cargar el componente de PDF. Inténtalo de nuevo.', true);
  }

  if (!selection && resource === 'reports' && reportDateFilter.from && reportDateFilter.to && reportDateFilter.from > reportDateFilter.to) {
    return showToast('La fecha inicial no puede ser posterior a la fecha final.', true);
  }

  let data;
  if (selection) {
    const report = (records[resource] || []).find((item) =>
      String(item.id) === String(selection.id) && item.operacion === selection.operacion);
    if (!report) return showToast('No se encontró el reporte seleccionado. Actualiza la lista e inténtalo de nuevo.', true);
    data = [report];
  } else {
    data = resource === 'reports'
      ? filterReportsByDate(records[resource] || [])
      : (records[resource] || []);

    const panel = document.querySelector(`[data-record-panel="${resource}"]`);
    const selectFilter = panel?.querySelector(`[data-record-filter="${resource}"]`)?.value;
    const searchInput = panel?.querySelector(`[data-record-search="${resource}"]`)?.value?.trim().toLowerCase();

    if (selectFilter && selectFilter !== 'Todas') {
      data = data.filter((item) => String(item.actividad || item.operacion || item.estado || '').toLowerCase() === selectFilter.toLowerCase());
    }
    if (searchInput) {
      data = data.filter((item) => Object.values(item).filter((val) => val !== null && val !== undefined).join(' ').toLowerCase().includes(searchInput));
    }
  }

  if (!data.length) {
    return showToast('No hay registros para generar el reporte en PDF.', true);
  }

  showToast('Generando reporte PDF profesional...');

  try {
    const doc = new jsPdfLib({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();

    // 1. Franjas decorativas superiores
    doc.setFillColor(25, 59, 58);
    doc.rect(0, 0, pw, 4, 'F');
    doc.setFillColor(239, 133, 111);
    doc.rect(0, 4, pw, 1.5, 'F');

    // 2. Identidad corporativa
    const logoImg = await preloadLogo();
    const logoRatio = logoImg.naturalHeight / logoImg.naturalWidth;
    doc.addImage(logoImg, 'JPEG', 14, 8, 32, 32 * logoRatio, 'corporate-logo');

    // 3. Formateo de fechas y metadatos
    const now = new Date();
    const folio = `REP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getTime()).slice(-4)}`;
    const formatD = (val) => {
      if (!val) return '—';
      const s = String(val).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y}`;
      }
      const dt = new Date(val);
      return Number.isNaN(dt.getTime()) ? String(val) : dt.toLocaleDateString('es-MX');
    };

    let periodoLabel = 'Histórico completo';
    if (selection) {
      periodoLabel = formatD(data[0].fecha);
    } else if (reportDateFilter.from && reportDateFilter.to) {
      periodoLabel = `${formatD(reportDateFilter.from)} al ${formatD(reportDateFilter.to)}`;
    } else if (reportDateFilter.from) {
      periodoLabel = `Desde ${formatD(reportDateFilter.from)}`;
    } else if (reportDateFilter.to) {
      periodoLabel = `Hasta ${formatD(reportDateFilter.to)}`;
    }

    const reportTitle = selection ? 'REPORTE INDIVIDUAL DE OPERACIÓN' : resource === 'reports' ? 'REPORTE EJECUTIVO DE OPERACIONES' : 'REPORTE EJECUTIVO DE COMISIONES';

    // Cuadro de metadatos del documento
    doc.setDrawColor(219, 227, 224);
    doc.setFillColor(248, 250, 249);
    doc.setLineWidth(0.2);
    doc.roundedRect(pw - 78, 8.5, 64, 18, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(25, 59, 58);
    doc.text(reportTitle, pw - 75, 12.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(96, 115, 113);
    doc.text(`Folio: ${folio}`, pw - 75, 17);
    doc.text(`Emisión: ${now.toLocaleDateString('es-MX')} ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`, pw - 75, 21);
    doc.text(`Periodo: ${periodoLabel}`, pw - 75, 25);

    // 4. Métricas e indicadores del reporte
    const totalCount = data.length;
    const salesRecords = data.filter((item) => String(item.operacion || '').toUpperCase() === 'VENTA');
    const rentalsRecords = data.filter((item) => String(item.operacion || '').toUpperCase() === 'RENTA');
    const purchaseRecords = data.filter((item) => String(item.operacion || '').toUpperCase() === 'COMPRA');
    const totalVentasMonto = salesRecords.reduce((sum, item) => sum + Number(item.cobros || 0), 0);
    const totalRentasMonto = rentalsRecords.reduce((sum, item) => sum + Number(item.cobros || 0), 0);
    const totalComprasMonto = purchaseRecords.reduce((sum, item) => sum + Number(item.cobros || 0), 0);
    const totalCobros = resource === 'reports' ? totalVentasMonto + totalRentasMonto
      : data.reduce((sum, item) => sum + Number(item.monto_total || 0), 0);
    const uniqueAgents = new Set(data.map((item) => item.vendedor || item.agente).filter(Boolean)).size;

    // Tarjetas KPI ejecutivas
    const kpiY = 30;
    const kpiW = (pw - 28 - 9) / 4;
    const kpis = resource === 'reports' ? [
      { label: 'OPERACIONES', val: String(totalCount), sub: `${uniqueAgents} asesor${uniqueAgents === 1 ? '' : 'es'}` },
      { label: 'COBROS', val: formatMoney(totalCobros), sub: 'Ventas y rentas' },
      { label: 'COMPRAS', val: String(purchaseRecords.length), sub: formatMoney(totalComprasMonto) },
      { label: 'VENTAS / RENTAS', val: `${salesRecords.length} / ${rentalsRecords.length}`, sub: 'Operaciones registradas' }
    ] : [
      { label: 'REGISTROS', val: String(totalCount), sub: 'Comisiones registradas' },
      { label: 'TOTAL COMISIÓN', val: formatCommissionMoney(totalCobros), sub: 'Monto acumulado' },
      { label: 'PAGADAS', val: String(data.filter((item) => String(item.estado).toUpperCase() === 'PAGADA').length), sub: 'Liquidadas' },
      { label: 'PENDIENTES', val: String(data.filter((item) => String(item.estado).toUpperCase() === 'PENDIENTE').length), sub: 'Por cobrar' }
    ];

    kpis.forEach((kpi, idx) => {
      const x = 14 + idx * (kpiW + 3);
      doc.setFillColor(246, 248, 247);
      doc.setDrawColor(219, 227, 224);
      doc.roundedRect(x, kpiY, kpiW, 14, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(96, 115, 113);
      doc.text(kpi.label, x + 3, kpiY + 4);

      doc.setFontSize(9.5);
      doc.setTextColor(25, 59, 58);
      doc.text(kpi.val, x + 3, kpiY + 9);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(130, 145, 143);
      doc.text(kpi.sub, x + 3, kpiY + 12.2);
    });

    // 5. Configuración de filas y columnas para AutoTable
    let headColumns;
    let bodyRows;
    let footRows;
    let columnStyles;
    const cleanReportText = (val) => String(val || '').replace(/‚/g, 'é').replace(/\u201A/g, 'é');

    if (resource === 'reports') {
      headColumns = [[selection ? 'ID' : '#', 'Fecha', 'Vendedor / Asesor', 'Operación', 'Propiedad', 'Monto', 'Actividad']];
      bodyRows = data.map((record, index) => [
        String(selection ? record.id : index + 1),
        formatD(record.fecha),
        cleanReportText(record.vendedor || 'Sin vendedor'),
        String(record.operacion || '—').toUpperCase(),
        cleanReportText(record.propiedad || 'Sin propiedad'),
        formatMoney(record.cobros),
        record.actividad || '—'
      ]);
      footRows = [
        ['', 'TOTALES', `Cobros: ${formatMoney(totalCobros)}`, `${salesRecords.length}V / ${rentalsRecords.length}R`, 'Costo compras', formatMoney(totalComprasMonto), '']
      ];
      columnStyles = {
        0: { cellWidth: selection ? 15 : 10, halign: 'center' },
        1: { cellWidth: 22, halign: 'center' },
        2: { cellWidth: 36, halign: 'left' },
        3: { cellWidth: 22, halign: 'center' },
        4: { cellWidth: selection ? 43 : 48, halign: 'left' },
        5: { cellWidth: 28, halign: 'right' },
        6: { cellWidth: 16, halign: 'center' }
      };
    } else {
      headColumns = [['#', 'Propiedad', '% Agencia', 'Operación', 'Comisión', 'Estado', 'Fecha']];
      bodyRows = data.map((record, index) => [
        String(index + 1),
        record.propiedad || '—',
        `${record.porcentaje_agencia || 0}%`,
        formatCommissionMoney(record.monto_operacion),
        formatCommissionMoney(record.monto_total),
        String(record.estado || '—').toUpperCase(),
        formatD(record.creado_en)
      ]);
      footRows = [
        ['', 'TOTAL', '', '', formatCommissionMoney(totalCobros), `${totalCount} reg.`, '']
      ];
      columnStyles = {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 50, halign: 'left' },
        2: { cellWidth: 18, halign: 'center' },
        3: { cellWidth: 28, halign: 'right' },
        4: { cellWidth: 28, halign: 'right' },
        5: { cellWidth: 24, halign: 'center' },
        6: { cellWidth: 24, halign: 'center' }
      };
    }

    const autoTableOpts = {
      startY: 48,
      margin: { left: 14, right: 14, top: 16, bottom: 18 },
      head: headColumns,
      body: bodyRows,
      foot: footRows,
      theme: 'grid',
      headStyles: {
        fillColor: [25, 59, 58],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
        halign: 'center',
        cellPadding: 2.5
      },
      bodyStyles: {
        textColor: [28, 40, 38],
        fontSize: 7,
        cellPadding: 2.2,
        lineColor: [221, 227, 225],
        lineWidth: 0.15
      },
      alternateRowStyles: {
        fillColor: [248, 250, 249]
      },
      footStyles: {
        fillColor: [238, 243, 241],
        textColor: [25, 59, 58],
        fontStyle: 'bold',
        fontSize: 7.5,
        lineColor: [25, 59, 58],
        lineWidth: 0.25
      },
      columnStyles,
      willDrawCell: function (cellData) {
        if (cellData.section === 'body') {
          if (resource === 'reports') {
            if (cellData.column.index === 3) {
              const val = String(cellData.cell.raw || '').toUpperCase();
              if (val === 'VENTA') {
                cellData.cell.styles.textColor = [27, 94, 32];
                cellData.cell.styles.fontStyle = 'bold';
              } else if (val === 'RENTA') {
                cellData.cell.styles.textColor = [13, 71, 161];
                cellData.cell.styles.fontStyle = 'bold';
              }
            }
            if (cellData.column.index === 5) {
              cellData.cell.styles.fontStyle = 'bold';
              cellData.cell.styles.textColor = [25, 59, 58];
            }
          } else {
            if (cellData.column.index === 4) {
              cellData.cell.styles.fontStyle = 'bold';
              cellData.cell.styles.textColor = [25, 59, 58];
            }
            if (cellData.column.index === 5) {
              const val = String(cellData.cell.raw || '').toUpperCase();
              if (val === 'PAGADA') {
                cellData.cell.styles.textColor = [27, 94, 32];
                cellData.cell.styles.fontStyle = 'bold';
              } else if (val === 'PENDIENTE') {
                cellData.cell.styles.textColor = [180, 83, 9];
                cellData.cell.styles.fontStyle = 'bold';
              }
            }
          }
        }
      }
    };

    if (typeof doc.autoTable === 'function') {
      doc.autoTable(autoTableOpts);
    } else if (typeof window.autoTable === 'function') {
      window.autoTable(doc, autoTableOpts);
    } else if (window.jspdf && typeof window.jspdf.autoTable === 'function') {
      window.jspdf.autoTable(doc, autoTableOpts);
    } else {
      throw new Error('No se pudo cargar el componente de tablas PDF.');
    }

    // 6. Marca de agua y pie de página en TODAS las páginas
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);

      // Franja de encabezado en páginas subsiguientes
      if (i > 1) {
        doc.setFillColor(25, 59, 58);
        doc.rect(0, 0, pw, 3, 'F');
        doc.setFillColor(239, 133, 111);
        doc.rect(0, 3, pw, 1, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(25, 59, 58);
        doc.text(`BIENES Y NEGOCIOS RENATO • ${reportTitle} (Continuación)`, 14, 8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(96, 115, 113);
        doc.text(`Folio: ${folio}`, pw - 14, 8, { align: 'right' });
        doc.setDrawColor(219, 227, 224);
        doc.setLineWidth(0.15);
        doc.line(14, 10, pw - 14, 10);
      }

      // MARCA DE AGUA corporativa
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.08 }));
      const watermarkWidth = 160;
      const watermarkHeight = watermarkWidth * logoRatio;
      doc.addImage(logoImg, 'JPEG', (pw - watermarkWidth) / 2, (ph - watermarkHeight) / 2, watermarkWidth, watermarkHeight, 'corporate-logo');
      doc.restoreGraphicsState();

      // Pie de página profesional
      doc.setDrawColor(219, 227, 224);
      doc.setLineWidth(0.2);
      doc.line(14, ph - 12, pw - 14, ph - 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(96, 115, 113);
      doc.text('Bienes y Negocios Renato • Documento confidencial para uso administrativo interno', 14, ph - 7.5);
      doc.text(`Página ${i} de ${totalPages} • ${now.toLocaleDateString('es-MX')} ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`, pw - 14, ph - 7.5, { align: 'right' });
    }

    const dateStr = now.toISOString().slice(0, 10);
    const fileName = selection
      ? `reporte-${String(data[0].operacion).toLowerCase()}-${data[0].id}-${dateStr}.pdf`
      : `${resource === 'reports' ? 'reporte-operaciones' : 'reporte-comisiones'}-${dateStr}.pdf`;
    doc.save(fileName);
    showToast('Reporte PDF descargado exitosamente.');
  } catch (error) {
    console.error('Error al generar PDF:', error);
    showToast(error.message || 'Hubo un error al generar el PDF.', true);
  }
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
    if (!record) return;
    fields[0].querySelector('select').value = record.estado;
    const priorityField = renderField(['prioridad', 'Prioridad', 'select', true, [{ id: 'automatica', nombre: 'Automática según fecha límite' }, 'baja', 'normal', 'alta', 'urgente']]);
    const deadlineField = renderField(['fecha_limite', 'Fecha límite', 'date']);
    const costField = renderField(['costo_final', 'Costo final', 'number']);
    const assigneeField = renderField(['asignado_a', 'Responsable', 'options', false, 'users']);
    priorityField.querySelector('select').value = record.prioridad_automatica ? 'automatica' : record.prioridad;
    deadlineField.querySelector('input').value = String(record.fecha_limite || '').slice(0, 10);
    costField.querySelector('input').value = record.costo_final ?? '';
    assigneeField.querySelector('select').value = record.asignado_a ?? '';
    fields.push(priorityField, deadlineField, costField, assigneeField);
  }
  dialog.querySelector('.workflow-fields').replaceChildren(...fields);
  enableWorkflowSearchableSelects(form);
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
  const fields = renderFormSections([
    ['', 'Datos de la propiedad', 'section'],
    ['titulo', 'Título', 'text', true], ['costo_adquisicion', 'Costo de adquisición', 'number'], ['precio', 'Precio de venta o renta', 'number', true],
    ['estado_propiedad', 'Estado', 'select', true, ['Disponible', 'Reservada', 'Vendida', 'Rentada', 'Inactiva']],
    ...(isAdmin ? [['id_categoria', 'Categoría', 'options', true, 'categories']] : []),
    ['descripcion', 'Descripción', 'textarea'],
    ['', 'Ubicación', 'section'],
    ['latitud', 'Latitud de Google Maps', 'number'], ['longitud', 'Longitud de Google Maps', 'number'],
    ['', 'Fotografía', 'section'],
    ['imagen', 'Cambiar imagen (JPEG, PNG o WebP; máximo 10 MB)', 'file'],
  ], (definition) => {
    const element = renderField(definition);
    const input = element.querySelector('input, textarea, select');
    if (definition[2] !== 'file') input.value = definition[0] === 'id_categoria' ? record.id_categoria : record[definition[0]] ?? '';
    return element;
  });
  dialog.querySelector('.workflow-fields').replaceChildren(...fields);
  enableWorkflowSearchableSelects(form);
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
  const fields = renderFormSections([
    ['', 'Datos personales', 'section'],
    ['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true],
    ['apellido_materno', 'Apellido materno', 'text'],
    ['', 'Contacto y acceso', 'section'],
    ['correo', 'Correo', 'email', true],
    ['telefono', 'Teléfono', 'tel'], ['password', 'Nueva contraseña (opcional)', 'password'],
  ], (definition) => {
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
  const fields = renderFormSections([
    ['', 'Datos personales', 'section'],
    ['nombre', 'Nombre', 'text', true], ['apellido_paterno', 'Apellido paterno', 'text', true],
    ['apellido_materno', 'Apellido materno', 'text'],
    ['', 'Contacto y acceso', 'section'],
    ['correo', 'Correo', 'email', true],
    ['telefono', 'Teléfono', 'tel'], ['password', 'Nueva contraseña (opcional)', 'password'],
    ['rol', 'Función', 'select', true, [
      { id: 'cliente', nombre: 'Cliente' },
      { id: 'usuario', nombre: 'Usuario' },
      { id: 'vendedor', nombre: 'Vendedor' },
      { id: 'administrador', nombre: 'Administrador' },
    ]],
  ], (definition) => {
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
    enableSearchableSelect(content.querySelector('[name="asignado_a"]'), 'Asignar a');
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
  if (!validateWorkflowForm(form)) return;
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
      const values = new FormData(form);
      ['latitud', 'longitud'].forEach((key) => {
        if (values.get(key) === '') values.delete(key);
      });
      if (!values.get('id_categoria')) values.delete('id_categoria');
      if (!form.querySelector('[name="imagen"]').files.length) values.delete('imagen');
      await api.request(`/api/properties/${form.dataset.recordId}`, { method: 'PUT', body: values });
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
    } else if (kind === 'property') {
      const values = new FormData(form);
      if (!form.querySelector('[name="imagen"]').files.length) values.delete('imagen');
      await api.request('/api/properties', { method: 'POST', body: values });
    } else {
      const values = Object.fromEntries(new FormData(form));
      form.querySelectorAll('input[type="number"]').forEach((input) => {
        if (values[input.name] !== undefined && values[input.name] !== '') values[input.name] = Number(values[input.name]);
      });
      if (kind === 'contract') {
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
  if (viewId === 'reports-view') {
    if (button && button.dataset.action === 'download-csv-report') return downloadCsv('reports');
    return downloadPdfReport('reports');
  }
}

// Gestiona el inicio de sesion y los eventos delegados de las tablas y ventanas.
const loginForm = document.getElementById('login-form');
loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorElement = document.getElementById('login-error');
  errorElement.textContent = '';
  const formData = new FormData(loginForm);
  try {
    const user = await api.login(formData.get('correo'), formData.get('contrasena'));
    if (user.rol === 'cliente') {
      window.location.assign('/portal-inquilinos.html');
      return;
    }
    hideLogin();
    addSecondaryActions();
    startNotificationPolling();
    await loadWorkspace();
  } catch (error) {
    errorElement.textContent = error.message;
  }
});

document.addEventListener('click', async (event) => {
  const calendarControl = event.target.closest('[data-calendar-mode], [data-calendar-move], [data-calendar-today]');
  if (calendarControl) {
    let selector;
    if (calendarControl.hasAttribute('data-calendar-mode')) {
      visitCalendarState.mode = calendarControl.dataset.calendarMode;
      selector = `[data-calendar-mode="${visitCalendarState.mode}"]`;
    } else if (calendarControl.hasAttribute('data-calendar-move')) {
      const direction = Number(calendarControl.dataset.calendarMove);
      moveVisitCalendar(direction);
      selector = `[data-calendar-move="${direction}"]`;
    } else {
      visitCalendarState.date = new Date();
      selector = '[data-calendar-today]';
    }
    const panel = calendarControl.closest('[data-visit-calendar]');
    renderVisitCalendar(panel, records.visits);
    panel.querySelector(selector)?.focus();
    return;
  }
  const generateMatches = event.target.closest('[data-generate-matches]');
  if (generateMatches) {
    await runMatchingGeneration(generateMatches);
    return;
  }
  const clearMatchFilters = event.target.closest('[data-match-clear]');
  if (clearMatchFilters) {
    clearMatchFilters.closest('form').reset();
    matchingState.filters = {};
    try { await loadMatchPage(1); } catch (error) { showToast(`No se pudieron cargar las coincidencias: ${error.message}`, true); }
    return;
  }
  const extraPage = event.target.closest('[data-match-extra-page]');
  if (extraPage) {
    try { await loadMatchingExtra(extraPage.dataset.matchExtraKind, Number(extraPage.dataset.matchExtraPage)); }
    catch (error) { showToast(`No se pudo cargar el historial: ${error.message}`, true); }
    return;
  }
  const retiredTrack = event.target.closest('[data-retired-track]');
  if (retiredTrack) {
    retiredTrack.disabled = true;
    try {
      await api.request(`/api/workflows/matching/tracking/${encodeURIComponent(retiredTrack.dataset.leadId)}/${encodeURIComponent(retiredTrack.dataset.propertyId)}`, {
        method: 'PATCH', body: JSON.stringify({ [retiredTrack.dataset.retiredTrack]: retiredTrack.dataset.value === 'true' }),
      });
      await loadMatchingExtra('retired');
    } catch (error) { showToast(`No se pudo actualizar el seguimiento: ${error.message}`, true); retiredTrack.disabled = false; }
    return;
  }
  const matchAction = event.target.closest('[data-match-track], [data-match-share]');
  if (matchAction) {
    const match = records.matches.find((item) => String(item.id_coincidencia) === matchAction.dataset.matchId);
    if (!match) { showToast('La coincidencia ya no está disponible. Actualiza los resultados.', true); return; }
    if (matchAction.dataset.matchShare) { await shareMatch(match, matchAction.dataset.matchShare); return; }
    matchAction.disabled = true;
    try {
      const field = matchAction.dataset.matchTrack;
      await api.request(`/api/workflows/matching/tracking/${encodeURIComponent(match.id_lead)}/${encodeURIComponent(match.id_propiedad)}`, {
        method: 'PATCH', body: JSON.stringify({ [field]: !match[field] }),
      });
      await loadMatchPage();
    } catch (error) { showToast(`No se pudo actualizar el seguimiento: ${error.message}`, true); matchAction.disabled = false; }
    return;
  }
  const matchPage = event.target.closest('[data-match-page]');
  if (matchPage) {
    try { await loadMatchPage(Number(matchPage.dataset.matchPage)); }
    catch (error) { showToast(`No se pudieron cargar las coincidencias: ${error.message}`, true); }
    return;
  }
  const matchProperty = event.target.closest('[data-match-property]');
  if (matchProperty) {
    const panel = document.querySelector('#properties-view [data-record-panel="properties"]');
    const search = panel?.querySelector('[data-property-search]');
    if (!search) {
      showToast('El inventario aún no está disponible.', true);
      return;
    }
    search.value = matchProperty.dataset.matchProperty;
    propertyFilters.exactId = matchProperty.dataset.matchProperty;
    const category = panel.querySelector('[data-property-category]');
    if (category) {
      category.value = '';
      category.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const dateState = recordFilters.properties;
    if (dateState) {
      dateState.from = '';
      dateState.to = '';
      panel.querySelectorAll('[data-record-date]').forEach((input) => { input.value = ''; });
    }
    applyPropertyFilters(panel);
    document.querySelector('.nav-item[data-view="properties"]')?.click();
    return;
  }
  const matchVisit = event.target.closest('[data-match-visit]');
  if (matchVisit) {
    const match = records.matches.find((item) => String(item.id_coincidencia) === matchVisit.dataset.matchVisit);
    if (match) openMatchVisit(match);
    else showToast('La coincidencia ya no está disponible. Actualiza los resultados.', true);
    return;
  }
  const filter = event.target.closest('[data-record-filter]');
  if (filter) return;
  document.querySelectorAll('.client-row-actions[open]').forEach((menu) => {
    if (!menu.contains(event.target) || event.target.closest('button')) menu.open = false;
  });
  const tab = event.target.closest('[data-client-tab]');
  if (tab) {
    clientTableTab = tab.dataset.clientTab;
    syncClientTabs();
    const panel = document.querySelector('#clients-view [data-record-panel="clients"]');
    if (panel) applyRecordFilters(panel, 'clients');
    return;
  }
  const contractTab = event.target.closest('[data-contract-tab]');
  if (contractTab) {
    contractTableTab = contractTab.dataset.contractTab;
    syncContractTabs();
    return;
  }
  const priorityTab = event.target.closest('[data-maintenance-priority]');
  if (priorityTab) {
    maintenancePriorityTab = priorityTab.dataset.maintenancePriority;
    syncMaintenanceTabs();
    const panel = document.querySelector('#maintenance-view [data-record-panel="maintenance"]');
    if (panel) applyRecordFilters(panel, 'maintenance');
    return;
  }
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
      menu.classList.toggle('topbar-session-menu', !profileButton.matches('.profile-row'));
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
  const individualReportButton = event.target.closest('[data-download-report-id]');
  if (individualReportButton) {
    event.preventDefault();
    return downloadPdfReport('reports', {
      id: individualReportButton.dataset.downloadReportId,
      operacion: individualReportButton.dataset.reportOperation,
    });
  }
  const downloadReportPdfButton = event.target.closest('[data-download-report-pdf], [data-action="download-pdf-report"]');
  if (downloadReportPdfButton) {
    event.preventDefault();
    try { await downloadPdfReport('reports'); } catch (error) { showToast(error.message, true); }
    return;
  }
  const downloadReportCsvButton = event.target.closest('[data-download-report-csv], [data-action="download-csv-report"]');
  if (downloadReportCsvButton) {
    event.preventDefault();
    try { downloadCsv('reports'); } catch (error) { showToast(error.message, true); }
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
      if (!menu.hidden) loadNotifications().catch((error) => showToast(error.message, true));
    }
    return;
  }
  const notificationItem = event.target.closest('[data-notification-id]');
  if (notificationItem) {
    try {
      if (notificationItem.dataset.entity === 'maintenance') {
        const result = await api.get('maintenance');
        records.maintenance = result.data;
        renderRecords('maintenance', 'maintenance-view', records.maintenance);
      }
      await api.request(`/api/workflows/notifications/${notificationItem.dataset.notificationId}/read`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      const destination = {
        leads: 'clients', visits: 'visits', payments: 'rents', rentals: 'rents',
        maintenance: 'maintenance', clients: 'clients', matching: 'matching',
      }[notificationItem.dataset.entity];
      if (notificationItem.dataset.entity === 'clients' || notificationItem.dataset.entity === 'leads') {
        clientTableTab = notificationItem.dataset.entity === 'leads' ? 'potenciales' : 'todos';
        syncClientTabs();
        const clientsPanel = document.querySelector('#clients-view [data-record-panel="clients"]');
        if (clientsPanel) applyRecordFilters(clientsPanel, 'clients');
      }
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
  if (event.target.matches('[data-match-filters]')) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    if (data.precio_min && data.precio_max && Number(data.precio_min) > Number(data.precio_max)) {
      showToast('El precio mínimo no puede superar el precio máximo.', true);
      return;
    }
    matchingState.filters = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== ''));
    loadMatchPage(1).catch((error) => showToast(`No se pudieron filtrar las coincidencias: ${error.message}`, true));
  }
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
  if (event.target.matches('[data-table-column]')) {
    const scope = event.target.closest('[data-column-scope]');
    const resource = event.target.dataset.columnResource;
    const columns = resource === 'dashboard-properties' ? dashboardPropertyColumns : tableConfig[resource]?.columns;
    if (scope && columns) setTableColumnVisibility(scope, resource, columns, event.target.dataset.tableColumn, event.target.checked);
  }
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
      const filterKey = panel.dataset.filterKey || resource;
      const state = recordFilters[filterKey] || (recordFilters[filterKey] = { search: '', from: '', to: '' });
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

let matchSearchTimer;
document.addEventListener('input', (event) => {
  if (event.target.matches('[data-match-search]')) {
    matchingState.search = event.target.value.trim();
    matchingState.requestId += 1;
    clearTimeout(matchSearchTimer);
    matchSearchTimer = setTimeout(() => {
      loadMatchPage(1).catch((error) => showToast(`No se pudieron buscar las coincidencias: ${error.message}`, true));
    }, 250);
  }
  if (event.target.matches('[data-record-search]')) {
    const panel = event.target.closest('.persisted-panel');
    const resource = event.target.dataset.recordSearch;
    const filterKey = panel.dataset.filterKey || resource;
    const state = recordFilters[filterKey] || (recordFilters[filterKey] = { search: '', from: '', to: '' });
    state.search = event.target.value;
    applyRecordFilters(panel, resource);
  }
  if (event.target.matches('[data-property-search]')) {
    propertyFilters.exactId = '';
    applyPropertyFilters(event.target.closest('.persisted-panel'));
  }
});

const search = document.getElementById('global-search');
search?.addEventListener('input', () => {
  const query = search.value.toLocaleLowerCase();
  document.querySelectorAll('.persisted-panel tbody tr, #property-table tbody tr').forEach((row) => {
    if (row.closest('[data-record-panel="clients"], [data-record-panel="leads"]')) return;
    row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
  });
  document.querySelectorAll('.persisted-panel[data-record-panel]').forEach((panel) => {
    const resource = panel.dataset.recordPanel;
    if (resource === 'clients' || resource === 'leads') applyRecordFilters(panel, resource);
    else paginatePanel(panel, resource, true);
  });
  matchingState.requestId += 1;
  clearTimeout(matchSearchTimer);
  matchSearchTimer = setTimeout(() => {
    loadMatchPage(1).catch((error) => showToast(`No se pudieron buscar las coincidencias: ${error.message}`, true));
  }, 250);
});

document.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[data-client-tab], [data-contract-tab], [data-maintenance-priority]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }
  if (event.key === 'Escape') {
    const menu = event.target.closest('.client-row-actions[open]');
    if (menu) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  }
});

function positionClientMenu(details) {
  const anchor = details.querySelector('summary').getBoundingClientRect();
  const menu = details.querySelector('.client-row-menu');
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - bounds.height - 8, anchor.bottom + bounds.height > window.innerHeight - 8 ? anchor.top - bounds.height : anchor.bottom))}px`;
}

document.addEventListener('toggle', (event) => {
  const details = event.target;
  if (details.matches('[data-match-extra]') && details.open) {
    loadMatchingExtra(details.dataset.matchExtra).catch((error) => {
      details.querySelector('[data-match-extra-content]').textContent = 'No se pudieron cargar los datos.';
      showToast(`No se pudo cargar el historial: ${error.message}`, true);
    });
    return;
  }
  if (!details.matches('.client-row-actions') || !details.open) return;
  document.querySelectorAll('.client-row-actions[open]').forEach((other) => {
    if (other !== details) other.open = false;
  });
  positionClientMenu(details);
}, true);

document.addEventListener('scroll', () => {
  document.querySelectorAll('.client-row-actions[open]').forEach(positionClientMenu);
}, true);
window.addEventListener('resize', () => {
  document.querySelectorAll('.client-row-actions[open]').forEach(positionClientMenu);
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page-nav]');
  if (!button) return;
  const panel = button.closest('.persisted-panel');
  const resource = panel?.dataset.recordPanel;
  if (!resource) return;
  const pageKey = panel.dataset.filterKey || resource;
  tablePages[pageKey] = (tablePages[pageKey] || 1) + (button.dataset.pageNav === 'next' ? 1 : -1);
  paginatePanel(panel, resource);
});

if (api.token && JSON.parse(localStorage.getItem('habita_user') || '{}').rol === 'cliente') {
  localStorage.setItem('habita_tenant_token', api.token);
  api.logout();
  window.location.replace('/portal-inquilinos.html');
} else if (api.token) {
  hideLogin();
  addSecondaryActions();
  startNotificationPolling();
  loadWorkspace();
} else {
  showLogin();
}
