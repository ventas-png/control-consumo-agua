# Housekeeping · flujo por pasos, reserva STR vinculada, avisos al responsable e informe al cerrar

Migración `20261031000000_housekeeping_flujo_reserva_y_avisos`. Convierte el servicio de housekeeping en un flujo
con dos momentos reales (**Iniciar servicio** → **Finalizar limpieza**), le permite vincular una **reserva STR**
del proyecto, avisa al **responsable** de lo que tiene asignado (campana + correo, y un recordatorio una hora
antes) y, al cerrar, encola el **informe** por correo a dueño/administradores y/o a un destinatario tecleado.
Complementa [`HOUSEKEEPING_EVIDENCIAS.md`](HOUSEKEEPING_EVIDENCIAS.md) (fotos, autoría, borrado) y
[`HOUSEKEEPING_RESPONSABLE.md`](HOUSEKEEPING_RESPONSABLE.md) (el responsable es un usuario elegible).

La primera parte es la del **servidor** (base, pruebas SQL, dominio puro); la segunda, la **pantalla** (modal de
alta, selector de reserva, flujo por pasos, PDF y diálogo de notificación).

## Archivos

| Qué | Dónde |
|---|---|
| Migración (columnas, reserva, transiciones, fase «inconvenientes», avisos, recordatorio, informe) | `supabase/migrations/20261031000000_housekeeping_flujo_reserva_y_avisos.sql` |
| Suite SQL (Postgres real, sesiones emuladas, 7 mutantes) | `supabase/tests/housekeeping_flujo/` (`run.sh`, `assert.sql`, `datos.sql`, `fixture_notif.sql`, `huella.sql`) |
| Dominio puro (transiciones, horas dedicadas, etiqueta y orden de reservas, destinatario, WhatsApp, texto del informe) | `src/domain/condominios/housekeepingFlujo.ts` (+ `__tests__/housekeepingFlujo.test.ts`) |
| Acceso a las RPC (catálogo de reservas, informe) | `src/domain/condominios/housekeepingReservas.ts` |
| Fases y cupos | `src/domain/condominios/housekeepingEvidencias.ts` (`FASES_FOTO`, `MAX_FOTOS_SERVICIO`) |
| Pantalla: alta/edición en ventana emergente | `src/components/condominios/tabs/HousekeepingServicioModal.tsx` (+ `ReservaSTRPicker.tsx`) |
| Pantalla: flujo por pasos, PDF, notificación | `HousekeepingServicioPasos.tsx` (sustituye a `HousekeepingEvidencias.tsx`), `HousekeepingFaseFotos.tsx`, `housekeepingPdf.ts` |
| Pantalla: tarjetas y botones por estado | `HousekeepingTab.tsx` |
| Pruebas de interfaz | `__tests__/HousekeepingServicioModal.test.tsx`, `HousekeepingTab.flujo.test.tsx`, `HousekeepingServicioPasos.test.tsx` (+ `HousekeepingTab.responsable.test.tsx`, que sigue en verde) |
| Datos de prueba del sandbox y su retirada | `supabase/tests/housekeeping_flujo/sandbox_datos_hkf.sql`, `sandbox_limpieza_hkf.sql` |
| Campana: grupo «servicios de housekeeping» | `src/domain/comunicacion/notificationCatalog.ts` |
| Render del correo (plantillas y respaldo) | `supabase/functions/notifications-dispatcher/__tests__/render.test.ts` |
| Tipos | `src/types/condominios/comercial.ts`, `src/types/database.types.ts` |
| Recuperación | `scripts/reversion-housekeeping-flujo.sql` |
| CI | paso «Housekeeping — flujo por pasos, reserva STR, avisos e informe» en `.github/workflows/coverage.yml` |

## Estados y transiciones (`trg_hk_estado_transicion`)

| De → a | Quién | Qué sella |
|---|---|---|
| `pendiente → en_proceso` («Iniciar servicio») | cualquiera que pueda escribir el servicio | `iniciado_por/_en` (`trg_hk_sellar_ejecucion`, sin cambios) |
| `en_proceso → completado` («Guardar y dar por finalizado») | ídem | `completado_por/_en` |
| `pendiente|en_proceso → cancelado` | ídem | — |
| `pendiente → completado` (salto directo) | **solo company_owner / admin / super_admin** | `completado_*` (sin `iniciado_*`: horas «no calculables») |
| `completado → en_proceso` (reabrir), `cancelado → pendiente` (reactivar) | solo dueño/admin | reabrir vuelve a sellar `iniciado_*` |
| cualquier otra (`en_proceso → pendiente`, `completado → cancelado`…) | nadie | — |

