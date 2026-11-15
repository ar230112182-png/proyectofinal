BEGIN;

ALTER TABLE public.solicitudes_mantenimiento
  ADD COLUMN IF NOT EXISTS prioridad_automatica BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.prioridad_mantenimiento(
  prioridad_manual VARCHAR, automatica BOOLEAN, fecha_limite DATE
) RETURNS VARCHAR
LANGUAGE SQL STABLE
AS $$
  SELECT CASE
    WHEN NOT automatica THEN prioridad_manual
    WHEN fecha_limite <= CURRENT_DATE + 1 THEN 'urgente'
    WHEN fecha_limite <= CURRENT_DATE + 7 THEN 'alta'
    ELSE 'normal'
  END::VARCHAR;
$$;

COMMIT;
