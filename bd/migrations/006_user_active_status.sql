-- Agrega el indicador de acceso y activa las cuentas existentes.
BEGIN;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.usuarios
SET activo = TRUE
WHERE activo IS NULL;

COMMIT;