Un salto inválido falla con `23514 HK_TRANSICION_INVALIDA: de "x" a "y"` **antes** de sellar nada (el trigger va
alfabéticamente antes que `trg_hk_sellar_ejecucion`). `service_role`/cron (sin JWT) no se restringe. Un UPDATE que
no cambia `estado` no pasa por la validación. **Horas dedicadas** = `completado_en − iniciado_en`.

`hora_inicio` pasa a significar **hora tentativa de ingreso** (base del recordatorio) y `hora_fin` la estimada de
fin; las reales siguen siendo `iniciado_en` / `completado_en`.

## Reserva STR vinculada (`trg_hk_reserva`)

- `reserva_str_id` → `reservas_str(id) ON DELETE SET NULL`. La base (DEFINER) comprueba que la reserva **existe, es
  del mismo proyecto y empresa** (`HK_RESERVA_FUERA_DE_ALCANCE`) y **no está cancelada** (`HK_RESERVA_CANCELADA`).
  Si el servicio no trae unidad, **hereda** la de la reserva; si trae otra, `HK_RESERVA_UNIDAD_DISTINTA`.
- `reserva_str_resumen` (jsonb) lo **sella la base** al vincular: código, huésped (nombre/teléfono/correo), fechas,
  horas estimadas, estado, plataforma, unidad y `vinculado_en`. Lo que mande el cliente se ignora, también en un
  UPDATE posterior. Desvincular a mano lo borra; **borrar la reserva lo conserva** (historial del servicio).
- Un operador de housekeeping **sin permiso de STR** puede vincular (la base lee la reserva por él) y la tarjeta,
  el PDF y el correo usan el resumen, no la tabla. Vincular no concede acceso a `reservas_str`.
- Catálogo del selector: `hk_reservas_vinculables(p_project_id, p_unidad_id)` — exige `hk_acceso` (42501 si no),
  devuelve solo `confirmada | en_curso` del proyecto, la unidad pedida primero, luego en curso, luego por entrada.

## Fases de fotos y cupos

`servicio_housekeeping_fotos.fase ∈ {ingreso, inconvenientes, cierre}`, **20 por fase** (`hk_fotos_preparar`, sin
cambios). El cupo de objetos por servicio en el bucket pasa de 60 a **90** (policy `hk_evidencias_insert`, recreada
íntegra). Texto `inconvenientes` junto a `hallazgos_ingreso` y `observaciones_cierre`; ninguno se purga.

## Avisos al responsable

| Momento | Canal | Clave de idempotencia (`hk_recordatorios_log`) |
|---|---|---|
| Al **asignar, reasignar o reprogramar** (fecha u hora) un servicio `pendiente` (`trg_hk_notificar_asignacion`) | campana (`in_app`, tipo `housekeeping_asignado`) + correo (`template_key housekeeping_asignado`) | `asignacion` · `fecha|hora_inicio` por usuario |
| **60 min antes** de `fecha + hora_inicio` (sin hora: 08:00) en la **zona del tenant** (`companies.timezone` vía `presencia_zona_horaria`), cron `hk_recordatorios_previos` cada 15 min | campana (`housekeeping_recordatorio`) + correo | `previo` · `fecha` por usuario |

- No se avisa a quien **se asigna a sí mismo**; el previo sí se manda aunque el responsable sea el autor.
- `en_proceso`, `completado` y `cancelado` no avisan. Reactivar un cancelado con la misma fecha|hora no duplica.
- El correo sale **solo si el responsable tiene correo** en `auth.users` y la empresa tiene **Gmail conectado**
  (`company_email_configs`; si no, el dispatcher marca la fila `failed`, no retriable). La campana es el canal
  garantizado. El payload lleva `user_id`, así que respeta `notification_channel_enabled` (opt-out por canal).
- Un outbox roto **nunca bloquea** el guardado del servicio: el trigger atrapa su error (`RAISE WARNING`), el log
  no queda marcado y el siguiente cambio vuelve a avisar.
- `hk_recordatorios_previos(p_ventana, p_ahora)` es inyectable para las pruebas y solo la ejecuta `service_role`.
  Devuelve cuántas notificaciones encoló (campana y correo cuentan por separado).

