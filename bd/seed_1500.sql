-- Datos de prueba para el esquema principal.
-- Ejecutar despues de crear las tablas:
--   psql -U postgres -d bienes_raices -f bd/seed_1500.sql
--
-- El script agrega 1500 filas nuevas por tabla. Las filas se identifican con
-- el prefijo demo1500 y pueden omitirse en ejecuciones posteriores.

BEGIN;

CREATE TEMP TABLE seed_ids (
  nombre_tabla TEXT NOT NULL,
  id BIGINT NOT NULL
) ON COMMIT DROP;

-- Crea cuentas de demostracion para asignar agentes a las propiedades.
INSERT INTO usuarios
  (nombre, apellido, correo, contrasena, telefono, rol, activo)
SELECT
  'Usuario' || lpad(g::TEXT, 4, '0'),
  'Demo1500',
  'demo1500.usuario' || lpad(g::TEXT, 4, '0') || '@example.test',
  '$2b$12$Sn1ygJ74hOAYsf2W3wy5s.OM5OsOYFGDa.HEL/bbTrOWEzVdreccy',
  '555' || lpad(g::TEXT, 7, '0'),
  'agente',
  TRUE
FROM generate_series(1, 1500) AS series(g)
ON CONFLICT (correo) DO NOTHING;

INSERT INTO seed_ids (nombre_tabla, id)
SELECT 'usuarios', id_usuario
FROM usuarios
WHERE correo LIKE 'demo1500.usuario%@example.test';

-- Asocia cada cuenta de agente con su perfil comercial.
INSERT INTO agentes (id_usuario, numero_licencia, fecha_ingreso)
SELECT
  id_usuario,
  'DEMO1500-' || lpad(row_number() OVER (ORDER BY id_usuario)::TEXT, 4, '0'),
  CURRENT_DATE - ((row_number() OVER (ORDER BY id_usuario)::INTEGER) % 1200)
FROM usuarios
WHERE correo LIKE 'demo1500.usuario%@example.test'
  AND rol = 'agente'
ON CONFLICT (id_usuario) DO NOTHING;

INSERT INTO seed_ids (nombre_tabla, id)
SELECT 'agentes', id_agente
FROM agentes
WHERE numero_licencia LIKE 'DEMO1500-%';

-- Genera los propietarios y sus domicilios de demostracion.
INSERT INTO propietarios
  (nombre, apellido, telefono, correo, direccion)
SELECT
  'Propietario' || lpad(g::TEXT, 4, '0'),
  'Demo1500',
  '556' || lpad(g::TEXT, 7, '0'),
  'demo1500.propietario' || lpad(g::TEXT, 4, '0') || '@example.test',
  'Domicilio de prueba ' || g
FROM generate_series(1, 1500) AS series(g)
ON CONFLICT DO NOTHING;

INSERT INTO seed_ids (nombre_tabla, id)
SELECT 'propietarios', id_propietario
FROM propietarios
WHERE correo LIKE 'demo1500.propietario%@example.test';

-- Crea ubicaciones de prueba distribuidas en varias ciudades.
INSERT INTO direcciones
  (calle, numero, colonia, ciudad, estado, codigo_postal, pais)
SELECT
  'Calle Demo ' || g,
  g::TEXT,
  'Colonia Demo1500',
  CASE WHEN g % 3 = 0 THEN 'Guadalajara'
       WHEN g % 3 = 1 THEN 'Ciudad de Mexico'
       ELSE 'Monterrey' END,
  CASE WHEN g % 3 = 0 THEN 'Jalisco'
       WHEN g % 3 = 1 THEN 'CDMX'
       ELSE 'Nuevo Leon' END,
  lpad((10000 + g)::TEXT, 5, '0'),
  'Mexico'
FROM generate_series(1, 1500) AS series(g)
WHERE NOT EXISTS (
  SELECT 1
  FROM direcciones d
  WHERE d.calle = 'Calle Demo ' || g
);

INSERT INTO seed_ids (nombre_tabla, id)
SELECT 'direcciones', id_direccion
FROM direcciones
WHERE calle LIKE 'Calle Demo %';

-- Genera el inventario de propiedades con distintos tipos y operaciones.
INSERT INTO propiedades
  (id_propietario, id_agente, id_direccion, tipo, titulo, descripcion,
   precio, operacion, superficie, habitaciones, banos, estacionamientos, estado)
SELECT
  p.id_propietario,
  a.id_agente,
  d.id_direccion,
  (ARRAY['CASA', 'DEPARTAMENTO', 'TERRENO', 'LOCAL', 'OFICINA', 'EDIFICIO'])
    [1 + ((g - 1) % 6)],
  'Propiedad Demo1500 ' || lpad(g::TEXT, 4, '0'),
  'Registro generado para pruebas del sistema.',
  (850000 + (g * 27500))::NUMERIC(15, 2),
  CASE WHEN g % 3 = 0 THEN 'RENTA' ELSE 'VENTA' END,
  (45 + (g % 250) * 2.5)::NUMERIC(10, 2),
  g % 5,
  1 + (g % 4),
  g % 3,
  'DISPONIBLE'
