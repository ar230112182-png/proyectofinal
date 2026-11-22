CREATE OR REPLACE FUNCTION public.registrar_auditoria()
RETURNS TRIGGER AS $$
DECLARE
  usuario_actual INTEGER;
  fila_anterior JSONB;
  fila_nueva JSONB;
  fila_actual JSONB;
  entidad_id_value TEXT;
  auditoria_tiene_detalle BOOLEAN;
BEGIN
  usuario_actual := NULLIF(current_setting('app.user_id', true), '')::INTEGER;
  fila_anterior := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  fila_nueva := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  fila_actual := COALESCE(fila_nueva, fila_anterior);
  entidad_id_value := COALESCE(
    fila_actual ->> 'id_usuario',
    fila_actual ->> 'id_cliente',
    fila_actual ->> 'id_propiedad',
    fila_actual ->> 'id_contrato',
    fila_actual ->> 'id_venta',
    fila_actual ->> 'id_renta',
    fila_actual ->> 'id_lead',
    fila_actual ->> 'id_cita',
    fila_actual ->> 'id_oferta',
    fila_actual ->> 'id_documento',
    fila_actual ->> 'id_comision',
    fila_actual ->> 'id_pago'
  );

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auditoria'
      AND column_name = 'detalle'
  ) INTO auditoria_tiene_detalle;

  IF auditoria_tiene_detalle THEN
    EXECUTE 'INSERT INTO public.auditoria (id_usuario, accion, entidad, entidad_id, detalle)
      VALUES ($1, $2, $3, $4, $5)'
      USING usuario_actual, TG_OP, TG_TABLE_NAME, entidad_id_value,
        jsonb_build_object('anterior', fila_anterior, 'nuevo', fila_nueva);
  ELSE
    EXECUTE 'INSERT INTO public.auditoria
      (id_usuario, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
      VALUES ($1, $2, $3, $4, $5, $6)'
      USING usuario_actual, TG_OP, TG_TABLE_NAME, entidad_id_value, fila_anterior, fila_nueva;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
