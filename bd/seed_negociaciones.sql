-- Poblado de datos para la sección "Negociaciones y ventas":
-- 1. Clientes comerciales (usuarios + clientes)
-- 2. Ofertas de negociación (OFERTA y CONTRAPROPUESTA)
-- 3. Ventas cerradas con clientes y agentes
-- 4. Contratos completos (VENTA y RENTA) con medidas, datos de partes y ubicaciones

BEGIN;

-- 1. Insertar 25 clientes (cuentas de usuario con rol cliente)
INSERT INTO usuarios (nombre, apellido_paterno, apellido_materno, correo, password, telefono, rol, activo)
SELECT
  'Cliente' || lpad(g::TEXT, 2, '0'),
  'PaternoCl' || g,
  'MaternoCl' || g,
  'cliente.negociacion' || lpad(g::TEXT, 2, '0') || '@demo.local',
  '$2b$12$Sn1ygJ74hOAYsf2W3wy5s.OM5OsOYFGDa.HEL/bbTrOWEzVdreccy',
  '555' || lpad((2000 + g)::TEXT, 7, '0'),
  'cliente',
  TRUE
FROM generate_series(1, 25) AS g
ON CONFLICT (correo) DO UPDATE SET activo = TRUE;

-- 2. Vincular perfil de cliente con CURP y domicilio
INSERT INTO clientes (id_usuario, curp, direccion, ciudad, estado, codigo_postal)
SELECT
  u.id_usuario,
  'CURP' || lpad(u.id_usuario::TEXT, 14, '0'),
  'Av. Residencial #' || u.id_usuario,
  CASE WHEN u.id_usuario % 3 = 0 THEN 'Ciudad de Mexico' WHEN u.id_usuario % 3 = 1 THEN 'Guadalajara' ELSE 'Monterrey' END,
  CASE WHEN u.id_usuario % 3 = 0 THEN 'CDMX' WHEN u.id_usuario % 3 = 1 THEN 'Jalisco' ELSE 'Nuevo Leon' END,
  '0' || (60000 + (u.id_usuario % 1000))
FROM usuarios u
WHERE u.correo LIKE 'cliente.negociacion%@demo.local'
ON CONFLICT (id_usuario) DO NOTHING;

-- 3. Insertar 30 ofertas y contrapropuestas en negociación
INSERT INTO ofertas (id_propiedad, id_usuario, monto, tipo, estado, notas, creado_en)
SELECT
  p.id_propiedad,
  u.id_usuario,
  (p.precio * (0.88 + ((g % 10) * 0.02)))::NUMERIC(15, 2),
  CASE WHEN g % 2 = 0 THEN 'OFERTA' ELSE 'CONTRAPROPUESTA' END,
  CASE WHEN g % 4 = 0 THEN 'ACEPTADA'
       WHEN g % 4 = 1 THEN 'PENDIENTE'
       WHEN g % 4 = 2 THEN 'PENDIENTE'
       ELSE 'RECHAZADA' END,
  'Negociación de prueba #' || g || ' con propuesta económica y condiciones comerciales.',
  CURRENT_TIMESTAMP - (g || ' days')::INTERVAL
FROM generate_series(1, 30) AS g
JOIN LATERAL (
  SELECT id_propiedad, precio FROM propiedades ORDER BY id_propiedad OFFSET (g * 5) LIMIT 1
) p ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE correo LIKE 'cliente.negociacion%@demo.local' ORDER BY id_usuario OFFSET (g % 25) LIMIT 1
) u ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM ofertas o WHERE o.id_propiedad = p.id_propiedad AND o.id_usuario = u.id_usuario
);

-- 4. Insertar 20 ventas cerradas
INSERT INTO ventas (id_propiedad, id_cliente, id_agente, precio_venta, fecha_venta)
SELECT
  p.id_propiedad,
  c.id_cliente,
  a.id_usuario,
  (p.precio * 0.95)::NUMERIC(15, 2),
  CURRENT_TIMESTAMP - (g || ' days')::INTERVAL
