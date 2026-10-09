# Acceso API: dominio asociado y bloqueo pendiente de diagnóstico

## Aplicado en el código

- Cada respuesta del Worker incluye `X-SMN-Request-ID` y `X-SMN-Version`.
- Los errores 403 y 5xx que llegan al Worker generan un registro JSON acotado:
  hora UTC, Ray ID válido, referencia, grupo de ruta, método, estado y duración.
  El registro propio excluye URL completa, parámetros, cuerpo, credenciales,
  tickets e IP. Los registros automáticos de invocaciones están desactivados.
- El panel ofrece **Diagnóstico de conexión → Comprobar servidor**. Consulta
  `/health` y comprueba que `/player_api.php` sin credenciales devuelve 401.
  No abre reproducciones ni reserva cupos. Es una prueba desde ese dispositivo,
  no una certificación del catálogo ni de las señales del proveedor.
- La web distingue un bloqueo 1010/challenge, un 403 del servicio y un 502 del
  proveedor. No repite automáticamente una solicitud bloqueada.

## 1. Identificar la regla exacta

Con hora UTC y referencia del diagnóstico, consultar Cloudflare:

1. En la zona `snaptvnow.com`, **Security → Analytics → Events**, buscar el Ray ID y la hora.
   Revisar el producto y la regla que produjo el bloqueo antes de modificarla.
2. En **Workers & Pages → snapmovienow-edge → Observability**, filtrar
   `event=request_failed`, `ray_id` o `request_id`.
3. Si Cloudflare rechaza una solicitud antes de ejecutar el Worker, no habrá
   registro propio ni encabezado `X-SMN-Request-ID`. La ausencia del registro no
   prueba que haya funcionado; un bloqueo CORS también puede impedir que el
   navegador lea el Ray ID. No confundirlo con credenciales incorrectas.

No se pudo consultar estos eventos en esta sesión: el navegador del panel
Cloudflare presentó un fallo persistente de verificación. El 1010 observado
es compatible con un rechazo por firma del cliente según la documentación
oficial; todavía no se ha observado el producto/regla concreto en los eventos.

## 2. Excepción selectiva preparada, sin activar

`bic-api-rule.pending.json` contiene una regla **deshabilitada** que omite solo
Browser Integrity Check (`products: ["bic"]`) para los métodos/rutas de esta API
en `api.snaptvnow.com`. Mantiene el registro de eventos. No omite WAF, controles
de autenticación, tickets, límites de cuentas ni límites de conexiones.

Activarla únicamente en una zona propia, después de confirmar un falso positivo
de BIC en los eventos. Si el bloqueo pertenece a otro producto/regla, esta
excepción no lo corrige y debe permanecer deshabilitada. No puede aplicarse
una regla de zona propia al dominio compartido `workers.dev`.

## 3. Dominio propio asociado; clientes pendientes de migración

Destino: `https://api.snaptvnow.com` (puerto 443).

El usuario confirmó en el panel la zona activa, los servidores de nombres
`rommy.ns.cloudflare.com` y `zainab.ns.cloudflare.com`, y la asociación de
`api.snaptvnow.com` al Worker existente `snapmovienow-edge` en Production.
El flujo observado es **Domains → Add Domain → seleccionar `snaptvnow.com`
→ Subdomain `api` → Production → Add domain**. El primer campo busca zonas;
no se debe incorporar una segunda zona ni asociar el dominio raíz al Worker.

`wrangler.jsonc` declara ahora esa misma asociación (`custom_domain: true`).
Conserva `workers_dev: true`, identidad del Worker, bindings y migraciones.
Se retiró el archivo de configuración pendiente para evitar dos fuentes
distintas. Este cambio no migra las URL de la web, panel ni apps.

Comprobación pública del 9 de octubre de 2026, aproximadamente 04:03 UTC
(8 de octubre, 23:03 America/Chicago):

| Prueba | Resultado |
| --- | --- |
| DNS A `api.snaptvnow.com` | 172.67.201.227 y 104.21.85.36, TTL 300 |
| DNS A `media.snaptvnow.com` | 194.76.0.119, TTL 300 |
| HTTPS GET `/health` | TLS validado; HTTP 403, cuerpo `error code: 1010`; Ray `a47a80eebdd06aeb-DFW` |
| HTTPS GET `/player_api.php` sin credenciales | TLS validado; HTTP 403, cuerpo `error code: 1010`; Ray `a47a80efa8f36aeb-DFW` |

No se reintentó el bloqueo con otra firma de cliente, IP o transporte.
Estas peticiones no abren señales ni reservan cupos. HTTPS pudo completarse,
pero no se verificó aún la respuesta v39 ni el 401 esperado a través del nuevo
hostname. Un fallo desde este entorno no prueba que todos los clientes fallen.

Pasos pendientes:

1. Consultar el evento de seguridad del nuevo hostname y verificar el producto
   y la regla. La excepción BIC sigue deshabilitada hasta identificar un falso
   positivo de ese producto en esta zona propia.
2. Validar `/health`, rechazo sin credenciales en `/player_api.php`,
   login de un usuario SNAP de prueba, catálogos y una reproducción con una
   cuenta autorizada. Cerrar/cambiar contenido y verificar liberación de cupos.
3. Solo entonces cambiar la dirección de la web, panel y apps al dominio
   validado. Conservar temporalmente `workers.dev` para los clientes actuales.
   Actualizar también la lista de hosts admitidos en
   `media-tools/package_tracks.py` si se usa esa herramienta.

El frontend de v39 sigue usando el hostname actual. El archivo
`bic-api-rule.pending.json` es preparación revisable, no una regla WAF activa.

## Fuentes oficiales

- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/waf/custom-rules/skip/options/
- https://developers.cloudflare.com/waf/tools/browser-integrity-check/
- https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/
- https://developers.cloudflare.com/waf/analytics/security-events/
