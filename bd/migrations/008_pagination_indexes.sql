-- Indices para ordenar y paginar listados frecuentes del panel.
-- Omite cada indice si falta su tabla o alguna de sus columnas.
DO $$
DECLARE
  statement TEXT;
  statements TEXT[] := ARRAY[
    'CREATE INDEX IF NOT EXISTS idx_propiedades_listado ON propiedades (fecha_publicacion DESC NULLS LAST, id_propiedad DESC) WHERE eliminado = FALSE',
    'CREATE INDEX IF NOT EXISTS idx_direcciones_propiedad ON direcciones (id_propiedad)',
    'CREATE INDEX IF NOT EXISTS idx_leads_listado ON leads (creado_en DESC, id_lead DESC)',
    'CREATE INDEX IF NOT EXISTS idx_citas_listado ON citas (fecha_cita DESC, id_cita DESC)',
    'CREATE INDEX IF NOT EXISTS idx_ofertas_listado ON ofertas (creado_en DESC, id_oferta DESC)',
    'CREATE INDEX IF NOT EXISTS idx_expedientes_listado ON expedientes_legales (creado_en DESC, id_documento DESC)',
    'CREATE INDEX IF NOT EXISTS idx_ventas_listado ON ventas (fecha_venta DESC, id_venta DESC)',
    'CREATE INDEX IF NOT EXISTS idx_comisiones_listado ON comisiones (creado_en DESC, id_comision DESC)',
    'CREATE INDEX IF NOT EXISTS idx_rentas_listado ON rentas (fecha_inicio DESC, id_renta DESC)',
    'CREATE INDEX IF NOT EXISTS idx_pagos_renta_listado ON pagos_renta (periodo DESC, id_pago DESC)',
    'CREATE INDEX IF NOT EXISTS idx_pagos_renta_renta ON pagos_renta (id_renta)',
    'CREATE INDEX IF NOT EXISTS idx_contratos_listado ON contratos (fecha_contrato DESC, id_contrato DESC)',
    'CREATE INDEX IF NOT EXISTS idx_coincidencias_puntuacion ON coincidencias (puntuacion DESC, id_coincidencia DESC)',
    'CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios (rol, nombre, apellido_paterno, id_usuario)'
  ];
BEGIN
  FOREACH statement IN ARRAY statements LOOP
    BEGIN
      EXECUTE statement;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      RAISE NOTICE 'Indice omitido: %', statement;
    END;
  END LOOP;
END $$;
