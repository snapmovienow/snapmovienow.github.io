# SNAPTVNOW: revisión de los 25 controles de seguridad

Fecha de revisión: 17 de noviembre de 2026, America/Chicago.

Seguimiento posterior de los seis controles y límites vigentes en [security-controls-followup-2026-11-17.md](security-controls-followup-2026-11-17.md).

## Alcance y significado

Se revisaron el código del gateway/API Cloudflare y la web pública en `c6793d6e9cde4c8cf4f79030040c7df9da44743a`, y el panel de resellers en su fuente `73a38cb76d5816b535fb15dce853ea1ca89de103`, antes de los cambios de esta entrega. Se contrastaron la versión activa y la configuración de secretos de Cloudflare, sin leer sus valores. No se accedió a sesiones de administrador ni a registros con URLs o credenciales, ni se realizaron pruebas contra proveedores o reproducciones de clientes.

Esta revisión no certifica que el sistema sea invulnerable. Un control identificado en código no acredita toda la configuración externa ni todas las rutas posibles. La APK instalada, sus dependencias y su firma requieren una revisión de su fuente y artefacto actuales; no se han certificado en este trabajo.

## Estado por punto

| # | Control | Resultado y actuación |
|---|---|---|
| 1 | Autenticación sólida | Ya existen sesiones revocables, límites de login y MFA del propietario. La activación efectiva de MFA no se comprobó. No se inscribe un autenticador por cuenta del propietario. |
| 2 | Claves API fuera del cliente | Las rutas revisadas usan secretos de servidor; Cloudflare registra las claves sensibles como `secret_text`. Se incorpora una comprobación preventiva de patrones reconocibles. No equivale a certificar toda APK o secreto posible. |
| 3 | Base de datos protegida | Ya hay aislamiento por actor/reseller, consultas parametrizadas y control de operaciones mediante D1/Durable Objects. La configuración completa de la cuenta del proveedor queda fuera de alcance. |
| 4 | HTTPS | Los paneles utilizan HTTPS. Se amplían cabeceras HSTS solo para el mismo host HTTPS, sin `includeSubDomains` ni precarga. No se fuerza una migración de todo Xtream ni de orígenes HTTP antiguos sin validar reproductores. |
| 5 | Contraseñas con hash | Ya existen PBKDF2-SHA256, salt individual y tokens de sesión hasheados. Hay contraseñas operativas cifradas recuperables para funciones existentes de soporte. PBKDF2 de 100 000 iteraciones merece una migración versionada y gradual; subir una constante invalidaría las contraseñas existentes. |
| 6 | Validación en servidor | Ya se comprueban identidad, ámbito, permisos, vencimiento, conexiones, precios y saldo en el servidor. |
| 7 | Protección XSS | Los renderizadores examinados usan escape de React o `textContent`. Se restringen más los scripts y conexiones del administrador estático. La CSP de la web de reproducción permanece separada por compatibilidad. No se afirma ausencia exhaustiva de XSS. |
| 8 | Actividad inusual | Ya hay auditoría administrativa y eventos saneados. Se añade una muestra limitada de login reseller fallido, sin usuario introducido, IP, contraseña o token. No representa un contador de todos los intentos ni una alerta automática al propietario. |
| 9 | Rutas administrativas | Ya exigen identidad de propietario, sesión vigente y ámbito del servidor; ocultar botones no es su mecanismo de protección. |
| 10 | Consultas parametrizadas | Ya implementadas en las rutas D1/SQLite examinadas, con listas permitidas para columnas y orden dinámicos. |
| 11 | Variables de entorno | Secretos del servidor ya separados del cliente. Se amplían exclusiones de archivos locales sensibles. Una variable incluida en un bundle público no sería secreta por llamarse variable de entorno. |
| 12 | Límite de peticiones | Ya hay límites de administrador, cliente administrado y operación reseller. Se limita también el login API antiguo antes de consultar su proveedor. No se aplica este límite a segmentos, reproducción ni solicitudes normales de listas. |
| 13 | CORS restringido | Ya existen orígenes explícitos y controles de origen en escrituras. CORS no sustituye la autenticación. |
| 14 | Cabeceras de seguridad | Ya había CSP y otras defensas en portales. Se uniforman respuestas tempranas del panel y se amplían defensas compatibles en API, conservando cookies, CORS, Range, cuerpo y estado. |
| 15 | Cookies seguras | Ya existen cookies `__Host-`, Secure, HttpOnly, SameSite y caducidad, con revocación en los flujos correspondientes. |
| 16 | CSRF | Ya hay comprobaciones de origen exacto y formato JSON para operaciones con sesión de navegador. |
| 17 | Enlaces que caducan | Ya existen tickets autenticados con expiración, entradas de un solo uso y revalidación de sesión/reserva. No se reducen sus plazos arbitrariamente. |
| 18 | Límite de archivos | La funcionalidad de imágenes del backend ya limita formatos raster, firmas, tamaños y cuotas. El Site no tiene una subida general de archivos; sí limita bytes reales de JSON. No hace falta crear una subida para añadir esta protección. |
| 19 | Precios en servidor | Ya implementados: paquetes y créditos se calculan y descuentan en el servidor con controles transaccionales. |
| 20 | Sin depuración pública | Entradas examinadas devuelven errores controlados y referencias saneadas. Se configura además la eliminación de query strings de los registros nuevos de Cloudflare. No elimina datos históricos ni oculta credenciales que un protocolo coloque en la ruta de URL. |
| 21 | Dependencias actualizadas | Se actualizan dependencias con avisos de seguridad tras revisar alcance y compatibilidad. Se distingue herramienta de desarrollo de código desplegado; un aviso no prueba explotación. La auditoría y el artefacto final deben verificarse, no solo el manifiesto. |
| 22 | Paquetes innecesarios | No se eliminan indiscriminadamente paquetes del framework o de herramientas. La ausencia de un import directo no acredita que un paquete sea prescindible. Se retienen los que requieren una evaluación adicional. |
| 23 | Archivos expuestos | La publicación de Pages ya selecciona activos públicos. Se añade una puerta de publicación que rechaza archivos privados o fuera de ese límite. |
| 24 | Secretos en Git | El escaneo acotado de patrones de alta confianza examinó 2 158 blobs únicos de 590 commits alcanzables sin coincidencias. Se incorpora una comprobación de contenido actual a CI. Ni uno ni otro detectan todos los formatos de secreto. |
| 25 | Revocar claves | Ya existen revocación de sesiones y mecanismos de rotación del gateway. No se confirmó una clave filtrada. La clave principal también cifra datos persistentes y MFA; rotarla requiere migración y recuperación comprobadas. |

