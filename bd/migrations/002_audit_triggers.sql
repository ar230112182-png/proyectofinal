CREATE TABLE IF NOT EXISTS public.auditoria (
    id_evento BIGSERIAL PRIMARY KEY,
    id_usuario INTEGER REFERENCES public.usuarios(id_usuario) ON DELETE SET NULL,
    accion VARCHAR(20) NOT NULL CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE')),
    entidad VARCHAR(100) NOT NULL,
    entidad_id TEXT,
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION public.registrar_auditoria()
RETURNS TRIGGER AS $$
DECLARE
    usuario_actual INTEGER;
    entidad_id_value TEXT;
BEGIN
    usuario_actual := NULLIF(current_setting('app.user_id', true), '')::INTEGER;

    IF TG_OP = 'INSERT' THEN
        IF TG_TABLE_NAME = 'usuarios' THEN
            entidad_id_value := NEW.id_usuario::TEXT;
        ELSIF TG_TABLE_NAME = 'agentes' THEN
            entidad_id_value := NEW.id_agente::TEXT;
        ELSIF TG_TABLE_NAME = 'propietarios' THEN
            entidad_id_value := NEW.id_propietario::TEXT;
        ELSIF TG_TABLE_NAME = 'direcciones' THEN
            entidad_id_value := NEW.id_direccion::TEXT;
        ELSIF TG_TABLE_NAME = 'propiedades' THEN
            entidad_id_value := NEW.id_propiedad::TEXT;
        ELSIF TG_TABLE_NAME = 'compras' THEN
            entidad_id_value := NEW.id_compra::TEXT;
        ELSIF TG_TABLE_NAME = 'operaciones' THEN
            entidad_id_value := NEW.id_operacion::TEXT;
        ELSIF TG_TABLE_NAME = 'clientes' THEN
            entidad_id_value := NEW.id_cliente::TEXT;
        ELSIF TG_TABLE_NAME = 'citas' THEN
            entidad_id_value := NEW.id_cita::TEXT;
        ELSIF TG_TABLE_NAME = 'ofertas' THEN
            entidad_id_value := NEW.id_oferta::TEXT;
        ELSIF TG_TABLE_NAME = 'expedientes_legales' THEN
            entidad_id_value := NEW.id_documento::TEXT;
        ELSIF TG_TABLE_NAME = 'ventas' THEN
            entidad_id_value := NEW.id_venta::TEXT;
        ELSIF TG_TABLE_NAME = 'comisiones' THEN
            entidad_id_value := NEW.id_comision::TEXT;
        ELSIF TG_TABLE_NAME = 'rentas' THEN
            entidad_id_value := NEW.id_renta::TEXT;
        ELSIF TG_TABLE_NAME = 'pagos_renta' THEN
            entidad_id_value := NEW.id_pago::TEXT;
        ELSIF TG_TABLE_NAME = 'leads' THEN
            entidad_id_value := NEW.id_lead::TEXT;
        ELSIF TG_TABLE_NAME = 'coincidencias' THEN
            entidad_id_value := NEW.id_coincidencia::TEXT;
        ELSIF TG_TABLE_NAME = 'categorias' THEN
            entidad_id_value := NEW.id_categoria::TEXT;
        ELSE
            entidad_id_value := NULL;
        END IF;

        INSERT INTO public.auditoria (id_usuario, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
        VALUES (usuario_actual, TG_OP, TG_TABLE_NAME, entidad_id_value, NULL, to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF TG_TABLE_NAME = 'usuarios' THEN
            entidad_id_value := NEW.id_usuario::TEXT;
        ELSIF TG_TABLE_NAME = 'agentes' THEN
            entidad_id_value := NEW.id_agente::TEXT;
        ELSIF TG_TABLE_NAME = 'propietarios' THEN
            entidad_id_value := NEW.id_propietario::TEXT;
        ELSIF TG_TABLE_NAME = 'direcciones' THEN
            entidad_id_value := NEW.id_direccion::TEXT;
        ELSIF TG_TABLE_NAME = 'propiedades' THEN
            entidad_id_value := NEW.id_propiedad::TEXT;
        ELSIF TG_TABLE_NAME = 'compras' THEN
            entidad_id_value := NEW.id_compra::TEXT;
        ELSIF TG_TABLE_NAME = 'operaciones' THEN
            entidad_id_value := NEW.id_operacion::TEXT;
        ELSIF TG_TABLE_NAME = 'clientes' THEN
            entidad_id_value := NEW.id_cliente::TEXT;
        ELSIF TG_TABLE_NAME = 'citas' THEN
            entidad_id_value := NEW.id_cita::TEXT;
        ELSIF TG_TABLE_NAME = 'ofertas' THEN
            entidad_id_value := NEW.id_oferta::TEXT;
        ELSIF TG_TABLE_NAME = 'expedientes_legales' THEN
            entidad_id_value := NEW.id_documento::TEXT;
        ELSIF TG_TABLE_NAME = 'ventas' THEN
            entidad_id_value := NEW.id_venta::TEXT;
        ELSIF TG_TABLE_NAME = 'comisiones' THEN
            entidad_id_value := NEW.id_comision::TEXT;
        ELSIF TG_TABLE_NAME = 'rentas' THEN
            entidad_id_value := NEW.id_renta::TEXT;
        ELSIF TG_TABLE_NAME = 'pagos_renta' THEN
            entidad_id_value := NEW.id_pago::TEXT;
        ELSIF TG_TABLE_NAME = 'leads' THEN
            entidad_id_value := NEW.id_lead::TEXT;
        ELSIF TG_TABLE_NAME = 'coincidencias' THEN
            entidad_id_value := NEW.id_coincidencia::TEXT;
        ELSIF TG_TABLE_NAME = 'categorias' THEN
            entidad_id_value := NEW.id_categoria::TEXT;
        ELSE
            entidad_id_value := NULL;
        END IF;

        INSERT INTO public.auditoria (id_usuario, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
        VALUES (usuario_actual, TG_OP, TG_TABLE_NAME, entidad_id_value, to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        IF TG_TABLE_NAME = 'usuarios' THEN
            entidad_id_value := OLD.id_usuario::TEXT;
        ELSIF TG_TABLE_NAME = 'agentes' THEN
            entidad_id_value := OLD.id_agente::TEXT;
        ELSIF TG_TABLE_NAME = 'propietarios' THEN
            entidad_id_value := OLD.id_propietario::TEXT;
        ELSIF TG_TABLE_NAME = 'direcciones' THEN
            entidad_id_value := OLD.id_direccion::TEXT;
        ELSIF TG_TABLE_NAME = 'propiedades' THEN
            entidad_id_value := OLD.id_propiedad::TEXT;
        ELSIF TG_TABLE_NAME = 'compras' THEN
            entidad_id_value := OLD.id_compra::TEXT;
        ELSIF TG_TABLE_NAME = 'operaciones' THEN
            entidad_id_value := OLD.id_operacion::TEXT;
        ELSIF TG_TABLE_NAME = 'clientes' THEN
            entidad_id_value := OLD.id_cliente::TEXT;
        ELSIF TG_TABLE_NAME = 'citas' THEN
            entidad_id_value := OLD.id_cita::TEXT;
        ELSIF TG_TABLE_NAME = 'ofertas' THEN
            entidad_id_value := OLD.id_oferta::TEXT;
        ELSIF TG_TABLE_NAME = 'expedientes_legales' THEN
            entidad_id_value := OLD.id_documento::TEXT;
        ELSIF TG_TABLE_NAME = 'ventas' THEN
            entidad_id_value := OLD.id_venta::TEXT;
        ELSIF TG_TABLE_NAME = 'comisiones' THEN
            entidad_id_value := OLD.id_comision::TEXT;
        ELSIF TG_TABLE_NAME = 'rentas' THEN
            entidad_id_value := OLD.id_renta::TEXT;
        ELSIF TG_TABLE_NAME = 'pagos_renta' THEN
            entidad_id_value := OLD.id_pago::TEXT;
        ELSIF TG_TABLE_NAME = 'leads' THEN
            entidad_id_value := OLD.id_lead::TEXT;
        ELSIF TG_TABLE_NAME = 'coincidencias' THEN
            entidad_id_value := OLD.id_coincidencia::TEXT;
        ELSIF TG_TABLE_NAME = 'categorias' THEN
            entidad_id_value := OLD.id_categoria::TEXT;
        ELSE
            entidad_id_value := NULL;
        END IF;

        INSERT INTO public.auditoria (id_usuario, accion, entidad, entidad_id, datos_anteriores, datos_nuevos)
        VALUES (usuario_actual, TG_OP, TG_TABLE_NAME, entidad_id_value, to_jsonb(OLD), NULL);
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'usuarios') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_usuarios ON public.usuarios;
        CREATE TRIGGER trg_auditoria_usuarios
        AFTER INSERT OR UPDATE OR DELETE ON public.usuarios
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agentes') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_agentes ON public.agentes;
        CREATE TRIGGER trg_auditoria_agentes
        AFTER INSERT OR UPDATE OR DELETE ON public.agentes
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'propietarios') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_propietarios ON public.propietarios;
        CREATE TRIGGER trg_auditoria_propietarios
        AFTER INSERT OR UPDATE OR DELETE ON public.propietarios
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'direcciones') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_direcciones ON public.direcciones;
        CREATE TRIGGER trg_auditoria_direcciones
        AFTER INSERT OR UPDATE OR DELETE ON public.direcciones
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'propiedades') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_propiedades ON public.propiedades;
        CREATE TRIGGER trg_auditoria_propiedades
        AFTER INSERT OR UPDATE OR DELETE ON public.propiedades
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'compras') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_compras ON public.compras;
        CREATE TRIGGER trg_auditoria_compras
        AFTER INSERT OR UPDATE OR DELETE ON public.compras
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'operaciones') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_operaciones ON public.operaciones;
        CREATE TRIGGER trg_auditoria_operaciones
        AFTER INSERT OR UPDATE OR DELETE ON public.operaciones
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clientes') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_clientes ON public.clientes;
        CREATE TRIGGER trg_auditoria_clientes
        AFTER INSERT OR UPDATE OR DELETE ON public.clientes
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'citas') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_citas ON public.citas;
        CREATE TRIGGER trg_auditoria_citas
        AFTER INSERT OR UPDATE OR DELETE ON public.citas
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ofertas') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_ofertas ON public.ofertas;
        CREATE TRIGGER trg_auditoria_ofertas
        AFTER INSERT OR UPDATE OR DELETE ON public.ofertas
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'expedientes_legales') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_expedientes_legales ON public.expedientes_legales;
        CREATE TRIGGER trg_auditoria_expedientes_legales
        AFTER INSERT OR UPDATE OR DELETE ON public.expedientes_legales
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ventas') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_ventas ON public.ventas;
        CREATE TRIGGER trg_auditoria_ventas
        AFTER INSERT OR UPDATE OR DELETE ON public.ventas
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'comisiones') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_comisiones ON public.comisiones;
        CREATE TRIGGER trg_auditoria_comisiones
        AFTER INSERT OR UPDATE OR DELETE ON public.comisiones
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rentas') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_rentas ON public.rentas;
        CREATE TRIGGER trg_auditoria_rentas
        AFTER INSERT OR UPDATE OR DELETE ON public.rentas
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pagos_renta') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_pagos_renta ON public.pagos_renta;
        CREATE TRIGGER trg_auditoria_pagos_renta
        AFTER INSERT OR UPDATE OR DELETE ON public.pagos_renta
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_leads ON public.leads;
        CREATE TRIGGER trg_auditoria_leads
        AFTER INSERT OR UPDATE OR DELETE ON public.leads
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'coincidencias') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_coincidencias ON public.coincidencias;
        CREATE TRIGGER trg_auditoria_coincidencias
        AFTER INSERT OR UPDATE OR DELETE ON public.coincidencias
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'categorias') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_categorias ON public.categorias;
        CREATE TRIGGER trg_auditoria_categorias
        AFTER INSERT OR UPDATE OR DELETE ON public.categorias
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;
END $$;
