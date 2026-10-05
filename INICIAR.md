# Iniciar la aplicacion

Para volver a entrar despues de cerrar VS Code, PostgreSQL o la terminal:

1. Abre la carpeta del proyecto en el Explorador de archivos.
2. Haz doble clic en `iniciar.bat`.
3. Si Windows solicita permiso para iniciar PostgreSQL, acepta. Si no tienes permisos, pide al administrador que inicie el servicio `postgresql`.
4. Espera a que aparezca el mensaje de que el servidor y PostgreSQL estan listos; se abrira `http://localhost:3007/`.

Deja abierta la ventana **Bienes y Raises - servidor** mientras uses la pagina. Al cerrar esa ventana se detiene el servidor; para volver a entrar, ejecuta `iniciar.bat` otra vez.

El iniciador comprueba que exista `.env`, inicia los servicios instalados de PostgreSQL y espera a que la aplicacion confirme que puede conectarse a la base de datos. Si la pagina no abre, revisa el error que aparece en la ventana del servidor. Si faltan dependencias, abre una terminal en la carpeta del proyecto, ejecuta `npm install` y vuelve a iniciar.

Tambien puedes iniciar el servidor manualmente desde una terminal abierta en la carpeta del proyecto con `npm start`. PostgreSQL debe estar iniciado y la terminal debe permanecer abierta mientras uses la pagina.

## Usuarios, clientes y contratos

- Un administrador inicia sesion y abre **Usuarios y vendedores** para crear cuentas de administrador o vendedor. La API comprueba el permiso y requiere una contrasena inicial de al menos 12 caracteres.
- Un vendedor o administrador abre **Clientes** o **Negociaciones y ventas** y selecciona **Nuevo cliente y contrato**. El formato permite registrar un cliente nuevo o usar uno existente, seleccionar una propiedad, capturar las medidas del lote y completar los datos de venta o renta.
- Las ventas requieren latitud y longitud. Las rentas pueden guardarse sin coordenadas; si se capturan, deben incluirse ambas.
- Al guardar se registra la operacion, se actualiza la disponibilidad de la propiedad y se descarga un archivo HTML imprimible. Abre el archivo y usa **Imprimir / Guardar como PDF** para crear el PDF desde el navegador. El formato es un registro preliminar; revisa las condiciones legales antes de firmarlo.
- En la tabla de contratos, **Google Maps** abre la ubicacion guardada del lote. Las rutas autenticadas son `GET /api/workflows/contracts/:id/map` y `GET /api/workflows/properties/:id/map`; responden con coordenadas y una URL de Google Maps. No se necesita una clave de Google Maps para abrir esa URL.

## Actualizar la base de datos

Antes de usar el nuevo formulario de contratos por primera vez, ejecuta una vez desde la carpeta del proyecto:

```text
npm run db:migrate
```

Este comando aplica `bd/migrations/003_contracts.sql` y agrega la tabla de contratos y las columnas de coordenadas si hacen falta. La migracion se puede ejecutar mas de una vez.

La aplicacion web se adapta a pantallas de telefono. No se agrego un instalador Android ni un proyecto para Android Studio.
