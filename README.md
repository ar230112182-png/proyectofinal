# Bienes y Negocios Renato

Sistema de gestión inmobiliaria con interfaz web sin framework, servidor
Node.js/Express y PostgreSQL. Este README describe las pantallas, formularios,
atributos, acciones, permisos, API y estructura de datos que existen en el
código del proyecto.

> **Aviso:** Los registros y formatos de prueba son ficticios. No deben
> utilizarse como documentos legales ni publicarse con información real.

## Revisión y correcciones registradas

**Fecha y horario local:** 10 de noviembre de 2026, de 17:18:50 a 17:31:50
(-06:00). El intervalo registra esta revisión y sus correcciones; los cambios
locales que ya existían antes de iniciarla no tienen una hora verificable y no
se les atribuye una.

En esta revisión se ajustó el diseño adaptable de los formularios y sus
controles para escritorio y teléfono. Se añadieron validaciones en la interfaz
y en el servidor para datos requeridos, longitudes, correo, teléfono, CURP,
código postal, importes, rangos, fechas, coordenadas, estados permitidos y
archivos de hasta 10 MB. Los presupuestos de solicitudes públicas también
comprueban que el mínimo no supere al máximo. Se verificaron la sintaxis de
JavaScript, el inicio del servidor, la conexión con PostgreSQL y validaciones
de formularios en el navegador; el árbol de trabajo conservó las modificaciones
y archivos no rastreados que ya estaban presentes.

El acceso interno sigue usando `/api/auth/login`. El panel guarda el token de
sesión en el almacenamiento local del navegador, por lo que puede conservar la
sesión después de reiniciar el servidor y no mostrar el formulario de acceso.
Usa **Salir** en el menú de sesión para volver a iniciar sesión. Iniciar el
servidor no ejecuta el seed ni restablece contraseñas. Una cuenta con rol
`cliente` que inicia sesión desde el panel es dirigida al portal de inquilinos.

## Funcionalidades

- Autenticación con JWT y contraseñas almacenadas con bcrypt.
- Gestión de inmuebles, clientes, clientes potenciales, visitas, ofertas,
  contratos, ventas, rentas, pagos, comisiones y mantenimiento.
- Expedientes legales con carga y descarga de archivos.
- Historial comercial del cliente con notas y tareas asignables.
- Motor para generar coincidencias entre clientes potenciales e inmuebles.
- Indicadores, alertas, notificaciones y bitácora de actividad.
- Portales web público de propiedades y privado para inquilinos.
- Búsqueda, filtros, ordenamiento, paginación y exportación CSV.
- Formatos imprimibles de contratos y recibos de pago.
- Interfaz adaptable a escritorio y teléfono.

## Guía funcional

### Acceso y roles

El panel interno está en `/`. Se inicia sesión con correo y contraseña. El
token JWT vence a las 8 horas; una cuenta inactiva no puede iniciar sesión. El
servidor considera equivalentes `admin`/`administrador` y `agente`/`vendedor`.

| Rol | Acceso y operaciones |
| --- | --- |
| `administrador` | Acceso al panel y a todas las secciones. Gestiona usuarios, vendedores, ventas, comisiones, accesos al portal y permisos de documentos de inquilinos. |
| `vendedor` (`agente`) | Acceso al panel y operación diaria: propiedades, clientes, prospectos, visitas, documentos, ofertas, rentas, pagos y mantenimiento. No accede a la administración de usuarios ni a las vistas restringidas a administradores. |
| `usuario` | Cuenta interna con permisos limitados; no tiene acceso a las rutas del panel que requieren administrador o vendedor. |
| `cliente` | Acceso al portal privado de inquilinos y únicamente a la información asociada a su cuenta. |

Las rutas además validan permisos por operación. Por ejemplo, las ventas y
comisiones se crean solo con rol administrador; los cambios de contraseña y
permisos de documentos del portal también son exclusivos del administrador.

### Panel interno y módulos

