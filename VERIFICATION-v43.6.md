# Recuperación comprobable v43.6

Una copia manual podía hacer aparecer reciente el estado de copias aunque la tarea diaria no hubiera ejecutado. El control ahora conserva la fecha y el resultado del cron por separado. Los registros anteriores quedan con origen/ejecución desconocidos hasta una nueva comprobación; no se convierten en evidencia automática.

Las nuevas copias ejecutan una restauración lógica en un objeto de la clase SQLite `BackupRecovery`, con un binding y namespace propios, sin rutas públicas de cuentas o reproducción. El objeto usa la función real de restauración, compara los datos recuperados, verifica cambio de identidades y eliminación de reservas, y limpia la base activa con una alarma de respaldo. La copia se conserva si falla el ensayo. No se certifica un ensayo si la limpieza falla o si la copia se sobrescribe durante la comprobación.

El panel permite repetir ese ensayo con una copia del servidor o con un archivo descargado. Requiere sesión, contraseña y MFA cuando está activado. Una descarga preparada no cuenta como copia externa comprobada: solo el ensayo del archivo reimportado registra esa comprobación. La confirmación de restauración de producción sigue siendo una acción aparte, con contraseña/MFA y texto RESTAURAR.

Validación local:
- 33 archivos de regresión y sintaxis aprobados.
- workerd con SQLite real y el módulo de producción: recupera usuarios/permisos/vencimientos/configuración, preserva las identidades y sesiones originales en el namespace de cuentas, conserva MFA y limpia KV/SQL del objeto de ensayo.
- Rechazo de acceso sin sesión, contraseña incorrecta/ausente, cifrado y entorno incorrectos; pruebas de fallo de limpieza, concurrencia y copia sobrescrita.
- Compilación Wrangler de producción y staging y generación del artefacto Pages aprobadas.
- Se amplió la prueba Chromium móvil para ensayo del servidor, ensayo del archivo y ausencia de restauración de usuarios en esas acciones. La ejecución de CI comprueba navegador, audio, almacenamiento y vídeo antes de autorizar Workers Builds.

Evidencia del motor local: `verification/2026-10-10-recovery-runtime.json`, únicamente datos sintéticos. Esta prueba no afirma haber restaurado datos de clientes ni ejecutado el cron en Cloudflare remoto. El ensayador se publica con el Worker; staging remoto y PITR físico no se dan por certificados.

Cierre operativo: crear una copia en el panel, esperar restauración aislada correcta, descargarla y ensayar el archivo guardado fuera del servidor. Verificar la ejecución automática después del cron de las 05:17 UTC. Conservar por separado la clave original del servidor. Guía completa: `cloudflare-worker/ENGINEERING_V43.md`.

Confirmación del propietario, 10 de octubre de 2026: la primera captura del panel informa restauración aislada correcta de una copia del servidor, con 3 usuarios y 1 servidor y almacenamiento de ensayo limpiado. A las 16:01 America/Chicago, una nueva captura confirma también «Archivo guardado comprobado», con los mismos conteos y limpieza. El archivo descargado y reimportado pasó el ensayo lógico aislado. Evidencia agregada: `verification/2026-10-10-recovery-owner-confirmation.json`; no conserva el archivo, identidades, claves ni códigos.

Quedan por comprobar la primera ejecución diaria registrada, la custodia privada de la clave original del servidor y PITR físico en un entorno separado. El ensayo del archivo no certifica estos pasos ni constituye una restauración de producción.
