require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('./db');

async function seed() {
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('demo-clientes-comisiones-1500'))");
    const prerequisites = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM propiedades WHERE eliminado = FALSE AND precio > 0 AND titulo LIKE 'Propiedad Demo%') AS properties,
        (SELECT COUNT(*) FROM usuarios WHERE activo = TRUE AND rol IN ('vendedor', 'agente') AND correo LIKE 'demo%@example.test') AS sellers
    `);
    if (!Number(prerequisites.rows[0].properties) || !Number(prerequisites.rows[0].sellers)) {
      throw new Error('Se necesita al menos una propiedad y un vendedor de demostración activos.');
    }

    const collisions = await client.query(`
      SELECT COUNT(*) AS total FROM generate_series(1, 1500) AS g
      JOIN usuarios u ON u.correo = 'demo-comision1500-' || lpad(g::text, 4, '0') || '@example.test'
      WHERE u.rol <> 'cliente' OR u.nombre <> 'ClienteDemo' || lpad(g::text, 4, '0')
        OR u.apellido_paterno <> 'Prueba'
    `);
    if (Number(collisions.rows[0].total)) throw new Error('Hay cuentas existentes que coinciden con los correos del lote de prueba.');

    await client.query(`
      INSERT INTO usuarios (nombre, apellido_paterno, correo, password, rol, activo)
      SELECT 'ClienteDemo' || lpad(g::text, 4, '0'), 'Prueba',
        'demo-comision1500-' || lpad(g::text, 4, '0') || '@example.test', $1, 'cliente', TRUE
      FROM generate_series(1, 1500) AS g
      ON CONFLICT (correo) DO NOTHING
    `, [passwordHash]);
    await client.query(`
      INSERT INTO clientes (id_usuario)
      SELECT u.id_usuario FROM generate_series(1, 1500) AS g
      JOIN usuarios u ON u.correo = 'demo-comision1500-' || lpad(g::text, 4, '0') || '@example.test'
      WHERE NOT EXISTS (SELECT 1 FROM clientes c WHERE c.id_usuario = u.id_usuario)
    `);
    await client.query(`
      CREATE TEMP TABLE demo_clientes_comisiones ON COMMIT DROP AS
      SELECT g, c.id_cliente
      FROM generate_series(1, 1500) AS g
      JOIN usuarios u ON u.correo = 'demo-comision1500-' || lpad(g::text, 4, '0') || '@example.test'
      JOIN clientes c ON c.id_usuario = u.id_usuario
    `);
    const clientCount = await client.query('SELECT COUNT(*) AS total, COUNT(DISTINCT g) AS distinct_total FROM demo_clientes_comisiones');
    if (Number(clientCount.rows[0].total) !== 1500 || Number(clientCount.rows[0].distinct_total) !== 1500) {
      throw new Error('El lote debe contener exactamente 1500 clientes distintos.');
    }

    const inserted = await client.query(`
      WITH choices AS (
        SELECT
          (SELECT array_agg(id_propiedad ORDER BY id_propiedad) FROM propiedades
           WHERE eliminado = FALSE AND precio > 0 AND titulo LIKE 'Propiedad Demo%') AS properties,
          (SELECT array_agg(id_usuario ORDER BY id_usuario) FROM usuarios
           WHERE activo = TRUE AND rol IN ('vendedor', 'agente') AND correo LIKE 'demo%@example.test') AS sellers
      )
      INSERT INTO comisiones
        (id_propiedad, id_cliente, id_agente_vendedor, porcentaje_agencia, monto_operacion, monto_total, estado, es_demo, creado_en)
      SELECT p.id_propiedad, dc.id_cliente, choices.sellers[1 + ((dc.g - 1) % cardinality(choices.sellers))],
        5, p.precio, ROUND(p.precio * 0.05, 2),
        CASE WHEN dc.g % 2 = 0 THEN 'PAGADA' ELSE 'PENDIENTE' END, TRUE,
        CURRENT_TIMESTAMP - ((dc.g % 60) * INTERVAL '1 day')
      FROM demo_clientes_comisiones dc CROSS JOIN choices
      JOIN propiedades p ON p.id_propiedad = choices.properties[1 + ((dc.g - 1) % cardinality(choices.properties))]
      WHERE NOT EXISTS (SELECT 1 FROM comisiones c WHERE c.id_cliente = dc.id_cliente AND c.es_demo)
    `);
    const commissionCount = await client.query(`
      SELECT COUNT(*) AS total, COUNT(DISTINCT c.id_cliente) AS distinct_total
      FROM comisiones c JOIN demo_clientes_comisiones dc ON dc.id_cliente = c.id_cliente
      WHERE c.es_demo
    `);
    if (Number(commissionCount.rows[0].total) !== 1500 || Number(commissionCount.rows[0].distinct_total) !== 1500) {
      throw new Error('El lote debe contener exactamente 1500 comisiones de demostración distintas.');
    }
    await client.query('COMMIT');
    console.log(`Lote listo: 1500 clientes y 1500 comisiones de demostración (${inserted.rowCount} comisiones nuevas).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error('No se pudo cargar el lote de demostración:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
