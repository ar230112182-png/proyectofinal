require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runSeed1000() {
  const sqlFile = path.join(__dirname, '..', 'bd', 'seed_1000.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  console.log('Iniciando inserciones de 1000 registros nuevos en cada tabla...');
  const client = await pool.connect();

  try {
    await client.query(sql);

    // Consulta de verificación
    const counts = await client.query(`
      SELECT 'usuarios' AS tabla, count(*) AS registros_lote_1000
      FROM usuarios WHERE correo LIKE 'demo1000.usuario%@example.test'
      UNION ALL
      SELECT 'agentes', count(*) FROM agentes WHERE numero_licencia LIKE 'DEMO1000-%'
      UNION ALL
      SELECT 'propietarios', count(*) FROM propietarios WHERE correo LIKE 'demo1000.propietario%@example.test'
      UNION ALL
      SELECT 'direcciones', count(*) FROM direcciones WHERE calle LIKE 'Calle Demo 1000 %'
      UNION ALL
      SELECT 'propiedades', count(*) FROM propiedades WHERE titulo LIKE 'Propiedad Demo1000 %'
      UNION ALL
      SELECT 'compras', count(*) FROM compras WHERE observaciones = 'Compra demo1000 para pruebas.'
      UNION ALL
      SELECT 'operaciones', count(*) FROM operaciones WHERE observaciones = 'Operacion demo1000 para pruebas.'
      ORDER BY tabla;
    `);

    console.log('Nuevas inserciones completadas exitosamente:');
    console.table(counts.rows);
  } catch (error) {
    console.error('Error durante las inserciones:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed1000().catch(() => {
  process.exitCode = 1;
});