| Sección | Datos y atributos principales | Acciones disponibles |
| --- | --- | --- |
| **Resumen** | Métricas de inmuebles disponibles, clientes, visitas semanales e ingresos; alertas, inmuebles recientes y actividad. | Revisar pendientes, consultar movimientos y abrir el inventario. La actividad usa `C` (crear), `A` (actualizar), `E` (eliminar), `Ar` (archivar), `Ej` (ejecutar) y `Ca` (cargar). `INSERT`/`UPDATE` de la bitácora se presentan como `C`/`A`. |
| **Inventario y propiedades** | Título, categoría, tipo de operación, costo de adquisición, precio de venta o renta, descripción, superficie, habitaciones, baños, estacionamientos, estado, amenidades, imagen, coordenadas y dirección (calle, número, colonia, ciudad, estado y código postal). | Crear, editar campos permitidos, cambiar disponibilidad, retirar del listado y abrir ubicación en mapa. Categoría solo la cambia un administrador. |
| **Clientes** | Nombre, apellidos, correo, teléfono, CURP, dirección, ciudad, estado, código postal y estado activo. | Crear, activar/desactivar, consultar historial, agregar notas/tareas y gestionar acceso al portal/documentos cuando se tiene permiso. |
| **Clientes potenciales** | Nombre, correo, teléfono, origen, ciudad preferida, presupuesto mínimo/máximo, habitaciones mínimas, tipo/categoría, operación y estado. | Registrar desde el panel o desde el portal público, cambiar estado, asociar interés y generar coincidencias. Al cerrar venta o renta, un prospecto con correo coincidente puede marcarse como convertido. |
| **Motor de coincidencias** | Prospecto, inmueble, puntuación y fecha de generación. | Ejecutar el cálculo y consultar coincidencias guardadas. |
| **Agenda y citas** | Cliente, inmueble, fecha y hora, agente, motivo y estado. | Agendar y actualizar el estado de una cita. |
| **Legal y expediente digital** | Inmueble, tipo de documento, nombre/tipo de archivo, tamaño, estado y fecha. | Cargar y descargar documentos. Se aceptan PDF, DOC/DOCX, JPEG, PNG y WebP, hasta 10 MB por archivo. |
| **Negociaciones y ventas** | Oferta: inmueble, monto, tipo (`OFERTA` o `CONTRAPROPUESTA`) y notas. Venta: inmueble, cliente, agente, precio y fecha. Contrato: operación, inmueble, cliente, precio, fecha, dimensiones y observaciones. | Registrar ofertas y cambiar su estado; registrar ventas (administrador); crear contratos de venta o renta, consultar mapa y generar/imprimir su formato. |
| **Comisiones y finanzas** | Vendedor, cliente, inmueble, valor del inmueble, porcentaje, comisión, estado y fecha. | El administrador puede registrar una comisión del 5 % del precio vigente del inmueble y cambiar su estado. Los registros demo se identifican en la tabla. |
| **Mantenimiento** | Inmueble, renta opcional, asunto, descripción, prioridad, responsable, costo estimado/final y fecha límite. | Crear y actualizar solicitudes. Prioridades: `baja`, `normal`, `alta`, `urgente`. Estados: `pendiente`, `en_proceso`, `completada`, `cancelada`. La renta seleccionada debe pertenecer al inmueble elegido. |
| **Cobranza y renovaciones** | Renta, inmueble, cliente, monto mensual, inicio/fin, periodo de pago, importe, estado y fecha de pago. | Consultar vencimientos y adeudos, registrar pagos, cambiar su estado e imprimir/guardar recibos. |
| **Vendedores** | Nombre, apellidos, correo, teléfono, rol, estado activo y comisión mensual. | Editar, activar/desactivar y eliminar; solo administrador. |
| **Usuarios y administradores** | Nombre, apellidos, correo, teléfono, rol, estado activo y fecha de registro. | Crear, editar, activar/desactivar y eliminar; la contraseña inicial debe tener al menos 12 caracteres. Solo administrador. |
| **Reportes** | Vendedor, monto, operación, inmueble, fecha y actividad; incluye compras completadas con agente, ventas y rentas. | Filtrar por fechas y actividad; descargar cada registro en PDF desde sus acciones, o exportar el informe en PDF o CSV. |

Las tablas muestran el ID de cada registro. En Reportes, el ID corresponde a la
compra, venta o renta indicada en la columna Operación. En **Clientes**, las pestañas
**Todos**, **Activos**, **Inactivos** y **Potenciales** cambian la tabla visible; el control
**Columnas** permite mostrar campos adicionales y el menú de cada fila reúne sus acciones.
En los formularios, los campos de selección de registros permiten escribir un
nombre o ID y elegir una opción en el mismo control. Las listas de opciones
fijas, como estados y tipos de operación, se mantienen desplegables.
El formulario **Registrar cliente y contrato** organiza los campos en secciones
de operación, cliente, condiciones, medidas y ubicación. En los campos de
cliente y propiedad, escribe un nombre o ID y selecciona una opción de la lista;
el tipo de operación se elige en su lista desplegable. Los formularios más
extensos de propiedades, clientes, prospectos, mantenimiento y cuentas también
agrupan sus campos por tema; los formularios cortos conservan una vista compacta.

Los formularios de alta contienen los campos indicados arriba. En particular:

- **Propiedad:** `titulo`, `categoria` (seleccionada del catálogo registrado),
  `tipo_operacion` (`VENTA` o `RENTA`), `precio`, `descripcion`, `superficie`,
  `habitaciones`, `banos`, `estacionamientos`, imagen, `latitud`,
  `longitud`, `calle`, `numero`, `colonia`, `ciudad`, `estado` y
  `codigo_postal`. Precio, categoría, operación y algunos datos de inmueble/
  domicilio son obligatorios. La ubicación es opcional: abre Google Maps,
  haz clic derecho en el lugar para copiar sus coordenadas, o pega la dirección completa del
  navegador que incluya el pin. Los enlaces cortos no son compatibles; la
  aplicación guarda la latitud y longitud juntas. La imagen se selecciona desde
  el dispositivo al crear o editar la propiedad y se guarda en la base de datos.
  Se aceptan JPEG, PNG y WebP de hasta 10 MB; las imágenes por URL existentes
  se conservan hasta que se sustituyan.
  Para un lote baldío se ocultan los campos residenciales.
