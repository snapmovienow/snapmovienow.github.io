# SNAPMOVIENOW v39 — diagnóstico de acceso y preparación de dominio

Fecha: 2026-10-08. Baseline: v38, commit
`0eaeb66a8634721746051b0b478b4197e002e66a`.

## Cambios de código

Identificadores de solicitud y versión en respuestas; registros propios de
errores 403/5xx con metadatos acotados y sin credenciales; registros automáticos
de invocación desactivados. El panel incluye diagnóstico de acceso sin reservar
reproducciones. La web distingue respuestas de Cloudflare en texto/HTML,
permisos deshabilitados, errores del proveedor y fallos de transporte.

## Validación

- Los **19 archivos** de pruebas Worker/frontend pasan, incluidos autenticación
  y catálogo Xtream, tickets, control de cupos, cancelación, cierre/cambio de
  canal, reintentos, aislamiento de reservas y expiración.
- Nuevas pruebas: 1010/challenge, 403 propio, HTML 502, respuesta inválida,
  fallo de red, protección Xtream sin credenciales, redacción de datos,
  cancelación del stream y preservación de Range/CORS. Los API embebidos en las
  dos páginas no repiten solicitudes bloqueadas; 401 real revoca la sesión
  del administrador.
- Scripts embebidos de ambas páginas analizados con `node --check`.
- Wrangler 4.149.0: dry run correcto, **135.69 KiB / gzip 33.00 KiB**, conserva
  `PLAYBACK_SESSIONS (PlaybackSession)` y las migraciones existentes.
- Configuraciones pendientes comparadas con la configuración activa: misma
  identidad del Worker y mismos bindings/migraciones; excepción solo BIC,
  deshabilitada, hostname/métodos/rutas acotados y eventos habilitados.

Las pruebas de v38 de 500/1.000 reservas sintéticas no se repitieron: v39 no
modifica asignación, SQLite ni heartbeat. No se certifica aquí una capacidad de
vídeo real ni estabilidad de señales 1080p del proveedor.

## Estado externo inicial del despliegue v39

El DNS público de `api.snaptvnow.com` devolvió NXDOMAIN; `snaptvnow.com` usa NS1/
NSOne. El panel de Cloudflare no permitió acceso en esta sesión debido a un
fallo persistente de verificación. No se consultaron eventos de seguridad, no
se identificó una regla concreta, no se activó una excepción y no se creó el
dominio ni certificado. La respuesta v38 válida aportada por el usuario
demuestra acceso desde su conexión, no desde todas las redes.

`cloudflare-worker/CLOUDFLARE_ACCESS.md` explica el cambio preparado y las
comprobaciones antes de cambiar clientes de hostname. Los archivos pendientes
no forman parte del despliegue activo. La dirección actual sigue funcionando
para los clientes que ya acceden a ella.

## Actualización: dominio asociado el 9 de octubre de 2026 UTC

La zona Cloudflare está activa según la captura aportada por el usuario.
`api.snaptvnow.com` aparece asociado a `snapmovienow-edge` en Production.
La asociación se declara en `cloudflare-worker/wrangler.jsonc`, conservando
`workers_dev: true`, bindings y migraciones. Se elimina la copia pendiente.

DNS público resuelve el nuevo hostname y mantiene `media.snaptvnow.com` en
194.76.0.119. HTTPS validó TLS pero `/health` y `/player_api.php` sin credenciales
devolvieron 403/1010 desde el entorno de pruebas. No se eludió el bloqueo ni se
abrieron reproducciones. Los Ray ID y el estado exacto constan en
`cloudflare-worker/CLOUDFLARE_ACCESS.md`.

Siguen pendientes el evento de seguridad, la excepción selectiva si procede,
y pruebas reales de autenticación/catálogo/reproducción en el nuevo hostname.
Las URL de clientes continúan en `workers.dev`; no se ha migrado ningún cliente.
