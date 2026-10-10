# Temporadas y episodios en clientes Xtream

El propietario informó el 10 de octubre de 2026 que IPTV Smarters Pro muestra la ficha de Lucky (2026) sin episodios, mientras SNAPTVNOW reproduce con la misma cuenta y API. La captura muestra el selector de temporada vacío. No se consultó el catálogo autenticado de ese cliente ni se ejecutó el binario de Smarters; el diagnóstico exacto de esa ficha necesita confirmación en el dispositivo.

Se reprodujo una incompatibilidad concreta en el código anterior: `get_series_info` devuelve `seasons: []` cuando el proveedor entrega episodios válidos sin metadatos de temporadas. SNAP lee directamente los grupos `episodes`, por lo que puede reproducirlos. El puente tampoco completaba el campo `season` del episodio. La prueba nueva falla antes del cambio con «playable episodes must have a selectable season».

El módulo `cloudflare-worker/src/xtream-series.mjs` construye temporadas únicamente para los grupos con episodios permitidos, completa número/nombre/ID/conteo, convierte los números a enteros, conserva especiales (temporada 0), ordena temporadas y episodios, y normaliza `info` vacío a objeto. Conserva los metadatos válidos del proveedor. Los episodios tienen `season` explícito, ID público estable y URL de reproducción propia; `smn_profile` conserva la referencia original para sincronización. Un catálogo realmente vacío sigue vacío. No se inventan episodios ni se cambia la configuración de las cuentas.

Las restricciones de series/adultos se aplican antes de construir las temporadas y sus conteos. No se publican temporadas sin episodios accesibles. Los IDs y las URLs siguen pasando por el registro y la protección de reproducción existentes; las credenciales y el origen del proveedor se eliminan antes de normalizar.

Validación local: 35 archivos de regresiones y sintaxis aprobados mediante `npm test`; compilación de producción mediante `npm run build:worker` aprobada. La regresión cubre GET/POST, temporadas omitidas/incompletas, especiales, orden numérico, claves PHP serializadas como arrays, metadata de temporadas como objeto, filas inválidas, identidad estable, reproducción parcial (Range), ausencia de secretos, permisos y catálogo vacío. El test completo del Worker usa dos proveedores simulados y comprueba temporadas seleccionables, asignación y reproducción del ID original, renovación y límites de conexiones. No se usaron cuentas reales ni se consumieron cupos del proveedor.

Después de Quality y Workers Builds, actualizar el catálogo de series de Smarters y volver a abrir Lucky. El resultado en el dispositivo es la aceptación final de ese caso; si permanece vacío, registrar versión de Smarters y otra serie afectada sin compartir contraseñas ni enlaces de reproducción. La publicación se verifica por la revisión exacta en Actions y el check de Cloudflare, sin omitir el control Quality.

Referencia del formato de temporadas y episodios: documentación del proyecto BUI, https://github.com/bluchip-studio-official/BUI/blob/main/docs/en/api/xtreamcodes_api.md. Esa referencia no documenta el parser interno de Smarters ni certifica la respuesta real de nuestro proveedor.

El cron diario de copias continúa pendiente por decisión del propietario. Esta corrección no certifica pruebas físicas completas de Android/Fire TV, capacidad simultánea ni costes.

## Seguimiento: ficha vacía de El Halcón

El propietario confirmó que el cambio inicial no resolvió Smarters y mostró El Halcón (2026) sin episodios. Se mantuvo abierto el incidente: no se dispone del catálogo autenticado de marvin2006 ni del binario del reproductor externo. La captura prueba el síntoma, no el formato exacto de la respuesta del proveedor.

Se reprodujeron otros dos fallos antes de corregirlos: una respuesta HTTP 200 con `user_info.auth: 0` se saneaba a `{}` y se aceptaba como detalle, sin probar otra cuenta autorizada; y una lista plana de episodios era descartada por el normalizador aunque el catálogo de SNAP puede leerla. Las regresiones fallaron, respectivamente, con «HTTP 200 authentication errors must fall back» y «flat episode lists must be grouped». Ahora se rechazan errores/malformaciones, se busca una respuesta con episodios en las cuentas configuradas del mismo servidor, y se agrupan listas planas por el campo de temporada. Una serie realmente vacía permanece vacía; los IDs de episodios siguen registrándose y la reproducción continúa protegida.