FROM generate_series(1, 20) AS g
JOIN LATERAL (
  SELECT id_propiedad, precio FROM propiedades
  WHERE id_propiedad NOT IN (SELECT id_propiedad FROM ventas)
  ORDER BY id_propiedad
  OFFSET (g * 4) LIMIT 1
) p ON TRUE
JOIN LATERAL (
  SELECT id_cliente FROM clientes ORDER BY id_cliente OFFSET (g % 25) LIMIT 1
) c ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE rol IN ('vendedor', 'agente', 'administrador') ORDER BY id_usuario OFFSET (g % 5) LIMIT 1
) a ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM ventas v WHERE v.id_propiedad = p.id_propiedad
);

-- 5. Insertar 25 contratos (VENTA y RENTA) completos con dimensiones y coordenadas
INSERT INTO contratos (
  tipo_operacion, id_cliente, id_propiedad, id_vendedor, fecha_contrato,
  precio_total, renta_mensual, fecha_inicio, fecha_fin, frente_metros,
  fondo_metros, superficie_m2, latitud, longitud, nombre_cliente,
  correo_cliente, telefono_cliente, curp_cliente, nombre_vendedor,
  correo_vendedor, titulo_propiedad, calle, numero, colonia, ciudad,
  estado, codigo_postal, observaciones, creado_en
)
SELECT
  CASE WHEN g % 2 = 0 THEN 'VENTA' ELSE 'RENTA' END AS tipo_operacion,
  c.id_cliente,
  p.id_propiedad,
  v.id_usuario,
  CURRENT_DATE - (g * 2),
  CASE WHEN g % 2 = 0 THEN p.precio ELSE (p.precio * 12) END,
  CASE WHEN g % 2 = 0 THEN NULL ELSE (p.precio * 0.008)::NUMERIC(15, 2) END,
  CASE WHEN g % 2 = 0 THEN NULL ELSE CURRENT_DATE - (g * 2) END,
  CASE WHEN g % 2 = 0 THEN NULL ELSE (CURRENT_DATE - (g * 2)) + INTERVAL '12 months' END,
  (10 + (g % 8))::NUMERIC(10, 2),
  (20 + (g % 10))::NUMERIC(10, 2),
  COALESCE(p.superficie, ((10 + (g % 8)) * (20 + (g % 10)))::NUMERIC(12, 2)),
  COALESCE(p.latitud, (19.4326 + (g * 0.002))::NUMERIC(10, 7)),
  COALESCE(p.longitud, (-99.1332 + (g * 0.002))::NUMERIC(10, 7)),
  u_cli.nombre || ' ' || u_cli.apellido_paterno,
  u_cli.correo,
  u_cli.telefono,
  c.curp,
  v.nombre || ' ' || v.apellido_paterno,
  v.correo,
  p.titulo,
  d.calle,
  d.numero,
  d.colonia,
  d.ciudad,
  d.estado,
  d.codigo_postal,
  'Contrato de ' || (CASE WHEN g % 2 = 0 THEN 'VENTA' ELSE 'RENTA' END) || ' debidamente protocolizado y registrado.',
  CURRENT_TIMESTAMP - (g || ' days')::INTERVAL
FROM generate_series(1, 25) AS g
JOIN LATERAL (
  SELECT cl.id_cliente, cl.curp, cl.id_usuario FROM clientes cl ORDER BY cl.id_cliente OFFSET (g % 25) LIMIT 1
) c ON TRUE
JOIN usuarios u_cli ON u_cli.id_usuario = c.id_usuario
JOIN LATERAL (
  SELECT id_usuario, nombre, apellido_paterno, correo FROM usuarios WHERE rol IN ('vendedor', 'agente', 'administrador') ORDER BY id_usuario OFFSET (g % 5) LIMIT 1
) v ON TRUE
JOIN LATERAL (
  SELECT prop.id_propiedad, prop.titulo, prop.precio, prop.superficie, prop.latitud, prop.longitud
  FROM propiedades prop
  ORDER BY prop.id_propiedad
  OFFSET (g * 6) LIMIT 1
) p ON TRUE
JOIN LATERAL (
  SELECT dir.calle, dir.numero, dir.colonia, dir.ciudad, dir.estado, dir.codigo_postal
  FROM direcciones dir
  WHERE dir.id_propiedad = p.id_propiedad
  LIMIT 1
) d ON TRUE;

COMMIT;
