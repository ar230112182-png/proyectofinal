const jwt = require('jsonwebtoken');

function requireAuth(request, response, next) {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!token) {
    return response.status(401).json({ error: 'Se requiere autenticacion.' });
  }

  try {
    request.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return response.status(401).json({ error: 'La sesion no es valida o ha expirado.' });
  }
}

function requireRole(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.user.rol)) {
      return response.status(403).json({ error: 'No tienes permisos para esta operacion.' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
