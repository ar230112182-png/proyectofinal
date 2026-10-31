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
      u.correo, u.telefono, u.activo, u.fecha_registro, c.curp, c.direccion, c.ciudad, c.estado, c.codigo_postal
    FROM clientes c JOIN usuarios u ON u.id_usuario = c.id_usuario ORDER BY c.id_cliente DESC`,
  leads: `SELECT id_lead, nombre, correo, telefono, origen, estado, nivel_interes,
      id_agente, consentimiento_datos, creado_en FROM leads ORDER BY creado_en DESC, id_lead DESC`,
  visits: `SELECT c.id_cita, c.fecha_cita, c.motivo, c.estado,
      cl.id_cliente, u.nombre || ' ' || u.apellido_paterno AS cliente,
      p.id_propiedad, p.titulo AS propiedad, c.id_agente,
      a.nombre || ' ' || a.apellido_paterno AS agente
    FROM citas c JOIN clientes cl ON cl.id_cliente = c.id_cliente
    JOIN usuarios u ON u.id_usuario = cl.id_usuario
    JOIN propiedades p ON p.id_propiedad = c.id_propiedad
    JOIN usuarios a ON a.id_usuario = c.id_agente ORDER BY c.fecha_cita DESC, c.id_cita DESC`,
  offers: `SELECT o.id_oferta, o.id_propiedad, p.titulo AS propiedad, o.id_usuario,
      u.nombre || ' ' || u.apellido_paterno AS cliente, o.monto, o.tipo, o.estado,
      o.notas, o.creado_en FROM ofertas o JOIN propiedades p ON p.id_propiedad = o.id_propiedad
      JOIN usuarios u ON u.id_usuario = o.id_usuario ORDER BY o.creado_en DESC, o.id_oferta DESC`,
  documents: `SELECT id_documento, id_propiedad, tipo, nombre_archivo, mime_type,
      tamano_bytes, hash_archivo, estado, subido_por, creado_en
    FROM expedientes_legales ORDER BY creado_en DESC, id_documento DESC`,
  sales: `SELECT v.id_venta, v.id_propiedad, p.titulo AS propiedad, v.id_cliente,
      u.nombre || ' ' || u.apellido_paterno AS cliente, v.id_agente,
      v.precio_venta, v.fecha_venta FROM ventas v
      JOIN propiedades p ON p.id_propiedad = v.id_propiedad
      JOIN clientes c ON c.id_cliente = v.id_cliente
      JOIN usuarios u ON u.id_usuario = c.id_usuario ORDER BY v.fecha_venta DESC, v.id_venta DESC`,
  commissions: `SELECT c.id_comision, c.id_propiedad, p.titulo AS propiedad,
      c.id_agente_captador, c.id_agente_vendedor, c.porcentaje_agencia,
      c.monto_operacion, c.monto_total, c.estado, c.creado_en FROM comisiones c
      JOIN propiedades p ON p.id_propiedad = c.id_propiedad ORDER BY c.creado_en DESC, c.id_comision DESC`,
  rentals: `SELECT r.id_renta, r.id_propiedad, p.titulo AS propiedad, r.id_cliente,
      u.nombre || ' ' || u.apellido_paterno AS cliente, r.id_agente, r.renta_mensual,
      r.fecha_inicio, r.fecha_fin, r.estado FROM rentas r
      JOIN propiedades p ON p.id_propiedad = r.id_propiedad
      JOIN clientes c ON c.id_cliente = r.id_cliente
      JOIN usuarios u ON u.id_usuario = c.id_usuario ORDER BY r.fecha_inicio DESC, r.id_renta DESC`,
  payments: `SELECT pg.id_pago, pg.id_renta, r.id_propiedad, p.titulo AS propiedad,
      pg.periodo, pg.monto, pg.estado, pg.pagado_en,
      c.id_cliente, u.nombre || ' ' || u.apellido_paterno AS cliente, u.correo
    FROM pagos_renta pg
      JOIN rentas r ON r.id_renta = pg.id_renta
      JOIN propiedades p ON p.id_propiedad = r.id_propiedad
      JOIN clientes c ON c.id_cliente = r.id_cliente
      JOIN usuarios u ON u.id_usuario = c.id_usuario
    ORDER BY pg.periodo DESC, pg.id_pago DESC`,
  maintenance: `SELECT m.id_solicitud, m.id_propiedad, p.titulo AS propiedad,
      m.id_renta, m.solicitado_por,
      CONCAT_WS(' ', creator.nombre, creator.apellido_paterno) AS solicitante,
      m.asignado_a,
      CONCAT_WS(' ', assignee.nombre, assignee.apellido_paterno) AS asignado,
      m.titulo, m.descripcion, m.prioridad, m.estado, m.costo_estimado,
      m.costo_final, m.fecha_limite, m.creado_en, m.actualizado_en
    FROM solicitudes_mantenimiento m
      JOIN propiedades p ON p.id_propiedad = m.id_propiedad
      JOIN usuarios creator ON creator.id_usuario = m.solicitado_por
      LEFT JOIN usuarios assignee ON assignee.id_usuario = m.asignado_a
    ORDER BY CASE m.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END,
      m.creado_en DESC, m.id_solicitud DESC`,
  users: `SELECT id_usuario, nombre, apellido_paterno, apellido_materno,
      correo, telefono, rol, activo, fecha_registro FROM usuarios ORDER BY id_usuario`,
  sellers: `SELECT id_usuario, nombre, apellido_paterno, apellido_materno,
      correo, telefono, rol, activo, fecha_registro,
      (SELECT COALESCE(SUM(c.monto_total), 0) FROM comisiones c
       WHERE c.id_agente_vendedor = usuarios.id_usuario
         AND date_trunc('month', c.creado_en) = date_trunc('month', CURRENT_DATE)) AS comision_mes
    FROM usuarios
    WHERE rol IN ('vendedor', 'agente') ORDER BY nombre, apellido_paterno, id_usuario`,
  contracts: `SELECT id_contrato, tipo_operacion, id_cliente, id_propiedad, id_vendedor,
      fecha_contrato, precio_total, renta_mensual, fecha_inicio, fecha_fin,
      frente_metros, fondo_metros, superficie_m2, latitud, longitud,
      nombre_cliente AS cliente,
      nombre_vendedor AS vendedor, titulo_propiedad AS propiedad, creado_en
    FROM contratos ORDER BY fecha_contrato DESC, id_contrato DESC`,
  matches: `SELECT m.id_coincidencia, m.id_lead, l.nombre AS lead,
      m.id_propiedad, p.titulo AS propiedad, m.puntuacion, m.creada_en
    FROM coincidencias m JOIN leads l ON l.id_lead = m.id_lead
    JOIN propiedades p ON p.id_propiedad = m.id_propiedad ORDER BY m.puntuacion DESC, m.id_coincidencia DESC`,
  reports: `SELECT v.id_venta AS id, v.id_agente AS id_vendedor,
      CONCAT_WS(' ', u.nombre, u.apellido_paterno) AS vendedor,
      p.titulo AS propiedad, 'VENTA' AS operacion, v.precio_venta AS cobros,
      v.fecha_venta AS fecha, 'vender' AS actividad
    FROM ventas v JOIN propiedades p ON p.id_propiedad = v.id_propiedad
      JOIN usuarios u ON u.id_usuario = v.id_agente
    UNION ALL
    SELECT r.id_renta AS id, r.id_agente AS id_vendedor,
      CONCAT_WS(' ', u.nombre, u.apellido_paterno) AS vendedor,
      p.titulo AS propiedad, 'RENTA' AS operacion, r.renta_mensual AS cobros,
      r.fecha_inicio AS fecha, 'rentar' AS actividad
    FROM rentas r JOIN propiedades p ON p.id_propiedad = r.id_propiedad
      JOIN usuarios u ON u.id_usuario = r.id_agente
    ORDER BY fecha DESC, operacion, id DESC`,
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE));
  return { page, limit, offset: (page - 1) * limit };
}

async function runPaginated(sql, query) {
  const { page, limit, offset } = parsePagination(query);
  const [rows, count] = await Promise.all([
    pool.query(`${sql} LIMIT $1 OFFSET $2`, [limit, offset]),
    pool.query(`SELECT COUNT(*)::int AS total FROM (${sql}) AS counted`),
  ]);
  const total = count.rows[0].total;
  return { data: rows.rows, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

async function audit(userId, action, entity, entityId, detail = {}) {
  const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'auditoria'
        AND column_name = 'detalle'
    ) AS has_detail
  `);
  const values = [
    userId || null,
    String(action),
    entity,
    entityId == null ? null : String(entityId),
    JSON.stringify(detail),
  ];
  const column = rows[0].has_detail ? 'detalle' : 'datos_nuevos';
  await pool.query(`
    INSERT INTO auditoria (id_usuario, accion, entidad, entidad_id, ${column})
    VALUES ($1, $2, $3, $4, $5::jsonb)
  `, values);
}

