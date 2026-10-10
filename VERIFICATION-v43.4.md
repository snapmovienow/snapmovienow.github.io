# SNAP v43.4 — integración y límites de validación

Fecha: 10 de octubre de 2026. Este informe registra cambios comprobados y diferencia validaciones locales de operaciones de producción.

## Cambios

- La web separa persistencia y transporte de sesión en `session-client.js`; el dominio propio guarda solo el marcador cookie. Una respuesta antigua no cambia una cuenta nueva. Se descartan registros antiguos con contraseña y los parámetros de contenido no pueden reemplazar la identidad del inicio de sesión.
- Las métricas conservan un identificador al reintentar después de una pérdida de red. El servidor acepta el informe una sola vez y conserva los informes limitados para reintento. Cuenta intentos/fallos de arranque y alerta ante cinco fallos aunque ninguna señal haya empezado. El panel separa web y Android; los agregados no identifican clientes.
- Xtream publica `smn_profile`: ID original/servidor/episodio para compartir perfil con la web. Los IDs globales de reproducción siguen siendo estables.
- Guía ampliada a 24 programas, títulos UTF-8/base64, omisión de programas terminados y marcador del programa actual. La guía disponible depende del proveedor; un error no detiene video ni revierte permisos.
- El workflow `Pages after Quality` publica un artefacto de frontend limitado a HTML/JS/CSS/assets cuando Quality aprueba el mismo SHA de main. Rechaza commits desplazados. Su activación requiere ajustes de Pages del propietario, descritos abajo; todavía no reemplaza el mecanismo anterior.
- Quality incorpora reproducción real local con 1 y 5 espectadores sintéticos además de la prueba de audio y la integración móvil. La prueba manual se amplió a 20, con evidencia en `verification/2026-10-10-video-capacity-v43.json`.

## Pruebas

Validación local terminada: 31 archivos de regresión y sintaxis; workerd/SQLite y aislamiento; invariantes de almacenamiento; Chromium móvil; MPEG/AAC; compilaciones Worker producción/staging y artefacto Pages.

Regresiones de login/permisos/cupos/Range/cancelación/suspensión/vencimiento, MFA/RFC6238, copias cifradas/restauración, perfil y sesiones. Módulos de producción en workerd con dos namespaces SQLite separados. Navegador Chromium de 390×844: login, catálogo parcial/restaurado, favoritos, panel, MFA/códigos nuevos y limpieza de secretos. La prueba MPEG reproduce el fallo con parsing progresivo y comprueba la corrección con segmentos completos; AAC también se valida.

La prueba de video usa exclusivamente loopback, HLS generado y decodificación MSE real. Resultados: 1/5/10/20 espectadores avanzaron ≥4 segundos, sin errores fatales, cortes o cuadros perdidos. El p95 local de inicio fue aproximadamente 165/158/207/295 ms. Esto no certifica capacidad, red, cupos ni coste de Cloudflare/proveedor, ni 1.000 vídeos simultáneos.

Las copias v43.3 ya se publicaron y Quality/Cloudflare las aprobaron. El ensayo local borró y recuperó un usuario ficticio, vencimiento, permisos y ajustes, conservó MFA y rechazó sesiones anteriores. No restauró datos de producción. La integridad comprobada no equivale a un ensayo de restauración ni confirma el cron diario remoto.

## Android

`juancanta89-tech/SnapTvNow`, versión 1.0.11, conserva el applicationId release existente. La rama de verificación integra favoritos/progreso/preferencias con referencias originales del servidor; cola offline y respuestas aisladas por cuenta. Las sesiones siguen cifradas con Android Keystore. Favoritos e historial locales se separan por usuario/servicio: los datos antiguos sin servidor no se migran automáticamente a una cuenta distinta y quedan almacenados.

Cada cliente captura su servidor. Inicio/reconexión/guía/catálogo tardíos no sobrescriben una cuenta nueva. La configuración exige HTTPS y utiliza el dominio API propio cuando no existe una configuración remota o guardada válida. El endpoint público de control respondió 403 desde esta sesión; no se cambió su contenido.

Android envía primer cuadro, tiempo activo/buffering, cortes y errores sin título, URL, usuario o dispositivo. Conserva hasta veinte informes en memoria para reintento con el mismo ID; al cerrar la cuenta se descartan. No mide bytes/cuadros en estos informes. La web mide segmentos HLS, incluyendo precargas/reintentos, sin equivaler a una factura.

La APK de prueba tiene applicationId separado. La distribución release requiere los secretos de firma existentes y prueba en teléfono/TV, red móvil/Wi-Fi, fondo/reanudación y dos cuentas ficticias. Una compilación y Robolectric no certifican esas pruebas físicas. No generar ni usar otra clave para actualizar instalaciones.

## Acciones que requieren acceso operativo

| Acción | Estado / requisito |
|---|---|
| Pages sujeto a Quality | En Settings → Pages → Build and deployment → Source seleccionar GitHub Actions. En Settings → Secrets and variables → Actions → Variables crear `PAGES_ACTIONS_ENABLED=true`. Ejecutar Quality de main. Confirmar Pages after Quality y HTTPS. El conector actual no administra estos ajustes. |
| Staging remoto | Crear los secretos distintos de producción y desplegar `snapmovienow-edge-staging`; configuración y aislamiento local están comprobados. |
| Cron de copias | Revisar en el panel fecha/estado después de 05:17 UTC y verificar/descargar una copia. No hubo sesión administrativa de producción disponible en esta verificación. |
| Recuperación SQLite de Cloudflare | Ensayar PITR en un objeto de staging remoto, conservando un bookmark de vuelta; no existe PITR en workerd local. Ver el procedimiento de ENGINEERING_V43.md. |
| Cuentas GitHub/Cloudflare | Confirmar MFA de cada cuenta por sus ajustes privados. El MFA de SNAP no verifica esas cuentas. |
| Capacidad/coste | Medición gradual con conexiones reales de prueba, presupuesto y métricas/facturación. |
| Integración Deno antigua | Sigue registrando un error externo; requiere retirarla/reconfigurarla en su cuenta. |

