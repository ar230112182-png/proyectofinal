require('dotenv').config();

const pool = require('./db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('demo-compras-reportes-200'))");
    const available = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM propiedades
         WHERE eliminado = FALSE AND precio > 0 AND titulo LIKE 'Propiedad Demo%') AS properties,
        (SELECT COUNT(*) FROM agentes a JOIN usuarios u ON u.id_usuario = a.id_usuario
         WHERE u.activo = TRUE AND u.rol IN ('agente', 'vendedor')
           AND u.correo LIKE 'demo%@example.test') AS agents,
        (SELECT COUNT(*) FROM propietarios WHERE correo LIKE 'demo%@example.test') AS owners
    `);
    if (Number(available.rows[0].properties) < 200 || !Number(available.rows[0].agents) || !Number(available.rows[0].owners)) {
      throw new Error('Se necesitan 200 propiedades, un agente y un propietario de demostración.');
    }

    const inserted = await client.query(`
      WITH choices AS (
        SELECT
          (SELECT array_agg(id_propiedad ORDER BY id_propiedad) FROM propiedades
           WHERE eliminado = FALSE AND precio > 0 AND titulo LIKE 'Propiedad Demo%') AS properties,
          (SELECT array_agg(a.id_agente ORDER BY a.id_agente) FROM agentes a
           JOIN usuarios u ON u.id_usuario = a.id_usuario
           WHERE u.activo = TRUE AND u.rol IN ('agente', 'vendedor')
             AND u.correo LIKE 'demo%@example.test') AS agents,
          (SELECT array_agg(id_propietario ORDER BY id_propietario) FROM propietarios
           WHERE correo LIKE 'demo%@example.test') AS owners
      )
      INSERT INTO compras (id_propiedad, id_vendedor, id_agente, precio_compra, fecha_compra, estado, observaciones)
      SELECT p.id_propiedad, choices.owners[1 + ((g - 1) % cardinality(choices.owners))],
        choices.agents[1 + ((g - 1) % cardinality(choices.agents))],
        ROUND(p.precio * 0.70, 2), CURRENT_DATE - (g % 90), 'COMPLETADA',
        'Compra demo-reportes-200-' || lpad(g::text, 3, '0')
      FROM generate_series(1, 200) AS g CROSS JOIN choices
      JOIN propiedades p ON p.id_propiedad = choices.properties[g]
      WHERE NOT EXISTS (
        SELECT 1 FROM compras c WHERE c.observaciones = 'Compra demo-reportes-200-' || lpad(g::text, 3, '0')
      )
    `);
    const verified = await client.query(`
      SELECT COUNT(*)::int AS total, COUNT(DISTINCT c.observaciones)::int AS distinct_total,
        COUNT(*) FILTER (WHERE c.estado <> 'COMPLETADA' OR a.id_agente IS NULL
          OR (u.correo LIKE 'demo%@example.test') IS NOT TRUE
          OR (o.correo LIKE 'demo%@example.test') IS NOT TRUE
          OR (p.titulo LIKE 'Propiedad Demo%') IS NOT TRUE)::int AS invalid
      FROM compras c
      JOIN propiedades p ON p.id_propiedad = c.id_propiedad
      JOIN propietarios o ON o.id_propietario = c.id_vendedor
      LEFT JOIN agentes a ON a.id_agente = c.id_agente
      LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario
      WHERE c.observaciones IN (
        SELECT 'Compra demo-reportes-200-' || lpad(g::text, 3, '0') FROM generate_series(1, 200) AS g
      )
    `);
    if (verified.rows[0].total !== 200 || verified.rows[0].distinct_total !== 200 || verified.rows[0].invalid !== 0) {
      throw new Error('El lote debe contener exactamente 200 compras de demostración válidas.');
    }
    await client.query('COMMIT');
    console.log(`Lote listo: 200 compras de demostración (${inserted.rowCount} nuevas).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error('No se pudo cargar el lote de compras:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