async function convertMatchingLeads(db, clientId) {
  return db.query(`
    UPDATE leads l
    SET estado = 'CONVERTIDO'
    FROM clientes c
    JOIN usuarios u ON u.id_usuario = c.id_usuario
    WHERE c.id_cliente = $1
      AND l.correo IS NOT NULL
      AND LOWER(TRIM(l.correo)) = LOWER(TRIM(u.correo))
      AND UPPER(COALESCE(l.estado, '')) NOT IN ('CONVERTIDO', 'DESCARTADO')
    RETURNING l.id_lead
  `, [clientId]);
}

async function syncNotifications() {
  await pool.query(`
    WITH events AS (
      SELECT 'lead:' || l.id_lead::text AS dedupe_key,
        'Nuevo cliente potencial'::text AS titulo,
        CONCAT(l.nombre, COALESCE(' · ' || NULLIF(l.correo, ''), ''),
          COALESCE(' · ' || NULLIF(l.telefono, ''), '')) AS detalle,
        'leads'::text AS entidad, l.id_lead::text AS entidad_id,
        l.id_agente AS asignado_a
      FROM leads l
      WHERE UPPER(l.estado) = 'NUEVO'
      UNION ALL
      SELECT 'visit:' || c.id_cita::text, 'Visita próxima',
        CONCAT(p.titulo, ' · ', u.nombre, ' ', u.apellido_paterno,
          ' · ', to_char(c.fecha_cita, 'DD/MM/YYYY HH24:MI')),
        'visits', c.id_cita::text, c.id_agente
      FROM citas c
      JOIN propiedades p ON p.id_propiedad = c.id_propiedad
      JOIN clientes cl ON cl.id_cliente = c.id_cliente
      JOIN usuarios u ON u.id_usuario = cl.id_usuario
      WHERE c.fecha_cita >= CURRENT_TIMESTAMP
        AND c.fecha_cita < CURRENT_TIMESTAMP + INTERVAL '7 days'
        AND UPPER(COALESCE(c.estado, '')) NOT IN ('CANCELADA', 'COMPLETADA')
      UNION ALL
      SELECT 'payment:' || pg.id_pago::text, 'Pago de renta pendiente',
        CONCAT(p.titulo, ' · ', to_char(pg.periodo, 'DD/MM/YYYY'),
          ' · $', pg.monto::text),
        'payments', pg.id_pago::text, r.id_agente
      FROM pagos_renta pg
      JOIN rentas r ON r.id_renta = pg.id_renta
      JOIN propiedades p ON p.id_propiedad = r.id_propiedad
      WHERE UPPER(COALESCE(pg.estado, '')) = 'VENCIDO'
        OR (UPPER(COALESCE(pg.estado, '')) = 'PENDIENTE' AND pg.periodo <= CURRENT_DATE)
      UNION ALL
      SELECT 'rental:' || r.id_renta::text, 'Renta próxima a vencer',
        CONCAT(p.titulo, ' · vence ', to_char(r.fecha_fin, 'DD/MM/YYYY')),
        'rentals', r.id_renta::text, r.id_agente
      FROM rentas r
      JOIN propiedades p ON p.id_propiedad = r.id_propiedad
      WHERE LOWER(r.estado) = 'activa'
        AND r.fecha_fin >= CURRENT_DATE
        AND r.fecha_fin < CURRENT_DATE + INTERVAL '61 days'
      UNION ALL
      SELECT 'followup:' || s.id_seguimiento::text, 'Seguimiento de cliente pendiente',
        CONCAT(cl.nombre, ' ', cl.apellido_paterno, ' · ', s.contenido),
        'clients', s.id_cliente::text, COALESCE(s.asignado_a, s.id_usuario)
      FROM seguimientos_clientes s
      JOIN clientes c ON c.id_cliente = s.id_cliente
      JOIN usuarios cl ON cl.id_usuario = c.id_usuario
      WHERE s.tipo = 'tarea' AND s.estado = 'pendiente'
        AND s.fecha_limite <= CURRENT_TIMESTAMP + INTERVAL '7 days'
      UNION ALL
      SELECT 'maintenance:' || m.id_solicitud::text, 'Solicitud de mantenimiento',
        CONCAT(p.titulo, ' · ', m.titulo, ' · ', m.prioridad),
        'maintenance', m.id_solicitud::text, m.asignado_a
      FROM solicitudes_mantenimiento m
      JOIN propiedades p ON p.id_propiedad = m.id_propiedad
      WHERE m.estado IN ('pendiente', 'en_proceso')
        AND m.prioridad IN ('alta', 'urgente')
    )
    INSERT INTO notificaciones
      (id_usuario, dedupe_key, titulo, detalle, entidad, entidad_id)
    SELECT recipient.id_usuario, source_event.dedupe_key, source_event.titulo,
      source_event.detalle, source_event.entidad, source_event.entidad_id
    FROM events source_event
    JOIN usuarios recipient ON recipient.activo = TRUE
      AND recipient.rol IN ('admin', 'administrador', 'agente', 'vendedor')
      AND (
        recipient.rol IN ('admin', 'administrador')
        OR source_event.asignado_a IS NULL
        OR recipient.id_usuario = source_event.asignado_a
      )
    ON CONFLICT (id_usuario, dedupe_key) DO NOTHING
  `);
}

