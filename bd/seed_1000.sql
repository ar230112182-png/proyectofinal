-- Datos de prueba para el esquema principal: 1000 registros nuevos por tabla.
-- Compatible con la estructura activa de PostgreSQL en el proyecto.

BEGIN;

-- 1. Crea 1000 cuentas de usuario
INSERT INTO usuarios
  (nombre, apellido_paterno, apellido_materno, correo, password, telefono, rol, activo)
SELECT
  'Usuario' || lpad(g::TEXT, 4, '0'),
  'Paterno1000',
  'Materno1000',
  'demo1000.usuario' || lpad(g::TEXT, 4, '0') || '@example.test',
  '$2b$12$Sn1ygJ74hOAYsf2W3wy5s.OM5OsOYFGDa.HEL/bbTrOWEzVdreccy',
  '555' || lpad((1000 + g)::TEXT, 7, '0'),
  'agente',
  TRUE
FROM generate_series(1, 1000) AS series(g)
ON CONFLICT (correo) DO NOTHING;

-- 2. Asocia cada nuevo usuario con un perfil de agente (1000)
INSERT INTO agentes (id_usuario, numero_licencia, fecha_ingreso)
SELECT
  id_usuario,
  'DEMO1000-' || lpad(row_number() OVER (ORDER BY id_usuario)::TEXT, 4, '0'),
  CURRENT_DATE - ((row_number() OVER (ORDER BY id_usuario)::INTEGER) % 1200)
FROM usuarios
WHERE correo LIKE 'demo1000.usuario%@example.test'
  AND rol = 'agente'
ON CONFLICT (id_usuario) DO NOTHING;

-- 3. Crea 1000 propietarios
INSERT INTO propietarios
  (nombre, apellido, telefono, correo, direccion)
SELECT
  'Propietario' || lpad(g::TEXT, 4, '0'),
  'Demo1000',
  '556' || lpad((1000 + g)::TEXT, 7, '0'),
  'demo1000.propietario' || lpad(g::TEXT, 4, '0') || '@example.test',
  'Domicilio de prueba 1000-' || g
FROM generate_series(1, 1000) AS series(g)
WHERE NOT EXISTS (
  SELECT 1 FROM propietarios WHERE correo = 'demo1000.propietario' || lpad(g::TEXT, 4, '0') || '@example.test'
);

-- 4. Genera el inventario de 1000 propiedades
INSERT INTO propiedades
  (id_categoria, id_usuario, titulo, descripcion, precio, superficie,
   habitaciones, banos, estacionamientos, tipo_operacion, estado_propiedad,
   latitud, longitud, amenidades, exclusiva, eliminado)
SELECT
  cat.id_categoria,
  u.id_usuario,
  'Propiedad Demo1000 ' || lpad(g::TEXT, 4, '0'),
  'Registro generado para pruebas del sistema con lote de 1000.',
  (900000 + (g * 25000))::NUMERIC(15, 2),
  (50 + (g % 250) * 2.5)::NUMERIC(10, 2),
  g % 5,
  1 + (g % 4),
  g % 3,
  CASE WHEN g % 3 = 0 THEN 'RENTA' ELSE 'VENTA' END,
  'Disponible',
  (19.4326 + ((g % 100) * 0.001))::NUMERIC(10, 7),
  (-99.1332 + ((g % 100) * 0.001))::NUMERIC(10, 7),
  '["Estacionamiento", "Seguridad", "Alberca"]'::jsonb,
  FALSE,
  FALSE
FROM generate_series(1, 1000) AS series(g)
JOIN LATERAL (
  SELECT id_categoria
  FROM categorias
  ORDER BY id_categoria
  LIMIT 1
) AS cat ON TRUE
JOIN LATERAL (
  SELECT id_usuario
  FROM usuarios
  WHERE correo LIKE 'demo1000.usuario%@example.test'
  ORDER BY id_usuario
  OFFSET ((g - 1) % 1000) LIMIT 1
) AS u ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM propiedades p WHERE p.titulo = 'Propiedad Demo1000 ' || lpad(g::TEXT, 4, '0')
);

-- 5. Crea 1000 direcciones (una por cada propiedad nueva)
INSERT INTO direcciones
  (id_propiedad, calle, numero, colonia, ciudad, estado, codigo_postal)
