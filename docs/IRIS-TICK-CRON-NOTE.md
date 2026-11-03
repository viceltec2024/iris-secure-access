# IRIS — Nota sobre el tick y el cron

## Estado actual (2026-11-03)

No hay cron de Sites en IRIS. Los ticks de agentes se drenan solo en
petición:

- Al abrir el panel de Creator (`GET /api/iris-creator`), que encola
  ticks de agentes aprobados y drena la cola una vez.
- Al llamar explícitamente a `process_ticks` en esa misma ruta.

El `tick()` de un agente generado es un latido: devuelve estado y
`autonomy: "supervised"`, no ejecuta tareas, no aplica cambios al
repo, no despliega y no gasta. Un agente con horario `always_on` no
está, por tanto, ejecutándose en segundo plano de forma continua.

No se debe prometer en la UI, en textos ni en ventas un "agente 24/7
activo" hasta que exista un drenado programado real y verificado.

## Cómo añadir un cron real en el futuro (no implementado aquí)

1. Definir un disparador programado en la plataforma de despliegue
   (por ejemplo, un handler `scheduled` de Cloudflare Workers, si el
   entorno Sites lo admite; este repo no usa `wrangler.jsonc` hoy, así
   que hay que verificar primero el flujo de Sites antes de añadirlo).
2. Que ese handler drene la misma cola que `processAgentTickQueue`,
   con los mismos límites (intentos, timeout, rate limit) y la misma
   regla: propuestas solo, nunca aplicación al repo sin aprobación
   humana, y `appliedToRepo=false` / `selfModifiedCore=false`.
3. Registrar cada drenado en auditoría y exponer en el panel cuándo
   fue el último tick real, para no confundir "programado" con
   "ejecutado".
4. Añadir tests que demuestren que el drenado programado no amplía
   permisos ni elude la puerta humana.

Hasta entonces, la frase correcta es: "el tick es un latido al abrir
el panel o drenar la cola".
