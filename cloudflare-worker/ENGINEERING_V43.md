# SNAP v43: funcionamiento, validación y operación

## Estado de publicación

El fallo de Cloudflare del 9 de octubre se identificó en las capturas del build `52032803-3f33-4501-bfc0-645e1aaf8e4c`: la instalación ejecutaba `npm clean-install --progress=false` desde `cloudflare-worker`, donde faltaba `package-lock.json`. El lockfile de la raíz servía para Quality, pero no para esa carpeta de despliegue.

Se añadió el lockfile propio del Worker, conservando Wrangler 4.149.0 y las versiones e integridades ya fijadas en la raíz. Quality instala y compila también desde la carpeta de Cloudflare para detectar este problema antes de futuras publicaciones. El commit `ac15bf8bf39832c4b831e9b57412cefce54a969d` pasó Quality y Cloudflare; `https://api.snaptvnow.com/health` ya responde con v43.

MFA, copias automáticas, sincronización remota y métricas agregadas están disponibles en ese servidor. La publicación del Worker no inscribe MFA en el teléfono del propietario; debe configurarse desde el panel. El panel v43.3 muestra la última copia y el estado del intento, permite crear una copia con reautenticación y comprobar su integridad sin restaurar. La primera ejecución automática en producción queda por comprobar después del cron; la validación local de cifrado/restauración no certifica esa ejecución en producción.

La actualización v43.5 añade cambio de contraseña y reemplazo de la clave del autenticador sin desactivar la protección durante la inscripción. Ver `VERIFICATION-v43.5.md` en la raíz para pruebas y pasos privados; renovar solo recuperación conserva la clave anterior. Android 1.0.11 está en main y pasó 142 pruebas; su firma espera la revisión del entorno production de GitHub.

## Cambios listos

- Web y panel separados en scripts y módulos. Configuración de API central en `app-config.js`; la API pública es `https://api.snaptvnow.com`.
- La adquisición del catálogo está separada en `catalog-loader.js`, con API/permisos de entrada y listas/avisos de salida, sin acceso al DOM, sesiones o reproductor. Respuestas nulas, objetos de error y elementos inválidos de un proveedor ya no interrumpen el inicio ni la recuperación de sesión: se conserva el catálogo válido y se muestra un aviso parcial. La persistencia/transporte de sesión está en `session-client.js` y la guía en `channel-guide.js`; la presentación principal y parte del reproductor todavía comparten `app.js`.
- MFA TOTP para el administrador, semilla cifrada AES-GCM y ocho códigos de recuperación de un solo uso. Activar, desactivar MFA o renovar recuperación revoca las sesiones administrativas anteriores. Renovar exige contraseña actual y un código TOTP nuevo; los códigos de recuperación no autorizan esta operación. El reemplazo es transaccional, conserva el autenticador, invalida los ocho códigos anteriores, almacena solo hashes y registra el cambio sin secretos. La inscripción muestra un contador de diez minutos, borra la clave vencida y presenta los errores junto al formulario. Una ventana adaptada al móvil conserva los códigos hasta que el administrador confirma que los guardó; el sondeo del panel se detiene mientras tanto.
- Historial administrativo acotado: inicios, usuarios, servidores, configuración Xtream, MFA y copias. No guarda contraseñas, tokens, URLs de reproducción ni diagnósticos completos.
- Copias lógicas cifradas de usuarios/permisos/vencimientos y conexiones. Exportación y restauración requieren contraseña actual y MFA cuando está activado. Una copia alterada, de otra clave o de otro entorno es rechazada. Vista previa y texto RESTAURAR antes de reemplazar datos. La restauración cambia las identidades de clientes y cierra sus accesos anteriores; mantiene el administrador y su MFA.
- Cron diario a las 05:17 UTC: últimas tres copias cifradas en el servidor, divididas en bloques pequeños para respetar el límite por valor de almacenamiento. Descarga externa desde Seguridad y recuperación. No se incluyen sesiones, reservas, progreso ni configuración MFA en estas copias.
- Favoritos, progreso de películas/episodios e idiomas sincronizados por identidad de cliente. Las preferencias locales tienen clave por usuario; eliminaciones conservan marcas para que un dispositivo antiguo no las reviva. Se recupera al volver al primer plano y se conservan cambios locales sin red. Las respuestas tardías de otra sesión se ignoran.
- Panel de salud: últimas 24 horas por servidor/tipo/etiqueta de calidad; inicios, límite superior de p95, tiempo cargando, cortes, errores y bytes de segmentos HLS medidos. Los datos no identifican clientes. Las alertas son orientativas: al menos cinco inicios para demora/cortes, o cinco fallos de arranque incluso sin inicios. Los informes se reintentan con ID deduplicado y se separan por plataforma.
- Guía TV: hasta 24 programas del canal seleccionado cuando el proveedor ofrece EPG. Comparte la restricción de adultos; su fallo no detiene la señal.
- CSP, política de referencia y cabeceras contra detección incorrecta de tipos; HLS y Movi con versiones e integridad fijadas. JSON de entrada acotado a 4 MB. Se conserva el diagnóstico manual y el modo HLS de segmentos completos que corrige el audio MPEG.

