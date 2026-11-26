const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware');

const router = express.Router();
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('imagen');
function parsePropertyImage(request, response, next) {
  imageUpload(request, response, (error) => {
    if (error) {
      return response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera el límite de 10 MB.' : 'No se pudo procesar la imagen.' });
    }
    const file = request.file;
    if (file) {
      const bytes = file.buffer;
      const jpeg = file.mimetype === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const png = file.mimetype === 'image/png' && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const webp = file.mimetype === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!jpeg && !png && !webp) return response.status(400).json({ error: 'Selecciona una imagen JPEG, PNG o WebP válida.' });
    }
    return next();
  });
}
async function savePropertyImage(client, propertyId, file) {
  await client.query(`
    INSERT INTO propiedad_imagenes (id_propiedad, contenido, tipo_mime)
    VALUES ($1, $2, $3)
    ON CONFLICT (id_propiedad) DO UPDATE SET contenido = EXCLUDED.contenido, tipo_mime = EXCLUDED.tipo_mime
  `, [propertyId, file.buffer, file.mimetype]);
}
const validOptionalText = (value, maxLength) => value === undefined || value === null
  || (typeof value === 'string' && value.length <= maxLength);
const isNumericInput = (value) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value));
const validPositiveNumber = (value) => value !== '' && value !== null && value !== undefined
  && isNumericInput(value) && Number(value) > 0;
const validAcquisitionCost = (value) => validPositiveNumber(value)
  && /^\d+(?:\.\d{1,2})?$/.test(String(value))
  && Number(value) <= 999999999999.99;
const validPropertyDimension = (value) => validPositiveNumber(value) && Number(value) <= 999999.99;
const validOptionalNonNegativeNumber = (value) => value === undefined || value === null || value === ''
  || (isNumericInput(value) && Number(value) >= 0);