- **Cliente:** `nombre`, `apellido_paterno`, `apellido_materno`, `correo`,
  `telefono`, `curp`, `direccion`, `ciudad`, `estado` y `codigo_postal`.
- **Prospecto:** `nombre`, `correo`, `telefono`, `ciudad`, `precio_min`,
  `precio_max`, `habitaciones_min`, `tipo` y `operacion`.
- **Visita:** `id_cliente`, `id_propiedad`, `fecha_cita` y `motivo`.
- **Oferta:** `id_propiedad`, `monto`, `tipo` y `notas`.
- **Expediente:** `id_propiedad`, `tipo` y archivo en el campo `archivo`.
- **Venta:** `id_propiedad`, `id_cliente`, `id_agente`, `precio_venta` y
  `fecha_venta`.
- **Comisión:** `id_propiedad`, `porcentaje_agencia`, `monto_operacion` y
  `monto_total`.
- **Renta:** `id_propiedad`, `id_cliente`, `renta_mensual`, `fecha_inicio` y
  `fecha_fin`.
- **Pago:** `id_renta`, `periodo`, `monto` y `estado` (`PAGADO` o
  `PENDIENTE`).
- **Mantenimiento:** `id_propiedad`, `id_renta` (opcional), `titulo`,
  `descripcion`, `prioridad`, `asignado_a`, `costo_estimado` y `fecha_limite`.
- **Contrato:** `tipo_operacion`, `id_propiedad`, cliente existente o datos de
  cliente nuevo (`cliente_nombre`, apellidos, correo, teléfono, CURP, domicilio,
  ciudad, estado y código postal), `precio_total`, `fecha_contrato`,
  `frente_metros`, `fondo_metros`, `superficie_m2`, coordenadas para venta,
  `renta_mensual`, fechas de renta y `observaciones`.
- **Usuario/vendedor:** nombre, apellidos, correo, teléfono, contraseña inicial
  de mínimo 12 caracteres y rol permitido para el formulario.

Los campos marcados como obligatorios en la interfaz también se validan en
servidor cuando aplica. Además, el servidor valida presupuestos, fechas,
coordenadas geográficas, asociación entre inmueble y renta, prioridad/costos de
mantenimiento y tipo/tamaño de archivo.

### Seguimiento, actividad y notificaciones

Desde el historial de un cliente se pueden consultar eventos comerciales y
crear una **nota** o **tarea** con `contenido`, fecha límite y responsable. Las
tareas pueden marcarse como completadas; las notas/tareas aceptan hasta 2,000
caracteres. El panel muestra notificaciones recientes y permite marcarlas como
leídas. La actividad del sistema muestra quién realizó una acción, entidad,
detalle disponible y fecha.

### Portal público de propiedades

Disponible en `/portal.html`. No requiere inicio de sesión. Permite buscar por
ubicación/nombre y filtrar por operación, categoría, presupuesto mínimo/máximo
y habitaciones mínimas. Los resultados se muestran en páginas de hasta 24
inmuebles. Se pueden abrir fichas de inmuebles disponibles, consultar
ubicación/mapa si hay coordenadas y enviar una solicitud de contacto.

La solicitud captura propiedad de interés (opcional), nombre (obligatorio),
correo, teléfono, ciudad, presupuesto mínimo/máximo y consentimiento obligatorio
para el seguimiento de datos.

### Portal privado de inquilinos

Disponible en `/portal-inquilinos.html`. El administrador habilita la cuenta
desde el historial del cliente y define la contraseña inicial (mínimo 12
caracteres). El inquilino inicia sesión con correo y contraseña y consulta solo
sus rentas, pagos, contratos y documentos cuyo acceso haya autorizado un
administrador. El administrador puede conceder o revocar acceso a documentos
asociados a rentas activas. La sesión puede cerrarse desde el portal.
En **Contratos** se descarga un PDF generado con los datos registrados de cada
contrato de renta propio. Es un formato informativo, no una copia firmada. Los
archivos originales autorizados se descargan desde **Documentos compartidos**;
solo aparecen después de que un administrador los comparta.
En **Reportar un problema**, el inquilino selecciona una de sus rentas activas,
indica asunto (hasta 180 caracteres), descripción (hasta 2,000) y prioridad.
El historial muestra sus reportes y su estado. Cada reporte se registra en
Mantenimiento y genera una notificación para los administradores y el agente
de la renta; si no tiene agente asignado, se notifica a los vendedores activos.
El panel actualiza las notificaciones al abrirlas y cada 60 segundos.

