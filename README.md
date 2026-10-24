# Bienes y Negocios Renato

Sistema web de gestión inmobiliaria con Node.js, Express, PostgreSQL y una
interfaz web sin framework. Permite administrar propiedades, clientes,
vendedores, usuarios, contratos, expedientes legales, rentas, comisiones y
reportes.

> **Aviso:** Los contratos y propiedades de prueba son datos ficticios. No
> deben utilizarse como documentos legales ni publicarse con información real.

## Características

- Inicio de sesión con JWT y contraseñas protegidas con bcrypt.
- Roles de administrador y vendedor.
- Alta, edición, cambio de estado y eliminación de usuarios y vendedores.
- Inventario de propiedades con categorías, disponibilidad, coordenadas y
  enlaces a Google Maps.
- Registro de clientes y contratos de venta o renta.
- Generación de formatos imprimibles de contratos.
- Expedientes legales con carga de PDF, imágenes y documentos de Word.
- Registro de auditoría de operaciones relevantes.
- Filtros, búsqueda, reportes y exportación de datos.
- Diseño adaptable para escritorio y teléfono.

## Requisitos

- Node.js 18 o posterior.
- npm.
- PostgreSQL 14 o posterior.
- Git.
- Opcional: Docker Desktop si se configura el entorno de contenedores.

## Instalación local

### 1. Clonar el repositorio

```powershell
git clone https://github.com/ar230112182-png/proyectofinal.git
cd proyectofinal
```

### 2. Instalar dependencias

```powershell
npm install
```

### 3. Crear la base de datos

En PostgreSQL crea una base llamada `bienes_raices`:

```sql
CREATE DATABASE bienes_raices;
```

Después carga el esquema base:

```powershell
psql -U postgres -d bienes_raices -f bd\BD.postgresql.sql
```

Si `psql` no está en el `PATH`, ejecuta el archivo desde la carpeta `bin` de
PostgreSQL o usa pgAdmin.

### 4. Configurar variables de entorno

Copia el archivo de ejemplo:

```powershell
Copy-Item .env.example .env
```

Edita `.env` y reemplaza los valores de ejemplo:

```dotenv
PORT=3007
DATABASE_URL=postgresql://postgres:TU_CONTRASENA@localhost:5432/bienes_raices
JWT_SECRET=una-clave-larga-aleatoria-y-privada
SEED_PASSWORD=una-contrasena-de-prueba-segura
```

No subas `.env` al repositorio. Está excluido mediante `.gitignore`.

### 5. Aplicar migraciones

```powershell
npm run db:migrate
```

Las migraciones agregan extensiones de flujo de trabajo, roles, estados de
usuario, coordenadas, expedientes y demás cambios posteriores al esquema base.
Son idempotentes y pueden ejecutarse de nuevo.

### 6. Crear datos iniciales opcionales

```powershell
npm run db:seed
```

Este comando crea o actualiza el usuario administrador:

- Correo: `admin@habita.local`
- Contraseña: el valor configurado en `SEED_PASSWORD`

Después del primer acceso cambia la contraseña y no uses estas credenciales en
producción.

### 7. Iniciar la aplicación

```powershell
npm start
```

Abre:

- Aplicación: <http://localhost:3007/>
- Estado de la API: <http://localhost:3007/api/health>

La comprobación de salud debe devolver:

```json
{
  "ok": true,
  "service": "bienesyraises-api",
  "database": "connected"
}
```

Para desarrollo con reinicio automático:

```powershell
npm run dev
```

En Windows también se puede ejecutar `iniciar.bat`. Este archivo comprueba
Node.js, npm, `.env`, dependencias y PostgreSQL antes de abrir el navegador.

## Docker

El proyecto incluye archivos de referencia para Docker y variables en
`.env.docker.example`. Si el archivo `docker-compose.yml` de la rama que se va
a publicar contiene los servicios `db` y `app`, usa:

```powershell
Copy-Item .env.docker.example .env.docker
```

Edita `.env.docker` con contraseñas propias y ejecuta:

```powershell
docker compose --env-file .env.docker up -d db
docker compose --env-file .env.docker ps
```

En una base nueva, carga el esquema:

```powershell
cmd /c "docker exec -i bienesyraises-db psql -v ON_ERROR_STOP=1 -U postgres -d bienes_raices < bd\BD.postgresql.sql"
docker compose --env-file .env.docker run --rm app npm run db:migrate
docker compose --env-file .env.docker run --rm app npm run db:seed
docker compose --env-file .env.docker up -d app
```

Abre <http://localhost:3007/>.

> Antes de publicar, verifica que `Dockerfile` y `docker-compose.yml` de la
> rama contengan una configuración completa y probada. Nunca publiques
> `.env.docker` ni contraseñas dentro de archivos versionados.

## Scripts disponibles

