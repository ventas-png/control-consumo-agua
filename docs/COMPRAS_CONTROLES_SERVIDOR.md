# Compras · controles de servidor del circuito proveedor → pago

Auditoría del circuito **proveedor → contrato / orden de compra → aprobación → recepción → factura → contabilización → pago** sobre `main` en `adffbfb`, y cierre de los faltantes **confirmados**. Tres reglas guiaron la revisión:

1. Una función **no** se da por implementada porque exista una pantalla: se comprobó que persiste y que el **servidor** aplica el control, con DML directo como `authenticated` (el camino de PostgREST) en un PostgreSQL 16 local con la cadena completa de migraciones.
2. Solo se implementó lo que se reprodujo como faltante. Lo que depende de una decisión de negocio **no** se implementó: está en §5 como pregunta concreta.
3. No se tocó producción ni se reseteó el sandbox; no se fusionó ningún PR.

---

## 1. Cierre anterior (PR #924 / #925) — verificado por separado

| Qué | Resultado | Evidencia |
|---|---|---|
| PR #924 fusionado | **Sí** | `merged: true`, squash `8a4debd` (2026-10-08 14:47 UTC) |
| Migración `20261026000500` desplegada en producción | **Sí** | Workflow *Apply Migrations to Production*, corrida 37795384002, job `apply` en `success`; `supabase_migrations.schema_migrations` de producción: **864** versiones, máxima `20261026000500` (un `SELECT`, esta sesión) |
| Mismo estado en el sandbox | **Sí** | 557 versiones, máxima `20261026000500` (`SELECT`, esta sesión) |
| Huella de producción posterior actualizada | **Sí, en el repositorio** | PR #925 fusionado (`adffbfb`): `huella-produccion.json` con `main_sha 8a4debd`, 864 migraciones, máxima `20261026000500` y los 3 hashes de las funciones de auditoría cambiados. **No se recapturó la huella contra producción en esta sesión**: se verificó el contenido del archivo fusionado, no su veracidad frente al catálogo real |
| CI de `main` tras #925 | **Pendiente de confirmar** | Al consultar, *CI* y *Coverage gate* del commit `adffbfb` estaban `in_progress`; el auditor de drift y el *security guard* del commit anterior (`8a4debd`) estaban en `success` |

**Pendientes heredados que siguen abiertos** (no son de este PR y no se dan por cerrados):

- #924: el camino de **borrado de un rol** nunca se ejercitó en producción (nunca hubo un `delete_role`); se sostiene en el arnés y el sandbox (`docs/AUDITORIA_BORRADO_ROLES.md`).
- #922, límite 2: el `SELECT` de órdenes y recepciones exige empresa y proyecto pero no un permiso específico de lectura de compras (`docs/COMPRAS_CIERRE_TECNICO.md`).
- #922, límite 3: los manejadores de avisos de presupuesto y de contabilización con cola siguen capturando excepciones por diseño.
- #922, límite 1: la prueba de pantalla contra el sandbox quedó parcial.

---

## 2. Matriz de auditoría

Leyenda: **I** implementada · **P** parcial · **X** pendiente. «Evidencia» es lo que se ejecutó o leyó; «Cambio» es lo que este PR hizo (o la decisión que falta).

### A · Proveedores