### Búsqueda, listados y exportación

Las tablas internas permiten búsqueda/filtros, orden y páginas de 20 filas; la
API pagina listados en lotes de hasta 200. El portal público también pagina
resultados. Las secciones de **Comisiones y finanzas** y **Reportes** permiten
exportar CSV. Los valores dinámicos se escapan antes de insertarse en el HTML.

## Requisitos

- Node.js 18 o posterior.
- npm.
- PostgreSQL 14 o posterior.
- Git.

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

### 3. Crear y preparar la base de datos

En PostgreSQL crea una base llamada `bienes_raices`:

```sql
CREATE DATABASE bienes_raices;
```

**Compatibilidad del esquema:** `bd/BD.postgresql.sql` conserva una versión
anterior del modelo de datos (por ejemplo, las propiedades se relacionan con
`id_propietario`, `id_agente` e `id_direccion`). Las rutas actuales usan el
modelo posterior (por ejemplo, `id_categoria`, `id_usuario` y
`estado_propiedad`). Las migraciones `001`–`011` agregan tablas y columnas, pero
no convierten por sí solas todo el esquema antiguo al esquema actual. Por eso,
no se debe asumir que cargar únicamente ese SQL en una base vacía basta para
iniciar el sistema. Antes de usar una base nueva, prepara y verifica un esquema
compatible con las consultas de `server/routes/`; no restaures un respaldo con
datos reales para crear un entorno de desarrollo.

Si `psql` no está en el `PATH`, usa la terminal `SQL Shell (psql)` o pgAdmin.
La forma de la variable de conexión es
`postgresql://USUARIO:CONTRASENA@HOST:PUERTO/BASE`; usa tus propios valores y
no incluyas una contraseña real en documentación ni en Git.

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

`PORT` es el puerto HTTP (por defecto `3007`) y `HOST` define la interfaz de
red (por defecto `0.0.0.0`). `DATABASE_URL` debe apuntar a la base PostgreSQL
compatible. `JWT_SECRET` debe ser aleatorio y tener al menos 32 caracteres.
`SEED_PASSWORD` establece la contraseña de demostración para `npm run db:seed`.
No subas `.env` al repositorio. Está excluido mediante `.gitignore`.

### 5. Aplicar migraciones

```powershell
npm run db:migrate
```

Las migraciones `bd/migrations/001_*.sql` a `011_*.sql` agregan extensiones de
flujo, auditoría, contratos, roles, estado activo, campos de propiedades,
índices, portales y mantenimiento. Deben ejecutarse sobre una base compatible
con las tablas requeridas por la aplicación; no reemplazan esa base. El
ejecutor las procesa en orden de nombre.

### 6. Crear datos iniciales opcionales

```powershell
npm run db:seed
```

El script crea o actualiza la cuenta administrativa `admin@habita.local` y
agrega registros de demostración. La contraseña se toma de `SEED_PASSWORD` (si
no se define, el script usa un valor de desarrollo); establece un valor seguro
en `.env` y no lo documentes ni lo reutilices en producción. El seed consulta
tablas del esquema heredado, por lo que también requiere una estructura
compatible con `server/seed.js`.

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

En Windows también se puede ejecutar `iniciar.bat`. Este archivo ayuda a
comprobar Node.js, npm, `.env`, dependencias y PostgreSQL antes de abrir el
navegador.

## Uso diario

1. Inicia PostgreSQL y el servidor con `npm start` o `iniciar.bat`.
2. Abre <http://localhost:3007/> e inicia sesión con una cuenta habilitada.
3. Usa el menú lateral para navegar y el menú de perfil para cerrar sesión.
4. Mantén abierta la terminal del servidor mientras uses el sistema.
5. El enlace **Portal de inquilinos** abre el portal privado; **Ver
   propiedades** lleva al portal público.

El acceso al portal público también está disponible desde la pantalla de
inicio de sesión y desde el menú de perfil, sin cerrar la sesión administrativa.
Los reportes PDF de operaciones incluyen el logotipo como marca de agua en
cada página. Los archivos CSV no admiten imágenes.

Al registrar una propiedad, el costo de adquisición es obligatorio y se guarda
separado del precio de venta o renta. Los inmuebles anteriores pueden conservar
su costo desconocido; se puede añadir al editarlos. El costo no se publica en
el portal ni crea una compra automáticamente. En los reportes PDF los costos
de compras se muestran separados de los cobros de ventas y rentas.

`npm run db:seed:compras-reportes` crea, sin duplicarlas, 200 compras
ficticias identificadas como `[DEMO]`; utiliza propiedades, agentes y
propietarios de demostración existentes y no cambia el estado de los inmuebles.

El endpoint `/api/health` solo comprueba que Node.js puede conectarse a
PostgreSQL; no valida que todas las tablas y columnas estén instaladas.

