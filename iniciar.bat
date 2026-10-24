@echo off
setlocal
cd /d "%~dp0"
set "APP_IP=192.168.1.247"
set "APP_PORT=3007"
set "APP_URL=http://%APP_IP%:%APP_PORT%"

if not exist ".env" (
  echo No se encontro el archivo .env en esta carpeta.
  echo Revisa INICIAR.md para configurar la aplicacion.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instala Node.js y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo No se encontro npm. Reinstala Node.js incluyendo npm.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo Faltan las dependencias de la aplicacion. Ejecuta npm install en esta carpeta.
  pause
  exit /b 1
)

echo Iniciando el servicio de PostgreSQL...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $services = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue); if ($services.Count -eq 0) { Write-Error 'No se encontro un servicio de PostgreSQL instalado.'; exit 1 }; foreach ($service in $services) { if ($service.Status -ne 'Running') { Write-Host ('Iniciando ' + $service.Name + '...'); Start-Service -Name $service.Name -ErrorAction Stop } }; $stopped = @(Get-Service -Name 'postgresql*' | Where-Object Status -ne 'Running'); if ($stopped.Count -gt 0) { Write-Error 'No fue posible iniciar todos los servicios de PostgreSQL.'; exit 1 }"
if errorlevel 1 (
  echo No se pudo iniciar PostgreSQL. Revisa que este instalado y que tu usuario tenga permiso para iniciar el servicio.
  pause
  exit /b 1
)

echo Iniciando la aplicacion...
curl.exe --silent --fail --connect-timeout 1 --max-time 2 http://localhost:%APP_PORT%/api/health >nul 2>nul
if not errorlevel 1 goto ready

echo La aplicacion escuchara en todas las interfaces de red.
start "Bienes y Raises - servidor" /D "%~dp0" cmd /k "set HOST=0.0.0.0&&set PORT=%APP_PORT%&&npm start"
echo Esperando al servidor y a la base de datos...
for /L %%i in (1,1,60) do (
  curl.exe --silent --fail --connect-timeout 1 --max-time 2 http://localhost:%APP_PORT%/api/health >nul 2>nul
  if not errorlevel 1 goto ready
  ping -n 2 127.0.0.1 >nul
)

echo El servidor no respondio en http://localhost:%APP_PORT%/.
echo Revisa los errores en la ventana "Bienes y Raises - servidor".
pause
exit /b 1

:ready
echo Servidor y PostgreSQL listos.
echo Acceso desde este equipo: http://localhost:%APP_PORT%/
echo Acceso desde otro dispositivo: %APP_URL%/
set "IP_FOUND="
for /f "delims=" %%I in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -IPAddress '%APP_IP%' -ErrorAction SilentlyContinue).IPAddress"') do set "IP_FOUND=%%I"
if not defined IP_FOUND (
  echo AVISO: Este equipo no tiene asignada la IP %APP_IP%.
  echo Configura esa IP en el adaptador de red o usa la IP mostrada por ipconfig.
  echo El servidor esta iniciado, pero %APP_URL% no funcionara hasta asignar esa IP.
)
start "" "%APP_URL%/"
exit /b 0
