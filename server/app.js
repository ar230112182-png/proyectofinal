require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const authRoutes = require('./routes/auth');
const propertyRoutes = require('./routes/properties');
const workflowRoutes = require('./routes/workflows');

const app = express();
const port = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.warn('Faltan DATABASE_URL o JWT_SECRET. Copia .env.example a .env antes de iniciar.');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ ok: true, service: 'bienesyraises-api', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    response.status(503).json({ ok: false, service: 'bienesyraises-api', database: 'unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/workflows', workflowRoutes);

app.use((error, _request, response, _next) => {
  console.error(error);
  if (error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'El archivo supera el límite de 10 MB.' });
  }
  if (error.message === 'Tipo de archivo no permitido.') {
    return response.status(400).json({ error: error.message });
  }
  response.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(port, () => {
  console.log(`Habita disponible en http://localhost:${port}`);
});