Los detalles se renuevan después de 30 segundos y no utilizan el mecanismo de snapshots de listas de hasta doce horas. Las categorías y los catálogos conservan ese mecanismo. Se añadió una lectura forzada para el diagnóstico autenticado.

En Panel → Acceso desde Smarters → Comprobar episodios de una serie, el administrador puede seleccionar el usuario y escribir El Halcón o Lucky. La comprobación ejecuta el formateador público y las restricciones de series/adultos de ese usuario; informa HTTP, ID público, temporadas y episodios. No inicia vídeos ni consume reservas de reproducción. No devuelve credenciales, URLs de vídeo, datos de cuentas del proveedor ni excepciones privadas. Requiere una sesión de administrador; la vista se limpia al salir. La búsqueda admite tildes y comprueba como máximo dos coincidencias. Esto verifica el servidor, no el parser interno de Smarters ni una reproducción física.

Validación de esta revisión: 38 archivos de regresiones y sintaxis, compilación de producción, runtime SQLite para autorización del diagnóstico y prueba móvil de envío/renderizado/limpieza. El runtime móvil se ejecuta en Quality con Chromium; su éxito y la publicación de la revisión exacta deben verificarse antes de comunicar que el cambio está activo. La aceptación específica de El Halcón en el dispositivo sigue pendiente hasta observar el resultado del diagnóstico y del cliente.

## Seguimiento: contrato estricto de episodios

El propietario volvió a cargar la cuenta y confirmó que TV y películas funcionan, pero la selección de temporadas de El Halcón permanece vacía. Esta vez se comprobó la API pública con la cuenta afectada: autenticación válida, listado de series y detalle de El Halcón con una temporada y diez episodios, HTTP 200 por GET y POST. El detalle omite `custom_sid` en todos los episodios. No se guardaron credenciales ni enlaces de reproducción en el repositorio.

Se inspeccionó estáticamente el APK público de Smarters 2.0.4 (`com.nst.iptvsmarterstvbox`, archivo archivado en https://archive.org/details/iptv-smarters-pro-com.nst.iptvsmarterstvbox). En `SeasonsActivitiy` y `EpisodeDetailActivity`, el lector accede a `custom_sid` con `JSONObject.getString`, sin comprobar su existencia. Esta llamada falla si falta la clave y el episodio no llega a añadirse a la lista. El mismo lector requiere `id`, `season`, `title`, `direct_source`, `added` y `container_extension`. Esto identifica una incompatibilidad verificable con ese lector; no se ejecutó la aplicación física del propietario ni se conoce su versión exacta.

La regresión que reproduce esas lecturas falló antes de la corrección con «legacy episode reader: missing custom_sid». El saneador continúa eliminando el valor privado del proveedor. El serializador público restaura `custom_sid: ""` y asegura que `added` sea una cadena, incluso si está ausente o es numérico. Conserva los IDs públicos, las URLs propias y los permisos. Las pruebas comprueban todas las variantes existentes de temporadas, episodios, POST, reproducción mapeada y filtrado, e incluyen un `custom_sid` privado como entrada para demostrar que nunca se publica.

APK inspeccionado: SHA-256 `379f2da847e79e0ae122385ede6165613b0ba4ad10b87160cf29c307ef663829`. Validación local: 38 archivos de regresiones y sintaxis, incluida la lectura estricta de campos, y compilación del Worker con Wrangler.

La aceptación en el dispositivo continúa abierta hasta que el propietario vuelva a abrir la ficha después de la publicación. El conteo del diagnóstico anterior no comprobaba estos campos obligatorios y por sí solo no certificaba compatibilidad con Smarters.
