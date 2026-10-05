const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    callback(allowed.has(file.mimetype) ? null : new Error('Tipo de archivo no permitido.'), allowed.has(file.mimetype));
  },
});

const listQueries = {
  clients: `SELECT c.id_cliente, c.id_usuario, u.nombre, u.apellido_paterno, u.apellido_materno,
      u.correo, u.telefono, c.curp, c.direccion, c.ciudad, c.estado, c.codigo_postal
    FROM clientes c JOIN usuarios u ON u.id_usuario = c.id_usuario ORDER BY c.id_cliente DESC`,
  leads: `SELECT id_lead, nombre, correo, telefono, origen, estado, nivel_interes,
      id_agente, consentimiento_datos, creado_en FROM leads ORDER BY creado_en DESC`,
  visits: `SELECT c.id_cita, c.fecha_cita, c.motivo, c.estado,
      cl.id_cliente, u.nombre || ' ' || u.apellido_paterno AS cliente,
      p.id_propiedad, p.titulo AS propiedad, c.id_agente,
      a.nombre || ' ' || a.apellido_paterno AS agente
    FROM citas c JOIN clientes cl ON cl.id_cliente = c.id_cliente
    JOIN usuarios u ON u.id_usuario = cl.id_usuario
    JOIN propiedades p ON p.id_propiedad = c.id_propiedad
    JOIN usuarios a ON a.id_usuario = c.id_agente ORDER BY c.fecha_cita DESC`,
  offers: `SELECT o.id_oferta, o.id_propiedad, p.titulo AS propiedad, o.id_usuario,
      u.nombre || ' ' || u.apellido_paterno AS cliente, o.monto, o.tipo, o.estado,
      o.notas, o.creado_en FROM ofertas o JOIN propiedades p ON p.id_propiedad = o.id_propiedad
      JOIN usuarios u ON u.id_usuario = o.id_usuario ORDER BY o.creado_en DESC`,
  documents: `SELECT id_documento, id_propiedad, tipo, nombre_archivo, mime_type,
      tamano_bytes, hash_archivo, estado, subido_por, creado_en
    FROM expedientes_legales ORDER BY creado_en DESC`,
  sales: `SELECT v.id_venta, v.id_propiedad, p.titulo AS propiedad, v.id_cliente,
      u.nombre || ' ' || u.apellido_paterno AS cliente, v.id_agente,
      v.precio_venta, v.fecha_venta FROM ventas v
      JOIN propiedades p ON p.id_propiedad = v.id_propiedad
      JOIN clientes c ON c.id_cliente = v.id_cliente
      JOIN usuarios u ON u.id_usuario = c.id_usuario ORDER BY v.fecha_venta DESC`,
  commissions: `SELECT c.id_comision, c.id_propiedad, p.titulo AS propiedad,
      c.id_agente_captador, c.id_agente_vendedor, c.porcentaje_agencia,
      c.monto_operacion, c.monto_total, c.creado_en FROM comisiones c
      JOIN propiedades p ON p.id_propiedad = c.id_propiedad ORDER BY c.creado_en DESC`,
  rentals: `SELECT r.id_renta, r.id_propiedad, p.titulo AS propiedad, r.id_cliente,
      u.nombre || ' ' || u.apellido_paterno AS cliente, r.id_agente, r.renta_mensual,
      r.fecha_inicio, r.fecha_fin, r.estado FROM rentas r
      JOIN propiedades p ON p.id_propiedad = r.id_propiedad
      JOIN clientes c ON c.id_cliente = r.id_cliente
      JOIN usuarios u ON u.id_usuario = c.id_usuario ORDER BY r.fecha_inicio DESC`,
  payments: `SELECT pg.id_pago, pg.id_renta, r.id_propiedad, p.titulo AS propiedad,
      pg.periodo, pg.monto, pg.estado, pg.pagado_en FROM pagos_renta pg
      JOIN rentas r ON r.id_renta = pg.id_renta
      JOIN propiedades p ON p.id_propiedad = r.id_propiedad ORDER BY pg.periodo DESC`,
  users: `SELECT id_usuario, nombre, apellido_paterno, apellido_materno,
      correo, telefono, rol, fecha_registro FROM usuarios ORDER BY id_usuario`,
  contracts: `SELECT id_contrato, tipo_operacion, id_cliente, id_propiedad, id_vendedor,
      fecha_contrato, precio_total, renta_mensual, fecha_inicio, fecha_fin,
      frente_metros, fondo_metros, superficie_m2, latitud, longitud,
      nombre_cliente AS cliente,
      nombre_vendedor AS vendedor, titulo_propiedad AS propiedad, creado_en
    FROM contratos`,
  matches: `SELECT m.id_coincidencia, m.id_lead, l.nombre AS lead,
      m.id_propiedad, p.titulo AS propiedad, m.puntuacion, m.creada_en
    FROM coincidencias m JOIN leads l ON l.id_lead = m.id_lead
    JOIN propiedades p ON p.id_propiedad = m.id_propiedad ORDER BY m.puntuacion DESC`,
};

