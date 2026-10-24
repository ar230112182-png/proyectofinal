// Aplica protecciones de acceso finales
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// PATCH A: main.js – redirigir si está en vista protegida sin ser admin
// ──────────────────────────────────────────────
const mainPath = path.join(__dirname, 'js', 'cruds', 'main.js');
let main = fs.readFileSync(mainPath, 'utf8');

// Buscar exactamente cómo aparece en el archivo (puede ser LF o CRLF)
// Usamos indexOf para buscar y splice para reemplazar
const marker = "if (usersNavigation) usersNavigation.hidden = !isAdmin;\r\n    if (sellersNavigation) sellersNavigation.hidden = !isAdmin;";
const markerLF = "if (usersNavigation) usersNavigation.hidden = !isAdmin;\n    if (sellersNavigation) sellersNavigation.hidden = !isAdmin;";

const addition = `\r\n    // Redirigir al dashboard si el usuario no es admin y está en vista protegida\r\n    if (!isAdmin) {\r\n      const activeProtected = document.querySelector('.active-view#sellers-view, .active-view#users-view');\r\n      if (activeProtected) {\r\n        const dashBtn = document.querySelector('[data-view=\"dashboard\"]');\r\n        if (dashBtn) dashBtn.click();\r\n      }\r\n    }`;

let found = false;
if (main.includes(marker)) {
  main = main.replace(marker, marker + addition);
  found = true;
  console.log('✅ main.js: redirección de vista protegida añadida (CRLF)');
} else if (main.includes(markerLF)) {
  main = main.replace(markerLF, markerLF + addition.replace(/\r\n/g, '\n'));
  found = true;
  console.log('✅ main.js: redirección de vista protegida añadida (LF)');
}
if (!found) console.log('⚠️  main.js: marcador no encontrado para redirección');

fs.writeFileSync(mainPath, main, 'utf8');

// ──────────────────────────────────────────────
// PATCH B: index.html – proteger showView contra acceso directo
// ──────────────────────────────────────────────
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const oldShowView = `        function showView(viewName) {\r\n            if (!document.getElementById(viewName + '-view')) return;\r\n            const loader = document.getElementById('view-loading');\r\n            loader.classList.add('visible');\r\n            clearTimeout(viewTransitionTimer);\r\n            views.forEach(view => view.classList.toggle('active-view', view.id === viewName + '-view'));\r\n            document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === viewName));\r\n            breadcrumb.textContent = titles[viewName] || viewName;\r\n            window.scrollTo({ top: 0, behavior: 'smooth' });\r\n            viewTransitionTimer = setTimeout(() => loader.classList.remove('visible'), 280);\r\n        }`;

const newShowView = `        const protectedViews = new Set(['sellers', 'users']);\r\n        function showView(viewName) {\r\n            if (!document.getElementById(viewName + '-view')) return;\r\n            // Bloquear acceso a secciones protegidas si no es administrador\r\n            if (protectedViews.has(viewName)) {\r\n                if (typeof window.isCurrentUserAdmin !== 'function' || !window.isCurrentUserAdmin()) {\r\n                    return;\r\n                }\r\n            }\r\n            const loader = document.getElementById('view-loading');\r\n            loader.classList.add('visible');\r\n            clearTimeout(viewTransitionTimer);\r\n            views.forEach(view => view.classList.toggle('active-view', view.id === viewName + '-view'));\r\n            document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === viewName));\r\n            breadcrumb.textContent = titles[viewName] || viewName;\r\n            window.scrollTo({ top: 0, behavior: 'smooth' });\r\n            viewTransitionTimer = setTimeout(() => loader.classList.remove('visible'), 280);\r\n        }`;

const oldShowViewLF = oldShowView.replace(/\r\n/g, '\n');
const newShowViewLF = newShowView.replace(/\r\n/g, '\n');

let foundHtml = false;
if (html.includes(oldShowView)) {
  html = html.replace(oldShowView, newShowView);
  foundHtml = true;
  console.log('✅ index.html: showView protegido (CRLF)');
} else if (html.includes(oldShowViewLF)) {
  html = html.replace(oldShowViewLF, newShowViewLF);
  foundHtml = true;
  console.log('✅ index.html: showView protegido (LF)');
}

if (!foundHtml) {
  // Buscar el patrón con regex como fallback
  const regex = /(\s*function showView\(viewName\) \{[\s\S]*?viewTransitionTimer = setTimeout[\s\S]*?280\);\s*\})/;
  const match = html.match(regex);
  if (match) {
    // Insertar verificación al inicio del cuerpo de showView
    const oldFn = match[0];
    const newFn = oldFn.replace(
      /(\s*function showView\(viewName\) \{\s*\n\s*if \(!document)/,
      (m, prefix) => {
        return `\n        const protectedViews = new Set(['sellers', 'users']);` + prefix + `if (protectedViews.has(viewName)) {\n                if (typeof window.isCurrentUserAdmin !== 'function' || !window.isCurrentUserAdmin()) {\n                    return;\n                }\n            }\n            if (!document`;
      }
    );
    html = html.replace(oldFn, newFn);
    console.log('✅ index.html: showView protegido (regex fallback)');
  } else {
    console.error('❌ index.html: no se pudo encontrar showView');
  }
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('\n✅ Protecciones de acceso aplicadas correctamente.');
