# Validación Android y Firestick · 1.0.12

Revisión verificada: f1b2a04b76666627129bb3ea68e5efdce1b1216d, repositorio juancanta89-tech/SnapTvNow. Android source check 38085780730 y Sign production APK 38085780725 completaron correctamente. Los informes XML del artefacto 11682257192 contienen 159 pruebas, cero fallos, cero errores y cero omisiones. La APK del artefacto 11681907567 corresponde a 1.0.12, versionCode 41 y paquete com.snaptvnow.tv; no es la variante debug/VPN. Se verificaron firma APK v2 y digest del contenido, y el certificado coincide con 1.0.11. No se generó ni sustituyó una clave de producción.

Evidencia agregada: verification/2026-10-10-android-v1.0.12.json. La APK no se añade al repositorio de Pages. Las pruebas automáticas no certifican decodificación, sonido, permisos de instalación, VPN ni control remoto de un dispositivo físico.

## Prueba física pendiente

Registrar versión, tipo de dispositivo y resultado, sin credenciales, claves VPN ni enlaces privados. Hacer primero teléfono y después Firestick, usando la APK firmada y una cuenta de prueba autorizada.

| Prueba | Resultado esperado |
| --- | --- |
| Instalar sobre la versión de producción anterior | El sistema ofrece actualizar; conserva los datos y abre SNAPTVNOW. |
| TV 1080p, sonido y cambios de canal | Reproduce al menos 15 minutos; audio continuo; cambiar cinco canales sin cierre ni bloqueo. |
| Película: avance, retroceso y reanudación | Saltar dos minutos hacia delante y uno hacia atrás; salir y volver; Continuar retoma cerca de la posición guardada. |
| Serie y siguiente episodio | Reproduce el episodio elegido y conserva la cola y el progreso al cambiar. |
| Regresar desde otra app y cambio de red | Mantiene la cuenta; presenta el fallo de red y recupera reproducción cuando vuelve la conexión. |
| Firestick: mando y pantalla | El foco y Atrás funcionan; controles accesibles y pantalla completa. |

La instalación mediante el actualizador nuevo requiere además una URL HTTPS de una APK de versión superior, permiso de instalación y validación en cada plataforma. El resultado de las pruebas automatizadas del descargador/instalador no certifica esa instalación física futura.

El botón de diagnóstico de la web se conserva. Un fallo físico debe registrarse con acción, resultado y hora para correlacionarlo con las métricas agregadas del panel. No se declara aprobada la prueba física sin su resultado.
