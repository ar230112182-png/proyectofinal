require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function seedNegociaciones() {
  const sqlFile = path.join(__dirname, '..', 'bd', 'seed_negociaciones.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  console.log('Poblando registros de Negociaciones y ventas (clientes, ofertas, ventas y contratos)...');
  const client = await pool.connect();

  try {
    await client.query(sql);

    const counts = await client.query(`
      SELECT 'clientes' AS seccion, count(*) AS total FROM clientes
      UNION ALL
      SELECT 'ofertas (negociaciones)', count(*) FROM ofertas
      UNION ALL
      SELECT 'ventas', count(*) FROM ventas
      UNION ALL
      SELECT 'contratos', count(*) FROM contratos;
    `);

    console.log('Registros de Negociaciones y ventas cargados exitosamente:');
    console.table(counts.rows);

    const ofertasSample = await client.query(`
      SELECT o.id_oferta, p.titulo AS propiedad, u.nombre || ' ' || u.apellido_paterno AS cliente, o.monto, o.tipo, o.estado
      FROM ofertas o
      JOIN propiedades p ON p.id_propiedad = o.id_propiedad
      JOIN usuarios u ON u.id_usuario = o.id_usuario
      ORDER BY o.creado_en DESC LIMIT 3;
    `);
    console.log('Muestra de Ofertas / Negociaciones:');
    console.table(ofertasSample.rows);

    const ventasSample = await client.query(`
      SELECT v.id_venta, p.titulo AS propiedad, u.nombre || ' ' || u.apellido_paterno AS cliente, v.precio_venta, v.fecha_venta
      FROM ventas v
      JOIN propiedades p ON p.id_propiedad = v.id_propiedad
      JOIN clientes c ON c.id_cliente = v.id_cliente
      JOIN usuarios u ON u.id_usuario = c.id_usuario
      ORDER BY v.fecha_venta DESC LIMIT 3;
    `);
    console.log('Muestra de Ventas:');
    console.table(ventasSample.rows);

    const contratosSample = await client.query(`
      SELECT id_contrato, tipo_operacion, nombre_cliente AS cliente, titulo_propiedad AS propiedad, precio_total, fecha_contrato
      FROM contratos ORDER BY fecha_contrato DESC LIMIT 3;
    `);
    console.log('Muestra de Contratos:');
    console.table(contratosSample.rows);
  } catch (error) {
    console.error('Error al poblar negociaciones y ventas:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedNegociaciones().catch(() => {
  process.exitCode = 1;
});
