# Publicación de Pages después de Quality

Pages publicaba main mediante el flujo nativo, en paralelo a Quality. El flujo preparado antes exigía una variable administrativa adicional y solo revisaba main al comenzar. El cambio actual consulta los ajustes reales de Pages, valida la revisión y el último intento aprobado de Quality y repite la comprobación inmediatamente antes de publicar.

La preparación usa permisos de lectura de Contents, Actions y Pages. El job con Pages/ID token solo comienza cuando hay aprobación. La publicación acepta exclusivamente main del repositorio original y una ejecución Quality de push exitosa de esa revisión; una PR, un fork, un workflow distinto, un intento fallido o posterior, un error de API o una revisión reemplazada no autoriza publicar. El arranque manual aplica los mismos controles. La web debe conservar app.snaptvnow.com y HTTPS forzado.

Validación local del 10 de octubre de 2026: 34 archivos de regresiones y sintaxis aprobados, incluido el control de procedencia, intentos, cambios concurrentes, configuración Pages, HTTPS, errores y aislamiento del token. Artefacto Pages generado con referencias locales válidas y YAML del workflow analizado correctamente. No hubo cambios en el módulo del Worker ni en reproducción. La suite completa de CI y la comprobación real de ajustes se ejecutan al publicar este commit.

Activación administrativa pendiente: en Settings > Pages > Build and deployment > Source seleccionar GitHub Actions, mantener el dominio y Enforce HTTPS, y ejecutar Pages after Quality en main. No necesita PAGES_ACTIONS_ENABLED ni otro token del propietario. No crear un segundo workflow sugerido por GitHub. Hasta cambiar Source, la publicación nativa continúa y este flujo muestra el pendiente sin desplegar. Después verificar el job Publish tested frontend y la ausencia de publicación nativa paralela. La conexión actual no administra ese ajuste.

La consulta final reduce publicaciones obsoletas, pero no constituye una transacción atómica entre el API de GitHub y un push simultáneo. Si main cambia después de la consulta, la revisión nueva tendrá su propia ejecución Quality y publicación posterior. Un arranque manual no certifica cambios aún sin pruebas.

Recuperación: el propietario confirmó con captura un ensayo real de una copia del servidor: 3 usuarios, 1 servidor y almacenamiento de ensayo limpiado. El ensayo de archivo externo, la primera ejecución diaria registrada y PITR físico siguen separados y pendientes de evidencia.

Guía: cloudflare-worker/ENGINEERING_V43.md. Fuente para Source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site.
