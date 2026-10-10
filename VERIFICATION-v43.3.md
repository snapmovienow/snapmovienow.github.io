# Copias y recuperación v43.3 — 10 de octubre de 2026

Se corrigió el reemplazo de copias del mismo día: elimina todos los fragmentos anteriores dentro de la misma transacción, incluso los sobrantes que ya no figuraban en el índice. La descarga lee índice y fragmentos de forma atómica. Un fallo revierte la escritura y conserva la última copia válida.

El panel muestra última copia, intento fallido/en curso y antigüedad de más de 36 horas. Permite crear una copia con contraseña y MFA, actualizar el estado y comprobar la integridad sin restaurar usuarios. La verificación descifra y valida el formato/entorno, comprueba SHA-256 y autenticación AES-GCM y registra fecha y evento. Las copias v1 existentes siguen siendo compatibles. Una copia reemplazada mientras se verifica no recibe la certificación de su versión anterior.

La creación concurrente está limitada a una operación. Los errores persistidos usan códigos permitidos, sin texto de excepciones ni credenciales. La tarea diaria continúa a las 05:17 UTC y conserva tres fechas; staging no ejecuta el cron. Crear manualmente una copia en staging requiere su administrador independiente.

Validación: regresiones de fragmentos sobrantes, lecturas transaccionales, rollback, fallo sin secretos, daño/fragmento perdido, índices antiguos y concurrencia. El ensayo del módulo de producción sobre workerd/SQLite usa cuentas ficticias, verifica contraseña recuperada, permisos, vencimiento, proveedor y configuración Xtream, rechazo de sesión antigua y conservación del MFA. Chromium con viewport móvil comprueba creación/verificación, borrado de contraseña y marcado de copia verificada.

Esta evidencia no confirma una ejecución del cron de producción ni una restauración de datos reales. El propietario puede verificar una copia real desde el panel; no debe restaurarla solo para probar. Las copias lógicas excluyen administrador/MFA, perfiles/favoritos/progreso, auditoría y reservas. Mantener una descarga cifrada y TICKET_SECRET en ubicaciones privadas separadas. No enviar archivos, semillas o códigos por chat.
