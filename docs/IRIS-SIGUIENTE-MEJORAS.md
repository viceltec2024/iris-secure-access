# IRIS — Siguiente tanda de mejoras (después del cierre, PR #37)

Base: rama `iris/excepcional-cierre-2026-11-03` (PR #37, en borrador).
Esta tanda: rama nueva en borrador, sin merge a main y sin despliegue.

## 1. Segunda fuente live: fetcher MDN

- Nuevo `lib/iris-mdn.ts`: consulta solo `https://developer.mozilla.org/api/v1/search`
  (sin clave, sin datos de usuario más allá de la consulta), con timeout de
  4 s, cuerpo máximo de 300 000 caracteres, 5 documentos como máximo y
  filtro de relevancia: un hit MDN solo cuenta si comparte palabras
  significativas con el tema.
- Solo para preguntas técnicas (`isTechnicalTopic`): MDN es una referencia
  de tecnología web, no una enciclopedia general. Para temas no técnicos
  devuelve null y no contamina la respuesta.
- `lib/iris-cited-answer.ts` (`irisWorldAnswerWithCitations`) ahora consulta
  Wikipedia y MDN en paralelo, en la misma ejecución: dos hosts distintos
  permitidos = `verificado`; uno solo = `parcial`; ninguno = `no_verificado`
  con "No sé" en primera línea. Nunca se cita una fuente no consultada.
- Si la API de búsqueda de MDN cambia de forma, el fetcher devuelve null
  (nunca inventa un hit): la respuesta vuelve a ser parcial con Wikipedia.

## 2. Aislamiento por organización en dispositivos, alertas, wallet y compras

- Nuevo `lib/iris-org-scope.ts` (puro, probado): claves con alcance
  (`iris_local_wallet_session:org:<id>`, `iris_purchase_desk:org:<id>`),
  lectura org-primero / legada-después, escritura por org cuando hay
  contexto, y filtro de filas por miembros activos de la organización.
- Aplicado en `app/api/security-state/route.ts` (GET: dispositivos, y por
  derivación alertas, remediaciones y comandos; wallet y compras con
  lectura con alcance; PATCH de compra con la misma clave), en
  `app/api/wallet-session/route.ts` y en `app/api/iris-purchases/route.ts`.
- Retrocompatibilidad: sin contexto de org se conserva el filtro por
  email; las filas legadas por email siguen legibles y no se borran ni
  se reasignan en silencio. La desconexión de wallet borra ambas claves
  para no dejar una sesión legada legible por fallback.
- Excepciones y límites, documentados:
  - El rol global ADMIN de plataforma sigue viendo todos los dispositivos,
    como ya hacía security-state. Es un rol de plataforma, no de org;
    los ADMIN de organización solo ven su propia organización.
  - Las mutaciones de security-state (confiar app, rotar código, borrar
    dispositivo, acciones sobre alertas) siguen siendo fail-closed:
    solo propietario o ADMIN global. Un compañero de org ve el
    dispositivo en el GET, pero no puede mutarlo desde esa ruta.
  - Los incidentes no tienen enlace a dispositivo en el esquema, así que
    siguen con el filtro anterior (ADMIN todos, resto solo los que
    actualizó). La tabla de incidentes por dispositivo sigue pendiente.
- **Migración de esquema pendiente (no hecha aquí, a propósito):** añadir
  `organization_id` a `devices` y `security_alerts` con backfill desde
  los miembros de cada org. Hacerla sin revisión propia rompería datos
  existentes; el filtro por miembros de esta entrega es la protección
  en la ruta, no un cambio de esquema.

## 3. Panel CAS: la UI envía expectedRevision

- El panel de memoria ya lo enviaba (`iris-memory-panel.tsx`).
- Ahora también: `iris-creator-panel.tsx` guarda la revisión del
  escritorio que devuelve la API y la envía en la aprobación
  (`action: "approve"`); `iris-mission-panel.tsx` la envía en la
  aceptación (`action: "approve"`). Si el servidor responde
  `revision_conflict`, el panel recarga el escritorio y avisa en español
  o inglés de que debe revisarse de nuevo antes de aprobar.
- El servidor ya exigía CAS solo cuando el cliente enviaba la revisión;
  ahora la UI la envía siempre que la tiene, así que el CAS se activa
  de verdad desde el panel. Rechazos y cancelaciones no la envían
  porque el servidor no la exige en esas acciones.

## Pruebas

`tests/iris-siguiente-mejoras.test.mjs`: MDN (técnico/no técnico, hit
real con URL permitida, irrelevante/fallo/sobretamaño = null, Wikipedia
+ MDN = verificado), claves con alcance, filtro org (otra org no lee,
sin contexto solo lo propio, ADMIN global excepción) y CAS (revisión
obsoleta = revision_conflict, vigente = aprobado/aceptado, tanto en
Creator como en Mission).

## Verificación pendiente (no afirmada)

- Lint (`npm run lint`) y build: sin `node_modules` en este entorno, no
  se verificaron; los paneles TSX y las rutas nuevas solo están
  verificados por lectura de código y por tests de sus módulos puros.
- Live con clave/sesión/DB: no probado. El fetcher MDN live real y el
  flujo de org con miembros reales en DB tampoco.
- CI de esta PR y de la cadena (#31–#37): pendiente. En particular, la
  revisión de CI paralela informó que el PR #37 tiene Lint en fallo;
  esta rama hereda esa base, así que el merge de la cadena no debe
  hacerse hasta diagnosticar ese fallo, aunque los tests de nodo pasen.
