# Temporadas y episodios en clientes Xtream

El propietario informó el 10 de octubre de 2026 que IPTV Smarters Pro muestra la ficha de Lucky (2026) sin episodios, mientras SNAPTVNOW reproduce con la misma cuenta y API. La captura muestra el selector de temporada vacío. No se consultó el catálogo autenticado de ese cliente ni se ejecutó el binario de Smarters; el diagnóstico exacto de esa ficha necesita confirmación en el dispositivo.

Se reprodujo una incompatibilidad concreta en el código anterior: `get_series_info` devuelve `seasons: []` cuando el proveedor entrega episodios válidos sin metadatos de temporadas. SNAP lee directamente los grupos `episodes`, por lo que puede reproducirlos. El puente tampoco completaba el campo `season` del episodio. La prueba nueva falla antes del cambio con «playable episodes must have a selectable season».

El módulo `cloudflare-worker/src/xtream-series.mjs` construye temporadas únicamente para los grupos con episodios permitidos, completa número/nombre/ID/conteo, convierte los números a enteros, conserva especiales (temporada 0), ordena temporadas y episodios, y normaliza `info` vacío a objeto. Conserva los metadatos válidos del proveedor. Los episodios tienen `season` explícito, ID público estable y URL de reproducción propia; `smn_profile` conserva la referencia original para sincronización. Un catálogo realmente vacío sigue vacío. No se inventan episodios ni se cambia la configuración de las cuentas.

Las restricciones de series/adultos se aplican antes de construir las temporadas y sus conteos. No se publican temporadas sin episodios accesibles. Los IDs y las URLs siguen pasando por el registro y la protección de reproducción existentes; las credenciales y el origen del proveedor se eliminan antes de normalizar.

Validación local: 35 archivos de regresiones y sintaxis aprobados mediante `npm test`; compilación de producción mediante `npm run build:worker` aprobada. La regresión cubre GET/POST, temporadas omitidas/incompletas, especiales, orden numérico, claves PHP serializadas como arrays, metadata de temporadas como objeto, filas inválidas, identidad estable, reproducción parcial (Range), ausencia de secretos, permisos y catálogo vacío. El test completo del Worker usa dos proveedores simulados y comprueba temporadas seleccionables, asignación y reproducción del ID original, renovación y límites de conexiones. No se usaron cuentas reales ni se consumieron cupos del proveedor.

Después de Quality y Workers Builds, actualizar el catálogo de series de Smarters y volver a abrir Lucky. El resultado en el dispositivo es la aceptación final de ese caso; si permanece vacío, registrar versión de Smarters y otra serie afectada sin compartir contraseñas ni enlaces de reproducción. La publicación se verifica por la revisión exacta en Actions y el check de Cloudflare, sin omitir el control Quality.

Referencia del formato de temporadas y episodios: documentación del proyecto BUI, https://github.com/bluchip-studio-official/BUI/blob/main/docs/en/api/xtreamcodes_api.md. Esa referencia no documenta el parser interno de Smarters ni certifica la respuesta real de nuestro proveedor.

El cron diario de copias continúa pendiente por decisión del propietario. Esta corrección no certifica pruebas físicas completas de Android/Fire TV, capacidad simultánea ni costes.
