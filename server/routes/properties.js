const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware');

const router = express.Router();

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT p.id_propiedad, p.id_categoria, p.id_usuario, p.titulo,
             p.descripcion, p.precio, p.tipo_operacion, p.superficie,
             p.habitaciones, p.banos, p.estacionamientos, p.estado_propiedad,
             p.fecha_publicacion, c.nombre AS categoria,
             CONCAT_WS(' ', u.nombre, u.apellido_paterno, u.apellido_materno) AS agente,
             CONCAT_WS(', ', NULLIF(TRIM(CONCAT_WS(' ', d.calle, d.numero)), ''),
               d.colonia, d.ciudad, d.estado) AS direccion,
             d.calle, d.numero, d.colonia, d.ciudad, d.estado, d.codigo_postal
      FROM propiedades p
      JOIN categorias c ON c.id_categoria = p.id_categoria
      JOIN usuarios u ON u.id_usuario = p.id_usuario
      LEFT JOIN direcciones d ON d.id_propiedad = p.id_propiedad
      WHERE p.eliminado = FALSE
      ORDER BY p.fecha_publicacion DESC NULLS LAST, p.id_propiedad DESC
    `);
    return response.json({ data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const {
    id_categoria, categoria, id_usuario, titulo, descripcion, precio,
    tipo_operacion, operacion, superficie, habitaciones, banos, estacionamientos,
    estado_propiedad, calle, numero, colonia, ciudad, estado, codigo_postal,
    amenidades,
  } = request.body;

  const operationType = tipo_operacion || operacion;
  if (!titulo || !precio || !operationType || !calle || !ciudad || !estado || (!id_categoria && !categoria)) {
    return response.status(400).json({ error: 'Completa título, precio, operación, categoría y dirección.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let categoryId = id_categoria;
    if (!categoryId) {
      const categoryResult = await client.query(`
        INSERT INTO categorias (nombre)
        VALUES ($1)
        ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
        RETURNING id_categoria
      `, [categoria.trim()]);
      categoryId = categoryResult.rows[0].id_categoria;
    }

    const assignedUserId = request.user.rol === 'administrador' && id_usuario
      ? id_usuario
      : request.user.id_usuario;
    const property = await client.query(`
      INSERT INTO propiedades
        (id_categoria, id_usuario, titulo, descripcion, precio, superficie,
         habitaciones, banos, estacionamientos, tipo_operacion,
         estado_propiedad, amenidades)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      RETURNING *
    `, [categoryId, assignedUserId, titulo.trim(), descripcion || null, precio,
      superficie || null, habitaciones || 0, banos || 0, estacionamientos || 0,
      operationType, estado_propiedad || 'Disponible', JSON.stringify(amenidades || [])]);

    await client.query(`
      INSERT INTO direcciones
        (id_propiedad, calle, numero, colonia, ciudad, estado, codigo_postal)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [property.rows[0].id_propiedad, calle.trim(), numero || null, colonia || null,
      ciudad.trim(), estado.trim(), codigo_postal || null]);

    await client.query(`
      INSERT INTO auditoria (id_usuario, accion, entidad, entidad_id, detalle)
      VALUES ($1, 'crear', 'propiedades', $2, jsonb_build_object('titulo', $3::text))
    `, [request.user.id_usuario, String(property.rows[0].id_propiedad), titulo.trim()]);
    await client.query('COMMIT');
    return response.status(201).json({ data: property.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.put('/:id', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { id } = request.params;
  const { titulo, descripcion, precio, estado_propiedad, estado } = request.body;

  try {
    const result = await pool.query(`
      UPDATE propiedades
      SET titulo = COALESCE($1, titulo), descripcion = COALESCE($2, descripcion),
          precio = COALESCE($3, precio),
          estado_propiedad = COALESCE($4, estado_propiedad)
      WHERE id_propiedad = $5
        AND eliminado = FALSE
      RETURNING *
    `, [titulo, descripcion, precio, estado_propiedad || estado, id]);

    if (!result.rowCount) {
      return response.status(404).json({ error: 'Propiedad no encontrada.' });
    }
    return response.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', requireAuth, requireRole('administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      UPDATE propiedades
      SET eliminado = TRUE
      WHERE id_propiedad = $1 AND eliminado = FALSE
      RETURNING id_propiedad
    `, [request.params.id]);
    if (!result.rowCount) {
      return response.status(404).json({ error: 'Propiedad no encontrada.' });
    }
    return response.status(204).send();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