## Informe al cerrar (`hk_notificar_informe(p_servicio_id, p_a_administradores, p_email_extra)`)

- Exige `auth.uid()` y `hk_acceso` al proyecto del servicio (si no, `P0002 Servicio inexistente`); el servicio debe
  estar `completado` (`HK_INFORME_NO_COMPLETADO`); el correo extra debe ser válido (`HK_EMAIL_INVALIDO`); hace falta
  al menos un destino (`HK_SIN_DESTINATARIOS`).
- Destinatarios: **company_owner/admin activos con acceso al proyecto** (`notif_staff_de_proyecto` filtrado por
  `usuario_acceso_a_proyecto`: un admin acotado a otro proyecto no recibe) que tengan correo, y/o el correo tecleado
  (externo: sin `user_id`, sin opt-out; no se duplica si coincide con el de un administrador).
- Cuerpo HTML **sin adjunto**: servicio, unidad, fecha + hora tentativa, responsable, inicio y fin reales, **horas
  dedicadas** (`HH:MM h` o «no calculable»), reserva (del resumen), fotos por fase, estado al ingresar,
  inconvenientes y resultado (texto del usuario **escapado**), y la nota «el PDF con las fotografías se comparte
  desde la aplicación». El enlace a la app lo pone la plantilla (`{{app_url}}`): el dispatcher solo sustituye
  variables dentro de plantillas, no en el cuerpo de respaldo del payload.
- Sella `informe_enviado_en/por`. Se puede repetir (reenviar). Devuelve `{encolados, destinatarios, extra}`.
- WhatsApp **no pasa por aquí**: se comparte desde el dispositivo (Web Share con el PDF o enlace `wa.me` con el texto
  de `resumenTextoInforme`), sin API de Meta.

## Plantillas de correo

Tres plantillas globales en `notification_templates` (`company_id NULL`, `ON CONFLICT DO NOTHING`; cada tenant puede
sobreescribirlas por `company_id`): `housekeeping_asignado`, `housekeeping_recordatorio`, `housekeeping_informe`.
Variables: `{{servicio_tipo}} {{unidad}} {{fecha}} {{hora}} {{asignado_por}} {{reserva}} {{notas}} {{informe_html}}
{{app_url}}`. Si faltan, el dispatcher usa `subject`/`body` del payload tal cual.

## Pantalla

- **Alta y edición en ventana emergente** (`HousekeepingServicioModal`): tipo, unidad, **reserva STR opcional**
  (`ReservaSTRPicker` sobre `hk_reservas_vinculables`: buscador por código, huésped o unidad; la unidad vacía se
  rellena con la de la reserva; al editar, el chip usa el resumen sellado mientras carga el catálogo), fecha,
  **hora tentativa de ingreso**, hora estimada de fin, responsable (elegible), costo y notas. **Sin selector de
  estado**: el payload no lleva `estado` ni `reserva_str_resumen`. Al editar un servicio pendiente o en proceso,
  «Cancelar servicio» (confirmación, `updateCondominioRowAfectando`). Los rechazos de la base
  (`HK_TRANSICION_INVALIDA`, `HK_RESERVA_*`, `HK_RESPONSABLE_NO_ELEGIBLE`) se traducen (`mensajeErrorFlujo`,
  `mensajeErrorResponsable`).
- **Tarjeta** (`HousekeepingTab`): reserva (`🔖 código · huésped · entrada → salida`), «🕐 Ingreso tentativo»,
  «⏱ horas dedicadas» cuando está completado, «📨 Informe enviado». Botones por estado: `pendiente` →
  **«▶️ Iniciar servicio»** (confirmación → `estado = en_proceso` exigiendo una fila; `SIN_FILAS` se explica → abre
  el paso 1); `en_proceso` → **«📝 Evidencia de ingreso»** (paso 1) y **«🏁 Finalizar limpieza»** (paso 2);
  `completado | cancelado` → **«📋 Ver evidencia»** (solo lectura). ✏️ y 🗑️ se mantienen.