router.get('/public/properties/:id', async (request, response, next) => {
  if (!/^\d+$/.test(request.params.id)) return response.status(404).json({ error: 'La propiedad no está disponible.' });
  try {
    const result = await pool.query(`
      SELECT p.id_propiedad, p.titulo, p.descripcion, p.precio,
        p.tipo_operacion, p.superficie, p.habitaciones, p.banos,
        p.estacionamientos, p.imagen_url, p.latitud, p.longitud,
        c.nombre AS categoria,
        CONCAT_WS(', ', NULLIF(TRIM(CONCAT_WS(' ', d.calle, d.numero)), ''),
          d.colonia, d.ciudad, d.estado) AS direccion
      FROM propiedades p
      JOIN categorias c ON c.id_categoria = p.id_categoria
      LEFT JOIN direcciones d ON d.id_propiedad = p.id_propiedad
      WHERE p.id_propiedad = $1 AND p.eliminado = FALSE
        AND LOWER(p.estado_propiedad) = 'disponible'
    `, [request.params.id]);
    if (!result.rowCount) return response.status(404).json({ error: 'La propiedad no está disponible.' });
    return response.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/public/properties', async (request, response, next) => {
  try {
    return response.json(await runPaginated(`
      SELECT p.id_propiedad, p.titulo, p.descripcion, p.precio, p.tipo_operacion,
        p.superficie, p.habitaciones, p.banos, p.estacionamientos, p.imagen_url,
        c.nombre AS categoria,
        CONCAT_WS(', ', d.calle || ' ' || COALESCE(d.numero, ''), d.colonia, d.ciudad, d.estado) AS direccion
      FROM propiedades p JOIN categorias c ON c.id_categoria = p.id_categoria
      LEFT JOIN direcciones d ON d.id_propiedad = p.id_propiedad
      WHERE p.eliminado = FALSE AND LOWER(p.estado_propiedad) = 'disponible'
      ORDER BY p.fecha_publicacion DESC NULLS LAST, p.id_propiedad DESC
    `, request.query));
  } catch (error) {
    return next(error);
  }
});

router.post('/public/leads', async (request, response, next) => {
  const { nombre, correo, telefono, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, consentimiento_datos, id_propiedad } = request.body;
  const propertyId = id_propiedad === undefined || id_propiedad === null || id_propiedad === ''
    ? null
    : Number(id_propiedad);
  if (typeof nombre !== 'string' || !nombre.trim() || consentimiento_datos !== true) {
    return response.status(400).json({ error: 'Nombre y consentimiento de datos son obligatorios.' });
  }
  if (propertyId !== null && (!Number.isSafeInteger(propertyId) || propertyId <= 0)) {
    return response.status(400).json({ error: 'La propiedad seleccionada no es válida.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (propertyId !== null) {
      const property = await client.query(`
        SELECT 1 FROM propiedades
        WHERE id_propiedad = $1 AND eliminado = FALSE
          AND LOWER(estado_propiedad) = 'disponible'
      `, [propertyId]);
      if (!property.rowCount) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'La propiedad seleccionada ya no está disponible.' });
      }
    }
    const lead = await client.query(`
      INSERT INTO leads (nombre, correo, telefono, origen, consentimiento_datos, id_propiedad_interes)
      VALUES ($1, $2, $3, 'portal', TRUE, $4) RETURNING id_lead
    `, [nombre.trim(), correo || null, telefono || null, propertyId]);
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

router.get('/notifications', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    await syncNotifications();
    const [notifications, unread] = await Promise.all([
      pool.query(`
        SELECT id_notificacion, titulo, detalle, entidad, entidad_id, creado_en, leido_en
        FROM notificaciones
        WHERE id_usuario = $1
        ORDER BY (leido_en IS NULL) DESC, creado_en DESC
        LIMIT 30
      `, [request.user.id_usuario]),
      pool.query(`
        SELECT COUNT(*)::int AS total
        FROM notificaciones WHERE id_usuario = $1 AND leido_en IS NULL
      `, [request.user.id_usuario]),
    ]);
    return response.json({ data: notifications.rows, unread_count: unread.rows[0].total });
  } catch (error) {
    return next(error);
  }
});

