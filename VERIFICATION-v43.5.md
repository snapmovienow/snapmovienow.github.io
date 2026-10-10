# SNAP v43.5 — renovación privada de credenciales

Fecha: 10 de octubre de 2026.

## Implementación y validación

El panel incorpora **Cambiar contraseña del administrador** y **Reemplazar autenticador**. Ambas operaciones exigen reautenticación, respetan el límite de intentos y registran el cambio sin guardar contraseñas, claves TOTP ni códigos de recuperación en el historial.

El cambio de contraseña exige entre 12 y 256 caracteres, una contraseña diferente y MFA cuando está activo. Guarda un nuevo salt/hash mediante el algoritmo existente, conserva el factor y los datos, borra una inscripción pendiente y revoca las sesiones administrativas anteriores.

El reemplazo del autenticador exige contraseña y un TOTP nuevo del factor actual; un código de recuperación no autoriza iniciar este reemplazo. La clave nueva vence a los diez minutos. El factor actual sigue activo hasta confirmar los seis dígitos de la clave nueva. La confirmación sustituye la clave y los ocho códigos de recuperación en una transacción y revoca las sesiones. Un error o vencimiento conserva el factor anterior. Renovar solamente códigos de recuperación conserva la misma clave TOTP y no resuelve la exposición de esa clave.

Validaciones locales: **32 archivos de regresión y sintaxis**, integración móvil Chromium de contraseña/reemplazo/MFA y ausencia de errores JavaScript/CSP, compilaciones Worker producción/staging y artefacto Pages. El ensayo workerd/SQLite verificó recuperación lógica, aislamiento, renovación y reemplazo de MFA, rechazo de contraseña/códigos anteriores y cierre de sesiones. Solo utilizó datos sintéticos; no cambió credenciales ni restauró datos de producción.

La versión anterior v43.4 fue publicada y aprobada: [Quality](https://github.com/snapmovienow/snapmovienow.github.io/actions/runs/38021864136), [Pages](https://github.com/snapmovienow/snapmovienow.github.io/actions/runs/38021863893) y Workers Builds. La API confirmó las capacidades de perfil nativo, reintento de métricas e integridad de copias; los módulos frontend publicados coincidieron byte por byte con el código verificado.

## Acción privada del propietario

La contraseña, clave del autenticador y códigos compartidos anteriormente deben reemplazarse. No se reutilizaron para acceder al panel durante este trabajo. El propietario realiza estos pasos con su teléfono, sin enviarlos por chat:

1. Entrar en [el panel](https://app.snaptvnow.com/admin.html) y abrir **Seguridad y recuperación**. Cambiar la contraseña por una única de al menos 12 caracteres, con un código nuevo del autenticador. Volver a entrar con la nueva contraseña y el siguiente código.
2. Introducir la nueva contraseña y otro código nuevo del autenticador actual. Pulsar **Reemplazar autenticador**. En Google Authenticator añadir la clave nueva como **SNAP Administrador nuevo**, tipo **Time based**. Conservar la entrada actual hasta terminar.
3. Confirmar en el panel el código de seis dígitos de la entrada nueva antes de que venza la configuración. Guardar en privado los ocho códigos de recuperación nuevos y pulsar **Ya guardé los códigos; iniciar sesión**.
4. Entrar con la contraseña nueva y el siguiente código de la entrada nueva. Comprobar **Segundo factor activado**. Entonces retirar la entrada antigua y reemplazar el respaldo de códigos anterior. Si vence o falla la inscripción, el autenticador anterior sigue válido; iniciar otro reemplazo y descartar la entrada incompleta.

Un código utilizado para entrar o autorizar otra operación no sirve nuevamente: esperar al siguiente código. Estas acciones afectan al administrador SNAP; las cuentas GitHub/Cloudflare tienen ajustes MFA independientes.

## Android y pendientes externos

Android 1.0.11 está en main, SHA `4e95621e97f14aa514ced761a19ff68cba4bb32f`. [CI de main](https://github.com/juancanta89-tech/SnapTvNow/actions/runs/38022035509) aprobó la compilación. Se descargaron y analizaron los XML del [ensayo del mismo SHA](https://github.com/juancanta89-tech/SnapTvNow/actions/runs/38021753884): **142 pruebas, cero fallos/errores/omitidas, 22 suites**. Evidencia: `verification/2026-10-10-android-v43-tests.json`.

La [firma de producción](https://github.com/juancanta89-tech/SnapTvNow/actions/runs/38022035490) terminó correctamente después de la aprobación del propietario. Se descargó la APK 1.0.11 (versionCode 40), se verificó la firma RSA v2 y se comparó el certificado con la APK 1.0.8: conserva paquete `com.snaptvnow.tv` y certificado SHA-256 `069517313d68df21e9ba3110db2e498e9b42aeb8f3f4553d84953e946cd27165`. SHA-256 de la APK nueva: `a6b115d7969400ceab9ba6030db24d819b7b851bc472e1922852e560fe5c34ff`. La APK firmada ya fue entregada al propietario. Sigue pendiente la validación física en teléfono/TV/VPN/red móvil/fondo; la firma no prueba esos escenarios.

Pages sigue con la publicación nativa. El workflow que exige Quality está preparado, pero requiere Source **GitHub Actions**, variable **PAGES_ACTIONS_ENABLED=true** y ejecutar Quality de main. Staging remoto, ensayo PITR de Cloudflare, ejecución del cron remoto, MFA de las cuentas GitHub/Cloudflare, integración Deno antigua y capacidad/coste real continúan sujetos al acceso operativo descrito en `VERIFICATION-v43.4.md` y `cloudflare-worker/ENGINEERING_V43.md`.

La prueba local de veinte videos no certifica mil espectadores reales. Las copias lógicas no incluyen favoritos/progreso ni el factor del administrador. Una compilación Android no sustituye pruebas en dispositivos físicos.
