# Acceso Xtream desde Smarters

El adaptador valida los usuarios de SNAPMOVIENOW y sirve los catálogos y la reproducción con las conexiones autorizadas que guarda el administrador. No crea ni modifica cuentas del proveedor.

## Datos del cliente

- Servidor: `https://snapmovienow-edge.juancanta89.workers.dev`
- Puerto HTTPS: `443`
- Usuario y contraseña: los creados en el panel de SNAPMOVIENOW.
- Tipo de acceso: Xtream Codes. Introducir la URL completa, incluyendo `https://`.

El administrador puede habilitar o deshabilitar la interfaz en **Acceso desde Smarters**, copiar la URL y comprobar que responde. Los permisos individuales de películas, series y TV se aplican tanto a los catálogos como a la reproducción. Cambiar contraseña, permisos o estado revoca las sesiones anteriores.

## Rutas implementadas

| Ruta | Función |
| --- | --- |
| `/player_api.php` | Validación del cliente y datos de servidor |
| `get_live_categories`, `get_live_streams` | Categorías y canales |
| `get_vod_categories`, `get_vod_streams`, `get_vod_info` | Películas |
| `get_series_categories`, `get_series`, `get_series_info` | Series, temporadas y episodios |
| `get_short_epg`, `get_simple_data_table` | Programación disponible en el proveedor |
| `/live/usuario/contraseña/id.m3u8` o `.ts` | TV |
| `/movie/usuario/contraseña/id.ext` | Películas y solicitudes Range |
| `/series/usuario/contraseña/id.ext` | Episodios |

Los IDs públicos son persistentes y distintos por servidor y tipo de contenido. El registro usa un Durable Object separado del que administra usuarios y reservas. Las URLs del catálogo apuntan a SNAPMOVIENOW; las credenciales del proveedor permanecen en el servidor.

## Reservas y revocación

- Hasta tres contextos Xtream simultáneos por usuario, sujetos a las plazas disponibles del proveedor. Un contexto se identifica por usuario, dirección IP y User-Agent.
- Las consultas periódicas del mismo manifiesto reutilizan la reserva. Los segmentos HLS renuevan su vigencia; los flujos TS y de archivos comprueban acceso cada 25 segundos mientras permanecen abiertos.
- Cerrar un flujo nativo libera la reserva. Una cancelación tardía no libera la de su solicitud sustituta. Las reservas HLS sin tráfico caducan en 90 segundos.
- Deshabilitar Xtream revoca sus sesiones y reservas, sin deshabilitar el acceso web. Volver a habilitarlo exige una sesión nueva.

## Continuidad de la reproducción

La reproducción nativa utiliza el inventario reciente mientras actualiza las conexiones en segundo plano. Cada nueva reserva valida la cuenta seleccionada. Una interrupción temporal al consultar el panel conserva el último inventario durante un máximo de doce horas; una respuesta que confirma cuentas inactivas las retira y revoca sus reservas. Una consulta fallida no equivale a una confirmación de cuentas inactivas.

Los catálogos y categorías Xtream se guardan como instantáneas comprimidas en el Durable Object, divididas en bloques inferiores al límite de almacenamiento. Tienen cinco minutos de vigencia para actualización y un máximo de doce horas para recuperación durante fallos. Las instantáneas sirven inmediatamente mientras se actualizan en segundo plano, sobreviven a cambios de instancia del Worker y se invalidan al editar o retirar conexiones. La autenticación, suspensión y permisos se comprueban antes de acceder a cualquier instantánea. Por servidor, la carga puede probar hasta tres cuentas autorizadas sin duplicar el catálogo. Una avería no renueva la fecha de una instantánea antigua.

La primera carga necesita una consulta correcta al proveedor: no se inventan categorías ni se puede reconstruir una instantánea que nunca se guardó. Un catálogo en caché tampoco garantiza que una señal externa esté disponible.

El transporte separa el plazo para obtener las cabeceras del tiempo sin recibir datos. Una señal que continúa entregando datos puede permanecer abierta. Los archivos y segmentos de tamaño conocido pueden recuperar los bytes pendientes mediante Range, con hasta dos intentos, comprobando el rango y los validadores disponibles. Cada recuperación comprueba otra vez el acceso. Si la preparación de una señal falla, incluido un 404 de una cuenta del proveedor que no sirve ese título, el acceso nativo puede probar hasta tres cuentas autorizadas del mismo servidor, liberando cada reserva fallida y respetando los límites de conexión.

La capacidad sigue dependiendo del proveedor, de sus conexiones externas y del formato de cada señal. La interfaz no convierte códecs, repara señales caídas ni convierte una cuenta compartida del proveedor en una cuenta exclusiva. M3U descargable y XMLTV completo no forman parte de este adaptador.

## Verificación

```sh
node --test cloudflare-worker/tests/*.test.mjs tests/*.test.mjs
cd cloudflare-worker
npx wrangler deploy --dry-run
```

`tests/xtream.test.mjs` simula dos proveedores con IDs iguales y clientes independientes. Comprueba autenticación, catálogos, episodios, Range, manifiestos y claves HLS, renovación, límites, cancelación, permisos y revocaciones. No utiliza cuentas ni tráfico reales del proveedor. La comprobación del panel verifica el protocolo; una reproducción real depende de una cuenta activa, una señal disponible y un reproductor compatible.

También comprueba el cambio a otra cuenta ante un error 503 y que una actualización lenta del inventario no bloquee la reproducción nativa. `tests/media-fetch.test.mjs` utiliza un servidor HTTP local para comprobar los plazos de cabeceras y de inactividad, y verifica la recuperación exacta de bytes, los intentos limitados y la revocación. Las pruebas del pool comprueban que una avería temporal conserve las reservas y que el inventario antiguo caduque.
