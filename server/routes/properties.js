const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware');

const router = express.Router();

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT p.id_propiedad, p.titulo, p.descripcion, p.precio, p.operacion,
             p.tipo, p.superficie, p.habitaciones, p.banos, p.estacionamientos,
             p.estado, p.fecha_publicacion,
             CONCAT(d.calle, ' ', COALESCE(d.numero, ''), ', ', d.colonia, ', ', d.ciudad) AS direccion,
             CONCAT(pr.nombre, ' ', pr.apellido) AS propietario,
             CONCAT(u.nombre, ' ', u.apellido) AS agente
      FROM propiedades p
      JOIN direcciones d ON d.id_direccion = p.id_direccion
      JOIN propietarios pr ON pr.id_propietario = p.id_propietario
      LEFT JOIN agentes a ON a.id_agente = p.id_agente
      LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario
      ORDER BY p.fecha_publicacion DESC
    `);
    return response.json({ data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const {
    id_propietario, id_agente, id_direccion, tipo, titulo, descripcion,
    precio, operacion, superficie, habitaciones, banos, estacionamientos, estado,
  } = request.body;

  if (!id_propietario || !id_direccion || !tipo || !titulo || !precio || !operacion) {
    return response.status(400).json({ error: 'Faltan campos obligatorios de la propiedad.' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO propiedades
        (id_propietario, id_agente, id_direccion, tipo, titulo, descripcion, precio,
         operacion, superficie, habitaciones, banos, estacionamientos, estado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, 'DISPONIBLE'))
      RETURNING *
    `, [id_propietario, id_agente || null, id_direccion, tipo, titulo, descripcion || null,
      precio, operacion, superficie || null, habitaciones || 0, banos || 0,
      estacionamientos || 0, estado || null]);

    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { id } = request.params;
  const { titulo, descripcion, precio, estado } = request.body;

  try {
    const result = await pool.query(`
      UPDATE propiedades
      SET titulo = COALESCE($1, titulo), descripcion = COALESCE($2, descripcion),
          precio = COALESCE($3, precio), estado = COALESCE($4, estado),
          fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id_propiedad = $5
      RETURNING *
    `, [titulo, descripcion, precio, estado, id]);

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
    const result = await pool.query('DELETE FROM propiedades WHERE id_propiedad = $1 RETURNING id_propiedad', [request.params.id]);
    if (!result.rowCount) {
      return response.status(404).json({ error: 'Propiedad no encontrada.' });
    }
    return response.status(204).send();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
