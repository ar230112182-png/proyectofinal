const api = {
  token: localStorage.getItem('habita_token'),

  async request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
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

  listProperties() {
    return this.request('/api/properties');
  },

  logout() {
    this.token = null;
    localStorage.removeItem('habita_token');
    localStorage.removeItem('habita_user');
  },
};

window.habitaApi = api;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function showLogin() {
  document.getElementById('auth-overlay').hidden = false;
}

function hideLogin() {
  document.getElementById('auth-overlay').hidden = true;
}

function renderProperties(properties) {
  const tableBody = document.querySelector('#property-table tbody');
  if (!tableBody) return;

  tableBody.innerHTML = properties.map((property) => `
    <tr>
      <td><div class="property-name"><div class="property-photo photo-one"></div><span><strong>${escapeHtml(property.titulo)}</strong><small>${escapeHtml(property.direccion)}</small></span></div></td>
      <td>${escapeHtml(property.tipo)}</td>
      <td><span class="status status-green">${escapeHtml(property.estado)}</span></td>
      <td><strong>$${Number(property.precio).toLocaleString('es-MX')}</strong></td>
      <td>${escapeHtml(property.agente || 'Sin asignar')}</td>
      <td><button class="row-menu" type="button" aria-label="Acciones">•••</button></td>
    </tr>
  `).join('');
}

async function loadProperties() {
  try {
    const payload = await api.listProperties();
    renderProperties(payload.data);
  } catch (error) {
    if (error.message.includes('sesion') || error.message.includes('autenticacion')) {
      showLogin();
      return;
    }
    console.error(error);
  }
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorElement = document.getElementById('login-error');
    errorElement.textContent = '';
    const formData = new FormData(loginForm);

    try {
      await api.login(formData.get('correo'), formData.get('contrasena'));
      hideLogin();
      await loadProperties();
    } catch (error) {
      errorElement.textContent = error.message;
    }
  });
}

if (api.token) {
  loadProperties();
} else {
  showLogin();
}
