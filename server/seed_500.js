require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runSeed500() {
  const sqlFile = path.join(__dirname, '..', 'bd', 'seed_500.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  console.log('Iniciando inserciones de 500 registros en la base de datos...');
  const client = await pool.connect();

  try {
    await client.query(sql);

    // Consulta de verificación
    const counts = await client.query(`
      SELECT 'usuarios' AS tabla, count(*) AS registros
      FROM usuarios WHERE correo LIKE 'demo500.usuario%@example.test'
      UNION ALL
      SELECT 'agentes', count(*) FROM agentes WHERE numero_licencia LIKE 'DEMO500-%'
      UNION ALL
      SELECT 'propietarios', count(*) FROM propietarios WHERE correo LIKE 'demo500.propietario%@example.test'
      UNION ALL
      SELECT 'direcciones', count(*) FROM direcciones WHERE calle LIKE 'Calle Demo 500 %'
      UNION ALL
      SELECT 'propiedades', count(*) FROM propiedades WHERE titulo LIKE 'Propiedad Demo500 %'
      UNION ALL
      SELECT 'compras', count(*) FROM compras WHERE observaciones = 'Compra demo500 para pruebas.'
      UNION ALL
      SELECT 'operaciones', count(*) FROM operaciones WHERE observaciones = 'Operacion demo500 para pruebas.'
      ORDER BY tabla;
    `);

    console.log('Inserciones completadas exitosamente:');
    console.table(counts.rows);
  } catch (error) {
    console.error('Error durante las inserciones:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed500().catch(() => {
  process.exitCode = 1;
});
