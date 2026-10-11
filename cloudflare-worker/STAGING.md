# Entorno remoto de pruebas

El despliegue `staging` publica el catálogo y el panel junto con una API propia en
`snapmovienow-edge-staging.<subdominio-de-la-cuenta>.workers.dev`. La URL concreta
se obtiene del despliegue; no se debe dar por existente antes de comprobarla.

## Separación

- Entrada exclusiva `src/staging.mjs`, assets exclusivos `artifacts/staging-web`.
- El frontend llama a `/api` en su propio origen. No acepta destinos de la URL.
- Cookies de sesión `Secure`, `HttpOnly`, `SameSite=Strict`, con control de origen.
- La política de conexión del navegador impide llamar a la API de producción.
- Tres namespaces SQLite del Worker de pruebas; sin bindings a otro script.
- Sin rutas de producción, copias programadas ni comprobaciones automáticas.
- Los avisos no se envían aunque se guarde una configuración ficticia de correo.
- Los usuarios desconocidos no se autentican contra el proveedor de producción.
- Un aviso visible identifica las páginas; se desactiva su indexación.
- Usar únicamente cuentas, servidores y archivos ficticios. No importar copias,
  claves, cuentas del proveedor ni contraseñas de producción.

## Primera publicación

Desde la cuenta Cloudflare propietaria del Worker de producción, crear un Worker
**nuevo** llamado exactamente `snapmovienow-edge-staging`, conectado al repositorio
`snapmovienow/snapmovienow.github.io`, rama `main`, raíz `cloudflare-worker`.
El comando de despliegue es `npm run deploy:staging`. El bloqueo Quality comprueba
el mismo commit antes de publicar. No modificar el Worker `snapmovienow-edge`.

El Worker nuevo requiere sus propios secretos `TICKET_SECRET` y
`ADMIN_SETUP_SECRET`, largos y aleatorios. No reutilizar los secretos existentes.
Los secretos se introducen en Cloudflare, nunca en el repositorio ni en el chat.
No configurar credenciales de correo ni del proveedor real.

La alternativa CLI, con una sesión Cloudflare ya autorizada, es:

```sh
cd cloudflare-worker
npx wrangler secret put TICKET_SECRET --env staging
npx wrangler secret put ADMIN_SETUP_SECRET --env staging
npm run deploy:staging
```

Abrir `/admin.html` en el origen publicado y crear un administrador exclusivo de
pruebas con la clave de activación de ese entorno. Las cuentas de producción no
deben funcionar. Las pruebas de recuperación o capacidad posteriores se realizan
únicamente allí, con cuentas ficticias.

## Comprobación

Desde la raíz del repositorio:

```sh
npm run test:staging
npm run build:staging
node scripts/check-staging.mjs https://snapmovienow-edge-staging.SUBDOMINIO.workers.dev
```

El primer comando usa el runtime real workerd y SQLite local: prueba los assets,
el enrutamiento de API, cookies, rechazo de origen de producción, usuario ficticio,
copia y restauración aislada y ausencia de solicitudes al proveedor/correo.
El segundo es una compilación sin publicación. El último verifica el entorno
remoto sin modificar cuentas ni configuración. Una compilación local correcta no
prueba que exista un despliegue remoto.

Estado al preparar este cambio: comprobación local realizada; creación y
verificación remotas pendientes del acceso autenticado a Cloudflare.
