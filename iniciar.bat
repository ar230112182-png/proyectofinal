@echo off
setlocal
cd /d "%~dp0"
set "APP_PORT=3007"

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
if not errorlevel 1 (
  call :check_server_version
  if errorlevel 1 goto outdated_server
  goto ready
)

echo La aplicacion escuchara en todas las interfaces de red.
start "Bienes y Raises - servidor" /D "%~dp0" cmd /k "set HOST=0.0.0.0&&set PORT=%APP_PORT%&&npm start"
echo Esperando al servidor y a la base de datos...
for /L %%i in (1,1,60) do (
  curl.exe --silent --fail --connect-timeout 1 --max-time 2 http://localhost:%APP_PORT%/api/health >nul 2>nul
  if not errorlevel 1 (
    call :check_server_version
    if errorlevel 1 goto outdated_server
    goto ready
  )
  ping -n 2 127.0.0.1 >nul
)

echo El servidor no respondio en http://localhost:%APP_PORT%/.
echo Revisa los errores en la ventana "Bienes y Raises - servidor".
pause
exit /b 1

:outdated_server
echo El servidor que ocupa el puerto %APP_PORT% no tiene la version actual.
echo Cierra la ventana donde se ejecuto npm start y vuelve a ejecutar este iniciador.
echo Si no encuentras esa ventana, revisa el proceso que ocupa el puerto %APP_PORT%.
pause
exit /b 1

:ready
echo Servidor y PostgreSQL listos.
echo Acceso desde este equipo: http://localhost:%APP_PORT%/
echo Acceso desde otro dispositivo conectado a la misma red:
set "IP_FOUND="
for /f "delims=" %%I in ('powershell -NoProfile -Command "Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -AddressState Preferred } | Where-Object { -not $_.SkipAsSource -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -Unique"') do (
  echo   http://%%I:%APP_PORT%/
  set "IP_FOUND=1"
)
if not defined IP_FOUND (
  echo No se detecto una direccion IPv4 de red. Comprueba la conexion y ejecuta ipconfig.
)
start "" "http://localhost:%APP_PORT%/"
exit /b 0

:check_server_version
set "API_STATUS="
for /f "delims=" %%S in ('curl.exe --silent --output nul --write-out "%%{http_code}" --connect-timeout 1 --max-time 2 http://localhost:%APP_PORT%/api/workflows/matching/results') do set "API_STATUS=%%S"
if "%API_STATUS%"=="401" exit /b 0
exit /b 1
