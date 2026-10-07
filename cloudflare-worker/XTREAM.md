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

La capacidad sigue dependiendo del proveedor, de sus conexiones externas y del formato de cada señal. La interfaz no convierte códecs, repara señales caídas ni convierte una cuenta compartida del proveedor en una cuenta exclusiva. M3U descargable y XMLTV completo no forman parte de este adaptador.

## Verificación

```sh
node --test cloudflare-worker/tests/*.test.mjs tests/*.test.mjs
cd cloudflare-worker
npx wrangler deploy --dry-run
```

`tests/xtream.test.mjs` simula dos proveedores con IDs iguales y clientes independientes. Comprueba autenticación, catálogos, episodios, Range, manifiestos y claves HLS, renovación, límites, cancelación, permisos y revocaciones. No utiliza cuentas ni tráfico reales del proveedor. La comprobación del panel verifica el protocolo; una reproducción real depende de una cuenta activa, una señal disponible y un reproductor compatible.