## Scripts disponibles

| Comando | Descripción |
| --- | --- |
| `npm start` | Inicia el servidor Express |
| `npm run dev` | Inicia el servidor con `node --watch` |
| `npm run db:migrate` | Ejecuta todas las migraciones SQL |
| `npm run db:seed` | Inserta datos de demostración y usuario administrador |
| `npm run db:seed:1500` | Ejecuta `bd/seed_1500.sql` con `psql`; requiere argumentos/conexión PostgreSQL |
| `npm run db:seed:clientes-comisiones` | Inserta un lote identificable de 1500 clientes y 1500 comisiones de demostración |

## Estructura principal

```text
bd/
  BD.postgresql.sql       Esquema heredado (ver nota de compatibilidad)
  migrations/             Migraciones incrementales 001–011
  seed_1500.sql           Datos de prueba del modelo anterior
server/
  app.js                  Servidor Express, archivos estáticos y errores
  db.js                   Pool de PostgreSQL
  migrate.js              Ejecutor de migraciones
  seed.js                 Datos y cuenta de demostración
  middleware.js           Autenticación y autorización
  routes/auth.js          Inicio de sesión
  routes/properties.js    API de propiedades
  routes/workflows.js     CRM, portales, reportes y operaciones
js/cruds/main.js          Lógica del panel interno
js/cruds/portal.js        Búsqueda y solicitudes públicas
js/cruds/tenant-portal.js Portal privado de inquilinos
estilo/style.css          Estilos de la interfaz
index.html                Panel interno
portal.html               Portal público
portal-inquilinos.html    Portal privado para inquilinos
iniciar.bat               Iniciador para Windows
```

## Datos y migraciones

Las tablas de negocio que utiliza el sistema incluyen:

| Grupo | Entidades y atributos relevantes |
| --- | --- |
| Acceso y equipo | `usuarios` (nombre, apellidos, correo, teléfono, contraseña hash, rol, activo, fechas) y `agentes` (usuario, licencia, fecha de ingreso). |
| Inmuebles | `categorias`; `propiedades` (categoría, responsable, título, descripción, precio, tipo de operación, superficie, habitaciones, baños, estacionamientos, estado, amenidades, imagen, coordenadas y fechas); `direcciones` (calle, número, colonia, ciudad, estado, código postal). |
| Clientes y negociación | `clientes`, `leads`, `citas`, `ofertas`, `coincidencias` y `contratos`. Conservan datos de contacto, preferencias, estados, puntuaciones, datos de las partes y condiciones de cada operación. |
| Operación y cobranza | `ventas`, `comisiones`, `rentas` y `pagos_renta`; enlazan inmueble, cliente, responsable, importes, periodos y estados. |
| Expediente y seguimiento | `expedientes_legales` guarda archivo, tipo MIME, tamaño y hash; `seguimientos_clientes` guarda notas/tareas; `notificaciones` conserva avisos y lectura; `acceso_documentos_inquilino` controla permisos por cliente y documento. |
| Mantenimiento y auditoría | `solicitudes_mantenimiento` enlaza inmueble/renta, solicitante, responsable, prioridad, estado, costos y fecha límite. `auditoria` conserva actor, acción, entidad, detalle y fecha; los disparadores también registran cambios de base de datos. |

El esquema del proyecto contiene las siguientes migraciones, que el ejecutor
aplica en orden alfabético:

| Migración | Cambio principal |
| --- | --- |
| `001_module_persistence.sql` | Almacenamiento y metadatos de expedientes; tabla de coincidencias. |
| `002_audit_triggers.sql` | Bitácora y disparadores de auditoría. |
| `003_contracts.sql` | Coordenadas y contratos con una copia de los datos de las partes e inmueble. |
| `004_workflow_extensions.sql` | Estado de comisiones y campo de detalle de auditoría. |
| `005_user_roles.sql` | Compatibilidad y normalización de roles. |
| `006_user_active_status.sql` | Estado activo de cuentas. |
| `007_property_media_coordinates.sql` | Medios y coordenadas de propiedades. |
| `008_pagination_indexes.sql` | Índices para consultas paginadas. |
| `009_action_schema_compatibility.sql` | Compatibilidad de columnas y valores de acciones de auditoría. |
| `010_customer_portals.sql` | Seguimiento de clientes, notificaciones y permisos de documentos de inquilinos. |
| `011_maintenance_requests.sql` | Solicitudes de mantenimiento e índices. |
| `013_commission_client.sql` | Vincula comisiones con clientes y marca los registros de demostración. Las comisiones anteriores conservan el cliente sin especificar. |
| `015_maintenance_priority.sql` | Prioridad automática por fecha límite, sin cambiar las prioridades manuales existentes. |
| `016_property_categories.sql` | Categorías adicionales para el registro de propiedades. |