async function audit(userId, action, entity, entityId, detail = {}) {
  await pool.query(`
    INSERT INTO auditoria (id_usuario, accion, entidad, entidad_id, detalle)
    VALUES ($1, $2, $3, $4, $5::jsonb)
  `, [userId || null, action, entity, entityId == null ? null : String(entityId), JSON.stringify(detail)]);
}

router.get('/public/properties', async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT p.id_propiedad, p.titulo, p.descripcion, p.precio, p.tipo_operacion,
        p.superficie, p.habitaciones, p.banos, c.nombre AS categoria,
        CONCAT_WS(', ', d.calle || ' ' || COALESCE(d.numero, ''), d.colonia, d.ciudad, d.estado) AS direccion
      FROM propiedades p JOIN categorias c ON c.id_categoria = p.id_categoria
      LEFT JOIN direcciones d ON d.id_propiedad = p.id_propiedad
      WHERE p.eliminado = FALSE AND LOWER(p.estado_propiedad) = 'disponible'
      ORDER BY p.fecha_publicacion DESC NULLS LAST
    `);
    return response.json({ data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/public/leads', async (request, response, next) => {
  const { nombre, correo, telefono, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, consentimiento_datos } = request.body;
  if (!nombre || !consentimiento_datos) {
    return response.status(400).json({ error: 'Nombre y consentimiento de datos son obligatorios.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lead = await client.query(`
      INSERT INTO leads (nombre, correo, telefono, origen, consentimiento_datos)
      VALUES ($1, $2, $3, 'portal', TRUE) RETURNING id_lead
    `, [nombre.trim(), correo || null, telefono || null]);
    if (ciudad || precio_min || precio_max || habitaciones_min || tipo || operacion) {
      await client.query(`
        INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [lead.rows[0].id_lead, ciudad || null, precio_min || null, precio_max || null,
        habitaciones_min || null, tipo || null, operacion || null]);
    }
    await client.query('COMMIT');
    return response.status(201).json({ data: { id_lead: lead.rows[0].id_lead } });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/summary', requireAuth, async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM propiedades WHERE eliminado = FALSE) AS propiedades,
        (SELECT COUNT(*) FROM clientes) AS clientes,
        (SELECT COUNT(*) FROM citas WHERE fecha_cita >= date_trunc('week', CURRENT_DATE)) AS visitas,
        (SELECT COALESCE(SUM(precio_venta), 0) FROM ventas
          WHERE date_trunc('month', fecha_venta) = date_trunc('month', CURRENT_DATE)) AS ingresos,
        (SELECT COUNT(*) FROM leads WHERE estado = 'NUEVO') AS leads_nuevos,
        (SELECT COUNT(*) FROM expedientes_legales WHERE estado = 'PENDIENTE') AS documentos_pendientes,
        (SELECT COUNT(*) FROM rentas WHERE LOWER(estado) = 'activa') AS rentas_activas,
        (SELECT COUNT(*) FROM auditoria WHERE creado_en >= CURRENT_DATE) AS eventos_hoy
    `);
    return response.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/activity', requireAuth, requireRole('agente', 'administrador'), async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT a.id_evento, a.accion, a.entidad, a.entidad_id, a.detalle, a.creado_en,
        COALESCE(u.nombre || ' ' || u.apellido_paterno, 'Sistema') AS usuario
      FROM auditoria a LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario
      ORDER BY a.creado_en DESC LIMIT 8
    `);
    return response.json({ data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/schema', requireAuth, requireRole('agente', 'administrador'), async (_request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT c.table_name, c.column_name, c.data_type, c.is_nullable,
        CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 'PK'
          WHEN tc.constraint_type = 'FOREIGN KEY' THEN 'FK' ELSE '-' END AS clave
      FROM information_schema.columns c
      LEFT JOIN information_schema.key_column_usage kcu
        ON kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name
        AND kcu.column_name = c.column_name
      LEFT JOIN information_schema.table_constraints tc
        ON tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
        AND tc.constraint_name = kcu.constraint_name
      WHERE c.table_schema = 'public' AND c.table_name NOT LIKE 'pg_%'
      ORDER BY c.table_name, c.ordinal_position
    `);
    return response.json({ data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/options', requireAuth, requireRole('agente', 'administrador'), async (_request, response, next) => {
  try {
    const [clients, properties, users, categories, leads, rentals] = await Promise.all([
      pool.query(`SELECT c.id_cliente AS id, u.nombre || ' ' || u.apellido_paterno AS nombre FROM clientes c JOIN usuarios u USING (id_usuario) ORDER BY nombre`),
      pool.query(`
        SELECT p.id_propiedad AS id,
          p.titulo || COALESCE(' · ' || d.ciudad, '') AS nombre,
          p.tipo_operacion, p.latitud, p.longitud, p.superficie
        FROM propiedades p LEFT JOIN direcciones d ON d.id_propiedad = p.id_propiedad
        WHERE p.eliminado = FALSE
        ORDER BY p.titulo
      `),
      pool.query(`SELECT id_usuario AS id, nombre || ' ' || apellido_paterno AS nombre FROM usuarios WHERE rol IN ('admin','administrador','agente','vendedor') ORDER BY nombre`),
      pool.query('SELECT id_categoria AS id, nombre FROM categorias ORDER BY nombre'),
      pool.query('SELECT id_lead AS id, nombre FROM leads ORDER BY nombre'),
      pool.query('SELECT id_renta AS id, id_propiedad, renta_mensual AS monto FROM rentas WHERE LOWER(estado) = \'activa\' ORDER BY id_renta DESC'),
    ]);
    return response.json({ data: {
      clients: clients.rows, properties: properties.rows, users: users.rows,
      categories: categories.rows, leads: leads.rows, rentals: rentals.rows,
    } });
  } catch (error) {
    return next(error);
  }
});

router.get('/contracts', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    const query = request.user.rol === 'administrador'
      ? `${listQueries.contracts} ORDER BY creado_en DESC`
      : `${listQueries.contracts} WHERE id_vendedor = $1 ORDER BY creado_en DESC`;
    const result = await pool.query(query, request.user.rol === 'administrador' ? [] : [request.user.id_usuario]);
    return response.json({ data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/properties/:id/map', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT id_propiedad, latitud, longitud
      FROM propiedades
      WHERE id_propiedad = $1 AND eliminado = FALSE
    `, [request.params.id]);
    const property = result.rows[0];
    if (!property) return response.status(404).json({ error: 'Propiedad no encontrada.' });
    if (property.latitud === null || property.longitud === null) {
      return response.status(404).json({ error: 'La propiedad no tiene coordenadas registradas.' });
    }
    const coordinates = `${property.latitud},${property.longitud}`;
    return response.json({
      data: {
        id_propiedad: property.id_propiedad,
        latitud: property.latitud,
        longitud: property.longitud,
        google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/contracts/:id/map', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT id_contrato, id_vendedor, latitud, longitud
      FROM contratos
      WHERE id_contrato = $1
        AND ($2 = 'administrador' OR id_vendedor = $3)
    `, [request.params.id, request.user.rol, request.user.id_usuario]);
    const contract = result.rows[0];
    if (!contract) return response.status(404).json({ error: 'Contrato no encontrado.' });
    if (contract.latitud === null || contract.longitud === null) {
      return response.status(404).json({ error: 'Este contrato no tiene coordenadas registradas.' });
    }
    const coordinates = `${contract.latitud},${contract.longitud}`;
    return response.json({
      data: {
        id_contrato: contract.id_contrato,
        latitud: contract.latitud,
        longitud: contract.longitud,
        google_maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/contracts', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const {
    tipo_operacion, id_propiedad, id_cliente, cliente, precio_total, renta_mensual,
    fecha_contrato, fecha_inicio, fecha_fin, frente_metros, fondo_metros,
    superficie_m2, latitud, longitud, observaciones,
  } = request.body;
  const operation = String(tipo_operacion || '').toUpperCase();
  const agreedAmount = operation === 'RENTA' ? (precio_total || renta_mensual) : precio_total;
  const numeric = (value) => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
  const validCoordinate = (value, minimum, maximum) => numeric(value) && Number(value) >= minimum && Number(value) <= maximum;
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };

  if (!['VENTA', 'RENTA'].includes(operation) || !id_propiedad
    || !numeric(agreedAmount) || Number(agreedAmount) <= 0
    || !numeric(frente_metros) || Number(frente_metros) <= 0
    || !numeric(fondo_metros) || Number(fondo_metros) <= 0
    || !numeric(superficie_m2) || Number(superficie_m2) <= 0) {
    return response.status(400).json({ error: 'Completa operación, lote, precio y las tres medidas con valores válidos.' });
  }
  if (operation === 'VENTA' && (!validCoordinate(latitud, -90, 90) || !validCoordinate(longitud, -180, 180))) {
    return response.status(400).json({ error: 'Las coordenadas válidas de latitud y longitud son obligatorias para una venta.' });
  }
  if (operation === 'RENTA' && (!fecha_inicio || !numeric(renta_mensual) || Number(renta_mensual) <= 0)) {
    return response.status(400).json({ error: 'La renta mensual y la fecha de inicio son obligatorias para una renta.' });
  }
  if ((fecha_contrato && !validDate(fecha_contrato))
    || (operation === 'RENTA' && (!validDate(fecha_inicio) || (fecha_fin && !validDate(fecha_fin))
      || (fecha_fin && fecha_fin < fecha_inicio)))) {
    return response.status(400).json({ error: 'Revisa la fecha del contrato y el periodo de renta.' });
  }
  if ((latitud === undefined || latitud === '') !== (longitud === undefined || longitud === '')) {
    return response.status(400).json({ error: 'Captura ambas coordenadas o deja ambas vacías.' });
  }
  if (latitud !== undefined && latitud !== '' && !validCoordinate(latitud, -90, 90)) {
    return response.status(400).json({ error: 'La latitud debe estar entre -90 y 90.' });
  }
  if (longitud !== undefined && longitud !== '' && !validCoordinate(longitud, -180, 180)) {
    return response.status(400).json({ error: 'La longitud debe estar entre -180 y 180.' });
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const propertyResult = await db.query(`
      SELECT p.id_propiedad, p.titulo, p.tipo_operacion, p.estado_propiedad,
        p.superficie, p.latitud, p.longitud, d.calle, d.numero, d.colonia,
        d.ciudad, d.estado, d.codigo_postal
      FROM propiedades p
      JOIN direcciones d ON d.id_propiedad = p.id_propiedad
      WHERE p.id_propiedad = $1 AND p.eliminado = FALSE
      FOR UPDATE OF p
    `, [id_propiedad]);
    const property = propertyResult.rows[0];
    if (!property) {
      await db.query('ROLLBACK');
      return response.status(404).json({ error: 'El lote seleccionado no existe.' });
    }
    if (String(property.tipo_operacion).toUpperCase() !== operation
      || String(property.estado_propiedad).toLowerCase() !== 'disponible') {
      await db.query('ROLLBACK');
      return response.status(409).json({ error: 'El lote ya no está disponible para esta operación.' });
    }

    let clientRecord;
    if (id_cliente) {
      const clientResult = await db.query(`
        SELECT c.id_cliente, c.curp, c.direccion, c.ciudad, c.estado, c.codigo_postal,
          u.nombre, u.apellido_paterno, u.apellido_materno, u.correo, u.telefono
        FROM clientes c JOIN usuarios u ON u.id_usuario = c.id_usuario
        WHERE c.id_cliente = $1
      `, [id_cliente]);
      clientRecord = clientResult.rows[0];
      if (!clientRecord) {
        await db.query('ROLLBACK');
        return response.status(404).json({ error: 'El cliente seleccionado no existe.' });
      }
    } else {
      const clientData = cliente || {};
      const nombre = String(clientData.nombre || '').trim();
      const apellidoPaterno = String(clientData.apellido_paterno || '').trim();
      const correo = String(clientData.correo || '').trim().toLowerCase();
      if (!nombre || !apellidoPaterno || !correo) {
        await db.query('ROLLBACK');
        return response.status(400).json({ error: 'Para registrar un cliente nuevo, nombre, apellido paterno y correo son obligatorios.' });
      }
      const existing = await db.query(`
        SELECT c.id_cliente FROM clientes c
        JOIN usuarios u ON u.id_usuario = c.id_usuario
        WHERE LOWER(TRIM(u.correo)) = $1
      `, [correo]);
      if (existing.rowCount) {
        await db.query('ROLLBACK');
        return response.status(409).json({ error: 'Ya existe un cliente con ese correo. Selecciónalo en el formulario.' });
      }
      const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
      const user = await db.query(`
        INSERT INTO usuarios (nombre, apellido_paterno, apellido_materno, correo, telefono, password, rol)
        VALUES ($1, $2, $3, $4, $5, $6, 'cliente')
        RETURNING id_usuario
      `, [nombre, apellidoPaterno, clientData.apellido_materno || null, correo,
        clientData.telefono || null, passwordHash]);
      const createdClient = await db.query(`
        INSERT INTO clientes (id_usuario, curp, direccion, ciudad, estado, codigo_postal)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id_cliente
      `, [user.rows[0].id_usuario, clientData.curp || null, clientData.direccion || null,
        clientData.ciudad || null, clientData.estado || null, clientData.codigo_postal || null]);
      clientRecord = {
        id_cliente: createdClient.rows[0].id_cliente,
        nombre,
        apellido_paterno: apellidoPaterno,
        apellido_materno: clientData.apellido_materno || null,
        correo,
        telefono: clientData.telefono || null,
        curp: clientData.curp || null,
      };
    }

    const sellerResult = await db.query(`
      SELECT nombre, apellido_paterno, apellido_materno, correo
      FROM usuarios WHERE id_usuario = $1
    `, [request.user.id_usuario]);
    const seller = sellerResult.rows[0];
    if (!seller) throw new Error('No se encontró el usuario vendedor de la sesión.');

    const latitude = latitud === '' || latitud === undefined ? null : Number(latitud);
    const longitude = longitud === '' || longitud === undefined ? null : Number(longitud);
    const startDate = operation === 'RENTA' ? fecha_inicio : null;
    const endDate = operation === 'RENTA' ? fecha_fin || null : null;
    const amount = Number(agreedAmount);
    const contractResult = await db.query(`
      INSERT INTO contratos (
        tipo_operacion, id_cliente, id_propiedad, id_vendedor, fecha_contrato,
        precio_total, renta_mensual, fecha_inicio, fecha_fin, frente_metros,
        fondo_metros, superficie_m2, latitud, longitud, nombre_cliente,
        correo_cliente, telefono_cliente, curp_cliente, nombre_vendedor,
        correo_vendedor, titulo_propiedad, calle, numero, colonia, ciudad,
        estado, codigo_postal, observaciones
      )
      VALUES (
        $1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE),
        $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        concat_ws(' ', $19::text, $20::text, $21::text), $22, $23, $24, $25, $26, $27, $28,
        $29, $30
      )
      RETURNING id_contrato
    `, [
      operation, clientRecord.id_cliente, property.id_propiedad, request.user.id_usuario,
      fecha_contrato || null, amount, operation === 'RENTA' ? Number(renta_mensual) : null,
      startDate, endDate, Number(frente_metros), Number(fondo_metros), Number(superficie_m2),
      latitude, longitude,
      `${clientRecord.nombre} ${clientRecord.apellido_paterno} ${clientRecord.apellido_materno || ''}`.trim(),
      clientRecord.correo, clientRecord.telefono || null, clientRecord.curp || null,
      seller.nombre, seller.apellido_paterno, seller.apellido_materno,
      seller.correo, property.titulo, property.calle, property.numero, property.colonia,
      property.ciudad, property.estado, property.codigo_postal, observaciones || null,
    ]);

    if (operation === 'VENTA') {
      await db.query(`
        INSERT INTO ventas (id_propiedad, id_cliente, id_agente, precio_venta, fecha_venta)
        VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))
      `, [property.id_propiedad, clientRecord.id_cliente, request.user.id_usuario, amount, fecha_contrato || null]);
    } else {
      await db.query(`
        INSERT INTO rentas (id_propiedad, id_cliente, id_agente, renta_mensual, fecha_inicio, fecha_fin)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [property.id_propiedad, clientRecord.id_cliente, request.user.id_usuario,
        Number(renta_mensual), fecha_inicio, endDate]);
    }
    await db.query(`
      UPDATE propiedades
      SET estado_propiedad = $1,
        latitud = COALESCE($2, latitud),
        longitud = COALESCE($3, longitud)
      WHERE id_propiedad = $4
    `, [operation === 'VENTA' ? 'Vendida' : 'Rentada', latitude, longitude, property.id_propiedad]);
    await db.query(`
      INSERT INTO auditoria (id_usuario, accion, entidad, entidad_id, detalle)
      VALUES ($1, 'crear', 'contratos', $2, jsonb_build_object('tipo_operacion', $3::text, 'id_propiedad', $4::integer))
    `, [request.user.id_usuario, String(contractResult.rows[0].id_contrato), operation, property.id_propiedad]);
    await db.query('COMMIT');

    const created = await pool.query('SELECT * FROM contratos WHERE id_contrato = $1', [contractResult.rows[0].id_contrato]);
    return response.status(201).json({ data: created.rows[0] });
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.code === '23505') {
      if (error.constraint === 'usuarios_correo_key') {
        return response.status(409).json({ error: 'Ya existe un cliente con ese correo.' });
      }
      if (error.constraint === 'ventas_id_propiedad_key') {
        return response.status(409).json({ error: 'Este lote ya tiene una venta registrada.' });
      }
    }
    return next(error);
  } finally {
    db.release();
  }
});

