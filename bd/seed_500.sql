-- Datos de prueba para el esquema principal: 500 registros por tabla.
-- Compatible con la estructura activa de PostgreSQL en el proyecto.

BEGIN;

-- 1. Crea 500 cuentas de usuario
INSERT INTO usuarios
  (nombre, apellido_paterno, apellido_materno, correo, password, telefono, rol, activo)
SELECT
  'Usuario' || lpad(g::TEXT, 4, '0'),
  'Paterno500',
  'Materno500',
  'demo500.usuario' || lpad(g::TEXT, 4, '0') || '@example.test',
  '$2b$12$Sn1ygJ74hOAYsf2W3wy5s.OM5OsOYFGDa.HEL/bbTrOWEzVdreccy',
  '555' || lpad(g::TEXT, 7, '0'),
  'agente',
  TRUE
FROM generate_series(1, 500) AS series(g)
ON CONFLICT (correo) DO NOTHING;

-- 2. Asocia cada usuario con un perfil de agente (500)
INSERT INTO agentes (id_usuario, numero_licencia, fecha_ingreso)
SELECT
  id_usuario,
  'DEMO500-' || lpad(row_number() OVER (ORDER BY id_usuario)::TEXT, 4, '0'),
  CURRENT_DATE - ((row_number() OVER (ORDER BY id_usuario)::INTEGER) % 1200)
FROM usuarios
WHERE correo LIKE 'demo500.usuario%@example.test'
  AND rol = 'agente'
ON CONFLICT (id_usuario) DO NOTHING;

-- 3. Crea 500 propietarios
INSERT INTO propietarios
  (nombre, apellido, telefono, correo, direccion)
SELECT
  'Propietario' || lpad(g::TEXT, 4, '0'),
  'Demo500',
  '556' || lpad(g::TEXT, 7, '0'),
  'demo500.propietario' || lpad(g::TEXT, 4, '0') || '@example.test',
  'Domicilio de prueba ' || g
FROM generate_series(1, 500) AS series(g)
ON CONFLICT DO NOTHING;

-- 4. Genera el inventario de 500 propiedades
INSERT INTO propiedades
  (id_categoria, id_usuario, titulo, descripcion, precio, superficie,
   habitaciones, banos, estacionamientos, tipo_operacion, estado_propiedad,
   latitud, longitud, amenidades, exclusiva, eliminado)
SELECT
  cat.id_categoria,
  u.id_usuario,
  'Propiedad Demo500 ' || lpad(g::TEXT, 4, '0'),
  'Registro generado para pruebas del sistema con lote de 500.',
  (850000 + (g * 27500))::NUMERIC(15, 2),
  (45 + (g % 250) * 2.5)::NUMERIC(10, 2),
  g % 5,
  1 + (g % 4),
  g % 3,
  CASE WHEN g % 3 = 0 THEN 'RENTA' ELSE 'VENTA' END,
  'Disponible',
  (19.4326 + ((g % 100) * 0.001))::NUMERIC(10, 7),
  (-99.1332 + ((g % 100) * 0.001))::NUMERIC(10, 7),
  '["Estacionamiento", "Seguridad"]'::jsonb,
  FALSE,
  FALSE
FROM generate_series(1, 500) AS series(g)
JOIN LATERAL (
  SELECT id_categoria
  FROM categorias
  ORDER BY id_categoria
  LIMIT 1
) AS cat ON TRUE
JOIN LATERAL (
  SELECT id_usuario
  FROM usuarios
  WHERE correo LIKE 'demo500.usuario%@example.test'
  ORDER BY id_usuario
  OFFSET ((g - 1) % 500) LIMIT 1
) AS u ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM propiedades p WHERE p.titulo = 'Propiedad Demo500 ' || lpad(g::TEXT, 4, '0')
);

-- 5. Crea 500 direcciones (una por cada propiedad creada)
INSERT INTO direcciones
  (id_propiedad, calle, numero, colonia, ciudad, estado, codigo_postal)
