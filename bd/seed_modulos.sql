-- Poblamiento complementario para que todas las vistas tengan registros reales:
-- 1. Citas / Visitas (pendientes, confirmadas, completadas)
-- 2. Expedientes legales (documentos validados y pendientes)
-- 3. Rentas activas
-- 4. Pagos de renta (pagados, pendientes, vencidos)
-- 5. Solicitudes de mantenimiento (abiertas, urgentes, en proceso, completadas)
-- 6. Comisiones financieras (pagadas y pendientes)

BEGIN;

-- 1. Citas de visita
INSERT INTO citas (id_cliente, id_propiedad, id_agente, fecha_cita, motivo, estado)
SELECT
  c.id_cliente,
  p.id_propiedad,
  a.id_usuario,
  CASE WHEN g % 3 = 0 THEN CURRENT_TIMESTAMP + (g || ' hours')::INTERVAL
       WHEN g % 3 = 1 THEN CURRENT_TIMESTAMP - (g || ' days')::INTERVAL
       ELSE CURRENT_TIMESTAMP + (g || ' days')::INTERVAL END,
  'Recorrido y evaluación de propiedad con cliente #' || g,
  CASE WHEN g % 3 = 0 THEN 'Confirmada'
       WHEN g % 3 = 1 THEN 'Completada'
       ELSE 'Pendiente' END
FROM generate_series(1, 15) AS g
JOIN LATERAL (
  SELECT id_cliente FROM clientes ORDER BY id_cliente OFFSET (g % 25) LIMIT 1
) c ON TRUE
JOIN LATERAL (
  SELECT id_propiedad FROM propiedades ORDER BY id_propiedad OFFSET (g * 8) LIMIT 1
) p ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE rol IN ('vendedor', 'agente', 'administrador') ORDER BY id_usuario OFFSET (g % 5) LIMIT 1
) a ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM citas ci WHERE ci.id_cliente = c.id_cliente AND ci.id_propiedad = p.id_propiedad
);

-- 2. Expedientes legales
INSERT INTO expedientes_legales
  (id_propiedad, tipo, nombre_archivo, url, hash_archivo, estado, subido_por, creado_en, mime_type, tamano_bytes)
SELECT
  p.id_propiedad,
  (ARRAY['Escritura', 'Identificación', 'Predial', 'Contrato', 'Libertad de gravamen'])[1 + (g % 5)],
  'documento_legal_prop_' || p.id_propiedad || '_' || g || '.pdf',
  'https://almacenamiento.local/expedientes/prop_' || p.id_propiedad || '_' || g || '.pdf',
  md5('expediente_' || p.id_propiedad || '_' || g),
  CASE WHEN g % 4 = 0 THEN 'PENDIENTE' ELSE 'VALIDADO' END,
  u.id_usuario,
  CURRENT_TIMESTAMP - (g || ' days')::INTERVAL,
  'application/pdf',
  (250000 + (g * 45000))
FROM generate_series(1, 20) AS g
JOIN LATERAL (
  SELECT id_propiedad FROM propiedades ORDER BY id_propiedad OFFSET (g * 7) LIMIT 1
) p ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE rol IN ('administrador', 'agente') ORDER BY id_usuario OFFSET (g % 3) LIMIT 1
) u ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM expedientes_legales el WHERE el.id_propiedad = p.id_propiedad AND el.nombre_archivo LIKE 'documento_legal_prop_' || p.id_propiedad || '_%'
);

-- 3. Contratos de Renta
INSERT INTO rentas (id_propiedad, id_cliente, id_agente, renta_mensual, fecha_inicio, fecha_fin, estado)
SELECT
  p.id_propiedad,
  c.id_cliente,
  a.id_usuario,
  (p.precio * 0.008)::NUMERIC(15, 2),
  CURRENT_DATE - (g * 15),
  CURRENT_DATE - (g * 15) + INTERVAL '12 months',
  'Activa'
FROM generate_series(1, 12) AS g
JOIN LATERAL (
  SELECT id_propiedad, precio FROM propiedades
  WHERE id_propiedad NOT IN (SELECT id_propiedad FROM rentas)
  ORDER BY id_propiedad OFFSET (g * 5) LIMIT 1
) p ON TRUE
JOIN LATERAL (
  SELECT id_cliente FROM clientes ORDER BY id_cliente OFFSET (g % 25) LIMIT 1
) c ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE rol IN ('vendedor', 'agente', 'administrador') ORDER BY id_usuario OFFSET (g % 5) LIMIT 1
) a ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM rentas r WHERE r.id_propiedad = p.id_propiedad
);

