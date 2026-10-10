# Capacidad y coste por espectador

El panel añade una calculadora de escenarios con espectadores simultáneos, Mbps, horas al día y días del período. Compara la demanda con los cupos totales y los asignables de la consulta existente del proveedor. Si la consulta falla o usa datos guardados, identifica el inventario como pendiente de confirmar y evita declarar que cubre el escenario.

El cálculo compartido entre panel y CLI está en `capacity-plan.js`. Tráfico decimal en GB = espectadores × horas del período × Mbps × 3600 / 8000. Por ejemplo, 10 espectadores a 6 Mbps, 2 horas al día durante 30 días producen una estimación de 1620 GB y 60 Mbps simultáneos. No incluye sobrecarga, reintentos ni una medición de vídeo real.

Los costes son importes introducidos por el administrador para el mismo período. Se suman proveedor y alojamiento y se dividen entre espectadores u horas de espectador. Un importe desconocido no se convierte a cero; hace falta indicar ambos. Cero espectadores u horas evita divisiones indefinidas. No se leen facturas, no se convierten monedas y no se infiere una tarifa a partir del tráfico. Los importes permanecen en memoria de la página y se borran al cerrar la sesión; cargar el ejemplo también vacía los importes.

`node scripts/capacity-plan.mjs --viewers 10 --mbps 6 --hours 60 --provider-slots 36 --provider-available 33 --provider-cost 100 --hosting-cost 50` usa el mismo cálculo: coste total 150, 15 por espectador y 0,25 por hora de espectador, en la moneda de los importes. Las horas de CLI corresponden al período completo.

Validación local: 36 archivos de regresiones y sintaxis aprobados con `npm test`, junto con el artefacto de Pages y las referencias de sus recursos. Las pruebas cubren unidades de tráfico, cupos totales/libres/desconocidos, importes incompletos, cero explícito, límites numéricos y reparto por espectador/hora. Chromium local no pudo instalarse en este entorno; la integración móvil se ejecuta en Quality antes de publicar.

La integración móvil de Quality comprueba costes incompletos, reparto, exceso de cupos totales/libres, inventario sin confirmar y actualizado, carga real de las hojas de estilo, ancho dentro del viewport y limpieza de costes al cerrar sesión. Guarda `capacity-mobile.png` en el artefacto `quality-evidence` para inspección visual. Usa exclusivamente datos sintéticos. La primera inspección visual detectó que el servidor de pruebas servía CSS como texto plano; se corrigió su tipo MIME y se añadió la comprobación de estilo/ancho para impedir una falsa aprobación de móvil. La comprobación reforzada detectó además que las tablas ensanchaban la cuadrícula por su mínimo implícito: se acotaron las columnas y el mínimo de sus secciones para mantener el panel dentro de la pantalla, conservando el desplazamiento de cada tabla.

Quedan pendientes señales y cuentas de prueba, métricas y facturas reales para una prueba gradual de capacidad de producción. Los ensayos de 1000 reservas y el vídeo local generado no certifican 1000 vídeos ni estabilidad 1080p del proveedor. El cron diario de recuperación permanece pendiente por decisión del propietario.

Referencias de facturación, sin precios incorporados al cálculo: https://developers.cloudflare.com/workers/platform/pricing/ y https://developers.cloudflare.com/durable-objects/platform/pricing/.
