# Publicar gratis con Render y Supabase

Esta configuración publica la aplicación en una URL gratuita de Render
(`*.onrender.com`) y usa PostgreSQL de Supabase. El enlace será público, pero
la aplicación seguirá exigiendo iniciar sesión. No es un dominio personalizado.

## Límites del plan gratuito

- Render suspende el servidor después de 15 minutos sin tráfico; la primera
  visita posterior puede tardar alrededor de un minuto.
- Supabase pausa proyectos gratuitos después de una semana de inactividad. El
  plan gratuito tiene límites de almacenamiento y no sustituye una estrategia
  de respaldos. Revisa los límites vigentes antes de migrar datos reales.
- Mantén copias privadas y actualizadas de la base de datos. No publiques
  archivos `.env`, respaldos ni cadenas de conexión.

## Preparar y migrar PostgreSQL

1. Crea un proyecto PostgreSQL en [Supabase](https://supabase.com/dashboard).
2. Desde **Connect**, copia la cadena de conexión **Session pooler** y confirma
   que use SSL (`sslmode=require`). No uses la contraseña de ejemplo del
   proyecto local.
3. En PowerShell, crea un respaldo actualizado de la base local y restáuralo
   en el proyecto nuevo. Las cadenas se solicitan ocultas y no quedan escritas
   en el historial de comandos. Si tu instalación de PostgreSQL no está en la
   carpeta indicada, ajusta `$pgBin` a su carpeta `bin`.

   ```powershell
   $pgBin = "$env:ProgramFiles\PostgreSQL\18\bin"
   $localUrl = [System.Net.NetworkCredential]::new('', (Read-Host 'URL PostgreSQL local' -AsSecureString)).Password
   $cloudUrl = [System.Net.NetworkCredential]::new('', (Read-Host 'URL Session pooler de Supabase' -AsSecureString)).Password
   & "$pgBin\pg_dump.exe" --dbname="$localUrl" --format=custom --no-owner --no-acl --file="backups\bienes-raices-cloud.dump"
   if ($LASTEXITCODE -ne 0) { throw 'pg_dump falló; no continúes.' }
   & "$pgBin\pg_restore.exe" --dbname="$cloudUrl" --no-owner --no-acl "backups\bienes-raices-cloud.dump"
   if ($LASTEXITCODE -ne 0) { throw 'pg_restore falló; revisa el error antes de continuar.' }
   Remove-Variable localUrl, cloudUrl
   ```

   La carpeta `backups` contiene datos privados: conserva el respaldo solo
   localmente y no lo subas a GitHub. Este procedimiento presupone un proyecto
   Supabase nuevo y vacío.
4. Con `DATABASE_URL` apuntando temporalmente a la base Supabase, aplica las
   migraciones desde una terminal local. Ingresa el URL cuando PowerShell lo
   solicite:

   ```powershell
   $cloudUrl = [System.Net.NetworkCredential]::new('', (Read-Host 'URL Session pooler de Supabase' -AsSecureString)).Password
   $env:DATABASE_URL = $cloudUrl
   npm run db:migrate
   Remove-Item Env:DATABASE_URL
   Remove-Variable cloudUrl
   ```

   No continúes si el respaldo o las migraciones muestran errores. Verifica
   también que las cuentas existentes puedan iniciar sesión y que imágenes y
   documentos continúen disponibles; se guardan en PostgreSQL.

La guía oficial de Supabase explica el flujo de respaldo y restauración con
`pg_dump` y `psql`: [Backup and Restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Crear el servicio web

1. Confirma que el código que quieres publicar esté en la rama del repositorio
   conectado a Render. Los cambios que solo están en tu computadora no se
   despliegan automáticamente. No agregues `.env` ni respaldos al repositorio.
2. En [Render](https://dashboard.render.com/), elige **New > Blueprint** y
   conecta el repositorio. Render detectará `render.yaml`.
3. Cuando solicite `DATABASE_URL`, pega la cadena Session pooler de Supabase.
   Render generará `JWT_SECRET`; no reutilices una clave de desarrollo.
4. Espera el despliegue y verifica que el chequeo `/api/health` quede saludable.
   Render mostrará el enlace público `https://...onrender.com`.
5. Si la aplicación genera enlaces absolutos para el portal público, agrega
   `PUBLIC_PORTAL_URL` en las variables del servicio con el URL de Render.

No ejecutes `npm run db:seed` en la base migrada: puede modificar cuentas y
datos. Administra las cuentas existentes desde la aplicación.