FROM generate_series(1, 1500) AS series(g)
JOIN LATERAL (
  SELECT id_propietario
  FROM propietarios
  WHERE correo LIKE 'demo1500.propietario%@example.test'
  ORDER BY id_propietario
  OFFSET ((g - 1) % 1500) LIMIT 1
) AS p ON TRUE
LEFT JOIN LATERAL (
  SELECT id_agente
  FROM agentes
  WHERE numero_licencia LIKE 'DEMO1500-%'
  ORDER BY id_agente
  OFFSET ((g - 1) % GREATEST((SELECT count(*) FROM agentes WHERE numero_licencia LIKE 'DEMO1500-%')::INTEGER, 1))
  LIMIT 1
) AS a ON TRUE
JOIN LATERAL (
  SELECT id_direccion
  FROM direcciones
  WHERE calle LIKE 'Calle Demo %'
  ORDER BY id_direccion
  OFFSET ((g - 1) % 1500) LIMIT 1
) AS d ON TRUE;

INSERT INTO seed_ids (nombre_tabla, id)
SELECT 'propiedades', id_propiedad
FROM propiedades
WHERE titulo LIKE 'Propiedad Demo1500 %';

-- Agrega compras vinculadas a las propiedades de demostracion.
INSERT INTO compras
  (id_propiedad, id_vendedor, id_agente, precio_compra, fecha_compra,
   estado, forma_pago, observaciones)
SELECT
  p.id_propiedad,
  o.id_propietario,
  a.id_agente,
  (700000 + (row_number() OVER (ORDER BY p.id_propiedad) * 19000))::NUMERIC(15, 2),
  CURRENT_DATE - ((row_number() OVER (ORDER BY p.id_propiedad)::INTEGER) % 900),
  CASE WHEN p.id_propiedad % 5 = 0 THEN 'COMPLETADA' ELSE 'PENDIENTE' END,
  CASE WHEN p.id_propiedad % 2 = 0 THEN 'TRANSFERENCIA' ELSE 'CONTADO' END,
  'Compra demo1500 para pruebas.'
FROM propiedades p
JOIN propietarios o ON o.correo LIKE 'demo1500.propietario%@example.test'
  AND o.id_propietario = (
    SELECT id_propietario FROM propietarios
    WHERE correo LIKE 'demo1500.propietario%@example.test'
    ORDER BY id_propietario
    OFFSET ((p.id_propiedad - 1) % 1500) LIMIT 1
  )
LEFT JOIN agentes a ON a.id_agente = (
  SELECT id_agente FROM agentes
  WHERE numero_licencia LIKE 'DEMO1500-%'
  ORDER BY id_agente
  LIMIT 1
)
WHERE p.titulo LIKE 'Propiedad Demo1500 %'
  AND NOT EXISTS (
    SELECT 1 FROM compras c WHERE c.id_propiedad = p.id_propiedad
  );

-- Registra operaciones completadas para validar consultas y reportes.
INSERT INTO operaciones
  (id_propiedad, id_comprador, id_agente, tipo_operacion, precio_acordado,
   estado, fecha_inicio, fecha_cierre, observaciones)
SELECT
  p.id_propiedad,
  u.id_usuario,
  a.id_agente,
  p.operacion,
  p.precio,
  'COMPLETADA',
  CURRENT_TIMESTAMP - (g || ' days')::INTERVAL,
  CURRENT_TIMESTAMP - ((g - 1) || ' days')::INTERVAL,
  'Operacion demo1500 para pruebas.'
FROM (
  SELECT p.*, row_number() OVER (ORDER BY p.id_propiedad)::INTEGER AS g
  FROM propiedades p
  WHERE p.titulo LIKE 'Propiedad Demo1500 %'
) AS p
JOIN LATERAL (
  SELECT id_usuario
  FROM usuarios
  WHERE correo LIKE 'demo1500.usuario%@example.test'
  ORDER BY id_usuario
  OFFSET ((p.g - 1) % 1500) LIMIT 1
) AS u ON TRUE
LEFT JOIN LATERAL (
  SELECT id_agente
  FROM agentes
  WHERE numero_licencia LIKE 'DEMO1500-%'
  ORDER BY id_agente
  LIMIT 1
) AS a ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM operaciones o WHERE o.id_propiedad = p.id_propiedad
);

COMMIT;

-- Validacion: las tablas principales deben mostrar 1500 registros demo.
SELECT 'usuarios' AS tabla, count(*) AS registros
FROM usuarios WHERE correo LIKE 'demo1500.usuario%@example.test'
UNION ALL
SELECT 'agentes', count(*) FROM agentes WHERE numero_licencia LIKE 'DEMO1500-%'
UNION ALL
SELECT 'propietarios', count(*) FROM propietarios WHERE correo LIKE 'demo1500.propietario%@example.test'
UNION ALL
SELECT 'direcciones', count(*) FROM direcciones WHERE calle LIKE 'Calle Demo %'
UNION ALL
SELECT 'propiedades', count(*) FROM propiedades WHERE titulo LIKE 'Propiedad Demo1500 %'
UNION ALL
SELECT 'compras', count(*) FROM compras WHERE observaciones = 'Compra demo1500 para pruebas.'
UNION ALL
SELECT 'operaciones', count(*) FROM operaciones WHERE observaciones = 'Operacion demo1500 para pruebas.'
ORDER BY tabla;
