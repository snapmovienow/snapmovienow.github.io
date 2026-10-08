# Acceso API: despliegue v39 y ajustes pendientes

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

1. En la zona correspondiente, **Security → Events**, buscar el Ray ID y la hora.
   Revisar el producto y la regla que produjo el bloqueo antes de modificarla.
2. En **Workers & Pages → snapmovienow-edge → Observability**, filtrar
   `event=request_failed`, `ray_id` o `request_id`.
3. Si Cloudflare rechaza una solicitud antes de ejecutar el Worker, no habrá
   registro propio ni encabezado `X-SMN-Request-ID`. La ausencia del registro no
   prueba que haya funcionado; un bloqueo CORS también puede impedir que el
   navegador lea el Ray ID. No confundirlo con credenciales incorrectas.

No se pudo consultar estos eventos en esta sesión: el navegador del panel
Cloudflare presentó un fallo persistente de verificación. El 1010 observado
desde el entorno de pruebas no identifica por sí solo una regla concreta.

## 2. Excepción selectiva preparada, sin activar

`bic-api-rule.pending.json` contiene una regla **deshabilitada** que omite solo
Browser Integrity Check (`products: ["bic"]`) para los métodos/rutas de esta API
en `api.snaptvnow.com`. Mantiene el registro de eventos. No omite WAF, controles
de autenticación, tickets, límites de cuentas ni límites de conexiones.

Activarla únicamente en una zona propia, después de confirmar un falso positivo
de BIC en los eventos. Si el bloqueo pertenece a otro producto/regla, esta
excepción no lo corrige y debe permanecer deshabilitada. No puede aplicarse
una regla de zona propia al dominio compartido `workers.dev`.

## 3. Dominio propio preparado, sin activar

Destino propuesto: `https://api.snaptvnow.com` (puerto 443).

La consulta DNS pública del 8 de octubre de 2026 devolvió servidores NS de
NS1/NSOne para `snaptvnow.com` y NXDOMAIN para `api.snaptvnow.com`. No se ha
creado el registro, asociado el hostname al Worker ni emitido su certificado.

Cloudflare Custom Domains requiere una zona activa en esa cuenta. Antes de
activar una zona o cambiar servidores NS, conservar y revisar los registros
existentes para evitar afectar la web y otros servicios. También puede usarse
otro dominio propio que ya tenga una zona activa en la cuenta.

Cuando exista la zona activa:

1. Abrir **Workers & Pages → snapmovienow-edge → Settings → Domains & Routes
   → Add → Custom Domain**. Añadir el hostname exacto `api.snaptvnow.com`.
   Cloudflare administra su DNS y certificado. No utilizar una ruta de panel
   XUI ni una URL de GitHub Pages como servidor Xtream.
2. Tras confirmar la asociación, añadir al `wrangler.jsonc` principal la ruta
   que está preparada en `wrangler.custom-domain.pending.jsonc` para que los
   siguientes despliegues conserven el dominio. No cambiar Durable Objects,
   migraciones ni secretos: se mantiene el mismo Worker y sus usuarios.
3. Validar HTTPS, `/health`, rechazo sin credenciales en `/player_api.php`,
   login de un usuario SNAP de prueba, catálogos y una reproducción con una
   cuenta autorizada. Cerrar/cambiar contenido y verificar liberación de cupos.
4. Solo entonces cambiar la dirección de la web, panel y apps al dominio
   validado. Conservar temporalmente `workers.dev` para los clientes actuales.
   Actualizar también la lista de hosts admitidos en
   `media-tools/package_tracks.py` si se usa esa herramienta.

El frontend de v39 sigue usando el hostname que funciona actualmente. Los
archivos `*.pending.*` son preparación revisable, no cambios activos de DNS/WAF.

## Fuentes oficiales

- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/waf/custom-rules/skip/options/
- https://developers.cloudflare.com/waf/tools/browser-integrity-check/
