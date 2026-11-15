ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS costo_adquisicion NUMERIC(15, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'propiedades'::regclass
      AND conname = 'propiedades_costo_adquisicion_check'
  ) THEN
    ALTER TABLE propiedades ADD CONSTRAINT propiedades_costo_adquisicion_check
      CHECK (costo_adquisicion IS NULL OR costo_adquisicion > 0);
  END IF;
END $$;
