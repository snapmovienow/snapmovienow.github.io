# SNAP v43: funcionamiento, validación y operación

## Estado de publicación

El fallo de Cloudflare del 9 de octubre se identificó en las capturas del build `52032803-3f33-4501-bfc0-645e1aaf8e4c`: la instalación ejecutaba `npm clean-install --progress=false` desde `cloudflare-worker`, donde faltaba `package-lock.json`. El lockfile de la raíz servía para Quality, pero no para esa carpeta de despliegue.

Se añadió el lockfile propio del Worker, conservando Wrangler 4.149.0 y las versiones e integridades ya fijadas en la raíz. Quality instala y compila también desde la carpeta de Cloudflare para detectar este problema antes de futuras publicaciones. El commit `ac15bf8bf39832c4b831e9b57412cefce54a969d` pasó Quality y Cloudflare; `https://api.snaptvnow.com/health` ya responde con v43.

MFA, copias automáticas, sincronización remota y métricas agregadas están disponibles en ese servidor. La publicación del Worker no inscribe MFA en el teléfono del propietario; debe configurarse desde el panel. El panel v43.3 muestra la última copia y el estado del intento, permite crear una copia con reautenticación y comprobar su integridad sin restaurar. El control de recuperación v43.6 registra por separado la última ejecución automática, el ensayo de restauración y el archivo reimportado. Las copias antiguas no certifican retroactivamente el cron. La primera ejecución con ese control queda por comprobar después del cron; la validación local de cifrado/restauración no certifica esa ejecución en producción.

La actualización v43.5 añade cambio de contraseña y reemplazo de la clave del autenticador sin desactivar la protección durante la inscripción. Ver `VERIFICATION-v43.5.md` en la raíz para pruebas y pasos privados; renovar solo recuperación conserva la clave anterior. Android 1.0.12 está en main, con 159 pruebas sin fallos ni omisiones y firma de producción terminada. Se verificaron los bytes y la firma v2 de la APK entregada, paquete com.snaptvnow.tv, versionCode 41 y certificado igual al de 1.0.11. La validación física sigue pendiente. Ver `VERIFICATION-android-1.0.12.md`.

## Cambios listos

- El puente Xtream normaliza temporadas y episodios para clientes que necesitan seleccionar una temporada antes de leer los episodios. Las temporadas se derivan de los episodios permitidos cuando faltan metadatos; conservan IDs públicos y reproducción protegida. La regresión aislada reproduce temporadas vacías con episodios válidos. El caso reportado de Lucky en Smarters queda pendiente de aceptación en el dispositivo después de publicar. Ver `VERIFICATION-xtream-series.md`.
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

GitHub Actions Quality ejecuta regresiones, aislamiento workerd, compilaciones, invariantes SQLite y pruebas de Chromium. `postinstall` de esta carpeta ejecuta `scripts/deploy-guard.mjs`: dentro de Workers Builds espera hasta doce minutos a que Quality apruebe el mismo SHA y la misma rama, con evento push y el workflow exacto. Una ejecución fallida/cancelada, un checkout diferente o modificado, una respuesta imposible de comprobar o el vencimiento de la espera bloquean la instalación y por tanto la publicación, incluso con el comando actual `npx wrangler deploy`.

El build `c2ea3d08-8ced-42b9-b97d-08035b2539d9` del 10 de octubre se bloqueó al consultar GitHub: primero encontró Quality en progreso y después recibió HTTP 403. El log anterior no incluía cabeceras; por eso no permite distinguir un límite de API de otro rechazo. El guard corregido consulta como mínimo cada 60 segundos, reutiliza ETag solo tras validar la respuesta y respeta `Retry-After`, `x-poll-interval` y el reinicio de cuota. Los errores consecutivos usan espera exponencial; si la siguiente consulta quedaría fuera de los doce minutos, bloquea el build sin seguir consultando. Registra el código HTTP y el agotamiento de cuota cuando lo confirma la cabecera, sin imprimir cuerpos de API ni excepciones que pudieran contener secretos.