`npm run db:seed:propiedades-categorias` agrega 50 propiedades ficticias por
cada una de las 18 categorías nuevas. Se identifican con `[DEMO]`, utilizan
domicilios de ejemplo y se publican como disponibles, por lo que aparecen en el
portal público y en las métricas. El comando requiere la migración 016 y un
vendedor de demostración activo; volver a ejecutarlo no duplica el lote.

`bd/BD.postgresql.sql` representa un modelo inicial anterior; no contiene por
sí solo todas las entidades/columnas consumidas por las rutas actuales. Las
migraciones no son una conversión integral de ese modelo. Prepara una base
compatible antes de ejecutar la aplicación o el seed. Los respaldos de
`backups/` son solo archivos de respaldo y pueden contener información
operativa: nunca los uses para inicializar una base pública o de demostración.

## API principal

Todas las rutas protegidas requieren un JWT:

```http
Authorization: Bearer <token>
```

El servidor responde en general con JSON. Los listados paginados incluyen
`data` y `meta`. Las solicitudes sin permiso devuelven `401` o `403`, según
corresponda. Los roles `admin`/`administrador` y `agente`/`vendedor` se
normalizan como equivalentes.

### Autenticación y salud

| Método y ruta | Acceso | Función / campos relevantes |
| --- | --- | --- |
| `GET /api/health` | Público | Comprueba conexión a la base de datos. |
| `POST /api/auth/login` | Público | Cuerpo: `correo`, `contrasena`. Devuelve `token` y `user`; el JWT vence en 8 horas. |

### Propiedades

| Método y ruta | Acceso | Función / campos relevantes |
| --- | --- | --- |
| `GET /api/properties` | Usuario autenticado | Lista inmuebles no retirados. Query: `page`, `limit`. |
| `POST /api/properties` | Vendedor o administrador | Crea propiedad y dirección; acepta categoría/operación, precio, características, dirección, imagen, amenidades y coordenadas. |
| `PUT /api/properties/:id` | Vendedor o administrador | Actualiza atributos permitidos; cambiar categoría requiere administrador. |
| `DELETE /api/properties/:id` | Vendedor o administrador | Retira del listado mediante marca lógica; no borra físicamente el registro. |

### Listados y resumen del equipo

Todas estas rutas requieren vendedor o administrador, excepto las listas
`users`, `sellers` y `commissions`, reservadas al administrador.

| Método y ruta | Función |
| --- | --- |
| `GET /api/workflows/summary` | Métricas y alertas del resumen. |
| `GET /api/workflows/options` | Opciones para formularios y relaciones. |
| `GET /api/workflows/activity` | Actividad reciente de auditoría. |
| `GET /api/workflows/schema` | Metadatos de tablas y columnas. |
| `GET /api/workflows/:resource` | Lista un recurso admitido: `clients`, `leads`, `visits`, `matches`, `documents`, `offers`, `sales`, `commissions`, `rentals`, `payments`, `maintenance`, `contracts`, `users`, `sellers` o `reports`. Acepta paginación y filtros implementados para el recurso. |
| `GET /api/workflows/contracts` | Lista contratos con relaciones y paginación. |

### Operaciones del equipo

| Método y ruta | Acceso | Función / campos relevantes |
| --- | --- | --- |
| `POST /api/workflows/clients` | Vendedor o administrador | Crea cliente: nombre, apellidos, correo, teléfono, CURP y domicilio. |
| `PATCH /api/workflows/clients/:id` | Vendedor o administrador | Actualiza el estado del cliente (`activo`). |
| `GET /api/workflows/clients/:id/history` | Vendedor o administrador | Devuelve perfil, historial comercial, seguimientos y documentos relacionados. |
| `POST /api/workflows/clients/:id/activities` | Vendedor o administrador | Crea nota/tarea: `tipo`, `contenido`, `fecha_limite`, `asignado_a`. |
| `PATCH /api/workflows/clients/:id/activities/:activityId` | Vendedor o administrador | Completa un seguimiento pendiente. |
| `POST /api/workflows/leads` | Vendedor o administrador | Crea prospecto y preferencias de búsqueda. |
| `POST /api/workflows/visits` | Vendedor o administrador | Crea cita con cliente, propiedad, fecha y motivo. |
| `POST /api/workflows/offers` | Vendedor o administrador | Registra oferta o contraoferta. |
| `POST /api/workflows/sales` | Administrador | Registra venta cerrada. |
| `POST /api/workflows/commissions` | Administrador | Recibe `id_propiedad`, `id_cliente` e `id_agente_vendedor`; guarda el 5 % del precio vigente de la propiedad como comisión pendiente. |
| `POST /api/workflows/rentals` | Vendedor o administrador | Registra contrato de renta. |
| `POST /api/workflows/payments` | Vendedor o administrador | Registra pago de renta y periodo. |
| `POST /api/workflows/maintenance` | Vendedor o administrador | Crea solicitud de mantenimiento. |
| `PATCH /api/workflows/:resource/:id` | Autenticado; permiso según recurso | Actualiza campos incluidos en la lista permitida del recurso, como estado, asignación, costos o fecha. |
| `POST /api/workflows/contracts` | Vendedor o administrador | Crea contrato de venta o renta con datos del inmueble y del cliente. |
| `GET /api/workflows/properties/:id/map` | Vendedor o administrador | Devuelve ubicación/mapa de una propiedad. |
| `GET /api/workflows/contracts/:id/map` | Vendedor o administrador | Devuelve ubicación asociada a un contrato. |
| `POST /api/workflows/matching/run` | Vendedor o administrador | Calcula y guarda coincidencias entre prospectos y propiedades. |
| `GET /api/workflows/notifications` | Vendedor o administrador | Lista notificaciones del usuario. |
| `PATCH /api/workflows/notifications/:id/read` | Vendedor o administrador | Marca una notificación como leída. |
| `POST /api/workflows/users` | Administrador | Crea usuario o administrador; contraseña inicial de al menos 12 caracteres. |
| `PATCH /api/workflows/users/:id` | Administrador | Actualiza datos permitidos del usuario o su estado activo. |
| `DELETE /api/workflows/users/:id` | Administrador | Elimina usuario si no es la propia cuenta y no hay restricciones de relaciones. |