## Evidencia de controles ya existentes

- Gateway: `cloudflare-worker/src/accounts.mjs`, `security.mjs`, `browser-sessions.mjs`, `owner-admin-access.mjs`, `owner-portal.mjs`, `reseller-portal.mjs` y `lease-store.mjs`.
- Imágenes: `cloudflare-worker/src/boxpanel.mjs` y `boxpanel-apps.mjs`.
- Panel: `lib/policy.ts`, `lib/panel-passwords.ts`, `lib/security.ts`, `lib/owner-access.ts`, `lib/service.ts`, `lib/packages.ts`, `lib/listing.ts`, `lib/request-body.ts` y `build/sites-worker.ts` en la fuente del Site.
- Publicación: `scripts/build-pages.mjs` y `.github/workflows/quality.yml`.

## Compatibilidad y límites de comprobación

La auditoría de dependencias posterior a los cambios encontró cero vulnerabilidades conocidas en cada lockfile npm del backend y Worker. El panel pasó de 25 avisos (3 críticos, 7 altos, 12 moderados y 3 bajos) a 3 (1 alto y 2 moderados), sin suprimirlos. No deben sumarse estos recuentos como incidentes o clientes afectados.

Versiones corregidas: Undici 7.30.1; en el panel, React/ReactDOM/RSC 19.2.9, Next y eslint-config-next 16.4.5, Vite 8.1.6 y fast-uri 3.1.9. Se conservaron el parche de Sharp y la exclusión previa de braces. Se comprobó que el build del panel selecciona RSC instalado y que el artefacto contiene la corrección de typed arrays; no basta con un cambio en el lockfile.

Persisten estos avisos, que requieren trabajo de compatibilidad independiente:

- Zod 3.25.76, alto, corrección en 4.6.6: migración mayor; el protocolo de herramientas de preview utiliza una firma que cambia en v4. No se confirmó una ruta de validación de producción con entrada ilimitada.
- Satori 0.16.0, moderado, corrección en 0.33.5: dependencia transitiva de generación de imágenes; no se encontró una ruta de la aplicación que la invoque.
- Minimatch 10.2.5, moderado, corrección en 11.0.1: herramientas ESLint/parser en el grafo examinado; no es un contador de errores del servicio.

Referencias primarias: [RSC](https://github.com/advisories/GHSA-xqc2-xf4c-x3h3), [Undici](https://github.com/advisories/GHSA-xjj6-f33q-929c), [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

Las pruebas de autenticación, permisos y cabeceras utilizan cuentas y solicitudes sintéticas. No acreditan reproducción real en todos los DNS, canales, televisores o dispositivos. Las comprobaciones públicas sin sesión se limitan a disponibilidad HTTP, cabeceras y puertas de acceso. Un 403 sin sesión en el panel del dueño es el resultado esperado.

Los nuevos límites legacy se restringen al login API que antes consultaba directamente al proveedor. La red compartida conserva un presupuesto amplio; una respuesta 429 es una decisión de política y no una caída de señal. Sus ventanas y pruebas de aislamiento quedan documentadas en el módulo y sus pruebas.

No se modifican asignaciones de proveedores, créditos, contraseñas, catálogos ni reglas comerciales como parte de esta revisión.
