# Catálogo SaaS con Supabase

Aplicación web multitienda para crear y administrar catálogos digitales. Cada negocio dispone de un catálogo público, gestión de productos, categorías, pedidos y clientes, personalización de la tienda y envío de pedidos por WhatsApp.

> Estado: MVP en preparación para producción. La aplicación compila correctamente, pero antes de publicarla deben resolverse los puntos de seguridad y pruebas descritos en [Estado preproducción](#estado-preproducción).

## Funcionalidades

### Sitio público

- Página de inicio y acceso para administradores.
- Catálogo público por `slug` de tienda.
- Búsqueda, categorías, paginación y detalle de productos.
- Productos con imágenes, videos, variantes, inventario, precios mayoristas y descuentos.
- Carrito de compras y cálculo de envío.
- Campos personalizados durante el checkout.
- Creación del pedido y apertura de WhatsApp para confirmarlo.
- URL compartible `/c/:slug` con metadatos dinámicos para redes sociales.

### Panel de administración

- Registro, inicio de sesión, recuperación de contraseña y cierre de sesión.
- Registro internacional para Latinoamérica con país, bandera y prefijo automático de WhatsApp.
- Dashboard con información general de la tienda.
- Gestión de productos, variantes, imágenes, videos y ordenamiento.
- Importación de productos desde Excel.
- Gestión de categorías.
- Gestión y seguimiento de pedidos.
- Base de clientes.
- Configuración visual, datos comerciales, envíos y checkout.
- Consulta del estado de la suscripción.

### Superadministración

- Listado y búsqueda de tiendas.
- Auditoría de datos del propietario.
- Activación y desactivación de tiendas.
- Revisión del estado de suscripción.

## Tecnologías

- React 19 y TypeScript.
- Vite 6.
- React Router 7 con `HashRouter`.
- Supabase Auth y PostgreSQL.
- Cloudflare R2 mediante la API compatible con S3.
- AWS SDK para las operaciones con R2.
- `dnd-kit` para ordenamiento mediante arrastrar y soltar.
- SheetJS (`xlsx`) para importar productos.
- Vercel Functions para endpoints del servidor.

## Arquitectura

```text
api/                 Funciones serverless para Vercel
components/
  admin/             Componentes del panel administrativo
  auth/              Protección de rutas
  catalog/           Componentes del catálogo público
  layouts/           Layouts públicos y administrativos
context/             Estado global de autenticación
helpers/             Precios, variantes, imágenes, videos y enlaces
interfaces/          Interfaces usadas por las vistas
lib/                 Adaptadores de Supabase, autenticación y R2
public/              Recursos públicos
server/              Lógica compartida por Vite y funciones serverless
types/               Tipos del dominio
views/
  admin/             Módulos del administrador
  public/            Inicio y catálogo público
  superadmin/        Administración global de tiendas
App.tsx              Mapa de rutas
vite.config.ts       Configuración de Vite y API local
vercel.json          Rewrites para el despliegue
```

El archivo `lib/supabaseFirestore.ts` proporciona una capa de compatibilidad con una API similar a Firestore, pero persiste los datos en tablas de Supabase.

## Rutas

| Ruta | Acceso | Descripción |
| --- | --- | --- |
| `/#/` | Público | Página de inicio |
| `/#/:slug` | Público | Catálogo de una tienda |
| `/c/:slug` | Público | Preview compartible con metadatos sociales |
| `/#/admin/login` | Público | Inicio de sesión |
| `/#/admin/register` | Público | Registro de una tienda |
| `/#/admin` | Autenticado | Dashboard |
| `/#/admin/products` | Autenticado | Productos |
| `/#/admin/categories` | Autenticado | Categorías |
| `/#/admin/orders` | Autenticado | Pedidos |
| `/#/admin/customers` | Autenticado | Clientes |
| `/#/admin/subscription` | Autenticado | Suscripción |
| `/#/admin/settings` | Autenticado | Configuración |
| `/#/system/stores` | Superadministrador | Tiendas registradas |

## Requisitos

- Node.js 20 o superior.
- npm 10 o superior.
- Proyecto de Supabase con Auth, tablas y políticas RLS configuradas.
- Bucket público de Cloudflare R2.
- Cuenta de Vercel o un servidor compatible con las funciones de `api/`.

## Variables de entorno

Crea un archivo `.env.local` en la raíz. Nunca subas este archivo ni valores reales al repositorio.

```dotenv
# Variables públicas incorporadas al frontend
VITE_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
VITE_R2_PUBLIC_BASE_URL=https://TU_DOMINIO_PUBLICO_R2

# Variables exclusivas del servidor
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
R2_ACCOUNT_ID=TU_ACCOUNT_ID
R2_ACCESS_KEY_ID=TU_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=TU_SECRET_ACCESS_KEY
R2_BUCKET_NAME=TU_BUCKET
R2_PUBLIC_BASE_URL=https://TU_DOMINIO_PUBLICO_R2

# Opcionales: permiten usar endpoints externos
VITE_R2_UPLOAD_ENDPOINT=/api/r2-upload
VITE_R2_DELETE_ENDPOINT=/api/r2-delete
```

Las variables con prefijo `VITE_` son visibles en el navegador. Nunca uses ese prefijo para `SUPABASE_SERVICE_ROLE_KEY` ni para credenciales de R2.

## Instalación local

```bash
npm install
npm run dev
```

La aplicación se abre por defecto en `http://localhost:3000`.

El servidor de desarrollo emula localmente los endpoints de registro, carga y eliminación de archivos, y preview compartido. Para probar correctamente los flujos se necesitan credenciales válidas de Supabase y R2.

## Scripts

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia Vite en modo desarrollo |
| `npm run build` | Genera la compilación optimizada en `dist/` |
| `npm run preview` | Sirve localmente la compilación |
| `npx tsc --noEmit` | Ejecuta la comprobación de tipos |
| `npm audit --omit=dev` | Revisa vulnerabilidades de producción |

Actualmente no existen scripts de lint ni una suite automatizada de pruebas.

## Compilación

```bash
npx tsc --noEmit
npm run build
npm run preview
```

No subas `node_modules/`, `dist/`, `.env` ni `.env.local` al repositorio.

## Despliegue en Vercel

1. Importa el repositorio en Vercel.
2. Configura todas las variables de entorno en Project Settings.
3. Usa `npm run build` como comando de compilación.
4. Usa `dist` como directorio de salida.
5. Despliega y comprueba las funciones dentro de `/api`.
6. Comprueba que el rewrite `/c/:slug` genere el preview social correcto.

`vercel.json` dirige `/c/:slug` hacia `/api/catalog-share?slug=:slug`. Las rutas de la SPA usan hash, por lo que no requieren rewrites adicionales.

## Modelo de datos esperado

La aplicación hace referencia a estas tablas principales:

- `profiles`
- `stores`
- `subscriptions`
- `subscription_payments`
- `products`
- `product_images`
- `product_videos`
- `product_options`
- `product_variants`
- `categories`
- `orders`
- `order_items`
- `clients`

El esquema SQL y las políticas RLS no se encuentran actualmente versionados en este repositorio. Antes de preparar otro entorno deben exportarse como migraciones de Supabase.

## Almacenamiento de archivos

Las imágenes y videos se guardan en Cloudflare R2. El frontend construye una clave de objeto y utiliza:

- `PUT /api/r2-upload`
- `POST /api/r2-upload-url` para obtener una URL temporal; los archivos mayores a 4 MB se suben directamente a R2
- `POST /api/r2-delete`

La URL pública se forma con `R2_PUBLIC_BASE_URL`. El bucket debe permitir lectura pública únicamente si el catálogo necesita mostrar los archivos directamente.

Para la subida directa, configura CORS en el bucket R2 permitiendo `PUT` y el header
`Content-Type` desde el dominio de producción y desde `http://localhost:5173`. Sin esta
regla, el navegador bloqueará videos mayores a 4 MB aunque la URL temporal sea válida.
La migración `202607200001_atomic_product_children.sql` también debe aplicarse en
Supabase antes del despliegue para guardar imágenes, videos, opciones y variantes en
una sola transacción.

## Seguridad

- La `anon key` de Supabase puede estar en el frontend; la seguridad depende de políticas RLS correctas.
- La `service_role key` omite RLS y solo puede existir en el servidor.
- Las credenciales de R2 solo pueden existir en el servidor.
- Las operaciones administrativas deben validarse también en el backend, no únicamente ocultarse mediante rutas React.
- Antes de aceptar archivos se deben validar sesión, propiedad de la tienda, tipo MIME, extensión y tamaño.
- El endpoint de activación de suscripciones debe estar protegido por un webhook firmado o una sesión de superadministrador validada en servidor.

## Estado preproducción

Última revisión técnica: julio de 2026.

### Verificado

- La comprobación de TypeScript termina sin errores.
- La compilación de producción termina correctamente.
- Las rutas principales responden desde el servidor local.
- Los módulos públicos y administrativos se incluyen en la compilación.

### Pendiente antes del lanzamiento

- Proteger `r2-upload` y `r2-delete` con autenticación y validación de propiedad.
- Rehacer o proteger `activate-subscription`; actualmente no debe exponerse públicamente.
- Implementar y versionar migraciones y políticas RLS de Supabase.
- Sustituir la autorización del superadministrador basada únicamente en un email del frontend.
- Resolver las vulnerabilidades altas reportadas en `react-router`, `turbo-stream` y `xlsx`.
- Añadir pruebas unitarias, de integración y end-to-end.
- Añadir lint, cobertura y un pipeline de CI.
- Probar registro, login, CRUD, pedidos, WhatsApp, carga de archivos y suscripciones en staging.
- Dividir el bundle inicial mediante carga diferida; actualmente supera 1 MB sin comprimir.
- Eliminar o corregir la referencia a `/index.css`, ya que el archivo no existe.
- Mantener las credenciales fuera de Git y proporcionar únicamente un `.env.example` sin valores reales.

## Checklist para publicar en Git

- [ ] Confirmar que `.env` y `.env.local` no estén incluidos en el commit.
- [ ] Rotar cualquier credencial que haya sido compartida o versionada anteriormente.
- [ ] Añadir migraciones de Supabase y documentación de RLS.
- [ ] Ejecutar `npx tsc --noEmit`.
- [ ] Ejecutar `npm run build`.
- [ ] Ejecutar `npm audit --omit=dev`.
- [ ] Revisar que no existan llaves, tokens, contraseñas o datos personales en el historial.
- [ ] Probar el despliegue en un entorno de staging.

## Licencia

InteliaSB, se reservan todos los derechos.
