BEGIN;

DO $$
BEGIN
  IF to_regclass('public.comisiones') IS NOT NULL THEN
    ALTER TABLE public.comisiones
      ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE';
    UPDATE public.comisiones
      SET estado = 'PENDIENTE'
      WHERE estado IS NULL OR estado = '';
    CREATE INDEX IF NOT EXISTS idx_comisiones_estado_mes
      ON public.comisiones(estado, creado_en DESC);
  END IF;

  IF to_regclass('public.auditoria') IS NOT NULL THEN
    ALTER TABLE public.auditoria
      ADD COLUMN IF NOT EXISTS detalle JSONB;
    ALTER TABLE public.auditoria
      DROP CONSTRAINT IF EXISTS auditoria_accion_check;
    ALTER TABLE public.auditoria
      ADD CONSTRAINT auditoria_accion_check
      CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE', 'crear', 'actualizar', 'eliminar', 'archivar', 'ejecutar', 'cargar'));
  END IF;
END $$;

COMMIT;