| Función | Estado | Evidencia | Cambio necesario |
|---|---|---|---|
| Una identidad compartida contabilidad ↔ operación | **I** | `proveedores` es el único catálogo por empresa; 15 tablas lo referencian por `id` (contratos, OC, facturas, pagos, suministros, proformas, evaluaciones…) | `proveedores_energia` es otro catálogo (decisión previa #30, fuera de alcance) |
| Sin duplicar por reescribir el nombre | **P** | NIT/RFC: bloqueado. Carga masiva: rechaza el nombre normalizado repetido. **Alta manual: NO** — «Distribuidora Aguas del Norte», «DISTRIBUIDORA AGUAS DEL NORTE» y «…, S.A.» conviven (reproducido) | **No implementado.** Se escribió la regla (`…0400`) y se **retiró** (`…0600`): choca con una decisión de PR A probada en `proveedores_pr_a/assert_identidad §4` («los nombres parecidos conviven»). Pregunta 8 |
| Alcance por empresa y proyecto | **P** | `alcance`, `proveedor_proyectos`, `proveedor_habilitado_en`. **Pero** una orden, factura, contraseña u orden de pago de la empresa C aceptaba el proveedor o el proyecto de la empresa D (reproducido) | **Hecho** (`…0000`) |
| Código de proveedor ≠ cuenta contable | **I** | `proveedores.codigo` (único por empresa); ninguna FK lo usa | — |
| Configuración contable por ámbito | **P** | Reglas por proveedor+destino y por categoría/producto, con proyecto y vigencia (`conta_reglas_proveedor`, `conta_reglas_compra`). La **cuenta por pagar** solo existe como mapeo general del evento, no por proveedor | Pregunta 4 (§5). El destino `costo` se puede **guardar** en una regla pero **ningún renglón de orden puede ser «costo»** (reproducido): regla muerta | Pregunta 5 |
| La cuenta habitual es sugerida; renglones distintos | **I** | `orden_compra_lineas.cuenta_id` y `factura_proveedor_lineas.cuenta_id` por renglón; el servidor resuelve y valida | — |
| Autorización, suspensión, vigencia en servidor | **P** | OC (aprobar/emitir), contratos y prórrogas: sí. **Factura sin orden** de un proveedor con autorización vencida o suspendido en el proyecto: se aprueba (reproducido); solo bloquea suspendido/vetado **general** | Pregunta 3 |
| Carga masiva (plantilla, prevalidación, errores, duplicados, reintentos) | **I** | Suite `proveedores_pr_a` (ver §6); un lote reaplicado no duplica | — |
| Históricos ambiguos no se vinculan solos | **I** | `contratos_vincular_inequivocos` con `dry_run` por defecto; ambiguos a decisión manual | — |

### B · Contratos y órdenes de compra

| Función | Estado | Evidencia | Cambio necesario |
|---|---|---|---|
| Proveedor vinculado, no texto libre | **I** | Aprobar sin `proveedor_id` → `COMPRAS_PROVEEDOR_REQUERIDO` (reproducido) | — |
| Contrato relacionado | **I** | Ligadura, vigencia, monto máximo y excepción auditada (#920) | — |
| Renglones: cantidad, unidad, precio, impuestos, destino | **I** | Columnas verificadas en el catálogo; `destino_tipo` ∈ inventario / activo fijo / servicio / gasto | Otros impuestos (retenciones) no se modelan: sin solicitud |
| Empresa, proyecto y centro de costo | **P** | Empresa y proyecto: sí. **No existe** estructura de centros de costo (la pestaña «Centro de costos» es un reporte por categoría) | Sin acción: «cuando exista esa estructura» |
| Estados y aprobaciones explícitos, permisos en servidor | **P** | Máquina de estados de la orden en servidor. **Pero** ver D (permisos) y: una orden podía **nacer «emitida»** con su número sin ningún permiso, una recepción **nacer «registrada»**, una factura **nacer «aprobada»** o ponerse «pagada» a mano (reproducido) | **Hecho** (`…0300`, `…0700`): la recepción, la factura y la contraseña nacen en su estado inicial; la orden nace en borrador o, **solo con el permiso del paso**, aprobada / emitida |
| Trazabilidad de cambios posteriores a la aprobación | **P** | Condiciones económicas congeladas y devolución con revisión + evento: sí. `numero`, `proveedor_nombre`, `concepto`, `notas`, fechas e importes informativos se reescribían **sin rastro**; y una orden emitida **se borraba** con su historial (reproducido) | **Hecho** (`…0500`, `…0200`) |
| Aprobar no es gasto contabilizado | **I** | Cero asientos con origen `ordenes_compra` tras aprobar y emitir; el aviso de presupuesto es solo una notificación | — |

### C · Recepción, factura y contabilidad

| Función | Estado | Evidencia | Cambio necesario |
|---|---|---|---|
| Recepciones parciales por renglón, responsable, respaldo | **I** | `compras_tg_recepcion_registrar`, `recepcion_respaldos` (sha256, tipo, quién y cuándo) | — |
| Conformidad de servicio | **I** | `recepciones.tipo = 'servicio'`: no mueve inventario; exige responsable | — |
| Inventario solo por recepción aceptada | **I** | Solo `compras_tg_recepcion_registrar` inserta la entrada; índice único por renglón de recepción | Regresión nueva (§6, 7a–7e) |
| Vínculo factura–OC–recepción | **P** | Factura ↔ renglón de la orden y orden ↔ recepción: sí; el cuadre es **acumulado por renglón** (facturado ≤ recibido). **No** hay vínculo de una factura a una recepción concreta | Pregunta 6 |
| Facturas duplicadas | **P** | El mismo número **exacto**: bloqueado. «FAC-001», «fac-001» y « FAC 001 »: aceptadas (reproducido). Sin número: no se detecta | **Hecho** (`…0400`); sin número → solo diagnóstico |
| Cantidades e importes excedidos | **P** | Factura contra recepción/orden: bloqueado (`COMPRAS_MATCH_NO_FORZABLE`). **Pago: NO** — dos órdenes de pago de 1 000 sobre una factura de 1 000, las dos «pagadas», con dos asientos de 1 000; un pago de una factura **sin aprobar** (saltando el cuadre y el devengo); una orden de la empresa C **contra la factura de la empresa D**, que al pagarse **reescribía la factura ajena** (todo reproducido) | **Hecho** (`…0100`) |
| Diferencias con flujo de revisión | **I** | Solo precio e IVA son forzables, con justificación y autorizador sellado | — |
| Contabilización e inventario idempotentes | **I** | Índices únicos de asiento por origen y de movimiento por renglón; pruebas de concurrencia A, B, L | Escenarios T–V nuevos para pagos y duplicados |
| Anulación por reversión trazable | **P** | Anular recepción / factura / pago revierte con asiento propio (reproducido). **Borrar** una recepción registrada, una orden emitida, una factura aprobada o una orden de pago pagada: permitido por la API y dejaba existencias, acumulados y saldos descuadrados | **Hecho** (`…0200`) |
| Concurrencia, cierres, aislamiento | **P** | Recepciones y facturas serializadas. Pagos: sin bloqueo. Cierre de periodo: el reverso va a la fecha vigente | **Hecho** para pagos; ver §7, riesgo no confirmado |

### D · Seguimiento y permisos

| Función | Estado | Evidencia | Cambio necesario |
|---|---|---|---|
| Comprometido / recibido / facturado / pagado / pendiente desde la OC | **I** | `compras_seguimiento_orden` y `compras_seguimiento_lista`; lo financiero llega `NULL` a quien no ve Contabilidad | — |
| Enlaces a los documentos | **P** | El detalle **lista** recepciones, facturas, pagos, movimientos y activos con su número; **no hay navegación** al documento | No implementado: depende de dónde debe abrir (Operaciones no ve las pestañas de Contabilidad). Ver §7 |
| Permisos separados: solicitar · aprobar · recibir · contabilizar · pagar | **X** en servidor | El catálogo ya tiene `create`, `edit`, `change_status`, `approve`; la pantalla de Compras y de Cuentas por pagar ya los usan. **El servidor solo usaba `edit`**: un usuario con ver/crear/editar/eliminar, **sin** autorizar ni cambiar estado, hacía solo todo el circuito por API (reproducido: solicitó, aprobó, emitió, registró la recepción, aprobó la factura y pagó) | **Hecho** (`…0300`, `…0700`) |
| Sin límites ni autoaprobación inventados | **I** | No se añadió ninguno | Pregunta 1 |

---

## 3. Qué se implementó

Ocho migraciones incrementales (ninguna edita una ya aplicada; dos corrigen a las anteriores), una pantalla ajustada, un diagnóstico y las pruebas. Todo es **aditivo**: triggers y funciones; ninguna tabla se vacía ni se reescribe.

| Migración | Qué cierra |
|---|---|
| `20261027000000_compras_aislamiento_referencias` | Proveedor y proyecto de orden, factura, contraseña y orden de pago ∈ la empresa del documento; renglón de orden y de factura ∈ la empresa de su cabecera; cuenta del renglón de factura ∈ la contabilidad de la factura, de detalle y activa; partida de contraseña de una sola empresa |
| `20261027000100_compras_pagos_controles` | Orden de pago: nace en borrador; borrador → aprobada → pagada (y anular); solo factura **aprobada / pagada parcial**, del mismo proveedor, contabilidad y empresa; **no** más del saldo (con la factura bloqueada: dos pagos simultáneos se serializan); contraseña vigente y partidas con saldo al pagar; el servidor sella `solicitada_por`, `aprobada_por/at`, `pagada_at` |
| `20261027000200_compras_documentos_sin_borrado` | Solo se borra lo que nunca tuvo efecto (borradores sin aprobar o registrar, factura registrada sin aprobar); lo demás se anula o cancela. La purga en cascada de una empresa o un proyecto sigue funcionando |
| `20261027000300_compras_permisos_y_estados_por_accion` | Cada transición exige el permiso que la pantalla ya exigía (§4); se nace en el estado inicial; `pagada` y el monto pagado de una factura y la contraseña `pagada` solo los deja el sistema; quién aprueba una orden lo sella el servidor |
| `20261027000400_compras_duplicados_proveedor_y_factura` | Factura: el número equivalente (solo letras y dígitos) del mismo proveedor no se repite; el error es el mismo que ya conoce la pantalla. *(La regla de nombre de proveedor que traía se retiró en `…0600`.)* |
| `20261027000500_compras_orden_trazabilidad_posterior` | `numero` y `correlativo` de la orden inmutables; `proveedor_nombre` fijo tras aprobar; cualquier cambio posterior a `concepto`, `descripcion`, `notas`, `fecha_entrega_esperada`, `monto_estimado`, `monto_real` deja un evento «modificacion» (quién, cuándo, campo, valor anterior → nuevo) |
| `20261027000600_compras_proveedor_identidad_restaurada` | Devuelve `proveedores_tg_identidad()` a su cuerpo de `20261020000000` (PR A), byte a byte. Retira la regla de nombre de `…0400` |
| `20261027000700_compras_orden_nace_con_permiso` | La orden puede nacer aprobada (con `approve`) o emitida (con `approve` y `change_status`) —camino que PR A usa a propósito para validar la autorización del proveedor—; cualquier otro estado inicial se rechaza; el aprobador y la hora los sella el servidor |

**Pantalla.** En Operaciones, *Órdenes de compra* ofrece «Aprobar» y «Devolver a borrador» solo con «Autorizar / Denegar — Contabilidad», y «Emitir» y «Cancelar» solo con «Cambiar estado — Contabilidad» (la pantalla de Contabilidad ya lo hacía). El historial de seguimiento muestra las modificaciones posteriores a la aprobación.

**Diagnóstico previo (solo lectura).** `scripts/diagnostico-compras-controles.sql`: un `SELECT` que lista referencias cruzadas ya existentes, facturas pagadas por encima de su total, pagos de facturas que nunca se aprobaron, duplicados históricos y **los perfiles que dejarán de poder** aprobar/cambiar estado por API. Es la lista a revisar **antes** de fusionar.

---

## 4. Mapeo de permisos (el modelo existente, tal como lo usa la pantalla)

| Paso | Transición | Permiso de Contabilidad |
|---|---|---|
| Solicitar | crear la orden, capturar recepción, factura y orden de pago | `create` (política INSERT, sin cambios) |
| Aprobar | orden: borrador → aprobada; devolver a borrador; nacer ya aprobada | `approve` |
| Emitir / cancelar / cerrar | orden: → emitida, → cancelada, → cerrada (nacer emitida exige además `approve`) | `change_status` |
| Recibir | recepción: registrar (mueve existencias y contabiliza), anular | `change_status` (capturarla es `create`) |
| Contabilizar | factura: registrada → aprobada (cuadre + devengo) | `approve` |
| Anular | factura, orden de pago, contraseña | `change_status` |
| Pagar | orden de pago: borrador → aprobada | `approve` |
|  | orden de pago: → pagada | `change_status` |

Sigue vigente la política `UPDATE` (`edit`): el nuevo permiso se exige **además**. Administrador y propietario pasan por `conta_puede_escribir`, como siempre. No se aplican a `service_role`, a procesos sin usuario ni a los triggers de sistema (recepción, factura y pago moviendo lo recibido, facturado y pagado).

---

## 5. Decisiones sin resolver (preguntas concretas)

Nada de esto se implementó ni se asumió.

1. **Una sola persona haciendo varios pasos.** Con los permisos separados, quien tiene todos (p. ej. un administrador) aún puede solicitar, aprobar, recibir, contabilizar y pagar la misma compra. `compras_config.aprobacion_separada` impide solo que quien solicita apruebe y está **apagada**. ¿Debe haber una regla de separación entre **pasos** distintos (p. ej. quien aprueba la factura no paga) y a partir de qué importe, o se mantiene que la separación la da el reparto de permisos? *(No se inventó ningún umbral.)*
2. **Quién queda sin acceso al aplicar `…0300`.** ¿Se acepta que los usuarios con «Editar» sin «Autorizar / Denegar»/«Cambiar estado» dejen de poder esos pasos (lo que su pantalla ya no les ofrecía), o se les asigna el permiso antes? La lista sale del diagnóstico (§3).
3. **Proveedor suspendido o vencido y facturas.** Hoy una factura **sin orden** de un proveedor con autorización vencida o suspendido en el proyecto se aprueba; una factura **con orden** de un proveedor suspendido *después* de entregar **no** se aprueba, aunque `PROVEEDORES_PR_A.md` dice que lo ya emitido no se altera. ¿Debe bloquearse la factura nueva sin orden? ¿Se permite aprobar lo ya recibido de un proveedor suspendido (con motivo), para poder pagarlo?
4. **Cuenta por pagar.** Hoy es el mapeo general del evento `cxp_proveedores` por contabilidad. ¿Se necesita una cuenta por pagar **distinta por proveedor o por tipo de proveedor** (locales, extranjeros, relacionados) o basta la general por ámbito? El auxiliar por proveedor ya existe por `proveedor_id`.
5. **Destino «costo».** Las reglas aceptan el destino `costo`, pero un renglón de orden solo puede ser inventario / activo fijo / servicio / gasto: esas reglas nunca se aplican. ¿`costo` debe ser un destino de renglón con sus propias cuentas y eventos de recepción, o se retira de las reglas?
6. **Factura ↔ recepción concreta.** El cuadre es por renglón acumulado. ¿Se necesita que una factura declare **qué recepciones cubre** (p. ej. por remisión) o basta el acumulado?
7. **Enlaces desde el seguimiento.** ¿A qué pantalla debe llevar cada documento, y qué ve un usuario de Operaciones que no tiene las pestañas de Contabilidad?
8. **Proveedores con el mismo nombre escrito distinto.** Hoy el alta manual acepta «Distribuidora Aguas del Norte», «DISTRIBUIDORA AGUAS DEL NORTE» y «…, S.A.» como proveedores distintos (la carga masiva sí los rechaza). PR A decidió explícitamente que «los nombres parecidos conviven» y lo probó, así que **no** se cambió. ¿Se mantiene, o el alta manual debe rechazar (o solo advertir) el nombre normalizado repetido cuando no hay NIT/RFC ni código que distinga?
9. **Duplicados históricos.** Se listan, no se fusionan. ¿Quién decide cuáles son el mismo proveedor o la misma factura, y con qué criterio?
10. **Los de siempre** (sin cambios, siguen abiertos): umbrales y aprobadores por monto, tolerancias, presupuesto bloqueante, compra de emergencia, anticipos, notas de crédito (`COMPRAS_BLOQUE_B.md §3`).

---

## 6. Pruebas

Todo se ejecutó en esta sesión, contra un PostgreSQL 16 local con la **cadena completa** de migraciones (la misma que arman los `run.sh`), con DML directo como `authenticated` (`SET ROLE`, el camino de PostgREST) y, para la concurrencia, **sesiones reales simultáneas** (`par()`).

| Prueba | Resultado |
|---|---|
| **Nueva** `compras_bloque_b/assert_controles_servidor.sql` (aislamiento, pagos, borrado, permisos por acción, duplicados, trazabilidad, flujos completos) | **130 comprobaciones, 0 fallos** |
| La misma suite **sin** las migraciones `20261027*` (rojo) | **72 fallan**, 58 pasan (las 58 son las que confirman lo que ya funcionaba: caminos felices y bloqueos previos) |
| Concurrencia nueva: **T** (dos órdenes de pago de 700 sobre una factura de 1 000 a la vez) y **U** (el mismo número de factura escrito de dos formas, a la vez) | Con controles: se crea **una** y la otra se rechaza. Sin controles se habían reproducido **dos pagos** y **dos facturas** |
| `compras_bloque_b/run.sh` completa (orden → recepción → factura → seguimiento; concurrencia A–U; histórico append-only) | rc=0 · 904 líneas `✓` |
| `proveedores_pr_a/run.sh` (identidad, alcance, carga masiva, concurrencia M–N) | rc=0 |
| `compras_cierre_tecnico`, `compras_flujo` | rc=0 |
| `conta_tipo_cambio_mensual`, `conta_pendientes_reproceso`, `conta_reglas_imputacion` | rc=0 (adaptadas, ver abajo) |
| `personal_usuario`, `presencia_marcaje`, `puntos_verificacion` | rc=0 |
| Barrido de las demás suites de `supabase/tests/` (62, de una en una) con las seis primeras migraciones | PENDIENTE_BARRIDO |
| Guardas: `migrations-guard`, `migrations-append-only`, auditor de drift | PENDIENTE_GUARDAS |
| Pantalla: `tsc`, `eslint`, `vitest` | PENDIENTE_UI |

**Suites existentes que hubo que adaptar** (y por qué). Ninguna aserción se debilitó: cada una *capturaba por la API* un dato que ahora el servidor rechaza, así que el dato se emula como **dato histórico** (`session_replication_role = replica` o el trigger apagado solo en ese punto):

- `conta_pendientes_reproceso`: renglones con cuenta inactiva / agrupadora / de otra contabilidad (ya no se capturan) y el borrado de una factura contabilizada.
- `conta_reglas_imputacion`: borrado de una factura contabilizada (§21) y renglón con cuenta de otra contabilidad (§23c).
- `conta_tipo_cambio_mensual`: la orden de pago pasa por «aprobada» antes de «pagada».
- `compras_bloque_b/assert_seguimiento_pantalla.sql`, `assert_contratos_compras.sql`: la orden de pago pasa por «aprobada».

**Dos choques con decisiones previas, detectados al correr la batería existente** y corregidos con migraciones nuevas (no editando las aplicadas): el nombre de proveedor (`…0600`, ver pregunta 8) y que PR A inserta órdenes ya aprobadas a propósito (`…0700`).

**No ejecutado / no concluyente:** la revisión adversarial independiente de las migraciones (cinco revisores) **no se completó**: los cinco agentes terminaron con error de límite de sesión antes de entregar hallazgos; no hay hallazgos ni confirmados ni descartados de ella.

---

## 7. Límites y riesgos declarados

- **No se tocó producción.** Se hizo un `SELECT` de versiones. La huella de producción no se recapturó.
- **Sandbox.** PENDIENTE_SANDBOX
- **No se probaron `DELETE` en el sandbox** (la herramienta SQL se cuelga con ellos, límite documentado desde #922): los cuatro caminos de borrado y la cascada de una empresa o proyecto se probaron solo en el PostgreSQL desechable.
- **Sin prueba de pantalla** contra el sandbox para los cambios de Operaciones: solo pruebas de componentes (Vitest).
- **Codificación.** El PostgreSQL local de esta sesión es `SQL_ASCII`; las pruebas nuevas no dependen de acentos. Producción es UTF-8.
- **Riesgo no confirmado:** `conta_reversar_automatico` termina con `EXCEPTION WHEN OTHERS … RETURN NULL`. Si el reverso fallara, el documento quedaría anulado con su asiento vivo. No se pudo provocar el fallo (un reverso con una cuenta desactivada sí se creó), por eso no se cambió; queda anotado.
- **Compatibilidad.** Todo se restringe hacia adelante: no repara datos existentes. Los controles de alcance, de duplicados y de pagos se evalúan cuando la fila nace o cambia lo que la identifica, para no bloquear a las filas históricas.

## 8. Despliegue y recuperación

- Fusionar **dispara** `apply-migrations-prod.yml` (ocho migraciones, bajo el límite de diez por corrida). **No fusionar** sin: (a) el diagnóstico de §3 en producción, (b) respuesta a las preguntas 1 y 2, (c) la aprobación del environment. Las migraciones `…0600` y `…0700` corrigen a `…0400` y `…0300`: se despliegan juntas, en orden.
- Refrescar `huella-produccion.json` con una captura real tras el despliegue; mientras tanto el auditor las muestra como cambios planificados.
- Recuperación: cada cabecera lista cómo revertir. Son solo funciones y triggers (`DROP TRIGGER` / `DROP FUNCTION`) y la restricción ampliada de `orden_compra_eventos.tipo`; revertir reabre los defectos descritos. No hay datos que borrar ni migrar.