## Activación por el propietario

El propietario confirmó la activación TOTP y un nuevo inicio de sesión con Google Authenticator el 9 de octubre de 2026. Esa confirmación corresponde al panel SNAP; no demuestra que las cuentas de GitHub o Cloudflare tengan MFA. La renovación de recuperación exige una acción privada del propietario en el panel y un nuevo inicio de sesión posterior.

`app.snaptvnow.com` está configurado en GitHub Pages con `CNAME` en la raíz. DNS público, certificado HTTPS, redirección HTTP → HTTPS, portada, panel y configuración de API se comprobaron el 9 de octubre. El TXT de verificación de la organización GitHub debe conservarse. El panel se abre en `https://app.snaptvnow.com/admin.html`; `panel.snaptvnow.com` no tiene hosting confirmado y no debe anunciarse como disponible.

En el dominio propio la web y el panel solicitan sesiones mediante cookies `HttpOnly; Secure; SameSite=Strict`, con cookies host-only en `api.snaptvnow.com`. El almacenamiento del navegador conserva el marcador `cookie`, sin token secreto. Se comprobaron CORS para el origen permitido y el rechazo de la lectura sin sesión; el propietario confirmó acceso real. La inspección de cookies de una sesión real del propietario no se realizó. El dominio antiguo de GitHub Pages redirige al nuevo; los clientes nativos/Xtream conservan el protocolo existente.

Para renovar códigos expuestos o perdidos sin retirar MFA:

1. Abrir **Seguridad y recuperación** desde una sesión válida.
2. Introducir contraseña actual y los seis dígitos nuevos del autenticador. Un código usado para entrar ya no sirve; esperar al siguiente.
3. Pulsar **Renovar códigos de recuperación**. Los códigos anteriores quedan invalidados inmediatamente; el autenticador se conserva y las sesiones se revocan.
4. Guardar los ocho códigos nuevos de forma privada. No fotografiarlos para compartirlos ni enviarlos por chat. Pulsar **Ya guardé los códigos; iniciar sesión**.
5. Volver a entrar con el siguiente código del autenticador y comprobar que aparece **Segundo factor activado**. Reemplazar el respaldo de recuperación anterior.

Para una nueva migración de Pages, verificar primero la propiedad del dominio, guardar el dominio personalizado en GitHub Pages (esto publica `CNAME`), configurar después el CNAME DNS hacia `snapmovienow.github.io`, esperar el certificado y activar **Enforce HTTPS**. `WEB_ORIGINS` ya contempla el hostname actual. No cambiar ni retirar el dominio API durante este procedimiento.

Para el entorno remoto de pruebas, desde `cloudflare-worker`:

```sh
npx wrangler secret put TICKET_SECRET --env staging
npx wrangler secret put ADMIN_SETUP_SECRET --env staging
npm run deploy:staging
```