| Comando | Descripción |
| --- | --- |
| `npm start` | Inicia el servidor Express |
| `npm run dev` | Inicia el servidor con `node --watch` |
| `npm run db:migrate` | Ejecuta todas las migraciones SQL |
| `npm run db:seed` | Crea datos y usuario de prueba |

## Estructura principal

```text
bd/
  BD.postgresql.sql       Esquema base
  migrations/             Migraciones incrementales
server/
  app.js                  Servidor Express y middleware
  db.js                   Pool de PostgreSQL
  migrate.js              Ejecutor de migraciones
  seed.js                 Datos iniciales
  middleware.js           Autenticación y autorización
  routes/                 Rutas de autenticación, propiedades y flujos
js/cruds/main.js          Lógica de la aplicación autenticada
js/cruds/portal.js        Portal público de propiedades
estilo/style.css          Estilos de la interfaz
index.html                Panel interno
portal.html               Portal público
iniciar.bat               Iniciador para Windows
```

## API principal

Todas las rutas protegidas requieren:

```http
Authorization: Bearer <token>
```

### Autenticación

```text
POST /api/auth/login
```

### Propiedades

```text
GET    /api/properties
POST   /api/properties
PUT    /api/properties/:id
DELETE /api/properties/:id
```

### Flujos de trabajo

```text
GET    /api/workflows/summary
GET    /api/workflows/options
GET    /api/workflows/users
GET    /api/workflows/sellers
GET    /api/workflows/contracts
POST   /api/workflows/contracts
POST   /api/workflows/documents
GET    /api/workflows/documents/:id/file
PATCH  /api/workflows/users/:id
DELETE /api/workflows/users/:id
```

### Salud y portal público

```text
GET /api/health
GET /api/workflows/public/properties
POST /api/workflows/public/leads
```

## Expedientes legales

La carga de documentos acepta:

- PDF.
- JPEG, PNG y WebP.
- DOC y DOCX.

El límite máximo es de 10 MB por archivo. Los archivos se guardan en
PostgreSQL como contenido binario y se registra un hash SHA-256 para auditoría.

## Pruebas y verificación manual

Antes de subir cambios:

1. Ejecuta `npm install` si cambió `package.json`.
2. Ejecuta `npm run db:migrate`.
3. Comprueba `GET /api/health`.
4. Inicia sesión con un administrador.
5. Verifica crear, editar, activar, desactivar y eliminar un usuario de
   prueba.
6. Verifica que un usuario inactivo no pueda iniciar sesión.
7. Verifica crear una propiedad, un contrato y un expediente legal.
8. Comprueba que no se hayan generado secretos o archivos privados en Git.

## Seguridad

- No publiques `.env`, `.env.docker`, respaldos de producción, tokens ni
  contraseñas.
- Usa un `JWT_SECRET` aleatorio de al menos 32 caracteres.
- Usa contraseñas distintas para PostgreSQL, administración y seed.
- Cambia o elimina el usuario de prueba antes de desplegar.
- No uses propiedades, clientes ni contratos ficticios en producción.
- No ejecutes `git add .env` ni subas la carpeta `backups/`.
- Configura CORS restringido al dominio real antes de exponer la aplicación.
- Coloca la aplicación detrás de HTTPS en producción.

## Publicar en GitHub

Desde la raíz del proyecto:

```powershell
git status
git add README.md package.json package-lock.json bd server js estilo index.html portal.html iniciar.bat .env.example .env.docker.example .gitignore
git diff --cached --check
git commit -m "Documentar instalacion y despliegue"
git push origin main
```

Si la rama principal tiene otro nombre, reemplaza `main` por el nombre
correcto. Antes del `git add`, confirma que no estén incluidos `.env`,
`.env.docker`, `node_modules`, archivos de respaldo ni datos personales.

## Solución de problemas

### El servidor no inicia

- Comprueba que Node.js y npm estén instalados.
- Verifica que exista `.env`.
- Comprueba que `DATABASE_URL` sea correcta.
- Revisa que PostgreSQL esté iniciado.
- Ejecuta `npm install`.

### La API devuelve `database: unavailable`

- Comprueba el servicio de PostgreSQL.
- Verifica usuario, contraseña, puerto y nombre de base.
- Prueba la conexión con:

```powershell
psql "$env:DATABASE_URL" -c "SELECT 1;"
```

### El navegador muestra una versión antigua

Recarga con `Ctrl + F5`, borra la caché o reinicia el servidor. Los archivos
estáticos incluyen versiones en sus URL para evitar caché después de cambios.

### No se puede eliminar un usuario

La aplicación impide eliminar la propia cuenta y usuarios con registros
relacionados. En esos casos usa **Cambiar estado** y selecciona **Inactivo**.

## Licencia

Este repositorio no declara una licencia de código abierto. No redistribuyas
el código sin autorización de sus propietarios.



xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx