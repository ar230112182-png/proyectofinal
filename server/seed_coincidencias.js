require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function seedCoincidencias() {
  const sqlFile = path.join(__dirname, '..', 'bd', 'seed_coincidencias.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  console.log('Poblando prospectos y coincidencias guardadas...');
  const client = await pool.connect();

  try {
    await client.query(sql);

    const counts = await client.query(`
      SELECT 'leads' AS entidad, count(*) AS total FROM leads
      UNION ALL
      SELECT 'preferencias_lead', count(*) FROM preferencias_lead
      UNION ALL
      SELECT 'coincidencias', count(*) FROM coincidencias;
    `);

    console.log('Datos cargados exitosamente:');
    console.table(counts.rows);

    const sample = await client.query(`
      SELECT m.id_coincidencia, l.nombre AS lead, p.titulo AS propiedad, m.puntuacion, m.creada_en
      FROM coincidencias m
      JOIN leads l ON l.id_lead = m.id_lead
      JOIN propiedades p ON p.id_propiedad = m.id_propiedad
      ORDER BY m.puntuacion DESC, m.id_coincidencia DESC
      LIMIT 5;
    `);

    console.log('Muestra de coincidencias guardadas:');
    console.table(sample.rows);
  } catch (error) {
    console.error('Error al poblar coincidencias:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedCoincidencias().catch(() => {
  process.exitCode = 1;
});