Los campos admitidos por la actualización genérica son:

| Recurso | Campos editables por `PATCH` |
| --- | --- |
| `leads` | `estado`, `nivel_interes`, `id_agente` |
| `visits` | `estado`, `fecha_cita`, `motivo` |
| `offers` | `estado`, `notas` |
| `rentals` | `estado`, `fecha_fin` |
| `payments` | `estado`, `pagado_en` |
| `commissions` | `estado` |
| `maintenance` | `estado`, `asignado_a`, `costo_final` |

### Archivos y portales

| Método y ruta | Acceso | Función / campos relevantes |
| --- | --- | --- |
| `POST /api/workflows/documents` | Vendedor o administrador | Carga multipart con `archivo`, `id_propiedad` y `tipo`. Límite de 10 MB. |
| `GET /api/workflows/documents/:id/file` | Vendedor o administrador | Descarga un expediente autorizado. |
| `GET /api/workflows/public/properties` | Público | Lista inmuebles publicados; filtros y paginación. |
| `GET /api/workflows/public/properties/:id` | Público | Consulta ficha pública de un inmueble. |
| `POST /api/workflows/public/leads` | Público | Crea prospecto con preferencias, consentimiento e inmueble opcional. |
| `PATCH /api/workflows/clients/:id/credentials` | Administrador | Define contraseña para acceso del inquilino. Cuerpo: `password`. |
| `POST /api/workflows/clients/:id/documents/:documentId` | Administrador | Otorga permiso de consulta de documento a un cliente. |
| `DELETE /api/workflows/clients/:id/documents/:documentId` | Administrador | Revoca permiso de consulta de documento. |
| `GET /api/workflows/tenant/me` | Cliente autenticado | Devuelve rentas, pagos, contratos, documentos autorizados y reportes del cliente actual. |
| `POST /api/workflows/tenant/reports` | Cliente autenticado | Registra un reporte de mantenimiento para una renta activa propia. Recibe `id_renta`, `titulo`, `descripcion` y `prioridad`. |
| `GET /api/workflows/tenant/contracts/:id/file` | Cliente autenticado | Genera un PDF informativo del contrato de renta perteneciente al cliente autenticado. |
| `GET /api/workflows/tenant/documents/:id/file` | Cliente autenticado | Descarga un documento expresamente compartido con ese cliente. |

## Paginación y carga de datos

Los listados aceptan `?page=1&limit=50`; `page` predeterminado es 1, `limit`
predeterminado es 50 y su máximo es 200. La respuesta tiene esta forma:

```json
{
  "data": [],
  "meta": { "page": 1, "limit": 50, "total": 1234, "totalPages": 25 }
}
```

La interfaz interna descarga datos en lotes de 200 y muestra 20 filas por
página. Los filtros y búsquedas se aplican antes de la paginación.

## Expedientes legales

La carga de documentos acepta:

- PDF.
- JPEG, PNG y WebP.
- DOC y DOCX.

El límite máximo es de 10 MB por archivo. Los archivos se guardan en
PostgreSQL como contenido binario y se registra un hash SHA-256 para auditoría.

El servidor acepta estos MIME/tipos de archivo y rechaza los demás. Cuando se
superan 10 MB responde `413`; si el formato no está permitido responde `400`.

## Portales de clientes e inquilinos

El portal público está disponible en `/portal.html`. Permite filtrar inmuebles
por ubicación, operación, tipo, presupuesto y habitaciones; cada propiedad
disponible tiene una ficha propia y puede vincularse a una solicitud de contacto.