-- 4. Pagos de renta
INSERT INTO pagos_renta (id_renta, periodo, monto, estado, pagado_en)
SELECT
  r.id_renta,
  (CURRENT_DATE - ((g % 4) * INTERVAL '1 month'))::DATE,
  r.renta_mensual,
  CASE WHEN g % 3 = 0 THEN 'PAGADO'
       WHEN g % 3 = 1 THEN 'PENDIENTE'
       ELSE 'VENCIDO' END,
  CASE WHEN g % 3 = 0 THEN CURRENT_TIMESTAMP - (g || ' days')::INTERVAL ELSE NULL END
FROM generate_series(1, 24) AS g
JOIN LATERAL (
  SELECT id_renta, renta_mensual FROM rentas ORDER BY id_renta OFFSET (g % 12) LIMIT 1
) r ON TRUE;

-- 5. Solicitudes de mantenimiento
INSERT INTO solicitudes_mantenimiento
  (id_propiedad, id_renta, solicitado_por, asignado_a, titulo, descripcion, prioridad, estado, costo_estimado, costo_final, fecha_limite, creado_en, actualizado_en)
SELECT
  p.id_propiedad,
  r.id_renta,
  cli.id_usuario,
  adm.id_usuario,
  (ARRAY['Fuga de agua en baño principal', 'Revisión de instalación eléctrica', 'Pintura y resane de muros exteriores', 'Mantenimiento de impermeabilización', 'Ajuste de cancelería y cerraduras'])[1 + (g % 5)],
  'Detalle de la solicitud de mantenimiento preventivo y correctivo #' || g,
  (ARRAY['urgente', 'alta', 'normal', 'baja'])[1 + (g % 4)],
  (ARRAY['pendiente', 'en_proceso', 'completada'])[1 + (g % 3)],
  (1200 + (g * 350))::NUMERIC(10, 2),
  CASE WHEN (g % 3) = 2 THEN (1250 + (g * 340))::NUMERIC(10, 2) ELSE NULL END,
  CURRENT_DATE + ((g % 10) + 1),
  CURRENT_TIMESTAMP - (g || ' days')::INTERVAL,
  CURRENT_TIMESTAMP - (g || ' days')::INTERVAL
FROM generate_series(1, 15) AS g
JOIN LATERAL (
  SELECT id_propiedad FROM propiedades ORDER BY id_propiedad OFFSET (g * 9) LIMIT 1
) p ON TRUE
LEFT JOIN LATERAL (
  SELECT id_renta FROM rentas WHERE id_propiedad = p.id_propiedad LIMIT 1
) r ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE rol = 'cliente' ORDER BY id_usuario OFFSET (g % 20) LIMIT 1
) cli ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE rol IN ('administrador', 'agente') ORDER BY id_usuario OFFSET (g % 4) LIMIT 1
) adm ON TRUE;

-- 6. Comisiones
INSERT INTO comisiones
  (id_propiedad, id_agente_captador, id_agente_vendedor, porcentaje_agencia, monto_operacion, monto_total, estado, creado_en)
SELECT
  p.id_propiedad,
  cap.id_usuario,
  vend.id_usuario,
  5.00,
  p.precio,
  (p.precio * 0.05)::NUMERIC(15, 2),
  CASE WHEN g % 2 = 0 THEN 'PAGADA' ELSE 'PENDIENTE' END,
  CURRENT_TIMESTAMP - (g || ' days')::INTERVAL
FROM generate_series(1, 16) AS g
JOIN LATERAL (
  SELECT id_propiedad, precio FROM propiedades ORDER BY id_propiedad OFFSET (g * 11) LIMIT 1
) p ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE rol IN ('agente', 'administrador') ORDER BY id_usuario OFFSET (g % 4) LIMIT 1
) cap ON TRUE
JOIN LATERAL (
  SELECT id_usuario FROM usuarios WHERE rol IN ('vendedor', 'agente') ORDER BY id_usuario OFFSET ((g + 1) % 4) LIMIT 1
) vend ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM comisiones c WHERE c.id_propiedad = p.id_propiedad
);

COMMIT;
