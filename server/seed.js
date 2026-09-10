require('dotenv').config();

const bcrypt = require('bcrypt');
const pool = require('./db');

async function seed() {
  const password = process.env.SEED_PASSWORD || 'Admin1234!';
  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const user = await client.query(`
      INSERT INTO usuarios (nombre, apellido, correo, contrasena, rol)
      VALUES ('Marina', 'Rojas', 'admin@habita.local', $1, 'administrador')
      ON CONFLICT (correo) DO UPDATE SET contrasena = EXCLUDED.contrasena, activo = TRUE
      RETURNING id_usuario
    `, [hash]);

    const owner = await client.query(`
      INSERT INTO propietarios (nombre, apellido, correo)
      VALUES ('Ana', 'Martinez', 'ana@habita.local')
      RETURNING id_propietario
    `);
    const address = await client.query(`
      INSERT INTO direcciones (calle, numero, colonia, ciudad, estado, codigo_postal)
      VALUES ('Reforma', '245', 'Lomas del Valle', 'Ciudad de Mexico', 'CDMX', '06600')
      RETURNING id_direccion
    `);
    const agent = await client.query(`
      INSERT INTO agentes (id_usuario, numero_licencia)
      VALUES ($1, 'HAB-001')
      ON CONFLICT (id_usuario) DO UPDATE SET numero_licencia = EXCLUDED.numero_licencia
      RETURNING id_agente
    `, [user.rows[0].id_usuario]);

    await client.query(`
      INSERT INTO propiedades
        (id_propietario, id_agente, id_direccion, tipo, titulo, descripcion, precio, operacion, habitaciones, banos, estado)
      VALUES ($1, $2, $3, 'CASA', 'Casa Lomas del Valle', 'Propiedad de prueba para validar la conexion.', 4850000, 'VENTA', 3, 2, 'DISPONIBLE')
    `, [owner.rows[0].id_propietario, agent.rows[0].id_agente, address.rows[0].id_direccion]);

    await client.query('COMMIT');
    console.log('Datos iniciales creados. Usuario: admin@habita.local');
    console.log(`Contrasena de prueba: ${password}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error('No se pudo preparar la base de datos:', error.message);
  process.exitCode = 1;
});
