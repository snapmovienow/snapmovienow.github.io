# SNAPTVNOW: piloto privado de procesamiento selectivo

Primera fase para medir el servidor antes de contratar capacidad para clientes.
Es un servicio Node.js 24 + FFmpeg separado del Worker. **No está conectado al
DNS ni al administrador de producción, no recibe cuentas de clientes y no
modifica créditos.** No se debe publicar directamente como servicio de clientes.

## Incluye

- Panel privado con selección de canales o categorías; control manual e intervalo
  opcional de hasta siete días. Las fechas del panel se introducen en la hora
  local del dispositivo y se guardan como instantes UTC.
- Texto incrustado y logo local opcional. El texto se pasa por archivo, sin
  expansión de expresiones ni ejecución de comandos.
- HLS H.264/AAC 480p y 720p. Un reproductor compatible elige la calidad; TS directo
  no se transforma automáticamente en un reproductor adaptativo.
- Una codificación por canal solicitado compartida entre sus espectadores.
  Seleccionar una categoría no arranca todos sus canales.
- Límite estricto de canales simultáneos, arranque serializado, apagado por
  inactividad y parada/revocación de enlaces al cambiar la configuración.
- API administrativa con Bearer; enlaces temporales de prueba firmados, asociados
  a canal y revisión. Cada playlist y segmento exige autorización.
- Fuentes fijadas por el operador en un archivo privado; ningún endpoint acepta
  una URL de entrada enviada por el espectador. Las respuestas no incluyen URLs
  ni credenciales de fuentes y los errores de FFmpeg no se imprimen.

## Prueba local reproducible

Requisitos: Node.js 24; FFmpeg/ffprobe con libx264, AAC, drawtext y overlay.
En Debian 13: paquetes oficiales `nodejs`, `ffmpeg`, `fonts-dejavu-core`.
Comprobar una versión Node 24 antes de iniciar; el paquete `nodejs` de cada
distribución puede tener otra versión. No se necesita npm para ejecutar el piloto.

```sh
node --test services/live-processing/pilot.test.mjs
SNAP_PILOT_REPORT=artifacts/live-processing/local-acceptance.json \
  node services/live-processing/smoke.mjs
```

La segunda orden genera una señal sintética, inserta una marca de prueba,
comprueba ambas resoluciones, H.264/AAC y píxeles del logo con FFmpeg/ffprobe,
y comprueba el apagado. No accede al proveedor ni certifica rendimiento OVH.

Para abrir el panel de demo, configurar `SNAP_PILOT_ADMIN_TOKEN` con un valor
aleatorio privado de 32 o más caracteres. No incluirlo en Git, URLs ni registros.
Iniciar y entrar a `http://127.0.0.1:8789`:

```sh
node services/live-processing/pilot.mjs --demo
```

La política inicial está desactivada. Seleccionar el canal demo, desmarcar logo
si aún no se configuró un archivo, guardar y generar un enlace privado. El canal
arranca al abrir el enlace. Para usar logo, definir `SNAP_PILOT_LOGO_FILE` como
ruta absoluta a un PNG/BMP local de tamaño apropiado (por ejemplo 96x48). La
marca se coloca arriba a la derecha sobre el video de entrada antes de escalar.

El acceso predeterminado escucha únicamente en loopback. En un servidor usar un
túnel SSH privado o un reverse proxy HTTPS con acceso limitado al operador.
Nunca enviar la clave por HTTP a través de una red pública. No se abre un puerto
público por esta implementación y no se añade CORS general.

## Señales reales: solo después de revisar el servidor

Crear un archivo de catálogo privado fuera del repositorio, con permisos 0600:

```json
[
  {
    "id": "canal-1",
    "name": "Canal elegido",
    "categoryId": "deportes",
    "categoryName": "Deportes",
    "source": "https://ORIGEN-AUTORIZADO/live/RUTA-PRIVADA"
  }
]
```

Definir `SNAP_PILOT_CATALOG_FILE` y `SNAP_PILOT_ALLOWED_ORIGINS` (orígenes exactos,
separados por coma); iniciar sin `--demo`. `SNAP_PILOT_POLICY_FILE` permite
conservar configuración entre reinicios, con revisión y escritura atómica.
`SNAP_PILOT_GRANT_SECRET` separa la firma de enlaces de la clave de administrador.
`SNAP_PILOT_THREADS` limita hilos de x264 por salida (2 por defecto, no cuota de
CPU del sistema); `SNAP_PILOT_FPS` admite 25, 30, 50 o 60 (30 por defecto).

El archivo de fuentes es configuración de confianza del operador: FFmpeg puede
seguir redirecciones y URLs secundarias de HLS. Antes de fuentes no controladas,
aislar su red y restringir salida hacia los proveedores autorizados. La lista de
orígenes de esta aplicación valida el punto inicial, no todos los destinos que
FFmpeg podría resolver. No usar como proxy para URLs de terceros arbitrarias.

La entrada upstream debe disponer de los cupos de proveedor necesarios. El
piloto no implementa todavía las concesiones de playback del Worker, la
validación de vigencia/conexiones de cuentas ni la recuperación del origen.
Esos controles existentes deberán conservarse en el adaptador de integración.

## Cómo decidir si alcanzan los $14.50

Ejecutar la aceptación y una prueba sostenida **en el modelo y región exactos**:

1. Registrar modelo CPU, núcleos disponibles y límites cgroup reales. Una prueba
   en esta máquina local u otro producto cloud no acredita el VPS-3 de OVH.
2. Usar muestras representativas 1080p30 y deportes 1080p50/60; comparar preset,
   fps y calidad visual. Preservar el fps deseado al configurar la prueba.
3. Medir 1, 3 y 5 canales activos con las salidas previstas, de forma gradual.
   Verificar que las fuentes permiten ese número de entradas simultáneas.
4. Medir CPU real, memoria y velocidad de codificación. Para medir margen de
   velocidad usar un archivo local representativo sin limitar su lectura a
   tiempo real; en una entrada live, `speed=1x` por sí solo no prueba margen.
5. Mantener 24-48 h el conjunto candidato. Criterio inicial propuesto: margen de
   CPU de 25-30%, sin acumulación de retraso ni reinicios del encoder.
6. Probar audiencia desde otra máquina/red; loopback no mide el enlace de OVH.
   Registrar tráfico, errores, arranque y cortes con aplicaciones DNS reales.
7. Confirmar con OVH el caudal sostenido del uso concreto y cualquier opción
   adicional, antes de prometer un precio final. El techo publicado de red y el
   número de vCore no indican un número de canales con logo.

El informe final debe indicar canales simultáneos, variantes, fps, audiencia,
bitrate, margen, ubicación y costo total. No existe todavía un resultado de
capacidad OVH ni una compra/provisión de servidor en esta primera fase.

## Integración pendiente para clientes DNS

Conectar este procesamiento a las autorizaciones y límites de sesiones actuales
del Worker y al catálogo propio, sin exponer URLs del proveedor; adaptar la
selección del panel principal; probar expiración/suspensión, conexiones, cambios
de canal y recuperación. Para clientes TS diseñar una salida compatible aparte.
No activar procesamiento masivo ni reemplazar rutas de producción antes de esa
aceptación. Los límites del piloto son técnicos y no representan créditos IPTV.