router.patch('/notifications/:id/read', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      UPDATE notificaciones
      SET leido_en = COALESCE(leido_en, CURRENT_TIMESTAMP)
      WHERE id_notificacion = $1 AND id_usuario = $2
      RETURNING id_notificacion, leido_en
    `, [request.params.id, request.user.id_usuario]);
    if (!result.rowCount) return response.status(404).json({ error: 'Notificación no encontrada.' });
    return response.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/clients/:id/history', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    const clientResult = await pool.query(`
      SELECT c.id_cliente, c.id_usuario, u.nombre, u.apellido_paterno,
        u.apellido_materno, u.correo, u.telefono
      FROM clientes c JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE c.id_cliente = $1
    `, [request.params.id]);
    if (!clientResult.rowCount) return response.status(404).json({ error: 'Cliente no encontrado.' });

    const [activities, visits, contracts, payments, documents] = await Promise.all([
      pool.query(`
        SELECT s.id_seguimiento, s.tipo, s.contenido, s.fecha_limite,
          s.estado, s.creado_en, s.asignado_a,
          CONCAT_WS(' ', u.nombre, u.apellido_paterno) AS asignado
        FROM seguimientos_clientes s
        LEFT JOIN usuarios u ON u.id_usuario = s.asignado_a
        WHERE s.id_cliente = $1
        ORDER BY s.creado_en DESC, s.id_seguimiento DESC
      `, [request.params.id]),
      pool.query(`
        SELECT c.id_cita AS id, 'Cita'::text AS tipo,
          CONCAT(p.titulo, ' · ', c.estado) AS contenido,
          c.fecha_cita AS fecha
        FROM citas c JOIN propiedades p ON p.id_propiedad = c.id_propiedad
        WHERE c.id_cliente = $1
        ORDER BY c.fecha_cita DESC
      `, [request.params.id]),
      pool.query(`
        SELECT id_contrato AS id, 'Contrato'::text AS tipo,
          CONCAT(tipo_operacion, ' · ', titulo_propiedad, ' · $', precio_total::text) AS contenido,
          fecha_contrato::timestamptz AS fecha
        FROM contratos WHERE id_cliente = $1
        ORDER BY fecha_contrato DESC
      `, [request.params.id]),
      pool.query(`
        SELECT pg.id_pago AS id, 'Pago de renta'::text AS tipo,
          CONCAT(p.titulo, ' · ', pg.estado, ' · $', pg.monto::text) AS contenido,
          pg.periodo::timestamptz AS fecha
        FROM pagos_renta pg
        JOIN rentas r ON r.id_renta = pg.id_renta
        JOIN propiedades p ON p.id_propiedad = r.id_propiedad
        WHERE r.id_cliente = $1
        ORDER BY pg.periodo DESC
      `, [request.params.id]),
      pool.query(`
        SELECT d.id_documento, d.nombre_archivo, d.tipo,
          (access.id_documento IS NOT NULL) AS autorizado
        FROM expedientes_legales d
        JOIN rentas r ON r.id_propiedad = d.id_propiedad AND r.id_cliente = $1
          AND LOWER(r.estado) = 'activa'
        LEFT JOIN acceso_documentos_inquilino access
          ON access.id_documento = d.id_documento AND access.id_cliente = $1
        GROUP BY d.id_documento, access.id_documento
        ORDER BY d.creado_en DESC
      `, [request.params.id]),
    ]);

    return response.json({ data: {
      client: clientResult.rows[0],
      activities: activities.rows,
      timeline: [...visits.rows, ...contracts.rows, ...payments.rows]
        .sort((left, right) => new Date(right.fecha) - new Date(left.fecha)),
      documents: documents.rows,
    } });
  } catch (error) {
    return next(error);
  }
});

router.post('/clients/:id/activities', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { tipo, contenido, fecha_limite, asignado_a } = request.body;
  if (!['nota', 'tarea'].includes(tipo) || !String(contenido || '').trim()) {
    return response.status(400).json({ error: 'Indica si es una nota o tarea y escribe su contenido.' });
  }
  if (String(contenido).length > 2000) {
    return response.status(400).json({ error: 'El contenido no puede superar los 2000 caracteres.' });
  }
  if (tipo === 'tarea' && !fecha_limite) {
    return response.status(400).json({ error: 'Las tareas necesitan una fecha límite.' });
  }
  if (asignado_a !== undefined && asignado_a !== '' && !/^\d+$/.test(String(asignado_a))) {
    return response.status(400).json({ error: 'El vendedor asignado no es válido.' });
  }
  if (tipo === 'tarea' && Number.isNaN(Date.parse(fecha_limite))) {
    return response.status(400).json({ error: 'La fecha límite de la tarea no es válida.' });
  }
  try {
    const result = await pool.query(`
      INSERT INTO seguimientos_clientes
        (id_cliente, id_usuario, asignado_a, tipo, contenido, fecha_limite)
      SELECT c.id_cliente, $2, $3, $4, $5, $6
      FROM clientes c
      WHERE c.id_cliente = $1
        AND ($3::integer IS NULL OR EXISTS (
          SELECT 1 FROM usuarios u WHERE u.id_usuario = $3
            AND u.activo = TRUE AND u.rol IN ('admin', 'administrador', 'agente', 'vendedor')
        ))
      RETURNING *
    `, [request.params.id, request.user.id_usuario, asignado_a || null,
      tipo, String(contenido).trim(), tipo === 'tarea' ? fecha_limite : null]);
    if (!result.rowCount) return response.status(404).json({ error: 'Cliente o vendedor asignado no encontrado.' });
    await audit(request.user.id_usuario, 'crear', 'seguimientos_clientes',
      result.rows[0].id_seguimiento, { id_cliente: request.params.id, tipo });
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/clients/:id/activities/:activityId', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      UPDATE seguimientos_clientes
      SET estado = 'completada'
      WHERE id_cliente = $1 AND id_seguimiento = $2 AND tipo = 'tarea'
      RETURNING id_seguimiento, estado
    `, [request.params.id, request.params.activityId]);
    if (!result.rowCount) return response.status(404).json({ error: 'Tarea pendiente no encontrada.' });
    await pool.query(`
      UPDATE notificaciones SET leido_en = COALESCE(leido_en, CURRENT_TIMESTAMP)
      WHERE dedupe_key = $1 AND leido_en IS NULL
    `, [`followup:${request.params.activityId}`]);
    return response.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/clients/:id/credentials', requireAuth, requireRole('administrador'), async (request, response, next) => {
  const password = String(request.body.password || '');
  if (password.length < 12) {
    return response.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres.' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const passwordColumns = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'usuarios'
        AND column_name IN ('contrasena', 'password')
    `);
    const passwordColumn = ['contrasena', 'password'].find((column) =>
      passwordColumns.rows.some((row) => row.column_name === column));
    if (!passwordColumn) throw new Error('No se encontró una columna de contraseña en usuarios.');
    const result = await pool.query(`
      UPDATE usuarios u SET ${passwordColumn} = $1
      FROM clientes c
      WHERE c.id_cliente = $2 AND c.id_usuario = u.id_usuario
        AND u.rol = 'cliente'
      RETURNING c.id_cliente
    `, [hash, request.params.id]);
    if (!result.rowCount) return response.status(404).json({ error: 'La cuenta de cliente no existe.' });
    await audit(request.user.id_usuario, 'actualizar', 'clientes',
      request.params.id, { acceso_portal: true });
    return response.json({ data: { id_cliente: result.rows[0].id_cliente } });
  } catch (error) {
    return next(error);
  }
});

router.post('/clients/:id/documents/:documentId', requireAuth, requireRole('administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      INSERT INTO acceso_documentos_inquilino (id_cliente, id_documento, otorgado_por)
      SELECT c.id_cliente, d.id_documento, $3
      FROM clientes c
      JOIN rentas r ON r.id_cliente = c.id_cliente AND LOWER(r.estado) = 'activa'
      JOIN expedientes_legales d ON d.id_propiedad = r.id_propiedad
      WHERE c.id_cliente = $1 AND d.id_documento = $2
      ON CONFLICT (id_cliente, id_documento) DO NOTHING
      RETURNING id_documento
    `, [request.params.id, request.params.documentId, request.user.id_usuario]);
    if (!result.rowCount) {
      const exists = await pool.query(`
        SELECT 1 FROM acceso_documentos_inquilino
        WHERE id_cliente = $1 AND id_documento = $2
      `, [request.params.id, request.params.documentId]);
      if (!exists.rowCount) return response.status(404).json({ error: 'El documento no pertenece a una renta activa de este cliente.' });
    }
    await audit(request.user.id_usuario, 'actualizar', 'acceso_documentos_inquilino',
      request.params.documentId, { id_cliente: request.params.id, acceso: true });
    return response.status(201).json({ data: { id_documento: request.params.documentId } });
  } catch (error) {
    return next(error);
  }
});