- **Flujo por pasos** (`HousekeepingServicioPasos`, con `HousekeepingFaseFotos` tres veces):
  - Paso 1 · Ingreso: «Estado en que se encontró la unidad» + fotos `ingreso`; botón **«⚠️ Inconvenientes
    encontrados»** que despliega su texto + fotos `inconvenientes` (se abre solo si ya hay texto o fotos);
    **Guardar** (solo textos) y «🏁 Finalizar limpieza →» (en proceso).
  - Paso 2 · Resultado: «Resultado de la limpieza» + fotos `cierre`; **«✅ Guardar y dar por finalizado»**: guarda
    los textos → `estado = completado` exigiendo una fila (la base sella `completado_en`) → recarga → diálogo
    **«¿Notificar el informe?»** (`openPromptDialog`): ☑ correo a dueño y administradores del proyecto (por defecto),
    ☐ WhatsApp (compartir el PDF desde este dispositivo), «Otro destinatario (correo o teléfono)». Correo →
    `hk_notificar_informe` (aviso con los destinatarios; recuerda que sale solo con Gmail). WhatsApp o teléfono →
    PDF por Web Share; si el dispositivo no comparte archivos, se descarga y se abre `wa.me` (teléfono tecleado o
    el del huésped de la reserva) con el texto de `resumenTextoInforme`. «Ahora no» = no notificar; se puede
    repetir desde «📋 Ver evidencia» → **«📨 Notificar informe»**.
  - Completado o cancelado: solo lectura (sin Guardar/Finalizar ni subir fotos), PDF y notificar.
- **PDF** (`housekeepingPdf.ts`): hora tentativa y fin estimado, inicio y fin reales, **horas dedicadas**, línea
  de la reserva vinculada (del resumen), tres bloques fotográficos (ingreso, inconvenientes, resultado).

## Qué NO cambia

`hk_acceso`, las policies de `servicios_housekeeping`, `trg_hk_sellar_ejecucion`, `trg_hk_responsable` ni los sellos
de autoría. Asignar o vincular no concede acceso a nada. La migración no escribe filas de datos (solo las tres
plantillas globales). Compatibilidad: columnas nuevas NULL; los servicios existentes quedan como están. **Una
integración que saltara `pendiente → completado` con un operador fallará desde ahora** (23514).

## Pruebas

```bash
PATH=/usr/lib/postgresql/16/bin:$PATH PGPORT_TEST=55563 supabase/tests/housekeeping_flujo/run.sh
npx vitest run src/domain/condominios src/domain/comunicacion supabase/functions/notifications-dispatcher
```

La suite SQL (107 comprobaciones) aplica la migración dos veces sobre el fixture (RBAC real + `reservas_str` con su
RLS + outbox + zona horaria + cron de mentira) y ejerce, **como cada persona**: A reserva (resumen sellado, herencia
de unidad, rechazos, desvincular, borrado de la reserva, mover de proyecto, operador sin STR), B fase
«inconvenientes» (20/21, fase inválida, 90/91 objetos), C transiciones (operador, dueña, admin, service_role, sin
sellar en un salto inválido), D avisos (una vez por clave, reprogramar, sin correo, autoasignación, en_proceso,
cancelado reactivado, outbox roto), E recordatorio (Guatemala y Madrid, idempotente, sin hora, en_proceso, ventana,
solo service_role, cron programado una vez), F informe (solo dueño/admin con acceso, extra, rechazos, sellos, horas
02:30, HTML escapado, reserva y fotos), G catálogo (orden, sin permiso STR, rechazos), H inventario. Siete mutantes
(proyecto de la reserva, idempotencia, rol, acceso al proyecto, sin perfil, salto, catálogo) hacen fallar la suite.
`fail_open_sin_perfil` registra las dos RPC nuevas (`hk_reservas_vinculables`, `hk_notificar_informe`) y exige que
rechacen una sesión sin perfil.

## Verificación en el sandbox (`jwpmivhvlstslncrtokb`, 2026-10-15)

Migraciones `20261031000000` (run 73) y `20261031000100` (run 74) aplicadas por `apply-migrations-sandbox.yml`;
inventario comprobado por SQL (funciones y sus ACL, triggers y su orden, columnas, CHECK de fase, policy `< 90`,
tres plantillas, cron `*/15` activo, RLS del log). Datos «ZZ HKF» (`sandbox_datos_hkf.sql`): empresa con zona
Guatemala, P1/P2, dueña g1, operadora g2 (módulo), admin P1 g3, admin P2 g4, operadora STR g5, admin de otra empresa
g6; 3 unidades; reservas en curso, futura y cancelada.

**Navegador real** (Chromium + Playwright, build de la rama contra el sandbox; capturas en
`docs/capturas/housekeeping_flujo/`):

