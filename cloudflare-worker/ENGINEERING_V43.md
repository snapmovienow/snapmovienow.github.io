# SNAP v43: funcionamiento, validación y operación

## Estado de publicación

El fallo de Cloudflare del 9 de octubre se identificó en las capturas del build `52032803-3f33-4501-bfc0-645e1aaf8e4c`: la instalación ejecutaba `npm clean-install --progress=false` desde `cloudflare-worker`, donde faltaba `package-lock.json`. El lockfile de la raíz servía para Quality, pero no para esa carpeta de despliegue.

Se añade el lockfile propio del Worker, conservando Wrangler 4.149.0 y las versiones e integridades ya fijadas en la raíz. Quality instala y compila también desde la carpeta de Cloudflare para detectar este problema antes de futuras publicaciones. Comprobar el resultado del build y `https://api.snaptvnow.com/health` después del commit: la API debe reportar v43. Al iniciar esta corrección aún reportaba v40.

MFA, copias automáticas, sincronización remota y métricas agregadas requieren que ese despliegue termine correctamente. El frontend conserva el funcionamiento local mientras espera y habilita las nuevas operaciones al recargar después de actualizar el servidor. La publicación del Worker no inscribe MFA en el teléfono del propietario; debe configurarse desde el panel. La primera copia automática queda por comprobar después de ejecutarse el cron.

## Cambios listos

- Web y panel separados en scripts y módulos. Configuración de API central en `app-config.js`; la API pública es `https://api.snaptvnow.com`.
- MFA TOTP para el administrador, semilla cifrada AES-GCM y ocho códigos de recuperación de un solo uso. Activar o desactivar MFA revoca las sesiones administrativas anteriores. Una ventana conserva los códigos hasta que el administrador confirma que los guardó; el sondeo del panel se detiene mientras tanto.
- Historial administrativo acotado: inicios, usuarios, servidores, configuración Xtream, MFA y copias. No guarda contraseñas, tokens, URLs de reproducción ni diagnósticos completos.
- Copias lógicas cifradas de usuarios/permisos/vencimientos y conexiones. Exportación y restauración requieren contraseña actual y MFA cuando está activado. Una copia alterada, de otra clave o de otro entorno es rechazada. Vista previa y texto RESTAURAR antes de reemplazar datos. La restauración cambia las identidades de clientes y cierra sus accesos anteriores; mantiene el administrador y su MFA.
- Cron diario a las 05:17 UTC: últimas tres copias cifradas en el servidor, divididas en bloques pequeños para respetar el límite por valor de almacenamiento. Descarga externa desde Seguridad y recuperación. No se incluyen sesiones, reservas, progreso ni configuración MFA en estas copias.
- Favoritos, progreso de películas/episodios e idiomas sincronizados por identidad de cliente. Las preferencias locales tienen clave por usuario; eliminaciones conservan marcas para que un dispositivo antiguo no las reviva. Se recupera al volver al primer plano y se conservan cambios locales sin red. Las respuestas tardías de otra sesión se ignoran.
- Panel de salud: últimas 24 horas por servidor/tipo/etiqueta de calidad; inicios, límite superior de p95, tiempo cargando, cortes, errores y bytes de segmentos HLS medidos. Los datos no identifican clientes. Las alertas son orientativas y exigen al menos cinco inicios por grupo.
- Guía TV: hasta cuatro programas del canal seleccionado cuando el proveedor ofrece EPG. Comparte la restricción de adultos; su fallo no detiene la señal.
- CSP, política de referencia y cabeceras contra detección incorrecta de tipos; HLS y Movi con versiones e integridad fijadas. JSON de entrada acotado a 4 MB. Se conserva el diagnóstico manual y el modo HLS de segmentos completos que corrige el audio MPEG.

## Activación por el propietario

MFA se ofrece en el panel y permanece apagado hasta que el propietario lo configura, confirma un código y guarda los ocho códigos de recuperación. El proceso no inscribe automáticamente el teléfono del propietario ni cambia sus credenciales.

Las sesiones HttpOnly/Secure/SameSite=Strict se utilizan desde `app.snaptvnow.com` y `panel.snaptvnow.com`. GitHub Pages mantiene la sesión por token porque es un dominio diferente; los clientes Xtream mantienen el protocolo existente. La conexión actual no permite modificar DNS/hosting ni iniciar sesión en Cloudflare. No se ha activado un dominio de frontend ni el Worker remoto de pruebas durante esta entrega.

