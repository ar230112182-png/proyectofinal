# Iniciar la aplicacion

Para volver a entrar despues de cerrar VS Code, PostgreSQL o la terminal:

1. Abre la carpeta del proyecto en el Explorador de archivos.
2. Haz doble clic en `iniciar.bat`.
3. Si Windows solicita permiso para iniciar PostgreSQL, acepta. Si no tienes permisos, pide al administrador que inicie el servicio `postgresql`.
4. Espera a que aparezca el mensaje de que el servidor y PostgreSQL estan listos; se abrira `http://192.168.100.28:3007/`.

Deja abierta la ventana **Bienes y Raises - servidor** mientras uses la pagina. Al cerrar esa ventana se detiene el servidor; para volver a entrar, ejecuta `iniciar.bat` otra vez.

El iniciador comprueba que exista `.env`, inicia los servicios instalados de PostgreSQL y espera a que la aplicacion confirme que puede conectarse a la base de datos. Si la pagina no abre, revisa el error que aparece en la ventana del servidor. Si faltan dependencias, abre una terminal en la carpeta del proyecto, ejecuta `npm install` y vuelve a iniciar.

Tambien puedes iniciar el servidor manualmente desde una terminal abierta en la carpeta del proyecto con `npm start`. PostgreSQL debe estar iniciado y la terminal debe permanecer abierta mientras uses la pagina.

## Acceso desde un telefono

El servidor escucha en la red local. Para entrar desde un telefono:

1. Conecta el telefono y la computadora a la misma red Wi-Fi. No uses la red de invitados.
2. Ejecuta `iniciar.bat` y conserva abierta la ventana **Bienes y Raises - servidor**.
3. En el mensaje final copia la direccion que aparece como `http://<IP>:3007/`, por ejemplo `http://192.168.29.82:3007/`.
4. Escribe `http://192.168.100.28:3007/` en el navegador del telefono. El equipo servidor debe tener asignada la IP `192.168.100.28` y ambos dispositivos deben estar en la misma red.
5. Si Windows muestra una alerta del Firewall, permite **Node.js** en redes privadas.

Si no aparece la IP, abre PowerShell y ejecuta `ipconfig`. Usa la direccion IPv4 del adaptador Wi-Fi, normalmente empieza por `192.168.` o `10.`. Si Windows bloquea la conexion, abre PowerShell como administrador y ejecuta:

```text
New-NetFirewallRule -DisplayName "Bienes y Negocios Renato 3007" -Direction Inbound -Protocol TCP -LocalPort 3007 -Action Allow -Profile Private
```

La computadora debe permanecer encendida, conectada al mismo Wi-Fi y con el servidor ejecutandose. La direccion puede cambiar al conectarte a otra red.

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

## Instalar e iniciar todo con Docker

Docker Desktop permite ejecutar Node.js y PostgreSQL juntos, sin depender del
servicio de PostgreSQL instalado en Windows. Esta es la opción recomendada
cuando se quiere reproducir el entorno completo del proyecto.

### Instalación de Docker Desktop

1. Descarga **Docker Desktop para Windows** desde
   [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).
2. Ejecuta el instalador y conserva activada la opción **Use WSL 2 instead of
   Hyper-V** cuando esté disponible.
3. Reinicia Windows si el instalador lo solicita.
4. Abre Docker Desktop y espera a que indique que el motor está ejecutándose.
5. Comprueba la instalación desde PowerShell:

```text
docker --version
docker compose version
```

Si alguno de los comandos no se reconoce, cierra y vuelve a abrir PowerShell
después de instalar Docker Desktop. El proyecto requiere Docker Compose
integrado; no es necesario instalar `docker-compose` por separado.

### Configuración inicial del proyecto

Abre PowerShell en la carpeta del proyecto y crea el archivo de variables
privadas:

```text
Copy-Item .env.docker.example .env.docker
```

