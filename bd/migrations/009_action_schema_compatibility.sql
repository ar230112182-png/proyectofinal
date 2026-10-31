-- Alinea usuarios, auditoria y comisiones con las acciones actuales del API.
BEGIN;

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.auditoria
  ADD COLUMN IF NOT EXISTS detalle JSONB;

ALTER TABLE public.auditoria
  DROP CONSTRAINT IF EXISTS auditoria_accion_check;

ALTER TABLE public.auditoria
  ADD CONSTRAINT auditoria_accion_check
  CHECK (accion IN (
    'INSERT', 'UPDATE', 'DELETE',
    'crear', 'actualizar', 'eliminar', 'archivar', 'ejecutar', 'cargar'
  ));

ALTER TABLE public.comisiones
  ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE';

COMMIT;