Para migrar el frontend: configurar `app.snaptvnow.com` como dominio personalizado de GitHub Pages y su DNS, esperar certificado HTTPS y comprobar reproducción/inicio/cierre. El panel puede abrirse en `https://app.snaptvnow.com/admin.html`; un hostname `panel.snaptvnow.com` necesita hosting/DNS que sirva el mismo panel. No publicar un archivo CNAME antes de que el dominio y certificado estén preparados. `WEB_ORIGINS` ya contempla ambos hosts.

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

GitHub Actions Quality ejecuta regresiones, aislamiento workerd, compilaciones, invariantes SQLite y pruebas de Chromium. Los scripts de despliegue de esta carpeta ejecutan las regresiones antes de desplegar. Si Cloudflare Builds utiliza `npx wrangler deploy` directamente, cambiar su comando a `npm run deploy` para aplicar esa comprobación. Los permisos disponibles no permiten modificar ese ajuste ni las reglas de protección de ramas.

La evidencia de navegador se puede generar con `SMN_LIVE_AUDIO_REPORT=artifacts/live-audio.json`. Reproduce el problema de MPEG Layer III con HLS.js 1.6.15 usando una señal sintética, comprueba avance/decodificación y audio continuo con segmentos completos y también comprueba AAC. No certifica todas las señales del proveedor ni un teléfono físico.

## Recuperación

1. Mantener una descarga cifrada fuera del servidor y la clave TICKET_SECRET en almacenamiento seguro separado. Rotar o perder la clave impide leer copias antiguas y la semilla MFA; no rotarla sin plan de migración.
2. En el panel, seleccionar archivo, revisar fecha/cantidad de usuarios/servidores, introducir contraseña y un nuevo código MFA o recuperación y escribir RESTAURAR.
3. Los clientes deben volver a iniciar sesión. Revisar usuarios/permisos, actualizar el inventario del proveedor y probar catálogo y una señal autorizada.
4. Las copias contienen el estado lógico a su fecha. No restauran el administrador, códigos MFA, historial, progreso o reservas. Las conexiones guardadas necesitan que el proveedor siga activo; el inventario y sus tickets expiran y deben revalidarse.
5. Recuperar un administrador sin MFA requiere un código de recuperación o acceso del propietario a Cloudflare. No se añadió una puerta de acceso pública. La recuperación completa de SQLite con Cloudflare debe evaluarse por separado porque también puede restaurar sesiones y secretos antiguos.

Para volver al reproductor anterior, el commit estable v42 es `202728872aa9df5fde7500c2da3a456d64a9a05c`. Revisar primero los cambios de datos/MFA: revertir código v43 después de activar MFA quitaría su verificación en versiones anteriores. Preferir corregir hacia adelante; desactivar MFA con reautenticación antes de un retorno autorizado a código sin soporte MFA.

## Capacidad y coste

Las reservas, los vídeos y las cuentas del proveedor son mediciones diferentes. Las pruebas de 1000 reservas no prometen 1000 señales simultáneas. El límite del proveedor se conserva, incluyendo duplicados, cuentas externas, vencimientos y suspensiones.

El panel aporta cifras de uso y problemas de la web. Los bytes HLS incluyen segmentos precargados/reintentados; excluyen clientes Android, Movi, playlists, claves y otras peticiones. No equivalen al ancho de banda facturado por Cloudflare ni a un bitrate exacto del programa.

Para planificar un escenario, usar `node scripts/capacity-plan.mjs --viewers 100 --mbps 6 --hours 2 --provider-slots 90`. Presenta tráfico estimado decimal y plazas faltantes. Comparar con mediciones reales y la factura de Cloudflare antes de dimensionar costes. No hay precios ni tarifas supuestos.

Queda pendiente una prueba gradual con señales y cuentas de prueba autorizadas, presupuesto de tráfico y acceso a métricas/facturación del alojamiento. No se lanzó carga contra producción ni se ocuparon conexiones reales del proveedor.

## Android

La API de perfil ya acepta clientes autenticados (`profile_get` / `profile_patch`), pero el código Android no está en este repositorio. La app instalada conserva su funcionamiento actual; la integración de sincronización, preferencias y revisión de su reproductor necesita ese código y una compilación Android verificable.