Para evitar depender de la cuota anónima compartida por IP, el guard admite `QUALITY_GITHUB_TOKEN` como **secreto de build**, separado de los secretos de ejecución del Worker. Configuración del propietario: crear en GitHub un token fine-grained, con vencimiento, propietario `snapmovienow`, únicamente el repositorio `snapmovienow.github.io` y permiso **Actions: Read-only**; conservar Metadata de lectura que GitHub añade. En Cloudflare, seleccionar el Worker, **Settings > Build**, editar **Build variables and secrets** y guardar `QUALITY_GITHUB_TOKEN` con tipo **Secret**. Pegar el valor directamente allí, sin enviarlo por chat ni guardarlo en el repositorio. Si la organización exige aprobación, aprobar el token antes del build. Un token inválido/expirado no provoca una vuelta silenciosa a consultas anónimas. Se envía únicamente al endpoint fijo HTTPS de GitHub, con redirecciones rechazadas. Esta modificación no crea ni configura automáticamente dicho secreto. Sin secreto conserva la consulta pública y los mismos controles de aprobación.

Referencias: [límites de GitHub](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [esperas y peticiones condicionales](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [permiso Actions de lectura](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow) y [secretos de Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/). Las respuestas 304 autenticadas no consumen cuota primaria; ese beneficio no se asume en modo anónimo.

Fuera de Workers Builds, la instalación normal no espera a Quality: hacerlo dentro del propio job produciría una espera circular. Los comandos manuales `npm run deploy` y `npm run deploy:staging` exigen la misma aprobación antes de las regresiones locales y Wrangler. La instalación automática debe conservar los scripts npm habilitados. Esta protección no impide que un administrador cambie el comando, desactive los scripts o publique deliberadamente por otra vía; las reglas de protección de ramas requieren ajustes adicionales de la cuenta.

GitHub Pages quedó configurado con Source GitHub Actions el 10 de octubre de 2026. El propietario activó el ajuste y la ejecución manual 38084677032 completó prepare, la comprobación final y Publish tested frontend de deebdb0. El flujo v43.7 exige la última aprobación Quality de push para la revisión actual y conserva el dominio y HTTPS. Las reglas de protección de ramas requieren ajustes administrativos adicionales; no se dan por activadas.

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

El panel añade **Capacidad y coste por espectador**: espectadores, Mbps, horas al día y días del período. Reutiliza el inventario existente para distinguir cupos totales de cupos asignables ahora y avisa cuando no se han confirmado. Estima tráfico decimal y demanda simultánea. Calcula costes por espectador y hora únicamente si se indican proveedor y alojamiento del mismo período; los importes desconocidos no aparecen como cero y se borran al cerrar la sesión. No consulta facturas ni aplica tarifas automáticas.

Para planificar desde CLI, usar `node scripts/capacity-plan.mjs --viewers 100 --mbps 6 --hours 2 --provider-slots 90`. Las opciones `--provider-available`, `--provider-cost` y `--hosting-cost` añaden cupos libres y reparto de costes. Panel y CLI comparten `capacity-plan.js`; la integración móvil de Quality comprueba inventario, cálculo y limpieza de importes. Ver `VERIFICATION-capacity.md`. Comparar con mediciones y facturas reales antes de dimensionar costes.

Queda pendiente una prueba gradual con señales y cuentas de prueba autorizadas, presupuesto de tráfico y acceso a métricas/facturación del alojamiento. No se lanzó carga contra producción ni se ocuparon conexiones reales del proveedor.

## Android

La integración nativa está en el repositorio `juancanta89-tech/SnapTvNow`: favoritos, progreso, idiomas, aislamiento por cuenta/servicio, HTTPS, métricas agregadas y guía ampliada. La revisión f1b2a04 (1.0.12) añade descarga e instalación de actualizaciones dentro de SNAPTVNOW. Android source check 38085780730 y Sign production APK 38085780725 terminaron correctamente. Se inspeccionaron los informes XML: 159 pruebas, cero fallos, errores y omisiones. La APK firmada se verificó y se entregó, conservando la firma anterior; no se modificó el repositorio Android durante esta comprobación. La prueba física en teléfono y Firestick, incluyendo instalación y reproducción real, sigue pendiente. Evidencia: `verification/2026-10-10-android-v1.0.12.json` y `VERIFICATION-android-1.0.12.md`.

## Pages sujeto a Quality

El workflow v43.7 está activo en `.github/workflows/pages-after-quality.yml`. El propietario cambió **Build and deployment > Source** a **GitHub Actions**, conservando **app.snaptvnow.com** y **Enforce HTTPS**, y ejecutó **Pages after Quality** en **main**. La ejecución https://github.com/snapmovienow/snapmovienow.github.io/actions/runs/38084677032 publicó correctamente deebdb0 el 10 de octubre de 2026. No necesita `PAGES_ACTIONS_ENABLED` ni un token adicional: consulta los ajustes reales con el token temporal de Actions. El arranque manual también exige la última ejecución push de Quality aprobada; no reemplaza sus pruebas por una aprobación manual. Una regresión a Source legado vuelve a omitir la publicación y explica el ajuste necesario.

El job de preparación solo tiene lectura de Contents, Actions y Pages. Rechaza otros repositorios, ramas, PR, workflows, revisiones, ejecuciones e intentos. Descarga únicamente la revisión aprobada, genera el artefacto de frontend y repite la consulta justo antes de desplegar con Pages/ID token. Un intento nuevo, fallo, error de API, cambio de main, de dominio o de HTTPS bloquea la publicación. Los permisos de escritura quedan en el job condicionado a la aprobación; no se cargan artefactos de PR ni credenciales externas. El artefacto excluye código de servidor, pruebas, dependencias e informes. La comprobación previa no es una transacción atómica con un push concurrente; una nueva revisión llegada después de esa comprobación se publicará con su propio Quality posterior.

La activación manual y sus pasos de publicación están confirmados mediante el API de Actions y la captura del propietario. El panel publicado coincide con el archivo del checkout y la API responde con HTTP 200. La actualización de esta guía comprueba además el siguiente disparo automático de Quality y Pages, y la ausencia de un flujo nativo nuevo. Evidencia de activación: `verification/2026-10-10-pages-activation.json`. Un ensayo local por sí solo no demuestra la configuración remota. Referencias: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site y https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run.

## Ensayo remoto de recuperación SQLite

PITR de Cloudflare recupera SQLite/KV de los últimos 30 días y no funciona en desarrollo local. Ensayar únicamente en un objeto staging sin datos de clientes: guardar `ctx.storage.getCurrentBookmark()`, crear un usuario ficticio, guardar otro bookmark, alterar/borrar y pedir `ctx.storage.onNextSessionRestoreBookmark(bookmark)`; registrar el bookmark de retorno que devuelve y reiniciar el objeto mediante `ctx.abort()`. Comprobar desde una sesión nueva el usuario/permiso/vencimiento y cerrar sesiones restauradas antes de conectar un cliente. Volver al bookmark inicial para limpiar el ensayo. No se añadió una ruta pública de recuperación física.

Antes de un incidente real conservar exportación cifrada y bookmark actuales, decidir el instante y registrar la autorización; una recuperación física puede traer sesiones, configuración y secretos antiguos. La prueba local de restauración lógica no demuestra PITR remoto. Fuente: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/.


## Recuperación aislada v43.6

Cada nueva copia, manual o del cron, ejecuta un ensayo lógico en `BACKUP_RECOVERY`, binding de la clase SQLite `BackupRecovery`. Tiene una migración y un namespace diferentes de `PlaybackSession`; el destino se genera internamente con `newUniqueId()`. El módulo no expone rutas de cuentas, sesiones, proveedores ni reproducción. No puede conectarse a proveedores. El Worker staging conserva bindings propios y no tiene cron; este ensayo dentro de producción no afirma que el Worker remoto staging esté desplegado.

El ensayo descifra la copia con la clave original, usa la misma restauración que producción y compara todos los campos de usuarios salvo las identidades/versiones/fechas que deben renovarse. Comprueba los permisos, vencimientos, hashes de contraseña, estado, configuración y eliminación de usuarios anteriores, vaciado de reservas y conservación del administrador de control. El administrador/MFA de producción y las sesiones de clientes permanecen en otro objeto. Al finalizar ejecuta `deleteAll()` y comprueba la ausencia de KV y de la tabla de reservas; una alarma limpia el objeto si el intento se interrumpe. La limpieza vacía la base activa y no promete borrar el historial de recuperación que administra Cloudflare.

`backup-drill` exige sesión administrativa, contraseña y segundo factor cuando está activado. Acepta una copia seleccionada o un archivo cifrado reimportado, rechaza formato/clave/entorno incorrectos, serializa los ensayos y vincula la evidencia al checksum exacto. Un ensayo de una copia sobrescrita no certifica su reemplazo. Solo devuelve resultados agregados; no devuelve identidades ni contraseñas. Si falla, conserva la copia. Un fallo de limpieza nunca se registra como éxito.

`backup-status` distingue `lastAutomaticAt`/`automaticStatus` de la última copia manual y marca la automática como antigua después de 36 horas. `recovery` registra fecha de la copia, checksum, comprobaciones y última reimportación correcta. Preparar una descarga no prueba que el archivo se haya guardado fuera del servidor. La importación del archivo y su ensayo sí prueban que el archivo presentado puede descifrarse y restaurarse; no certifican la disponibilidad futura del teléfono o de otro almacenamiento.

Cierre operativo desde el panel:
1. Abrir Seguridad y recuperación, escribir la contraseña y un código nuevo, y pulsar Crear copia en el servidor. Esperar el ensayo correcto y actualizar el estado.
2. Descargar esa copia, guardarla en un lugar privado fuera del servidor, seleccionar el archivo descargado y pulsar Ensayar el archivo guardado con otro código nuevo.
3. Comprobar que la última tarea diaria aparece confirmada después de las 05:17 UTC. Una copia manual no elimina el aviso de cron pendiente o fallido.
4. Conservar por separado la clave original del servidor, sin pegarla en el chat. PITR físico y recuperación de la cuenta Cloudflare siguen siendo procedimientos distintos; nunca probar PITR sobre el objeto de clientes.

Evidencia automatizada: `npm test`, `npm run test:platform` y la integración móvil. `artifacts/recovery-runtime.json` se genera en CI usando únicamente datos sintéticos en workerd/SQLite local. No contiene copias, usuarios reales, tokens ni claves y no prueba la ejecución del cron remoto.

Confirmación operativa del 10 de octubre de 2026: el propietario aportó primero la captura de «Restauración aislada comprobada: 3 usuarios y 1 servidores. Almacenamiento de ensayo limpiado» y después, a las 16:01 America/Chicago, otra con «Archivo guardado comprobado». Confirman el ensayo lógico real de la copia del servidor y del archivo descargado y reimportado, con 3 usuarios, 1 servidor y limpieza del almacenamiento de ensayo. Evidencia agregada: `verification/2026-10-10-recovery-owner-confirmation.json`. No confirman el próximo cron diario, la custodia privada de la clave original ni PITR físico.

El propietario dejó pendiente explícitamente la comprobación del cron diario a las 16:40 America/Chicago. El siguiente punto activo es la validación física de la APK, tras completar la protección de Pages después de Quality.


## Web v43.9: motores de reproducción separados

- `playback-transport.js` concentra la carga de HLS/Movi, opciones de búfer, reproducción nativa, cancelación de cargas, recuperación de señal y cierre de ambos motores. `app.js` conserva la sesión, selección del catálogo, autorización, reservas y mensajes de la interfaz.
- `playback-tracks.js` concentra audio, subtítulos y aplicación de preferencias. Cada transporte usa su propio lector de pistas: HLS, Movi o `TextTrackList` nativo. Los eventos del reproductor inactivo no cambian los controles del seleccionado.
- El lector anterior de Movi devolvía cero pistas para el elemento de vídeo nativo. El módulo nuevo consulta sus subtítulos/captions directamente, conserva el índice al omitir pistas de metadatos y permite desactivarlos.
- Pruebas locales: 17 archivos de regresión web; compilación Worker y empaquetado Pages correctos. Las pruebas específicas cubren cierre con error de motor, cierre durante carga HLS/Movi, cancelación durante manifiesto, limpieza de observadores temporales, reanudación, HLS nativo y preferencias por transporte.
- Quality ejecuta además la suite completa, SQLite, interfaz móvil con `TextTrackList` real y vídeo generado con audio AAC/MPEG Layer III usando el módulo de producción. No certifica dispositivos físicos ni capacidad del proveedor.
- La medición de carga y costes reales sigue pendiente: requiere cuentas de ensayo, límites de tráfico, métricas de consumo e importes del mismo período. La calculadora existente no sustituye esa medición. La comprobación del cron diario continúa aplazada por decisión del propietario.