router.delete('/clients/:id/documents/:documentId', requireAuth, requireRole('administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      DELETE FROM acceso_documentos_inquilino
      WHERE id_cliente = $1 AND id_documento = $2
      RETURNING id_documento
    `, [request.params.id, request.params.documentId]);
    if (!result.rowCount) return response.status(404).json({ error: 'El acceso al documento no existe.' });
    await audit(request.user.id_usuario, 'actualizar', 'acceso_documentos_inquilino',
      request.params.documentId, { id_cliente: request.params.id, acceso: false });
    return response.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get('/tenant/me', requireAuth, requireRole('cliente'), async (request, response, next) => {
  try {
    const clientResult = await pool.query(`
      SELECT c.id_cliente, u.nombre, u.apellido_paterno
      FROM clientes c JOIN usuarios u ON u.id_usuario = c.id_usuario
      WHERE c.id_usuario = $1
    `, [request.user.id_usuario]);
    if (!clientResult.rowCount) return response.status(403).json({ error: 'La cuenta no tiene un perfil de inquilino asociado.' });
    const client = clientResult.rows[0];
    const [rentals, contracts, payments, documents] = await Promise.all([
      pool.query(`
        SELECT r.id_renta, r.renta_mensual, r.fecha_inicio, r.fecha_fin, r.estado,
          p.titulo AS propiedad,
          CONCAT_WS(', ', d.calle || ' ' || COALESCE(d.numero, ''),
            d.colonia, d.ciudad, d.estado) AS direccion
        FROM rentas r
        JOIN propiedades p ON p.id_propiedad = r.id_propiedad
        LEFT JOIN direcciones d ON d.id_propiedad = p.id_propiedad
        WHERE r.id_cliente = $1 ORDER BY r.fecha_inicio DESC, r.id_renta DESC
      `, [client.id_cliente]),
      pool.query(`
        SELECT id_contrato, tipo_operacion, fecha_contrato, fecha_inicio, fecha_fin,
          precio_total, renta_mensual, titulo_propiedad AS propiedad
        FROM contratos WHERE id_cliente = $1 AND tipo_operacion = 'RENTA'
        ORDER BY fecha_contrato DESC, id_contrato DESC
      `, [client.id_cliente]),
      pool.query(`
        SELECT pg.id_pago, pg.periodo, pg.monto, pg.estado, pg.pagado_en,
          p.titulo AS propiedad
        FROM pagos_renta pg
        JOIN rentas r ON r.id_renta = pg.id_renta
        JOIN propiedades p ON p.id_propiedad = r.id_propiedad
        WHERE r.id_cliente = $1 ORDER BY pg.periodo DESC, pg.id_pago DESC
      `, [client.id_cliente]),
      pool.query(`
        SELECT d.id_documento, d.nombre_archivo, d.tipo, d.mime_type, d.creado_en
        FROM acceso_documentos_inquilino access
        JOIN expedientes_legales d ON d.id_documento = access.id_documento
        JOIN rentas r ON r.id_cliente = access.id_cliente
          AND r.id_propiedad = d.id_propiedad AND LOWER(r.estado) = 'activa'
        WHERE access.id_cliente = $1
        GROUP BY d.id_documento, access.otorgado_en
        ORDER BY access.otorgado_en DESC
      `, [client.id_cliente]),
    ]);
    return response.json({ data: {
      client,
      rentals: rentals.rows,
      contracts: contracts.rows,
      payments: payments.rows,
      documents: documents.rows,
    } });
  } catch (error) {
    return next(error);
  }
});

router.get('/tenant/documents/:id/file', requireAuth, requireRole('cliente'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT d.nombre_archivo, d.mime_type, d.contenido
      FROM acceso_documentos_inquilino access
      JOIN clientes c ON c.id_cliente = access.id_cliente
      JOIN expedientes_legales d ON d.id_documento = access.id_documento
      JOIN rentas r ON r.id_cliente = access.id_cliente
        AND r.id_propiedad = d.id_propiedad AND LOWER(r.estado) = 'activa'
      WHERE c.id_usuario = $1 AND d.id_documento = $2
    `, [request.user.id_usuario, request.params.id]);
    if (!result.rowCount || !result.rows[0].contenido) {
      return response.status(404).json({ error: 'Documento autorizado no encontrado.' });
    }
    const file = result.rows[0];
    response.type(file.mime_type || 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.nombre_archivo)}"`);
    return response.send(file.contenido);
  } catch (error) {
    return next(error);
  }
});

