ALTER TABLE public.historial_generaciones_coincidencias
  ADD COLUMN IF NOT EXISTS es_demo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.coincidencias_retiradas
  ADD COLUMN IF NOT EXISTS es_demo BOOLEAN NOT NULL DEFAULT FALSE;
