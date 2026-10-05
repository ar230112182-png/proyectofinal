@echo off
setlocal
cd /d "%~dp0"

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
curl.exe --silent --fail --connect-timeout 1 --max-time 2 http://localhost:3007/api/health >nul 2>nul
if not errorlevel 1 goto ready

start "Bienes y Raises - servidor" /D "%~dp0" cmd /k npm start
echo Esperando al servidor y a la base de datos...
for /L %%i in (1,1,60) do (
  curl.exe --silent --fail --connect-timeout 1 --max-time 2 http://localhost:3007/api/health >nul 2>nul
  if not errorlevel 1 goto ready
  ping -n 2 127.0.0.1 >nul
)

echo El servidor no respondio en http://localhost:3007/.
echo Revisa los errores en la ventana "Bienes y Raises - servidor".
pause
exit /b 1

:ready
echo Servidor y PostgreSQL listos. Abriendo http://localhost:3007/...
start "" "http://localhost:3007/"
exit /b 0
