# Continuación de SNAPMOVIENOW: perfil v43.2

Verificado el 9 de octubre de 2026 sobre `ef4939b`.

## Corrección

Una respuesta inicial lenta de `profile_get`, o su fallo de red, podía volver a
encolar el progreso capturado al entrar y sobrescribir lo avanzado mientras
esa petición estaba pendiente. Una prueba reprodujo el cambio incorrecto de
20 a 10 segundos. Ahora se hidrata con el estado local más reciente, se conserva
lo avanzado durante la petición y se envía ese progreso al servidor.

Con la misma fecha de modificación, una eliminación prevalece sobre un favorito
activo, como en el backend. La web actualiza la URL de `profile-sync.js` a
`v=43.2` para cargar la corrección. El reproductor HLS y el botón Diagnóstico
conservan su funcionamiento.

## Comprobaciones

- `npm test`: 25 archivos de regresión y sintaxis JavaScript aprobados. Se
  incluyen respuestas iniciales demoradas, fallo inicial de red, eliminación
  con fecha empatada, aislamiento entre cuentas y compatibilidad con la API antigua.
- `npm run test:platform`: aislamiento de entornos, perfiles autenticados,
  copias cifradas, restauración y MFA en workerd/SQLite local aprobados.
- `SMN_SAFETY_ONLY=1 npm run test:storage`: migración, transacciones, concurrencia
  y propiedad de reservas aprobadas, sin consumir conexiones del proveedor.
- `npm run build:worker` y `npm run build:staging`: compilaciones aprobadas.
  El backend no cambia en esta corrección.
- El navegador local no pudo instalarse: la descarga de Chromium llegó truncada.
  Las pruebas de Chromium y audio quedan a cargo del flujo Quality existente;
  comprobar su resultado para este commit antes de dar esa validación por aprobada.

## Pendiente real de producción

`https://api.snaptvnow.com/health` todavía devuelve versión 40. GitHub Pages
publicó v43, pero Cloudflare Builds rechazó el Worker. El check de GitHub
únicamente aporta el enlace del build, sin la causa. El build observado fue
`52032803-3f33-4501-bfc0-645e1aaf8e4c`.

La conexión actual no permite leer los registros de esa cuenta Cloudflare.
El propietario debe abrir Workers & Pages → snapmovienow-edge → Builds,
seleccionar el despliegue fallido más reciente y facilitar las líneas del error,
sin secretos. Con esa causa se podrá corregir el despliegue y comprobar `/health`,
la sincronización real, copias y funciones administrativas. No debe confundirse
la aprobación de Quality o de GitHub Pages con la publicación del Worker.

La organización Deno también reporta suspensión por facturación. La API que
usa actualmente la web es Cloudflare; corregir el despliegue Deno no publica ese
Worker. No se han cambiado cuentas, pagos, DNS, credenciales ni datos de producción.
