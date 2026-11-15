BEGIN;

INSERT INTO public.categorias (nombre)
SELECT nombre
FROM unnest(ARRAY[
  'Casa', 'Lote baldío', 'Oficinas', 'Tiendas a pie de calle',
  'Plazas comerciales', 'Supermercados', 'Restaurantes', 'Moteles',
  'Resorts', 'Hostales', 'Clínicas privadas', 'Hospitales', 'Gimnasios',
  'Escuelas privadas', 'Estacionamientos', 'Naves industriales', 'Bodegas',
  'Ranchos', 'Haciendas', 'Huertos'
]) AS categorias(nombre)
ON CONFLICT (nombre) DO NOTHING;

COMMIT;