SELECT
  p.id_propiedad,
  'Calle Demo 500 ' || p.g,
  p.g::TEXT,
  'Colonia Demo500',
  CASE WHEN p.g % 3 = 0 THEN 'Guadalajara'
       WHEN p.g % 3 = 1 THEN 'Ciudad de Mexico'
       ELSE 'Monterrey' END,
  CASE WHEN p.g % 3 = 0 THEN 'Jalisco'
       WHEN p.g % 3 = 1 THEN 'CDMX'
       ELSE 'Nuevo Leon' END,
  lpad((10000 + p.g)::TEXT, 5, '0')
FROM (
  SELECT p.id_propiedad, row_number() OVER (ORDER BY p.id_propiedad)::INTEGER AS g
  FROM propiedades p
  WHERE p.titulo LIKE 'Propiedad Demo500 %'
) AS p
WHERE NOT EXISTS (
  SELECT 1 FROM direcciones d WHERE d.id_propiedad = p.id_propiedad
);

-- 6. Registra 500 compras vinculadas a las propiedades de demostración
INSERT INTO compras
  (id_propiedad, id_vendedor, id_agente, precio_compra, fecha_compra,
   estado, forma_pago, observaciones)
SELECT
  p.id_propiedad,
  o.id_propietario,
  a.id_agente,
  (700000 + (p.g * 19000))::NUMERIC(15, 2),
  CURRENT_DATE - (p.g % 900),
  CASE WHEN p.id_propiedad % 5 = 0 THEN 'COMPLETADA' ELSE 'PENDIENTE' END,
  CASE WHEN p.id_propiedad % 2 = 0 THEN 'TRANSFERENCIA' ELSE 'CONTADO' END,
  'Compra demo500 para pruebas.'
FROM (
  SELECT p.id_propiedad, row_number() OVER (ORDER BY p.id_propiedad)::INTEGER AS g
  FROM propiedades p
  WHERE p.titulo LIKE 'Propiedad Demo500 %'
) AS p
JOIN LATERAL (
  SELECT id_propietario
  FROM propietarios
  WHERE correo LIKE 'demo500.propietario%@example.test'
  ORDER BY id_propietario
  OFFSET ((p.g - 1) % 500) LIMIT 1
) AS o ON TRUE
LEFT JOIN LATERAL (
  SELECT id_agente
  FROM agentes
  WHERE numero_licencia LIKE 'DEMO500-%'
  ORDER BY id_agente
  OFFSET ((p.g - 1) % GREATEST((SELECT count(*) FROM agentes WHERE numero_licencia LIKE 'DEMO500-%')::INTEGER, 1))
  LIMIT 1
) AS a ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM compras c WHERE c.id_propiedad = p.id_propiedad
);

-- 7. Registra 500 operaciones completadas para consultas y reportes
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
  'Operacion demo500 para pruebas.'
FROM (
  SELECT p.id_propiedad, p.tipo_operacion, p.precio, row_number() OVER (ORDER BY p.id_propiedad)::INTEGER AS g
  FROM propiedades p
  WHERE p.titulo LIKE 'Propiedad Demo500 %'
) AS p
JOIN LATERAL (
  SELECT id_usuario
  FROM usuarios
  WHERE correo LIKE 'demo500.usuario%@example.test'
  ORDER BY id_usuario
  OFFSET ((p.g - 1) % 500) LIMIT 1
) AS u ON TRUE
LEFT JOIN LATERAL (
  SELECT id_agente
  FROM agentes
  WHERE numero_licencia LIKE 'DEMO500-%'
  ORDER BY id_agente
  OFFSET ((p.g - 1) % GREATEST((SELECT count(*) FROM agentes WHERE numero_licencia LIKE 'DEMO500-%')::INTEGER, 1))
  LIMIT 1
) AS a ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM operaciones o WHERE o.id_propiedad = p.id_propiedad
);

COMMIT;
