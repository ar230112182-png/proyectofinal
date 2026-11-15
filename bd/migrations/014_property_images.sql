CREATE TABLE IF NOT EXISTS public.propiedad_imagenes (
  id_propiedad INTEGER PRIMARY KEY REFERENCES public.propiedades(id_propiedad) ON DELETE CASCADE,
  contenido BYTEA NOT NULL,
  tipo_mime TEXT NOT NULL CHECK (tipo_mime IN ('image/jpeg', 'image/png', 'image/webp'))
);
