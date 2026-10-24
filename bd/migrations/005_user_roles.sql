BEGIN;

ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_check;

UPDATE public.usuarios
SET rol = 'administrador'
WHERE rol = 'admin';

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('cliente', 'usuario', 'agente', 'vendedor', 'administrador'));

COMMIT;