const validOptionalInteger = (value) => value === undefined || value === null || value === ''
  || (isNumericInput(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 0);
const validOptionalImageUrl = (value) => {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(request.query.limit, 10) || 50));
    const [result, count] = await Promise.all([pool.query(`
      SELECT p.id_propiedad, p.id_categoria, p.id_usuario, p.titulo,
             p.descripcion, p.precio,
             CASE WHEN $3::boolean THEN p.costo_adquisicion ELSE NULL END AS costo_adquisicion,
             p.tipo_operacion, p.superficie, p.frente_metros, p.fondo_metros,
             p.habitaciones, p.banos, p.estacionamientos, p.estado_propiedad,
             p.fecha_publicacion,
             CASE WHEN EXISTS (SELECT 1 FROM propiedad_imagenes i WHERE i.id_propiedad = p.id_propiedad)
               THEN '/api/properties/' || p.id_propiedad || '/image' ELSE p.imagen_url END AS imagen_url,
             p.latitud, p.longitud, c.nombre AS categoria,
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
      LIMIT $1 OFFSET $2
    `, [limit, (page - 1) * limit, ['agente', 'vendedor', 'administrador', 'admin'].includes(request.user.rol)]),
    pool.query('SELECT COUNT(*)::int AS total FROM propiedades WHERE eliminado = FALSE')]);
    const total = count.rows[0].total;
    return response.json({
      data: result.rows,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/image', async (request, response, next) => {
  if (!/^\d+$/.test(request.params.id)) return response.status(404).json({ error: 'Imagen no disponible.' });
  try {
    const result = await pool.query(`
      SELECT i.contenido, i.tipo_mime FROM propiedad_imagenes i
      JOIN propiedades p ON p.id_propiedad = i.id_propiedad
      WHERE i.id_propiedad = $1 AND p.eliminado = FALSE AND LOWER(p.estado_propiedad) = 'disponible'
    `, [request.params.id]);
    if (!result.rowCount) return response.status(404).json({ error: 'Imagen no disponible.' });
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    return response.type(result.rows[0].tipo_mime).send(result.rows[0].contenido);
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('agente', 'administrador'), parsePropertyImage, async (request, response, next) => {
  const {
    id_categoria, categoria, id_usuario, titulo, descripcion, precio, costo_adquisicion,
    tipo_operacion, operacion, superficie, frente_metros, fondo_metros, habitaciones, banos, estacionamientos,
    estado_propiedad, calle, numero, colonia, ciudad, estado, codigo_postal,
    amenidades, imagen_url, latitud, longitud,
  } = request.body;

  const operationType = tipo_operacion || operacion;
  const statusValue = estado_propiedad === undefined || estado_propiedad === null || estado_propiedad === ''
    ? 'Disponible'
    : estado_propiedad;
  const propertyStatus = typeof statusValue === 'string' ? statusValue.toLocaleLowerCase() : '';
  if (!validPositiveNumber(precio) || !validAcquisitionCost(costo_adquisicion) || !['VENTA', 'RENTA'].includes(String(operationType || '').toUpperCase())
    || !validPropertyDimension(superficie) || !validPropertyDimension(frente_metros) || !validPropertyDimension(fondo_metros)
    || (!id_categoria && !categoria)
    || !['disponible', 'reservada', 'vendida', 'rentada', 'inactiva'].includes(propertyStatus)
    || (id_categoria !== undefined && id_categoria !== null && id_categoria !== ''
      && (!Number.isSafeInteger(Number(id_categoria)) || Number(id_categoria) <= 0))
    || (id_usuario !== undefined && id_usuario !== null && id_usuario !== ''
      && (!Number.isSafeInteger(Number(id_usuario)) || Number(id_usuario) <= 0))) {
    return response.status(400).json({ error: 'Completa costo de adquisición, precio, operación, categoría y medidas válidas (superficie, frente y fondo).' });
  }
  const normalizedCategory = String(categoria || '').trim();
  if (!id_categoria && (typeof categoria !== 'string' || !normalizedCategory || normalizedCategory.length > 100)) {
    return response.status(400).json({ error: 'Selecciona una categoría válida.' });
  }
  const isVacantLot = normalizedCategory === 'Lote baldío';
  if (!isVacantLot && (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 200
    || typeof calle !== 'string' || !calle.trim() || calle.trim().length > 150
    || typeof ciudad !== 'string' || !ciudad.trim() || ciudad.trim().length > 100
    || typeof estado !== 'string' || !estado.trim() || estado.trim().length > 100)) {
    return response.status(400).json({ error: 'Para esta categoría completa título y dirección.' });
  }
  if (!validOptionalText(descripcion, 2000) || !validOptionalText(numero, 30)
    || !validOptionalText(colonia, 100) || !validOptionalText(codigo_postal, 5)
    || (codigo_postal && !/^\d{5}$/.test(codigo_postal))
    || !validOptionalText(estado_propiedad, 40)
    || !validOptionalText(imagen_url, 2048)
    || !validOptionalNonNegativeNumber(superficie)
    || !validOptionalNonNegativeNumber(frente_metros)
    || !validOptionalNonNegativeNumber(fondo_metros)
    || !validOptionalInteger(habitaciones) || !validOptionalInteger(banos)
    || !validOptionalInteger(estacionamientos)
    || !validOptionalImageUrl(imagen_url)
    || !Array.isArray(amenidades || [])) {
    return response.status(400).json({ error: 'Revisa descripción, domicilio, código postal, datos numéricos e imagen.' });
  }
  if ((latitud === undefined || latitud === '') !== (longitud === undefined || longitud === '')) {
    return response.status(400).json({ error: 'Debes capturar latitud y longitud juntas.' });
  }
  if (latitud !== undefined && latitud !== '' && (!isNumericInput(latitud) || Number(latitud) < -90 || Number(latitud) > 90)) {
    return response.status(400).json({ error: 'La latitud debe estar entre -90 y 90.' });
  }
  if (longitud !== undefined && longitud !== '' && (!isNumericInput(longitud) || Number(longitud) < -180 || Number(longitud) > 180)) {
    return response.status(400).json({ error: 'La longitud debe estar entre -180 y 180.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    let categoryId = id_categoria;
    if (categoryId) {
      const categoryResult = await client.query('SELECT id_categoria FROM categorias WHERE id_categoria = $1', [categoryId]);
      if (!categoryResult.rowCount) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'La categoría seleccionada no existe.' });
      }
    } else if (['Casa', 'Lote baldío'].includes(normalizedCategory)) {
      const categoryResult = await client.query(`
        INSERT INTO categorias (nombre)
        VALUES ($1)
        ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
        RETURNING id_categoria
      `, [normalizedCategory]);
      categoryId = categoryResult.rows[0].id_categoria;
    } else {
      const categoryResult = await client.query('SELECT id_categoria FROM categorias WHERE nombre = $1', [normalizedCategory]);
      if (!categoryResult.rowCount) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'La categoría seleccionada no existe.' });
      }
      categoryId = categoryResult.rows[0].id_categoria;
    }

    const assignedUserId = request.user.rol === 'administrador' && id_usuario
      ? id_usuario
      : request.user.id_usuario;
    const property = await client.query(`
      INSERT INTO propiedades
        (id_categoria, id_usuario, titulo, descripcion, precio, superficie, frente_metros, fondo_metros,
         habitaciones, banos, estacionamientos, tipo_operacion,
         estado_propiedad, amenidades, imagen_url, latitud, longitud, costo_adquisicion)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18)
      RETURNING *
    `, [categoryId, assignedUserId, (titulo || 'Lote baldío').trim(), descripcion || null, precio,
      superficie || null, frente_metros || null, fondo_metros || null,
      isVacantLot ? 0 : (habitaciones || 0), isVacantLot ? 0 : (banos || 0),
      isVacantLot ? 0 : (estacionamientos || 0),
      operationType, statusValue, JSON.stringify(amenidades || []),
      imagen_url || null, latitud === '' ? null : latitud || null, longitud === '' ? null : longitud || null, costo_adquisicion]);

    if (request.file) {
      await savePropertyImage(client, property.rows[0].id_propiedad, request.file);
      property.rows[0].imagen_url = `/api/properties/${property.rows[0].id_propiedad}/image`;
    }
    await client.query(`
      INSERT INTO direcciones
        (id_propiedad, calle, numero, colonia, ciudad, estado, codigo_postal)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [property.rows[0].id_propiedad, isVacantLot ? 'Sin dirección' : calle.trim(), numero || null, colonia || null,
      isVacantLot ? 'No especificada' : ciudad.trim(), isVacantLot ? 'No especificado' : estado.trim(), codigo_postal || null]);

    await client.query(`
      INSERT INTO auditoria (id_usuario, accion, entidad, entidad_id, detalle)
      VALUES ($1, 'crear', 'propiedades', $2, jsonb_build_object('titulo', $3::text))
    `, [request.user.id_usuario, String(property.rows[0].id_propiedad),     (titulo || 'Lote baldío').trim()]);
    await client.query('COMMIT');
    return response.status(201).json({ data: property.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    return next(error);
  } finally {
    if (client) client.release();
  }
});

router.put('/:id', requireAuth, requireRole('agente', 'administrador'), parsePropertyImage, async (request, response, next) => {
  const { id } = request.params;
  const { titulo, descripcion, precio, costo_adquisicion, estado_propiedad, estado, id_categoria, imagen_url, latitud, longitud, superficie, frente_metros, fondo_metros } = request.body;
  const propertyStatus = estado_propiedad ?? estado;
  if ((titulo !== undefined && (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 200))
    || !validOptionalText(descripcion, 2000)
    || !validOptionalText(imagen_url, 2048)
    || (precio !== undefined && precio !== null && !validPositiveNumber(precio))
    || (costo_adquisicion !== undefined && costo_adquisicion !== null && costo_adquisicion !== '' && !validAcquisitionCost(costo_adquisicion))
    || (superficie !== undefined && superficie !== null && superficie !== '' && !validPropertyDimension(superficie))
    || (frente_metros !== undefined && frente_metros !== null && frente_metros !== '' && !validPropertyDimension(frente_metros))
    || (fondo_metros !== undefined && fondo_metros !== null && fondo_metros !== '' && !validPropertyDimension(fondo_metros))
    || !validOptionalText(propertyStatus, 40)
    || (propertyStatus !== undefined && propertyStatus !== null && propertyStatus !== ''
      && !['disponible', 'reservada', 'vendida', 'rentada', 'inactiva'].includes(String(propertyStatus).toLocaleLowerCase()))
    || !validOptionalImageUrl(imagen_url)) {
    return response.status(400).json({ error: 'Revisa título, descripción, costo de adquisición, precio, estado e imagen de la propiedad.' });
  }
  if (id_categoria !== undefined && !['administrador', 'admin'].includes(request.user.rol)) {
    return response.status(403).json({ error: 'Solo los administradores pueden cambiar la categoría.' });
  }
  if (id_categoria !== undefined && (!Number.isSafeInteger(Number(id_categoria)) || Number(id_categoria) <= 0)) {
    return response.status(400).json({ error: 'La categoría seleccionada no es válida.' });
  }
  if ((latitud === undefined || latitud === '') !== (longitud === undefined || longitud === '')) {
    return response.status(400).json({ error: 'Debes capturar latitud y longitud juntas.' });
  }
  if (latitud !== undefined && latitud !== '' && (!isNumericInput(latitud) || Number(latitud) < -90 || Number(latitud) > 90)) {
    return response.status(400).json({ error: 'La latitud debe estar entre -90 y 90.' });
  }
  if (longitud !== undefined && longitud !== '' && (!isNumericInput(longitud) || Number(longitud) < -180 || Number(longitud) > 180)) {
    return response.status(400).json({ error: 'La longitud debe estar entre -180 y 180.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    if (id_categoria !== undefined) {
      const category = await client.query(
       'SELECT id_categoria FROM categorias WHERE id_categoria = $1',
       [id_categoria],
      );
      if (!category.rowCount) {
       await client.query('ROLLBACK');
       return response.status(400).json({ error: 'La categoría seleccionada no existe.' });
      }
    }
    const result = await client.query(`
      UPDATE propiedades
      SET titulo = COALESCE($1, titulo), descripcion = COALESCE($2, descripcion),
          precio = COALESCE($3, precio),
          estado_propiedad = COALESCE($4, estado_propiedad),
          id_categoria = COALESCE($5, id_categoria),
          imagen_url = COALESCE($6, imagen_url),
          latitud = COALESCE($7, latitud),
          longitud = COALESCE($8, longitud),
          superficie = COALESCE($11, superficie),
          frente_metros = COALESCE($12, frente_metros),
          fondo_metros = COALESCE($13, fondo_metros),
          costo_adquisicion = COALESCE($10, costo_adquisicion)
      WHERE id_propiedad = $9
        AND eliminado = FALSE
      RETURNING *
    `, [titulo, descripcion, precio, estado_propiedad || estado, id_categoria, imagen_url, latitud, longitud, id,
      costo_adquisicion === '' ? null : costo_adquisicion, superficie || null, frente_metros || null, fondo_metros || null]);

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return response.status(404).json({ error: 'Propiedad no encontrada.' });
    }
    if (request.file) {
      await savePropertyImage(client, id, request.file);
      result.rows[0].imagen_url = `/api/properties/${id}/image`;
    } else if (imagen_url) {
      await client.query('DELETE FROM propiedad_imagenes WHERE id_propiedad = $1', [id]);
    }
    await client.query('COMMIT');
    return response.json({ data: result.rows[0] });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    return next(error);
  } finally {
    if (client) client.release();
  }
});

router.delete('/:id', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
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