El portal privado está en `/portal-inquilinos.html`. Un administrador habilita
el acceso desde **Clientes → Acceso portal** y define una contraseña inicial de
al menos 12 caracteres. El inquilino puede consultar únicamente sus propias
rentas, pagos, contratos y documentos expresamente compartidos. Para compartir
un documento, abre el historial del cliente y selecciona **Dar acceso** junto
al documento asociado a una renta activa.

Las notificaciones del equipo se generan dentro del sistema para clientes
nuevos, visitas próximas, pagos pendientes, rentas próximas a vencer y tareas
de seguimiento. Se actualizan al abrir el menú y periódicamente mientras el
panel está abierto.

Al registrar una venta o una renta para un cliente cuyo correo coincide con el
de un cliente potencial, su estado cambia automáticamente a **CONVERTIDO**.
También se puede actualizar manualmente desde la tabla de clientes potenciales.

La migración `010_customer_portals.sql` crea las tablas de seguimiento,
notificaciones y permisos de documentos; se aplica con `npm run db:migrate`.

## Mantenimiento, cobranza y renovaciones

En **Mantenimiento** se pueden registrar solicitudes para una propiedad,
relacionarlas opcionalmente con una renta, asignar un responsable, definir
prioridad y fecha límite, y actualizar su estado y costo final. Las solicitudes
se agrupan por prioridad. En modo automático, la prioridad es normal sin fecha
o con más de siete días restantes, alta a siete días o menos y urgente a un
día o menos (incluidas las vencidas). Se calcula al consultar la información,
también para solicitudes completadas o canceladas. Las solicitudes existentes
conservan su prioridad manual; en **Actualizar estado** se puede cambiar la
prioridad, activar o desactivar el modo automático y modificar la fecha límite.
Los reportes de inquilinos conservan la prioridad manual que eligen al crearlos.
Para habilitar esta función aplica la migración `015_maintenance_priority.sql`.

**Cobranza y renovaciones** reúne pagos de renta y contratos activos. Muestra
adeudos vencidos, cobros previstos para los próximos 30 días y contratos que
vencen dentro de los próximos 60 días. Los pagos se pueden marcar como pagados;
el sistema registra la fecha de pago y habilita la descarga de un recibo
imprimible. Para habilitar solicitudes de mantenimiento, aplica también la
migración `011_maintenance_requests.sql` mediante `npm run db:migrate`.

Estados de mantenimiento: `pendiente`, `en_proceso`, `completada` y
`cancelada`. El estado de pago puede ser `PENDIENTE`, `PAGADO` o `VENCIDO`;
cuando se cambia a `PAGADO`, el servidor registra la fecha de pago.
Seguimientos de clientes usan tipo `nota` o `tarea` y estado `pendiente` o
`completada`.

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

## Publicar cambios

Antes de crear un commit:

```powershell
git status --short
git diff --check
```

Revisa y agrega únicamente los archivos deseados. No incluyas `.env`,
`node_modules`, `backups/`, archivos con datos reales ni contraseñas. Los
archivos de configuración de ejemplo no sustituyen la configuración segura del
entorno de despliegue.

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

### El formulario de acceso no aparece

El panel conserva el token en el almacenamiento local del navegador para
mantener la sesión entre reinicios. Selecciona **Salir** en el menú de sesión
para mostrar nuevamente el acceso. Si el inicio de sesión rechaza las
credenciales, revisa el mensaje del formulario; `GET /api/health` solo confirma
la conexión con la base y no valida una cuenta. No ejecutes `npm run db:seed`
para recuperar el acceso: el seed puede cambiar la contraseña de su cuenta.

### No se puede eliminar un usuario

La aplicación impide eliminar la propia cuenta y usuarios con registros
relacionados. En esos casos usa **Cambiar estado** y selecciona **Inactivo**.

## Cargar 1500 registros de prueba

Para el modelo actual, después de aplicar las migraciones, ejecuta
`npm run db:seed:clientes-comisiones` en una base de pruebas. Requiere al menos
una propiedad llamada `Propiedad Demo...` y un vendedor activo con correo
`demo...@example.test`. El comando es repetible: conserva exactamente 1500
clientes del lote y una comisión demo por cada uno, sin duplicarlas. Estas
comisiones afectan los totales financieros y no deben usarse como datos reales.

El script `bd/seed_1500.sql` inserta datos de prueba en `usuarios`, `agentes`,
`propietarios`, `direcciones`, `propiedades`, `compras` y `operaciones`. Está
basado en el modelo heredado y no debe usarse como sustituto del esquema
compatible requerido por las rutas actuales. Úsalo solo en una base desechable
que cumpla ese esquema y que no contenga datos reales.

```powershell
npm run db:seed:1500 -- -U postgres -d bienes_raices
```

El script usa el prefijo `demo1500` para identificar los registros generados.
No se documentan contraseñas de demostración; revisa el script y cambia
cualquier credencial de prueba antes de habilitar una cuenta.

## Licencia

Este repositorio no declara una licencia de código abierto. No redistribuyas
el código sin autorización de sus propietarios.