Edita `.env.docker` y reemplaza los valores de ejemplo de
`POSTGRES_PASSWORD`, `JWT_SECRET` y `SEED_PASSWORD` por valores propios. No
publiques ni compartas este archivo: está excluido de Git.

### Primer arranque con una base nueva

Ejecuta los pasos siguientes en el orden indicado:

1. Inicia PostgreSQL y espera a que pase la comprobación de salud:

```text
docker compose --env-file .env.docker up -d db
docker compose --env-file .env.docker ps
```

El servicio `db` debe aparecer como `healthy`. La primera ejecución crea el
volumen persistente `postgres_data`.

2. Carga el esquema base en la base recién creada:

```text
cmd /c "docker exec -i bienesyraises-db psql -v ON_ERROR_STOP=1 -U postgres -d bienes_raices < bd\BD.postgresql.sql"
```

3. Aplica las migraciones adicionales:

```text
docker compose --env-file .env.docker run --rm app npm run db:migrate
```

4. Crea los datos y el usuario de prueba:

```text
docker compose --env-file .env.docker run --rm app npm run db:seed
```

5. Inicia la aplicación:

```text
docker compose --env-file .env.docker up -d app
```

Abre [http://localhost:3007/](http://localhost:3007/). Para comprobar el
estado de la API, visita
[http://localhost:3007/api/health](http://localhost:3007/api/health); debe
responder indicando que la base de datos está conectada.

El usuario creado por `db:seed` es `admin@habita.local`. La contraseña es la
que hayas definido en `SEED_PASSWORD`. Cámbiala o elimina los datos de prueba
antes de usar el sistema en un entorno real.

### Inicios posteriores y comandos habituales

Después de completar la instalación, basta con ejecutar:

```text
docker compose --env-file .env.docker up -d
```

Para ver el estado y los registros:

```text
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f app
```

Para detener los contenedores sin borrar la información:

```text
docker compose --env-file .env.docker down
```

No uses `docker compose down -v` salvo que quieras borrar completamente la
base de datos almacenada en el volumen `postgres_data`.

### Conservar la base de datos actual de Windows

Antes de cambiar de entorno, crea un respaldo desde una terminal que tenga
`pg_dump`:

```text
pg_dump -U postgres -d bienes_raices --format=plain --clean --if-exists --no-owner --file=backups\bienes_raices.sql
```

Inicia primero PostgreSQL de Docker:

```text
docker compose --env-file .env.docker up -d db
```

Cuando el contenedor este saludable, restaura el respaldo. En PowerShell se
recomienda usar `cmd` para que la redireccion del archivo binario no se
modifique:

```text
cmd /c "docker exec -i bienesyraises-db psql -v ON_ERROR_STOP=1 -U postgres -d bienes_raices < backups\bienes_raices.sql"
```

Despues inicia la aplicacion:

```text
docker compose --env-file .env.docker up -d app
```

El archivo `backups\bienes_raices.sql` contiene los datos de la base y no debe
publicarse en GitHub ni enviarse a personas no autorizadas. Si el respaldo está
en formato personalizado `.dump`, usa `pg_restore` en lugar de `psql`.

### Problemas frecuentes con Docker

- **`docker` no se reconoce:** abre Docker Desktop, reinicia PowerShell y
  confirma que Docker Desktop terminó su instalación.
- **El contenedor `db` no llega a `healthy`:** revisa los registros con
  `docker compose --env-file .env.docker logs db` y confirma que Docker
  Desktop tenga suficientes recursos.
- **El puerto 3007 ya está ocupado:** detén la aplicación iniciada con
  `iniciar.bat` o cambia el puerto publicado en `docker-compose.yml`.
- **La aplicación no encuentra tablas:** en una base nueva faltó cargar
  `bd\BD.postgresql.sql`; detén `app`, carga el esquema y vuelve a ejecutar las
  migraciones.
- **Se perdió la información:** no elimines el volumen con `down -v`. Para
  recuperarla, restaura un respaldo siguiendo la sección anterior.
