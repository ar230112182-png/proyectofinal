ALTER TABLE public.coincidencias ALTER COLUMN puntuacion DROP NOT NULL;
ALTER TABLE public.coincidencias
  ADD COLUMN IF NOT EXISTS explicacion JSONB,
  ADD COLUMN IF NOT EXISTS version_calculo INTEGER;

CREATE INDEX IF NOT EXISTS idx_coincidencias_version_puntuacion
  ON public.coincidencias (version_calculo, puntuacion DESC NULLS LAST, id_coincidencia DESC);

CREATE TABLE IF NOT EXISTS public.generaciones_coincidencias (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generada_en TIMESTAMPTZ NOT NULL,
  total BIGINT NOT NULL
);
