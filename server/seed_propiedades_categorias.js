require('dotenv').config();

const pool = require('./db');

const categories = [
  'Oficinas', 'Tiendas a pie de calle', 'Plazas comerciales', 'Supermercados',
  'Restaurantes', 'Moteles', 'Resorts', 'Hostales', 'Clínicas privadas',
  'Hospitales', 'Gimnasios', 'Escuelas privadas', 'Estacionamientos',
  'Naves industriales', 'Bodegas', 'Ranchos', 'Haciendas', 'Huertos',
];
const description = 'Propiedad ficticia de demostración; no corresponde a una oferta real.';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('demo-propiedades-categorias-50'))");
    const categoryCount = await client.query(
      'SELECT COUNT(*)::int AS total FROM categorias WHERE nombre = ANY($1::text[])', [categories],
    );
    if (categoryCount.rows[0].total !== categories.length) {
      throw new Error('Faltan categorías; aplica la migración 016 antes de cargar el lote.');
    }
    const owner = await client.query(`
      SELECT id_usuario FROM usuarios
      WHERE activo = TRUE AND rol IN ('agente', 'vendedor', 'administrador', 'admin')
        AND correo LIKE 'demo%@example.test'
      ORDER BY id_usuario LIMIT 1
    `);
    if (!owner.rowCount) throw new Error('Se necesita una cuenta de vendedor de demostración activa.');

    const candidates = `
      SELECT name, '[DEMO] ' || name || ' ' || lpad(g::text, 3, '0') AS titulo
      FROM unnest($1::text[]) AS names(name) CROSS JOIN generate_series(1, 50) AS g
    `;
    const collisions = await client.query(`
      WITH candidates AS (${candidates})
      SELECT COUNT(*)::int AS total FROM (
        SELECT candidates.titulo
        FROM candidates JOIN propiedades p ON p.titulo = candidates.titulo
        JOIN categorias c ON c.id_categoria = p.id_categoria
        GROUP BY candidates.titulo, candidates.name
        HAVING COUNT(*) > 1 OR bool_or(p.eliminado OR c.nombre <> candidates.name
          OR p.descripcion IS DISTINCT FROM $2)
      ) conflicts
    `, [categories, description]);
    if (collisions.rows[0].total) throw new Error('Hay propiedades incompatibles con los nombres del lote de demostración.');

    const inserted = await client.query(`
      WITH candidates AS (
        SELECT name, ordinal, g,
          '[DEMO] ' || name || ' ' || lpad(g::text, 3, '0') AS titulo
        FROM unnest($1::text[]) WITH ORDINALITY AS names(name, ordinal)
        CROSS JOIN generate_series(1, 50) AS g
      ), inserted AS (
        INSERT INTO propiedades
          (id_categoria, id_usuario, titulo, descripcion, precio, superficie,
            habitaciones, banos, estacionamientos, tipo_operacion, estado_propiedad)
        SELECT c.id_categoria, $2, candidates.titulo, $3,
          1000000 + candidates.ordinal * 100000 + candidates.g * 1000,
          100 + candidates.g * 5, 0, 0, 0,
          CASE WHEN candidates.g % 2 = 0 THEN 'RENTA' ELSE 'VENTA' END, 'Disponible'
        FROM candidates JOIN categorias c ON c.nombre = candidates.name
        WHERE NOT EXISTS (SELECT 1 FROM propiedades p WHERE p.titulo = candidates.titulo)
        RETURNING id_propiedad
      )
      INSERT INTO direcciones (id_propiedad, calle, ciudad, estado)
      SELECT id_propiedad, 'Calle de demostración', 'Ciudad de ejemplo', 'Estado de ejemplo'
      FROM inserted
    `, [categories, owner.rows[0].id_usuario, description]);
    const counts = await client.query(`
      SELECT c.nombre, COUNT(*)::int AS total
      FROM propiedades p JOIN categorias c ON c.id_categoria = p.id_categoria
      WHERE c.nombre = ANY($1::text[]) AND p.eliminado = FALSE
        AND p.descripcion = $2
        AND p.titulo IN (
          SELECT '[DEMO] ' || name || ' ' || lpad(g::text, 3, '0')
          FROM unnest($1::text[]) AS names(name) CROSS JOIN generate_series(1, 50) AS g
        )
      GROUP BY c.nombre
    `, [categories, description]);
    if (counts.rows.length !== categories.length || counts.rows.some((row) => row.total !== 50)) {
      throw new Error('El lote debe contener 50 propiedades de demostración por categoría.');
    }
    await client.query('COMMIT');
    console.log(`Lote listo: ${categories.length} categorías y 900 propiedades de demostración (${inserted.rowCount} nuevas).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error('No se pudo cargar el lote de propiedades:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
