-- Generación de prospectos (leads), preferencias y coincidencias guardadas para el Motor de Coincidencias.
BEGIN;

-- 1. Insertar clientes potenciales (leads) con datos ficticios
INSERT INTO leads (nombre, correo, telefono, origen, estado, consentimiento_datos)
VALUES
  ('Lead Demo 01', 'demo.lead01@example.test', '0000000001', 'portal', 'NUEVO', TRUE),
  ('Lead Demo 02', 'demo.lead02@example.test', '0000000002', 'portal', 'CONTACTADO', TRUE),
  ('Lead Demo 03', 'demo.lead03@example.test', '0000000003', 'redes', 'NUEVO', TRUE),
  ('Lead Demo 04', 'demo.lead04@example.test', '0000000004', 'portal', 'CALIFICADO', TRUE),
  ('Lead Demo 05', 'demo.lead05@example.test', '0000000005', 'referido', 'NUEVO', TRUE),
  ('Lead Demo 06', 'demo.lead06@example.test', '0000000006', 'portal', 'CONTACTADO', TRUE),
  ('Lead Demo 07', 'demo.lead07@example.test', '0000000007', 'portal', 'NUEVO', TRUE),
  ('Lead Demo 08', 'demo.lead08@example.test', '0000000008', 'llamada', 'CALIFICADO', TRUE),
  ('Lead Demo 09', 'demo.lead09@example.test', '0000000009', 'portal', 'NUEVO', TRUE),
  ('Lead Demo 10', 'demo.lead10@example.test', '0000000010', 'portal', 'CONTACTADO', TRUE),
  ('Lead Demo 11', 'demo.lead11@example.test', '0000000011', 'redes', 'NUEVO', TRUE),
  ('Lead Demo 12', 'demo.lead12@example.test', '0000000012', 'portal', 'CALIFICADO', TRUE),
  ('Lead Demo 13', 'demo.lead13@example.test', '0000000013', 'portal', 'NUEVO', TRUE),
  ('Lead Demo 14', 'demo.lead14@example.test', '0000000014', 'referido', 'CONTACTADO', TRUE),
  ('Lead Demo 15', 'demo.lead15@example.test', '0000000015', 'portal', 'NUEVO', TRUE)
ON CONFLICT DO NOTHING;

-- 2. Asignar preferencias inmobiliarias a cada lead
INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Ciudad de Mexico', 850000, 2000000, 2, 'rural', 'VENTA', '["Estacionamiento", "Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead01@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Guadalajara', 800000, 1800000, 1, 'rural', 'RENTA', '["Estacionamiento"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead02@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Monterrey', 900000, 2200000, 2, 'rural', 'VENTA', '["Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead03@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Ciudad de Mexico', 900000, 1900000, 2, 'rural', 'RENTA', '["Estacionamiento", "Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead04@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Guadalajara', 850000, 1750000, 2, 'rural', 'VENTA', '["Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead05@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Monterrey', 850000, 1600000, 1, 'rural', 'RENTA', '["Estacionamiento"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead06@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Ciudad de Mexico', 950000, 2500000, 3, 'rural', 'VENTA', '["Estacionamiento", "Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead07@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Guadalajara', 880000, 1500000, 1, 'rural', 'RENTA', '["Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead08@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Monterrey', 950000, 2400000, 2, 'rural', 'VENTA', '["Estacionamiento"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead09@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Ciudad de Mexico', 850000, 1700000, 1, 'rural', 'RENTA', '["Estacionamiento", "Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead10@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Guadalajara', 920000, 2100000, 2, 'rural', 'VENTA', '["Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead11@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Monterrey', 870000, 1800000, 2, 'rural', 'RENTA', '["Estacionamiento"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead12@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Ciudad de Mexico', 1000000, 2800000, 2, 'rural', 'VENTA', '["Estacionamiento", "Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead13@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Guadalajara', 860000, 1650000, 1, 'rural', 'RENTA', '["Seguridad"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead14@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

INSERT INTO preferencias_lead (id_lead, ciudad, precio_min, precio_max, habitaciones_min, tipo, operacion, amenidades)
SELECT l.id_lead, 'Monterrey', 900000, 2300000, 2, 'rural', 'VENTA', '["Estacionamiento"]'::jsonb
FROM leads l WHERE l.correo = 'demo.lead15@example.test'
  AND NOT EXISTS (SELECT 1 FROM preferencias_lead pl WHERE pl.id_lead = l.id_lead);

-- 3. Calcular e insertar coincidencias guardadas evaluadas
INSERT INTO coincidencias (id_lead, id_propiedad, puntuacion, creada_en)
SELECT
  l.id_lead,
  p.id_propiedad,
  LEAST(100, (CASE WHEN pref.ciudad IS NULL OR LOWER(pref.ciudad) = LOWER(d.ciudad) THEN 35 ELSE 0 END)
    + (CASE WHEN pref.precio_min IS NULL OR p.precio >= pref.precio_min THEN 18 ELSE 0 END)
    + (CASE WHEN pref.precio_max IS NULL OR p.precio <= pref.precio_max THEN 18 ELSE 0 END)
    + (CASE WHEN pref.habitaciones_min IS NULL OR p.habitaciones >= pref.habitaciones_min THEN 14 ELSE 0 END)
    + (CASE WHEN pref.tipo IS NULL OR LOWER(pref.tipo) = LOWER(cat.nombre) THEN 8 ELSE 0 END)
    + (CASE WHEN pref.operacion IS NULL OR LOWER(pref.operacion) = LOWER(p.tipo_operacion) THEN 7 ELSE 0 END)) AS score,
  CURRENT_TIMESTAMP - ((row_number() OVER (ORDER BY l.id_lead, p.id_propiedad)) % 10 || ' hours')::INTERVAL
FROM leads l
JOIN LATERAL (
  SELECT * FROM preferencias_lead WHERE id_lead = l.id_lead ORDER BY id_preferencia DESC LIMIT 1
) pref ON TRUE
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
ON CONFLICT (id_lead, id_propiedad) DO UPDATE
SET puntuacion = EXCLUDED.puntuacion, creada_en = EXCLUDED.creada_en;

COMMIT;