SELECT
  p.id_propiedad,
  'Calle Demo 1000 ' || p.g,
  p.g::TEXT,
  'Colonia Demo1000',
  CASE WHEN p.g % 3 = 0 THEN 'Guadalajara'
       WHEN p.g % 3 = 1 THEN 'Ciudad de Mexico'
       ELSE 'Monterrey' END,
  CASE WHEN p.g % 3 = 0 THEN 'Jalisco'
       WHEN p.g % 3 = 1 THEN 'CDMX'
       ELSE 'Nuevo Leon' END,
  lpad((20000 + p.g)::TEXT, 5, '0')
FROM (
  SELECT p.id_propiedad, row_number() OVER (ORDER BY p.id_propiedad)::INTEGER AS g
  FROM propiedades p
  WHERE p.titulo LIKE 'Propiedad Demo1000 %'
) AS p
WHERE NOT EXISTS (
  SELECT 1 FROM direcciones d WHERE d.id_propiedad = p.id_propiedad
);

-- 6. Registra 1000 compras vinculadas a las propiedades nuevas
INSERT INTO compras
  (id_propiedad, id_vendedor, id_agente, precio_compra, fecha_compra,
   estado, forma_pago, observaciones)
SELECT
  p.id_propiedad,
  o.id_propietario,
  a.id_agente,
  (750000 + (p.g * 18000))::NUMERIC(15, 2),
  CURRENT_DATE - (p.g % 900),
  CASE WHEN p.id_propiedad % 5 = 0 THEN 'COMPLETADA' ELSE 'PENDIENTE' END,
  CASE WHEN p.id_propiedad % 2 = 0 THEN 'TRANSFERENCIA' ELSE 'CONTADO' END,
  'Compra demo1000 para pruebas.'
FROM (
  SELECT p.id_propiedad, row_number() OVER (ORDER BY p.id_propiedad)::INTEGER AS g
  FROM propiedades p
  WHERE p.titulo LIKE 'Propiedad Demo1000 %'
) AS p
JOIN LATERAL (
  SELECT id_propietario
  FROM propietarios
  WHERE correo LIKE 'demo1000.propietario%@example.test'
  ORDER BY id_propietario
  OFFSET ((p.g - 1) % 1000) LIMIT 1
) AS o ON TRUE
LEFT JOIN LATERAL (
  SELECT id_agente
  FROM agentes
  WHERE numero_licencia LIKE 'DEMO1000-%'
  ORDER BY id_agente
  OFFSET ((p.g - 1) % GREATEST((SELECT count(*) FROM agentes WHERE numero_licencia LIKE 'DEMO1000-%')::INTEGER, 1))
  LIMIT 1
) AS a ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM compras c WHERE c.id_propiedad = p.id_propiedad
);

-- 7. Registra 1000 operaciones completadas para consultas y reportes
INSERT INTO operaciones
  (id_propiedad, id_comprador, id_agente, tipo_operacion, precio_acordado,
   estado, fecha_inicio, fecha_cierre, observaciones)
SELECT
  p.id_propiedad,
  u.id_usuario,
  a.id_agente,
  p.tipo_operacion,
  p.precio,
  'COMPLETADA',
  CURRENT_TIMESTAMP - (p.g || ' days')::INTERVAL,
  CURRENT_TIMESTAMP - ((p.g - 1) || ' days')::INTERVAL,
  'Operacion demo1000 para pruebas.'
FROM (
  SELECT p.id_propiedad, p.tipo_operacion, p.precio, row_number() OVER (ORDER BY p.id_propiedad)::INTEGER AS g
  FROM propiedades p
  WHERE p.titulo LIKE 'Propiedad Demo1000 %'
) AS p
JOIN LATERAL (
  SELECT id_usuario
  FROM usuarios
  WHERE correo LIKE 'demo1000.usuario%@example.test'
  ORDER BY id_usuario
  OFFSET ((p.g - 1) % 1000) LIMIT 1
) AS u ON TRUE
LEFT JOIN LATERAL (
  SELECT id_agente
  FROM agentes
  WHERE numero_licencia LIKE 'DEMO1000-%'
  ORDER BY id_agente
  OFFSET ((p.g - 1) % GREATEST((SELECT count(*) FROM agentes WHERE numero_licencia LIKE 'DEMO1000-%')::INTEGER, 1))
  LIMIT 1
) AS a ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM operaciones o WHERE o.id_propiedad = p.id_propiedad
);

COMMIT;