| Paso | Resultado |
|---|---|
| g2 abre «+ Nuevo Servicio» | ventana emergente sin selector de estado; g2 preseleccionada; el catálogo muestra solo HKF-EN-CURSO y HKF-FUTURA (la cancelada no) |
| elige HKF-FUTURA | la unidad vacía pasa a «ZZ HKF Apto 2B»; chip `🔖 HKF-FUTURA · ZZ HKF Huésped Futuro · 25/10 → 29/10 · ZZ HKF Apto 2B (confirmada)` |
| Agregar | fila con `reserva_str_resumen` sellado (13 claves), sin `estado` ni resumen en el payload; **sin aviso** (se asignó a sí misma) |
| «▶️ Iniciar servicio» → Iniciar | `iniciado_en`/`iniciado_por` sellados; se abre el paso 1 con la cabecera (unidad, ingreso tentativo 09:00, reserva) |
| paso 1 | texto + 2 fotos `ingreso`; «⚠️ Inconvenientes encontrados» despliega texto + 1 foto `inconvenientes`; Guardar → PATCH solo de textos |
| «🏁 Finalizar limpieza →» → paso 2 | texto + 1 foto `cierre`; «✅ Guardar y dar por finalizado» → `completado`, `completado_en` sellado, diálogo «¿Notificar el informe?» |
| Notificar (correo ☑ + otro `externo-hkf@…`) | `hk_notificar_informe` → `{encolados: 3, destinatarios: [g1, g3, externo]}`; **g4 (admin acotado a P2) no**; 3 filas `email` en el outbox con el HTML (horas dedicadas, reserva, `ingreso 2 · inconvenientes 1 · resultado 1`); `informe_enviado_en/por` sellados |
| tarjeta | «Completado», reserva, ingreso tentativo, «⏱ 0 min», «📨 Informe enviado»; «📋 Ver evidencia» en solo lectura con «📨 Notificar informe» |
| g1 asigna a g2 (09:00) y reprograma a 10:30 | 2 avisos `in_app` + 2 `email` a g2 (`asignado por ZZ HKF Dueña`), log `asignacion:2026-11-20|09:00:00` y `|10:30:00` |

**Peticiones directas con la sesión real** (REST): g2 `pendiente → completado` → `23514 HK_TRANSICION_INVALIDA`;
reserva de otro proyecto → `HK_RESERVA_FUERA_DE_ALCANCE`; cancelada → `HK_RESERVA_CANCELADA`; `reserva_str_resumen`
«pirata» → ignorado (queda `null`); vincular la reserva en curso → hereda la unidad y sella el resumen; informe de un
pendiente → `HK_INFORME_NO_COMPLETADO`; `reservas_str` directo como g2 → `[]` (sin permiso de STR) mientras
`hk_reservas_vinculables` sí devuelve el catálogo. g1 (dueña): salto `pendiente → completado` permitido con sello,
reabrir `→ en_proceso` permitido, `en_proceso → cancelado` permitido.

**Recordatorio previo** (`hk_recordatorios_previos(60 min, p_ahora)` por SQL): a las 16:45 UTC (61 min antes de las
10:30 Guatemala) → 0; a las 15:45 UTC → 4 (campana + correo de los dos pendientes de esa franja); repetido → 0.

Los datos ZZ HKF se retiran con `sandbox_limpieza_hkf.sql` (ensayo → autorización → aplicar) tras borrar las fotos
por las RPC y drenar la cola.

## Recuperación

`scripts/reversion-housekeeping-flujo.sql`: A) silenciar avisos (cron + trigger) sin tocar nada más; B) dejar de
validar transiciones y reservas conservando columnas; C) cerrar las RPC a la API; D) CHECK de fase a dos valores y
cupo a 60 (solo sin fotos `inconvenientes`); E) reversión exacta con respaldo previo; F) comprobaciones.

## Límites conocidos

- El correo depende de Gmail por tenant; sin él el outbox marca `failed`. La campana es el canal seguro.
- El PDF con fotos no viaja por correo (el MIME del dispatcher no lleva adjuntos): el correo lleva el resumen y el
  enlace; el PDF se comparte desde la app.
- `informe_enviado_en/por` los escribe la RPC, pero no están protegidos por trigger: un UPDATE directo autorizado
  por la RLS podría alterarlos (igual que `notas`). No son sellos de autoría.
- El recordatorio previo usa el día del tenant: la clave `fecha` evita duplicados dentro del día; si se reprograma la
  hora **después** de que el previo salió, no sale otro previo ese día (sí el aviso de reprogramación).
