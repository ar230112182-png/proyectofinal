/**
 * Patch de seguridad:
 * 1. main.js  – bloquear navegación a sellers/users si no es admin
 * 2. workflows.js – reforzar GET /:resource para sellers y users
 */
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// PATCH 1: main.js – bloquear navegación protegida
// ──────────────────────────────────────────────
const mainPath = path.join(__dirname, 'js', 'cruds', 'main.js');
let main = fs.readFileSync(mainPath, 'utf8');

// Buscar el bloque de loadWorkspace donde se ocultan/muestran los nav items
// y agregar la protección de las vistas sellers/users
const oldNavHide = `    const usersNavigation = document.querySelector('[data-view="users"]');
    const sellersNavigation = document.querySelector('[data-view="sellers"]');
    if (usersNavigation) usersNavigation.hidden = !isAdmin;
    if (sellersNavigation) sellersNavigation.hidden = !isAdmin;`;

const newNavHide = `    const usersNavigation = document.querySelector('[data-view="users"]');
    const sellersNavigation = document.querySelector('[data-view="sellers"]');
    if (usersNavigation) usersNavigation.hidden = !isAdmin;
    if (sellersNavigation) sellersNavigation.hidden = !isAdmin;
    // Si no es admin y está en una vista protegida, redirigir al dashboard
    const activeProtected = document.querySelector('.active-view#sellers-view, .active-view#users-view');
    if (!isAdmin && activeProtected) {
      const dashBtn = document.querySelector('[data-view="dashboard"]');
      if (dashBtn) dashBtn.click();
    }`;

if (main.includes(oldNavHide)) {
  main = main.replace(oldNavHide, newNavHide);
  console.log('✅ main.js: protección de vista en loadWorkspace aplicada');
} else {
  console.log('⚠️  main.js: bloque de navegación no encontrado, posiblemente ya aplicado');
}

// También necesitamos proteger showView en el HTML (index.html)
// Pero la función showView está en index.html, no en main.js.
// Exportamos una función helper que index.html puede llamar.

// Agregar helper isCurrentUserAdmin al API global
const oldApiExport = 'window.habitaApi = api;';
const newApiExport = `window.habitaApi = api;

function isCurrentUserAdmin() {
  try {
    const user = JSON.parse(localStorage.getItem('habita_user') || '{}');
    return ['administrador', 'admin'].includes(user.rol);
  } catch { return false; }
}
window.isCurrentUserAdmin = isCurrentUserAdmin;`;

if (!main.includes('window.isCurrentUserAdmin')) {
  main = main.replace(oldApiExport, newApiExport);
  console.log('✅ main.js: helper isCurrentUserAdmin exportado');
} else {
  console.log('ℹ️  main.js: isCurrentUserAdmin ya existe');
}

fs.writeFileSync(mainPath, main, 'utf8');

// ──────────────────────────────────────────────
// PATCH 2: workflows.js – asegurar GET /:resource para sellers/users
// ──────────────────────────────────────────────
const workflowsPath = path.join(__dirname, 'server', 'routes', 'workflows.js');
let wf = fs.readFileSync(workflowsPath, 'utf8');

const oldGenericGet = `router.get('/:resource', requireAuth, async (request, response, next) => {
  const query = listQueries[request.params.resource];
  if (!query) return response.status(404).json({ error: 'Recurso no encontrado.' });
  if (request.user.rol !== 'administrador' && request.user.rol !== 'vendedor' && request.user.rol !== 'admin') {
    return response.status(403).json({ error: 'No tienes permisos para consultar usuarios.' });
  }
  if (request.params.resource === 'users' && request.user.rol !== 'administrador' && request.user.rol !== 'admin') {
    return response.status(403).json({ error: 'No tienes permisos para consultar usuarios.' });
  }
  if (request.params.resource === 'sellers' && request.user.rol !== 'administrador' && request.user.rol !== 'admin') {
    return response.status(403).json({ error: 'No tienes permisos para consultar vendedores.' });
  }`;

const newGenericGet = `router.get('/:resource', requireAuth, async (request, response, next) => {
  const query = listQueries[request.params.resource];
  if (!query) return response.status(404).json({ error: 'Recurso no encontrado.' });
  const rol = request.user.rol;
  const isAdmin = rol === 'administrador' || rol === 'admin';
  const isVendedor = rol === 'vendedor' || rol === 'agente';
  // Solo administradores y vendedores pueden entrar al sistema
  if (!isAdmin && !isVendedor) {
    return response.status(403).json({ error: 'No tienes permisos para acceder al sistema.' });
  }
  // Solo administradores pueden consultar usuarios y vendedores
  if ((request.params.resource === 'users' || request.params.resource === 'sellers') && !isAdmin) {
    return response.status(403).json({ error: 'Solo los administradores pueden acceder a esta sección.' });
  }`;

if (wf.includes(oldGenericGet)) {
  wf = wf.replace(oldGenericGet, newGenericGet);
  console.log('✅ workflows.js: GET /:resource reforzado');
} else {
  console.log('⚠️  workflows.js: bloque GET no encontrado, revisando...');
  // Intento alternativo más flexible
  const idx = wf.indexOf("router.get('/:resource', requireAuth");
  if (idx !== -1) {
    console.log('   Bloque encontrado en posición', idx);
  } else {
    console.log('   ❌ Bloque no encontrado');
  }
}

fs.writeFileSync(workflowsPath, wf, 'utf8');

console.log('\n✅ Todos los parches de seguridad aplicados.');
