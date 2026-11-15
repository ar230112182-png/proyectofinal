require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function seedModulos() {
  const sqlFile = path.join(__dirname, '..', 'bd', 'seed_modulos.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  console.log('Poblando registros de los módulos restantes...');
  const client = await pool.connect();

  try {
    await client.query(sql);

    const counts = await client.query(`
      SELECT 'citas' AS modulo, count(*) AS total FROM citas
      UNION ALL
      SELECT 'expedientes_legales', count(*) FROM expedientes_legales
      UNION ALL
      SELECT 'rentas', count(*) FROM rentas
      UNION ALL
      SELECT 'pagos_renta', count(*) FROM pagos_renta
      UNION ALL
      SELECT 'solicitudes_mantenimiento', count(*) FROM solicitudes_mantenimiento
      UNION ALL
      SELECT 'comisiones', count(*) FROM comisiones;
    `);

    console.log('Registros de módulos cargados exitosamente:');
    console.table(counts.rows);
  } catch (error) {
    console.error('Error al poblar módulos:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedModulos().catch(() => {
  process.exitCode = 1;
});
