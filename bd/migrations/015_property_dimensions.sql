ALTER TABLE public.propiedades
  ADD COLUMN IF NOT EXISTS frente_metros NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS fondo_metros NUMERIC(10, 2);