router.get('/summary', requireAuth, requireRole('agente', 'administrador'), async (_request, response, next) => {
  try {
    const [summary, newLeads, upcomingVisits, pendingPayments, expiringRentals, openMaintenance] = await Promise.all([
      pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM propiedades
          WHERE eliminado = FALSE AND LOWER(estado_propiedad) = 'disponible') AS propiedades,
        (SELECT COUNT(*)::int FROM clientes) AS clientes,
        (SELECT COUNT(*)::int FROM citas
          WHERE fecha_cita >= date_trunc('week', CURRENT_DATE)
            AND fecha_cita < date_trunc('week', CURRENT_DATE) + INTERVAL '1 week'
            AND UPPER(COALESCE(estado, '')) <> 'CANCELADA') AS visitas,
        (SELECT COALESCE(SUM(precio_venta), 0) FROM ventas
          WHERE date_trunc('month', fecha_venta) = date_trunc('month', CURRENT_DATE)) AS ingresos,
        (SELECT COUNT(*)::int FROM leads WHERE UPPER(estado) = 'NUEVO') AS leads_nuevos,
        (SELECT COUNT(*)::int FROM expedientes_legales WHERE UPPER(estado) = 'PENDIENTE') AS documentos_pendientes,
        (SELECT COUNT(*)::int FROM rentas WHERE LOWER(estado) = 'activa') AS rentas_activas,
        (SELECT COUNT(*)::int FROM auditoria WHERE creado_en >= CURRENT_DATE) AS eventos_hoy
      `),
      pool.query(`
        SELECT id_lead, nombre,
          CONCAT_WS(' · ', NULLIF(correo, ''), NULLIF(telefono, '')) AS detalle,
          creado_en AS fecha, COUNT(*) OVER() AS total
        FROM leads
        WHERE UPPER(estado) = 'NUEVO'
        ORDER BY creado_en ASC, id_lead ASC
        LIMIT 4
      `),
      pool.query(`
        SELECT c.id_cita,
          CONCAT_WS(' ', u.nombre, u.apellido_paterno) AS cliente,
          p.titulo AS propiedad, c.fecha_cita, c.estado,
          COUNT(*) OVER() AS total
        FROM citas c
        JOIN clientes cl ON cl.id_cliente = c.id_cliente
        JOIN usuarios u ON u.id_usuario = cl.id_usuario
        JOIN propiedades p ON p.id_propiedad = c.id_propiedad
        WHERE c.fecha_cita >= CURRENT_TIMESTAMP
          AND c.fecha_cita < CURRENT_TIMESTAMP + INTERVAL '7 days'
          AND UPPER(COALESCE(c.estado, '')) NOT IN ('CANCELADA', 'COMPLETADA')
        ORDER BY c.fecha_cita ASC, c.id_cita ASC
        LIMIT 4
      `),
      pool.query(`
        SELECT pg.id_pago, p.titulo AS propiedad, pg.periodo::text AS periodo,
          pg.monto, pg.estado, COUNT(*) OVER() AS total
        FROM pagos_renta pg
        JOIN rentas r ON r.id_renta = pg.id_renta
        JOIN propiedades p ON p.id_propiedad = r.id_propiedad
          WHERE UPPER(COALESCE(pg.estado, '')) = 'VENCIDO'
            OR (UPPER(COALESCE(pg.estado, '')) = 'PENDIENTE' AND pg.periodo <= CURRENT_DATE)
        ORDER BY pg.periodo ASC, pg.id_pago ASC
        LIMIT 4
      `),
      pool.query(`
        SELECT r.id_renta, p.titulo AS propiedad, r.fecha_fin,
          COUNT(*) OVER() AS total
        FROM rentas r
        JOIN propiedades p ON p.id_propiedad = r.id_propiedad
        WHERE LOWER(r.estado) = 'activa'
          AND r.fecha_fin >= CURRENT_DATE
          AND r.fecha_fin < CURRENT_DATE + INTERVAL '61 days'
        ORDER BY r.fecha_fin ASC, r.id_renta ASC
        LIMIT 4
      `),
      pool.query(`
        SELECT m.id_solicitud, m.titulo, m.prioridad, p.titulo AS propiedad,
          COUNT(*) OVER() AS total
        FROM solicitudes_mantenimiento m
        JOIN propiedades p ON p.id_propiedad = m.id_propiedad
        WHERE m.estado IN ('pendiente', 'en_proceso')
          AND m.prioridad IN ('alta', 'urgente')
        ORDER BY CASE m.prioridad WHEN 'urgente' THEN 0 ELSE 1 END,
          m.creado_en ASC, m.id_solicitud ASC
        LIMIT 4
      `),
    ]);

    const makeGroup = (rows, items) => ({
      total: Number(rows[0]?.total || 0),
      items: rows.map(items),
    });
    const alerts = [
      {
        type: 'leads',
        label: 'Clientes potenciales por contactar',
        view: 'clients',
        ...makeGroup(newLeads.rows, (lead) => ({
          id: lead.id_lead,
          title: lead.nombre,
          detail: lead.detalle || 'Sin datos de contacto',
          date: lead.fecha,
        })),
      },
      {
        type: 'visits',
        label: 'Visitas próximas',
        view: 'visits',
        ...makeGroup(upcomingVisits.rows, (visit) => ({
          id: visit.id_cita,
          title: visit.cliente,
          detail: `${visit.propiedad} · ${visit.estado}`,
          date: visit.fecha_cita,
        })),
      },
      {
        type: 'payments',
        label: 'Pagos de renta pendientes',
        view: 'rents',
        ...makeGroup(pendingPayments.rows, (payment) => ({
          id: payment.id_pago,
          title: payment.propiedad,
          detail: `${payment.periodo} · ${payment.estado} · $${Number(payment.monto).toLocaleString('es-MX')}`,
          date: payment.periodo,
        })),
      },
      {
        type: 'rentals',
        label: 'Contratos por vencer',
        view: 'rents',
        ...makeGroup(expiringRentals.rows, (rental) => ({
          id: rental.id_renta,
          title: rental.propiedad,
          detail: `Vence ${String(rental.fecha_fin).slice(0, 10)}`,
          date: rental.fecha_fin,
        })),
      },
      {
        type: 'maintenance',
        label: 'Mantenimiento prioritario',
        view: 'maintenance',
        ...makeGroup(openMaintenance.rows, (item) => ({
          id: item.id_solicitud,
          title: item.titulo,
          detail: `${item.propiedad} · ${item.prioridad}`,
        })),
      },
    ];

    return response.json({ data: { ...summary.rows[0], alerts } });
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
      pool.query(`SELECT id_usuario AS id, nombre || ' ' || apellido_paterno AS nombre FROM usuarios WHERE activo = TRUE AND rol IN ('admin','administrador','agente','vendedor') ORDER BY nombre`),
      pool.query('SELECT id_categoria AS id, nombre FROM categorias ORDER BY nombre'),
      pool.query('SELECT id_lead AS id, nombre FROM leads ORDER BY nombre'),
      pool.query(`
        SELECT r.id_renta AS id, r.id_propiedad, r.renta_mensual AS monto,
          p.titulo || ' · ' || u.nombre || ' ' || u.apellido_paterno AS nombre
        FROM rentas r
        JOIN propiedades p ON p.id_propiedad = r.id_propiedad
        JOIN clientes c ON c.id_cliente = r.id_cliente
        JOIN usuarios u ON u.id_usuario = c.id_usuario
        WHERE LOWER(r.estado) = 'activa'
        ORDER BY r.id_renta DESC
      `),
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
    await convertMatchingLeads(db, clientRecord.id_cliente);
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
  const rol = request.user.rol;
  const isAdmin = rol === 'administrador' || rol === 'admin';
  const isVendedor = rol === 'vendedor' || rol === 'agente';
  // Solo administradores y vendedores pueden usar el sistema interno
  if (!isAdmin && !isVendedor) {
    return response.status(403).json({ error: 'No tienes permisos para acceder al sistema.' });
  }
  // Solo administradores pueden consultar usuarios y vendedores
  if ((request.params.resource === 'users' || request.params.resource === 'sellers') && !isAdmin) {
    return response.status(403).json({ error: 'Solo los administradores pueden acceder a esta sección.' });
  }
  if (request.params.resource === 'commissions' && !isAdmin) {
    return response.status(403).json({ error: 'Solo los administradores pueden acceder a comisiones y finanzas.' });
  }
  try {
    return response.json(await runPaginated(query, request.query));
  } catch (error) {
    return next(error);
  }
});

router.post('/maintenance', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const {
    id_propiedad, id_renta, titulo, descripcion, prioridad,
    asignado_a, costo_estimado, fecha_limite,
  } = request.body;
  const normalizedPriority = String(prioridad || 'normal').toLowerCase();
  const optionalNumber = (value) => value === undefined || value === null || value === ''
    || (Number.isSafeInteger(Number(value)) && Number(value) > 0);
  const validDeadline = !fecha_limite || (
    /^\d{4}-\d{2}-\d{2}$/.test(fecha_limite)
    && !Number.isNaN(Date.parse(`${fecha_limite}T00:00:00Z`))
    && new Date(`${fecha_limite}T00:00:00Z`).toISOString().slice(0, 10) === fecha_limite
  );
  if (!Number.isSafeInteger(Number(id_propiedad)) || Number(id_propiedad) <= 0
    || typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 180
    || typeof descripcion !== 'string' || !descripcion.trim()
    || !['baja', 'normal', 'alta', 'urgente'].includes(normalizedPriority)
    || !optionalNumber(id_renta) || !optionalNumber(asignado_a)
    || (costo_estimado !== undefined && costo_estimado !== ''
      && (!Number.isFinite(Number(costo_estimado)) || Number(costo_estimado) < 0))
    || !validDeadline) {
    return response.status(400).json({ error: 'Revisa la propiedad, título, descripción, prioridad y demás datos de la solicitud.' });
  }
  try {
    if (id_renta) {
      const rental = await pool.query(`
        SELECT 1 FROM rentas
        WHERE id_renta = $1 AND id_propiedad = $2
      `, [id_renta, id_propiedad]);
      if (!rental.rowCount) return response.status(400).json({ error: 'La renta seleccionada no corresponde a esta propiedad.' });
    }
    if (asignado_a) {
      const assignee = await pool.query(`
        SELECT 1 FROM usuarios
        WHERE id_usuario = $1 AND activo = TRUE
          AND rol IN ('admin', 'administrador', 'agente', 'vendedor')
      `, [asignado_a]);
      if (!assignee.rowCount) return response.status(400).json({ error: 'El responsable seleccionado no está activo o no puede atender solicitudes.' });
    }
    const result = await pool.query(`
      INSERT INTO solicitudes_mantenimiento
        (id_propiedad, id_renta, solicitado_por, asignado_a, titulo, descripcion,
          prioridad, costo_estimado, fecha_limite)
      SELECT p.id_propiedad, $2, $3, $4, $5, $6, $7, $8, $9
      FROM propiedades p
      WHERE p.id_propiedad = $1 AND p.eliminado = FALSE
      RETURNING *
    `, [id_propiedad, id_renta || null, request.user.id_usuario, asignado_a || null,
      titulo.trim(), descripcion.trim(), normalizedPriority,
      costo_estimado === '' ? null : costo_estimado || null, fecha_limite || null]);
    if (!result.rowCount) return response.status(404).json({ error: 'La propiedad no existe o ya fue archivada.' });
    await audit(request.user.id_usuario, 'crear', 'solicitudes_mantenimiento',
      result.rows[0].id_solicitud, { titulo: result.rows[0].titulo, prioridad: normalizedPriority });
    return response.status(201).json({ data: result.rows[0] });
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

router.patch('/clients/:id', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const active = request.body.activo;
  if (typeof active !== 'boolean') {
    return response.status(400).json({ error: 'El estado debe ser activo o inactivo.' });
  }
  try {
    const result = await pool.query(`
      UPDATE usuarios u
      SET activo = $1
      FROM clientes c
      WHERE c.id_cliente = $2 AND c.id_usuario = u.id_usuario
      RETURNING c.id_cliente, u.activo
    `, [active, request.params.id]);
    if (!result.rowCount) return response.status(404).json({ error: 'Cliente no encontrado.' });
    await audit(request.user.id_usuario, 'actualizar', 'clientes', request.params.id, { activo: active });
    return response.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/leads', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { nombre, correo, telefono, origen, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion } = request.body;
  if (!nombre) return response.status(400).json({ error: 'El nombre del cliente potencial es obligatorio.' });
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
    await convertMatchingLeads(client, id_cliente);
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
  const { id_propiedad, id_agente_captador, id_agente_vendedor, porcentaje_agencia, monto_operacion, monto_total, estado } = request.body;
  if (!id_propiedad || !monto_operacion || !monto_total) return response.status(400).json({ error: 'Propiedad y montos son obligatorios.' });
  try {
    const result = await pool.query(`
      INSERT INTO comisiones
        (id_comision, id_propiedad, id_agente_captador, id_agente_vendedor, porcentaje_agencia, monto_operacion, monto_total, estado)
      VALUES (nextval('public.comisiones_id_comision_seq'), $1, $2, $3, $4, $5, $6, COALESCE($7, 'PENDIENTE')) RETURNING *
    `, [id_propiedad, id_agente_captador || null, id_agente_vendedor || null,
      porcentaje_agencia || 0, monto_operacion, monto_total, estado || null]);
    await audit(request.user.id_usuario, 'crear', 'comisiones', result.rows[0].id_comision);
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/rentals', requireAuth, requireRole('agente', 'administrador'), async (request, response, next) => {
  const { id_propiedad, id_cliente, renta_mensual, fecha_inicio, fecha_fin } = request.body;
  if (!id_propiedad || !id_cliente || !renta_mensual || !fecha_inicio) return response.status(400).json({ error: 'Propiedad, cliente, renta mensual e inicio son obligatorios.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO rentas (id_propiedad, id_cliente, id_agente, renta_mensual, fecha_inicio, fecha_fin)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [id_propiedad, id_cliente, request.user.id_usuario, renta_mensual, fecha_inicio, fecha_fin || null]);
    await convertMatchingLeads(client, id_cliente);
    await client.query('COMMIT');
    await audit(request.user.id_usuario, 'crear', 'rentas', result.rows[0].id_renta);
    return response.status(201).json({ data: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
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
  if (!['cliente', 'usuario', 'administrador', 'vendedor'].includes(normalizedRole)) {
    return response.status(400).json({ error: 'El rol debe ser cliente, usuario, administrador o vendedor.' });
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

router.patch('/users/:id', requireAuth, requireRole('administrador'), async (request, response, next) => {
  const { nombre, apellido_paterno, apellido_materno, correo, telefono, password, rol, activo } = request.body;
  const fields = [];
  const values = [];
  const addField = (field, value) => {
    if (value !== undefined) {
      fields.push(`${field} = $${values.length + 1}`);
      values.push(typeof value === 'string' ? value.trim() : value);
    }
  };
  addField('nombre', nombre);
  addField('apellido_paterno', apellido_paterno);
  addField('apellido_materno', apellido_materno);
  addField('correo', correo ? String(correo).toLowerCase() : correo);
  addField('telefono', telefono);
  if (activo !== undefined) {
    if (typeof activo !== 'boolean') {
      return response.status(400).json({ error: 'El estado debe ser activo o inactivo.' });
    }
    addField('activo', activo);
  }
  if (rol !== undefined) {
    const normalizedRole = String(rol).toLowerCase();
    if (!['cliente', 'usuario', 'administrador', 'vendedor'].includes(normalizedRole)) {
      return response.status(400).json({ error: 'El rol debe ser cliente, usuario, administrador o vendedor.' });
    }
    fields.push(`rol = $${values.length + 1}`);
    values.push(normalizedRole);
  }
  if (password !== undefined && password !== '') {
    if (String(password).length < 12) {
      return response.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres.' });
    }
    fields.push(`password = $${values.length + 1}`);
    values.push(await bcrypt.hash(password, 12));
  }
  if (!fields.length) return response.status(400).json({ error: 'No hay cambios válidos.' });
  try {
    const result = await pool.query(`
      UPDATE usuarios SET ${fields.join(', ')}
      WHERE id_usuario = $${values.length + 1}
      RETURNING id_usuario, nombre, apellido_paterno, apellido_materno, correo, telefono, rol, activo
    `, [...values, request.params.id]);
    if (!result.rowCount) return response.status(404).json({ error: 'Usuario no encontrado.' });
    await audit(request.user.id_usuario, 'actualizar', 'usuarios', request.params.id);
    return response.json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
    return next(error);
  }
});

router.delete('/users/:id', requireAuth, requireRole('administrador'), async (request, response, next) => {
  try {
    const result = await pool.query(`
      DELETE FROM usuarios
      WHERE id_usuario = $1 AND id_usuario <> $2
      RETURNING id_usuario
    `, [request.params.id, request.user.id_usuario]);
    if (!result.rowCount) return response.status(404).json({ error: 'Usuario no encontrado o es tu propia cuenta.' });
    await audit(request.user.id_usuario, 'eliminar', 'usuarios', request.params.id);
    return response.status(204).send();
  } catch (error) {
    if (error.code === '23503') return response.status(409).json({ error: 'No se puede eliminar este usuario porque tiene registros relacionados.' });
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
    commissions: { table: 'comisiones', key: 'id_comision', fields: ['estado'] },
    maintenance: {
      table: 'solicitudes_mantenimiento',
      key: 'id_solicitud',
      fields: ['estado', 'asignado_a', 'costo_final'],
    },
  }[resource];
  if (!allowed) return response.status(404).json({ error: 'Recurso no editable.' });
  if (!['administrador', 'agente', 'admin'].includes(request.user.rol)) {
    return response.status(403).json({ error: 'No tienes permisos para modificar este registro.' });
  }
  const updates = Object.entries(request.body).filter(([key, value]) => allowed.fields.includes(key) && value !== undefined);
  if (!updates.length) return response.status(400).json({ error: 'No hay cambios válidos.' });
  if (resource === 'maintenance' && updates.some(([key, value]) => (
    (key === 'estado' && !['pendiente', 'en_proceso', 'completada', 'cancelada'].includes(value))
    || (key === 'asignado_a' && value !== null && value !== ''
      && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0))
    || (key === 'costo_final' && value !== null && value !== ''
      && (!Number.isFinite(Number(value)) || Number(value) < 0))
  ))) {
    return response.status(400).json({ error: 'El estado, responsable o costo final no es válido.' });
  }
  if (resource === 'payments' && updates.some(([key, value]) => (
    key === 'estado' && !['PENDIENTE', 'PAGADO', 'VENCIDO'].includes(String(value).toUpperCase())
  ))) {
    return response.status(400).json({ error: 'El estado del pago no es válido.' });
  }
  try {
    if (resource === 'maintenance') {
      const assignee = updates.find(([key]) => key === 'asignado_a')?.[1];
      if (assignee !== undefined && assignee !== null && assignee !== '') {
        const validAssignee = await pool.query(`
          SELECT 1 FROM usuarios
          WHERE id_usuario = $1 AND activo = TRUE
            AND rol IN ('admin', 'administrador', 'agente', 'vendedor')
        `, [assignee]);
        if (!validAssignee.rowCount) return response.status(400).json({ error: 'El responsable seleccionado no está activo o no puede atender solicitudes.' });
      }
    }
    const values = updates.map(([, value]) => value);
    let assignments = updates.map(([key], index) => `${key} = $${index + 1}`).join(', ');
    if (resource === 'payments') {
      const stateUpdate = updates.find(([key]) => key === 'estado');
      if (stateUpdate) {
        const stateParameter = updates.findIndex(([key]) => key === 'estado') + 1;
        assignments += `, pagado_en = CASE WHEN UPPER($${stateParameter}) = 'PAGADO' THEN COALESCE(pagado_en, CURRENT_TIMESTAMP) ELSE NULL END`;
      }
    }
    const maintenanceTimestamp = resource === 'maintenance' ? ', actualizado_en = CURRENT_TIMESTAMP' : '';
    const result = await pool.query(`UPDATE ${allowed.table} SET ${assignments}${maintenanceTimestamp} WHERE ${allowed.key} = $${values.length + 1} RETURNING *`, [...values, id]);
    if (!result.rowCount) return response.status(404).json({ error: 'Registro no encontrado.' });
    await audit(request.user.id_usuario, 'actualizar', allowed.table, id, Object.fromEntries(updates));
    const notificationPrefixes = {
      leads: 'lead',
      visits: 'visit',
      rentals: 'rental',
      payments: 'payment',
      maintenance: 'maintenance',
    };
    if (notificationPrefixes[resource]) {
      await pool.query(`
        UPDATE notificaciones
        SET leido_en = CURRENT_TIMESTAMP
        WHERE dedupe_key = $1 AND leido_en IS NULL
      `, [`${notificationPrefixes[resource]}:${id}`]);
    }
    return response.json({ data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