router.get('/documents/:id/file', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT nombre_archivo, mime_type, contenido FROM expedientes_legales WHERE id_documento = $1
    `, [request.params.id]);
    if (!result.rowCount || !result.rows[0].contenido) {
      return response.status(404).json({ error: 'Archivo no encontrado.' });
    }
    response.type(result.rows[0].mime_type || 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.rows[0].nombre_archivo)}"`);
    return response.send(result.rows[0].contenido);
  } catch (error) {
    return next(error);
  }
});

router.post('/documents', requireAuth, requireRole('agente', 'administrador'), upload.single('archivo'), async (request, response, next) => {
  const { id_propiedad, tipo } = request.body;
  if (!request.file || !id_propiedad || !tipo) {
    return response.status(400).json({ error: 'Selecciona una propiedad, tipo y archivo.' });
  }
  try {
    const hash = crypto.createHash('sha256').update(request.file.buffer).digest('hex');
    const result = await pool.query(`
      INSERT INTO expedientes_legales
        (id_documento, id_propiedad, tipo, nombre_archivo, url, hash_archivo,
         estado, subido_por, contenido, mime_type, tamano_bytes)
      VALUES (nextval('public.expedientes_legales_id_documento_seq'), $1, $2, $3,
        'postgres://expedientes_legales', $4, 'PENDIENTE', $5, $6, $7, $8)
      RETURNING id_documento, id_propiedad, tipo, nombre_archivo, hash_archivo, estado, creado_en
    `, [id_propiedad, tipo, request.file.originalname, hash, request.user.id_usuario,
      request.file.buffer, request.file.mimetype, request.file.size]);
    await audit(request.user.id_usuario, 'cargar', 'expedientes_legales', result.rows[0].id_documento,
      { nombre_archivo: request.file.originalname, id_propiedad });
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/matching/run', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    const matches = await pool.query(`
      SELECT l.id_lead, p.id_propiedad,
        LEAST(100, (CASE WHEN pref.ciudad IS NULL OR LOWER(pref.ciudad) = LOWER(d.ciudad) THEN 35 ELSE 0 END)
          + (CASE WHEN pref.precio_min IS NULL OR p.precio >= pref.precio_min THEN 18 ELSE 0 END)
          + (CASE WHEN pref.precio_max IS NULL OR p.precio <= pref.precio_max THEN 18 ELSE 0 END)
          + (CASE WHEN pref.habitaciones_min IS NULL OR p.habitaciones >= pref.habitaciones_min THEN 14 ELSE 0 END)
          + (CASE WHEN pref.tipo IS NULL OR LOWER(pref.tipo) = LOWER(cat.nombre) THEN 8 ELSE 0 END)
          + (CASE WHEN pref.operacion IS NULL OR LOWER(pref.operacion) = LOWER(p.tipo_operacion) THEN 7 ELSE 0 END)) AS score
      FROM leads l
      JOIN LATERAL (SELECT * FROM preferencias_lead WHERE id_lead = l.id_lead ORDER BY id_preferencia DESC LIMIT 1) pref ON TRUE
      JOIN propiedades p ON p.eliminado = FALSE AND LOWER(p.estado_propiedad) = 'disponible'
      JOIN categorias cat ON cat.id_categoria = p.id_categoria
      LEFT JOIN direcciones d ON d.id_propiedad = p.id_propiedad
      WHERE l.estado NOT IN ('CERRADO', 'PERDIDO')
        AND (pref.ciudad IS NULL OR LOWER(pref.ciudad) = LOWER(d.ciudad))
        AND (pref.precio_min IS NULL OR p.precio >= pref.precio_min)
        AND (pref.precio_max IS NULL OR p.precio <= pref.precio_max)
        AND (pref.habitaciones_min IS NULL OR p.habitaciones >= pref.habitaciones_min)
        AND (pref.tipo IS NULL OR LOWER(pref.tipo) = LOWER(cat.nombre))
        AND (pref.operacion IS NULL OR LOWER(pref.operacion) = LOWER(p.tipo_operacion))
    `);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const match of matches.rows) {
        await client.query(`
          INSERT INTO coincidencias (id_lead, id_propiedad, puntuacion)
          VALUES ($1, $2, $3)
          ON CONFLICT (id_lead, id_propiedad) DO UPDATE
          SET puntuacion = EXCLUDED.puntuacion, creada_en = CURRENT_TIMESTAMP
        `, [match.id_lead, match.id_propiedad, match.score]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await audit(request.user.id_usuario, 'ejecutar', 'coincidencias', null, { generadas: matches.rowCount });
    return response.json({ data: matches.rows, count: matches.rowCount });
  } catch (error) {
    return next(error);
  }
});

router.get('/:resource', requireAuth, async (request, response, next) => {
  const query = listQueries[request.params.resource];
  if (!query) return response.status(404).json({ error: 'Recurso no encontrado.' });
  if (request.user.rol !== 'administrador' && request.user.rol !== 'vendedor' && request.user.rol !== 'admin') {
    return response.status(403).json({ error: 'No tienes permisos para consultar usuarios.' });
  }
  if (request.params.resource === 'users' && request.user.rol !== 'administrador' && request.user.rol !== 'admin') {
    return response.status(403).json({ error: 'No tienes permisos para consultar usuarios.' });
  }
  try {
    const result = await pool.query(query);
    return response.json({ data: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/clients', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { nombre, apellido_paterno, apellido_materno, correo, telefono, curp, direccion, ciudad, estado, codigo_postal } = request.body;
  if (!nombre || !apellido_paterno || !correo) {
    return response.status(400).json({ error: 'Nombre, apellido y correo son obligatorios.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
    const user = await client.query(`
      INSERT INTO usuarios (nombre, apellido_paterno, apellido_materno, correo, telefono, password, rol)
      VALUES ($1, $2, $3, $4, $5, $6, 'cliente') RETURNING id_usuario
    `, [nombre.trim(), apellido_paterno.trim(), apellido_materno || null,
      correo.trim().toLowerCase(), telefono || null, passwordHash]);
    const result = await client.query(`
      INSERT INTO clientes (id_usuario, curp, direccion, ciudad, estado, codigo_postal)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_cliente, id_usuario
    `, [user.rows[0].id_usuario, curp || null, direccion || null, ciudad || null, estado || null, codigo_postal || null]);
    await client.query('COMMIT');
    await audit(request.user.id_usuario, 'crear', 'clientes', result.rows[0].id_cliente, { correo });
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/leads', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { nombre, correo, telefono, origen, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion } = request.body;
  if (!nombre) return response.status(400).json({ error: 'El nombre del prospecto es obligatorio.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lead = await client.query(`
      INSERT INTO leads (nombre, correo, telefono, origen, id_agente, consentimiento_datos)
      VALUES ($1, $2, $3, COALESCE($4, 'manual'), $5, TRUE) RETURNING id_lead
    `, [nombre.trim(), correo || null, telefono || null, origen || null, request.user.id_usuario]);
    if (ciudad || precio_min || precio_max || habitaciones_min || tipo || operacion) {
      await client.query(`
        INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [lead.rows[0].id_lead, ciudad || null, precio_min || null, precio_max || null,
        habitaciones_min || null, tipo || null, operacion || null]);
    }
    await client.query('COMMIT');
    await audit(request.user.id_usuario, 'crear', 'leads', lead.rows[0].id_lead, { nombre });
    return response.status(201).json({ data: lead.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/visits', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { id_cliente, id_propiedad, fecha_cita, motivo } = request.body;
  if (!id_cliente || !id_propiedad || !fecha_cita) {
    return response.status(400).json({ error: 'Cliente, propiedad y fecha son obligatorios.' });
  }
  try {
    const result = await pool.query(`
      INSERT INTO citas (id_cliente, id_propiedad, id_agente, fecha_cita, motivo)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [id_cliente, id_propiedad, request.user.id_usuario, fecha_cita, motivo || null]);
    await audit(request.user.id_usuario, 'crear', 'citas', result.rows[0].id_cita);
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/offers', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { id_propiedad, monto, tipo, notas } = request.body;
  if (!id_propiedad || !monto || !tipo) return response.status(400).json({ error: 'Propiedad, monto y tipo son obligatorios.' });
  try {
    const result = await pool.query(`
      INSERT INTO ofertas (id_oferta, id_propiedad, id_usuario, monto, tipo, notas)
      VALUES (nextval('public.ofertas_id_oferta_seq'), $1, $2, $3, $4, $5) RETURNING *
    `, [id_propiedad, request.user.id_usuario, monto, tipo, notas || null]);
    await audit(request.user.id_usuario, 'crear', 'ofertas', result.rows[0].id_oferta);
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/sales', requireAuth, requireRole('administrador'), async (request, response, next) => {
  const { id_propiedad, id_cliente, id_agente, precio_venta, fecha_venta } = request.body;
  if (!id_propiedad || !id_cliente || !id_agente || !precio_venta) {
    return response.status(400).json({ error: 'Propiedad, cliente, agente y precio son obligatorios.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sale = await client.query(`
      INSERT INTO ventas (id_propiedad, id_cliente, id_agente, precio_venta, fecha_venta)
      VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_TIMESTAMP)) RETURNING *
    `, [id_propiedad, id_cliente, id_agente, precio_venta, fecha_venta || null]);
    await client.query("UPDATE propiedades SET estado_propiedad = 'Vendida' WHERE id_propiedad = $1", [id_propiedad]);
    await client.query('COMMIT');
    await audit(request.user.id_usuario, 'crear', 'ventas', sale.rows[0].id_venta);
    return response.status(201).json({ data: sale.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/commissions', requireAuth, requireRole('administrador'), async (request, response, next) => {
  const { id_propiedad, id_agente_captador, id_agente_vendedor, porcentaje_agencia, monto_operacion, monto_total } = request.body;
  if (!id_propiedad || !monto_operacion || !monto_total) return response.status(400).json({ error: 'Propiedad y montos son obligatorios.' });
  try {
    const result = await pool.query(`
      INSERT INTO comisiones
        (id_comision, id_propiedad, id_agente_captador, id_agente_vendedor, porcentaje_agencia, monto_operacion, monto_total)
      VALUES (nextval('public.comisiones_id_comision_seq'), $1, $2, $3, $4, $5, $6) RETURNING *
    `, [id_propiedad, id_agente_captador || null, id_agente_vendedor || null,
      porcentaje_agencia || 0, monto_operacion, monto_total]);
    await audit(request.user.id_usuario, 'crear', 'comisiones', result.rows[0].id_comision);
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/rentals', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { id_propiedad, id_cliente, renta_mensual, fecha_inicio, fecha_fin } = request.body;
  if (!id_propiedad || !id_cliente || !renta_mensual || !fecha_inicio) return response.status(400).json({ error: 'Propiedad, cliente, renta mensual e inicio son obligatorios.' });
  try {
    const result = await pool.query(`
      INSERT INTO rentas (id_propiedad, id_cliente, id_agente, renta_mensual, fecha_inicio, fecha_fin)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [id_propiedad, id_cliente, request.user.id_usuario, renta_mensual, fecha_inicio, fecha_fin || null]);
    await audit(request.user.id_usuario, 'crear', 'rentas', result.rows[0].id_renta);
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/payments', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { id_renta, periodo, monto, estado } = request.body;
  if (!id_renta || !periodo || !monto) return response.status(400).json({ error: 'Renta, periodo y monto son obligatorios.' });
  try {
    const result = await pool.query(`
      INSERT INTO pagos_renta (id_pago, id_renta, periodo, monto, estado, pagado_en)
      VALUES (nextval('public.pagos_renta_id_pago_seq'), $1, $2, $3,
        COALESCE($4, 'PENDIENTE'), CASE WHEN $4 = 'PAGADO' THEN CURRENT_TIMESTAMP ELSE NULL END)
      RETURNING *
    `, [id_renta, periodo, monto, estado || 'PENDIENTE']);
    await audit(request.user.id_usuario, 'crear', 'pagos_renta', result.rows[0].id_pago);
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/users', requireAuth, requireRole('administrador'), async (request, response, next) => {
  const { nombre, apellido_paterno, apellido_materno, correo, telefono, password, rol } = request.body;
  const normalizedRole = String(rol || '').toLowerCase();
  if (!nombre || !apellido_paterno || !correo || !password || !normalizedRole) {
    return response.status(400).json({ error: 'Nombre, apellido, correo, contraseña y rol son obligatorios.' });
  }
  if (!['administrador', 'vendedor'].includes(normalizedRole)) {
    return response.status(400).json({ error: 'El rol debe ser administrador o vendedor.' });
  }
  if (String(password).length < 12) {
    return response.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres.' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(`
      INSERT INTO usuarios (nombre, apellido_paterno, apellido_materno, correo, telefono, password, rol)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id_usuario, nombre, apellido_paterno, apellido_materno, correo, telefono, rol
    `, [nombre.trim(), apellido_paterno.trim(), apellido_materno || null,
      correo.trim().toLowerCase(), telefono || null, hash, normalizedRole]);
    await audit(request.user.id_usuario, 'crear', 'usuarios', result.rows[0].id_usuario);
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
    }
    return next(error);
  }
});

router.patch('/:resource/:id', requireAuth, async (request, response, next) => {
  const { resource, id } = request.params;
  const allowed = {
    leads: { table: 'leads', key: 'id_lead', fields: ['estado', 'nivel_interes', 'id_agente'] },
    visits: { table: 'citas', key: 'id_cita', fields: ['estado', 'fecha_cita', 'motivo'] },
    offers: { table: 'ofertas', key: 'id_oferta', fields: ['estado', 'notas'] },
    rentals: { table: 'rentas', key: 'id_renta', fields: ['estado', 'fecha_fin'] },
    payments: { table: 'pagos_renta', key: 'id_pago', fields: ['estado', 'pagado_en'] },
  }[resource];
  if (!allowed) return response.status(404).json({ error: 'Recurso no editable.' });
  if (!['administrador', 'agente', 'admin'].includes(request.user.rol)) {
    return response.status(403).json({ error: 'No tienes permisos para modificar este registro.' });
  }
  const updates = Object.entries(request.body).filter(([key, value]) => allowed.fields.includes(key) && value !== undefined);
  if (!updates.length) return response.status(400).json({ error: 'No hay cambios válidos.' });
  try {
    const values = updates.map(([, value]) => value);
    const assignments = updates.map(([key], index) => `${key} = $${index + 1}`).join(', ');
    const result = await pool.query(`UPDATE ${allowed.table} SET ${assignments} WHERE ${allowed.key} = $${values.length + 1} RETURNING *`, [...values, id]);
    if (!result.rowCount) return response.status(404).json({ error: 'Registro no encontrado.' });
    await audit(request.user.id_usuario, 'actualizar', allowed.table, id, Object.fromEntries(updates));
    return response.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
