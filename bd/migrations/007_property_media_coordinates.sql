BEGIN;

ALTER TABLE public.propiedades
  ADD COLUMN IF NOT EXISTS imagen_url TEXT,
  ADD COLUMN IF NOT EXISTS latitud NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitud NUMERIC(10, 7);

ALTER TABLE public.propiedades
  DROP CONSTRAINT IF EXISTS propiedades_coordinates_check;

ALTER TABLE public.propiedades
  ADD CONSTRAINT propiedades_coordinates_check
  CHECK (
    (latitud IS NULL AND longitud IS NULL)
    OR (latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
  );

COMMIT;
