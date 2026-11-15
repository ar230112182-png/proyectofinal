-- Migracion para triggers adicionales:
-- 1. Trigger de auditoria en contratos, seguimientos_clientes y solicitudes_mantenimiento
-- 2. Trigger para actualizar automaticamente actualizado_en en solicitudes_mantenimiento

BEGIN;

-- Funcion generica para mantener actualizado el campo actualizado_en / updated_at
CREATE OR REPLACE FUNCTION public.actualizar_timestamp_modificacion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    -- 1. Trigger de auditoria para contratos
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contratos') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_contratos ON public.contratos;
        CREATE TRIGGER trg_auditoria_contratos
        AFTER INSERT OR UPDATE OR DELETE ON public.contratos
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    -- 2. Trigger de auditoria para seguimientos_clientes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'seguimientos_clientes') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_seguimientos_clientes ON public.seguimientos_clientes;
        CREATE TRIGGER trg_auditoria_seguimientos_clientes
        AFTER INSERT OR UPDATE OR DELETE ON public.seguimientos_clientes
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    -- 3. Trigger de auditoria para solicitudes_mantenimiento
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'solicitudes_mantenimiento') THEN
        DROP TRIGGER IF EXISTS trg_auditoria_solicitudes_mantenimiento ON public.solicitudes_mantenimiento;
        CREATE TRIGGER trg_auditoria_solicitudes_mantenimiento
        AFTER INSERT OR UPDATE OR DELETE ON public.solicitudes_mantenimiento
        FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
    END IF;

    -- 4. Trigger BEFORE UPDATE para refrescar fecha de actualizacion en solicitudes_mantenimiento
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'solicitudes_mantenimiento') THEN
        DROP TRIGGER IF EXISTS trg_actualizar_timestamp_mantenimiento ON public.solicitudes_mantenimiento;
        CREATE TRIGGER trg_actualizar_timestamp_mantenimiento
        BEFORE UPDATE ON public.solicitudes_mantenimiento
        FOR EACH ROW EXECUTE FUNCTION public.actualizar_timestamp_modificacion();
    END IF;
END $$;

COMMIT;
