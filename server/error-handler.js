function errorHandler(error, _request, response, _next) {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'El cuerpo de la solicitud debe contener JSON válido.' });
  }
  console.error(error);
  if (error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'El archivo supera el límite de 10 MB.' });
  }
  if (error.message === 'Tipo de archivo no permitido.') {
    return response.status(400).json({ error: error.message });
  }
  return response.status(500).json({ error: 'Error interno del servidor.' });
}

module.exports = errorHandler;