Usar secretos distintos, cuentas ficticias y servidores de prueba. El nombre `snapmovienow-edge-staging`, los bindings propios, las rutas vacías y la ausencia de cron lo separan de producción. Ajustar `env.staging.vars.WEB_ORIGINS` al frontend de pruebas antes de una prueba remota. La separación se ha probado con dos namespaces SQLite del motor workerd local; no se afirma que el Worker remoto ya esté creado.

## Validación y entrega

Desde la raíz del repositorio:

```sh
npm ci
npm test
npm run test:platform
npm run test:storage
npx playwright install --with-deps chromium
npm run test:browser
node tests/browser-ui-runtime.mjs
npm run build:worker
npm run build:staging
```

`npm test` ejecuta todas las regresiones, incluyendo vectores publicados RFC 6238, compatibilidad de sesiones nativas, restricciones de adultos, reproducción/Range/cancelación, sincronización y recuperación. `test:platform` utiliza el módulo de producción en workerd/SQLite real con dos entornos y cuentas ficticias; restaura únicamente esos datos de prueba. `test:storage` puede medir 100/250/500/1000 reservas sintéticas; con `SMN_SAFETY_ONLY=1` valida las invariantes sin repetir la carga.

GitHub Actions Quality ejecuta regresiones, aislamiento workerd, compilaciones, invariantes SQLite y pruebas de Chromium. `postinstall` de esta carpeta ejecuta `scripts/deploy-guard.mjs`: dentro de Workers Builds espera hasta doce minutos a que Quality apruebe el mismo SHA y la misma rama, con evento push y el workflow exacto. Una ejecución fallida/cancelada, un checkout diferente o modificado, una respuesta imposible de comprobar o el vencimiento de la espera bloquean la instalación y por tanto la publicación, incluso con el comando actual `npx wrangler deploy`. Usa la API pública de GitHub sin credenciales ni secretos nuevos. Un bloqueo por red o límite de la API permite reintentar el build cuando se resuelva; no aprueba por omisión.

Fuera de Workers Builds, la instalación normal no espera a Quality: hacerlo dentro del propio job produciría una espera circular. Los comandos manuales `npm run deploy` y `npm run deploy:staging` exigen la misma aprobación antes de las regresiones locales y Wrangler. La instalación automática debe conservar los scripts npm habilitados. Esta protección no impide que un administrador cambie el comando, desactive los scripts o publique deliberadamente por otra vía; las reglas de protección de ramas requieren ajustes adicionales de la cuenta.

GitHub Pages todavía publica en paralelo mediante su mecanismo nativo. Exigir Quality antes de publicar también el frontend requiere configurar Pages con GitHub Actions y un job de publicación dependiente de Quality; ese ajuste y las reglas de protección de ramas no están accesibles con la conexión actual.

La evidencia de navegador se puede generar con `SMN_LIVE_AUDIO_REPORT=artifacts/live-audio.json`. Reproduce el problema de MPEG Layer III con HLS.js 1.6.15 usando una señal sintética, comprueba avance/decodificación y audio continuo con segmentos completos y también comprueba AAC. No certifica todas las señales del proveedor ni un teléfono físico.

## Recuperación

1. Revisar «Copia cifrada» en el panel: crear una copia si hace falta con contraseña y código nuevo MFA, seleccionar y verificarla, y comprobar la fecha de la tarea diaria (05:17 UTC). La verificación comprueba integridad, formato y entorno; no es un ensayo de restauración. Mantener una descarga cifrada fuera del servidor y la clave TICKET_SECRET en almacenamiento seguro separado. Rotar o perder la clave impide leer copias antiguas y la semilla MFA; no rotarla sin plan de migración.
2. En el panel, seleccionar archivo, revisar fecha/cantidad de usuarios/servidores, introducir contraseña y un nuevo código MFA o recuperación y escribir RESTAURAR.
3. Los clientes deben volver a iniciar sesión. Revisar usuarios/permisos, actualizar el inventario del proveedor y probar catálogo y una señal autorizada.
4. Las copias contienen el estado lógico a su fecha. No restauran el administrador, códigos MFA, historial, progreso o reservas. Las conexiones guardadas necesitan que el proveedor siga activo; el inventario y sus tickets expiran y deben revalidarse.
5. Recuperar un administrador sin MFA requiere un código de recuperación o acceso del propietario a Cloudflare. No se añadió una puerta de acceso pública. La recuperación completa de SQLite con Cloudflare debe evaluarse por separado porque también puede restaurar sesiones y secretos antiguos.

