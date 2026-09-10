require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const propertyRoutes = require('./routes/properties');

const app = express();
const port = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  console.warn('Faltan DATABASE_URL o JWT_SECRET. Copia .env.example a .env antes de iniciar.');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'bienesyraises-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(port, () => {
  console.log(`Habita disponible en http://localhost:${port}`);
});
