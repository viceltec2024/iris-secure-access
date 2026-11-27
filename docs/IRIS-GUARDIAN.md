# IRIS Guardian — amenazas en tiempo real

Guardian protege IRIS, rastrea quién ataca y lo reporta al administrador.
Trabaja **solo con eventos reales** del registro de auditoría: si no hubo
ataques, lo dice. No inventa incidentes, ubicaciones ni acciones.

## Qué hace

| Capa | Qué detecta | Qué hace |
|------|-------------|----------|
| Guardian (bloquea) | Anular reglas, secuestro de rol, robo de claves, cambiar el núcleo, comandos de shell, **extraer instrucciones internas**, **SSRF a metadatos de la nube**, **órdenes escondidas en base64 o %xx**, mensajes enormes | Bloquea antes de llegar al modelo |
| Señales (no bloquean) | Sondas de SQL, XSS, recorrido de rutas, inyección de plantillas | Registra `GUARDIAN_ATTACK_SIGNAL` para rastrear al actor |
| Rastreo | Agrupa por cuenta (e IP si Sites la envía) | 3 bloqueos graves o 5 de cualquier tipo en 10 min → **cuarentena de 15 min** |
| Cuarentena | Ask IRIS, agente, Creator y Misiones devuelven 423 | Se registra `GUARDIAN_QUARANTINE` y se crea una **lección pendiente** |
| Postura | Modo local en producción, sin `IRIS_OWNER_EMAIL`, cobros reales, administradores o usuarios sin passkey/contraseña, **cadena de auditoría alterada** | Aparece en el panel y en el reporte con cómo arreglarlo |

Una inyección que viene en la salida del modelo o de una herramienta
(inyección indirecta) se registra, pero no cuenta para la cuarentena del
usuario.

## Qué significa "eliminar" una amenaza

Guardian **contiene**: bloquea el mensaje y pone la cuenta en cuarentena
temporal (caduca sola). Las decisiones de fondo son humanas:

- **Levantar cuarentena** o **suspender cuenta**: botones del panel, solo
  administradores con step-up (`POST /api/iris-threats`). La suspensión usa
  `updateUserAccess`, que impide suspenderse a uno mismo o dejar IRIS sin
  administradores.
- Guardian **nunca** borra usuarios, datos ni archivos del Mac, ni cambia el
  núcleo. Las lecciones que crea quedan pendientes hasta que un humano las
  aprueba.

## Dónde verlo

- Dashboard → **Guardian**: estado (sin ataques / en vigilancia / bajo
  ataque), reporte en texto, contadores por severidad, feed en vivo (cada
  5 s), cuentas rastreadas, vulnerabilidades y estado de la cadena de
  auditoría. Los usuarios que no son administradores ven solo su cuenta.
- **Ask IRIS**: "¿hay ataques?", "dame el reporte de seguridad",
  "¿nos están hackeando?". La respuesta sale del mismo registro y se lee
  en voz alta (ElevenLabs si `ELEVENLABS_API_KEY` está configurada; si no,
  la voz del navegador). Las preguntas sobre el Mac siguen yendo al SOC.
- El coordinador enruta estas preguntas a la tarea `guardian`
  (herramienta de solo lectura `threat_ledger`).

## Nombre del usuario

Ask IRIS llama a cada persona por su nombre: el que pidió ("llámame Ana",
"me llamo José Luis", "call me Bob"), si no el de su cuenta de ChatGPT, si
no la parte legible de su correo. Nunca usa el correo como nombre. El
nombre se valida (solo letras) antes de guardarlo.

## Límites honestos

- La IP solo aparece si la petición trae `cf-connecting-ip`.
- El panel sondea cada 5 s; no es un canal push.
- La revisión de postura se recalcula como mucho una vez por minuto.
- Las amenazas al Mac (firewall, FileVault, malware) siguen en el SOC y sus
  remediaciones siguen necesitando aprobación.