Para volver al reproductor anterior, el commit estable v42 es `202728872aa9df5fde7500c2da3a456d64a9a05c`. Revisar primero los cambios de datos/MFA: revertir código v43 después de activar MFA quitaría su verificación en versiones anteriores. Preferir corregir hacia adelante; desactivar MFA con reautenticación antes de un retorno autorizado a código sin soporte MFA.

## Capacidad y coste

Las reservas, los vídeos y las cuentas del proveedor son mediciones diferentes. Las pruebas de 1000 reservas no prometen 1000 señales simultáneas. El límite del proveedor se conserva, incluyendo duplicados, cuentas externas, vencimientos y suspensiones.

El panel aporta cifras de uso y problemas de la web. Los bytes HLS incluyen segmentos precargados/reintentados; excluyen Android, Movi, playlists, claves y otras peticiones. Android aporta tiempos/cortes/errores por separado, sin bytes medidos. No equivalen al ancho de banda facturado por Cloudflare ni a un bitrate exacto del programa.

Para planificar un escenario, usar `node scripts/capacity-plan.mjs --viewers 100 --mbps 6 --hours 2 --provider-slots 90`. Presenta tráfico estimado decimal y plazas faltantes. Comparar con mediciones reales y la factura de Cloudflare antes de dimensionar costes. No hay precios ni tarifas supuestos.

Queda pendiente una prueba gradual con señales y cuentas de prueba autorizadas, presupuesto de tráfico y acceso a métricas/facturación del alojamiento. No se lanzó carga contra producción ni se ocuparon conexiones reales del proveedor.

## Android

La integración nativa está en el repositorio `juancanta89-tech/SnapTvNow`: favoritos, progreso, idiomas, aislamiento por cuenta/servicio, HTTPS, métricas agregadas y guía ampliada. Ver VERIFICATION-v43.4.md para evidencia de compilación y límites. Las pruebas físicas y firma/distribución de producción requieren un dispositivo y la clave existente.

## Pages sujeto a Quality

El workflow está preparado en `.github/workflows/pages-after-quality.yml`. El propietario debe cambiar Source a GitHub Actions y activar la variable de Actions `PAGES_ACTIONS_ENABLED=true`. Mientras no lo haga, Pages continúa su publicación nativa en paralelo; el Worker ya exige Quality. El artefacto nuevo excluye código de servidor, pruebas, dependencias e informes.

## Ensayo remoto de recuperación SQLite

PITR de Cloudflare recupera SQLite/KV de los últimos 30 días y no funciona en desarrollo local. Ensayar únicamente en un objeto staging sin datos de clientes: guardar `ctx.storage.getCurrentBookmark()`, crear un usuario ficticio, guardar otro bookmark, alterar/borrar y pedir `ctx.storage.onNextSessionRestoreBookmark(bookmark)`; registrar el bookmark de retorno que devuelve y reiniciar el objeto mediante `ctx.abort()`. Comprobar desde una sesión nueva el usuario/permiso/vencimiento y cerrar sesiones restauradas antes de conectar un cliente. Volver al bookmark inicial para limpiar el ensayo. No se añadió una ruta pública de recuperación física.

Antes de un incidente real conservar exportación cifrada y bookmark actuales, decidir el instante y registrar la autorización; una recuperación física puede traer sesiones, configuración y secretos antiguos. La prueba local de restauración lógica no demuestra PITR remoto. Fuente: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/.
