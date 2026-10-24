// Reemplaza el bloque GET /:resource en workflows.js con una versión reforzada
const fs = require('fs');
const path = require('path');

const workflowsPath = path.join(__dirname, 'server', 'routes', 'workflows.js');
let wf = fs.readFileSync(workflowsPath, 'utf8');

// Encuentra el bloque completo exacto (con \r\n para CRLF)
const oldBlock = `router.get('/:resource', requireAuth, async (request, response, next) => {\r\n  const query = listQueries[request.params.resource];\r\n  if (!query) return response.status(404).json({ error: 'Recurso no encontrado.' });\r\n  if (request.user.rol !== 'administrador' && request.user.rol !== 'vendedor' && request.user.rol !== 'admin') {\r\n    return response.status(403).json({ error: 'No tienes permisos para consultar usuarios.' });\r\n  }\r\n  if (request.params.resource === 'users' && request.user.rol !== 'administrador' && request.user.rol !== 'admin') {\r\n    return response.status(403).json({ error: 'No tienes permisos para consultar usuarios.' });\r\n  }\r\n  if (request.params.resource === 'sellers' && request.user.rol !== 'administrador' && request.user.rol !== 'admin') {\r\n    return response.status(403).json({ error: 'No tienes permisos para consultar vendedores.' });\r\n  }\r\n  try {\r\n    const result = await pool.query(query);\r\n    return response.json({ data: result.rows });\r\n  } catch (error) {\r\n    return next(error);\r\n  }\r\n});`;

const newBlock = `router.get('/:resource', requireAuth, async (request, response, next) => {\r\n  const query = listQueries[request.params.resource];\r\n  if (!query) return response.status(404).json({ error: 'Recurso no encontrado.' });\r\n  const rol = request.user.rol;\r\n  const isAdmin = rol === 'administrador' || rol === 'admin';\r\n  const isVendedor = rol === 'vendedor' || rol === 'agente';\r\n  // Solo administradores y vendedores pueden usar el sistema interno\r\n  if (!isAdmin && !isVendedor) {\r\n    return response.status(403).json({ error: 'No tienes permisos para acceder al sistema.' });\r\n  }\r\n  // Solo administradores pueden consultar usuarios y vendedores\r\n  if ((request.params.resource === 'users' || request.params.resource === 'sellers') && !isAdmin) {\r\n    return response.status(403).json({ error: 'Solo los administradores pueden acceder a esta sección.' });\r\n  }\r\n  try {\r\n    const result = await pool.query(query);\r\n    return response.json({ data: result.rows });\r\n  } catch (error) {\r\n    return next(error);\r\n  }\r\n});`;

// Normalizar para búsqueda (reemplazar => con unicode escape en el original)
if (wf.includes(oldBlock)) {
  wf = wf.replace(oldBlock, newBlock);
  console.log('✅ workflows.js: bloque GET /:resource reemplazado correctamente');
} else {
  // Buscar con regex flexible
  const regex = /router\.get\('\/\:resource', requireAuth, async \(request, response, next\) => \{[\s\S]*?if \(request\.params\.resource === 'sellers'[\s\S]*?\}\);/;
  if (regex.test(wf)) {
    wf = wf.replace(regex, newBlock);
    console.log('✅ workflows.js: bloque GET /:resource reemplazado via regex');
  } else {
    console.error('❌ No se pudo encontrar el bloque GET /:resource');
    process.exit(1);
  }
}

fs.writeFileSync(workflowsPath, wf, 'utf8');
console.log('Archivo guardado.');
