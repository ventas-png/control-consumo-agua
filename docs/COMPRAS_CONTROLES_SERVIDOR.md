# Compras · controles de servidor del circuito proveedor → pago

Auditoría del circuito **proveedor → contrato / orden de compra → aprobación → recepción → factura → contabilización → pago** sobre `main` en `adffbfb`, cierre de los faltantes **confirmados** y cierre de los **hallazgos de la revisión adversarial** del PR #926. Reglas que guiaron el trabajo:

1. Una función **no** se da por implementada porque exista una pantalla: se comprobó que persiste y que el **servidor** aplica el control, con DML directo como `authenticated` (el camino de PostgREST) en un PostgreSQL 16 local con la cadena completa de migraciones.
2. Solo se implementó lo que se **reprodujo** como faltante. Lo que depende de una decisión de negocio **no** se implementó: está en §6 como pregunta concreta.
3. Un error contable **no se oculta** dejando el pago como exitoso: si el asiento o su reverso no se puede generar, la operación entera falla.
4. No se tocó producción ni se reseteó el sandbox; no se fusionó ningún PR; ninguna migración ya aplicada al sandbox se editó y ningún control se debilitó para que una prueba pasara.

## 0. Estado en una mirada

| Pregunta | Respuesta |
|---|---|
| ¿Se puede fusionar? | **No todavía.** El PR sigue en **borrador**. Faltan las decisiones de §6 (P-1 y P-2 antes de desplegar) y la aprobación del *environment* de producción |
| ¿El módulo está cerrado? | **No se declara cerrado.** Quedan 1 hallazgo confirmado sin corregir (RG-4), las decisiones de negocio de §6 y los límites de §9 (p. ej. 41 tablas fuera del circuito con la misma clase de trigger, sin prueba de pantalla de Contabilidad) |
| Migraciones pendientes frente al tope de diez por despliegue | **9** (`20261027000000` … `0800`); el tope de `MAX_APPLY = 10` **no se tocó** y deja una de margen |
| Revisión adversarial | 37 hallazgos: **24** confirmados y corregidos en la migración nueva, **1** confirmado sin corregir (decisión), **2** de pantalla corregidos, **10** documentales/de despliegue corregidos; **0** descartados |
| Producción | Solo lectura: el diagnóstico (§8). **Nada escrito.** |
| Sandbox | El existente, sin resetear: migración `0800` aplicada con `apply-migrations-sandbox.yml`; guion reversible y prueba de pantalla repetidos (§7) |


---

## 1. Cierre anterior (PR #924 / #925) — verificado por separado

| Qué | Resultado | Evidencia |
|---|---|---|
| PR #924 fusionado | **Sí** | `merged: true`, squash `8a4debd` (2026-10-08 14:47 UTC) |
| Migración `20261026000500` desplegada en producción | **Sí** | Workflow *Apply Migrations to Production*, corrida 37795384002, job `apply` en `success`; `supabase_migrations.schema_migrations` de producción: **864** versiones, máxima `20261026000500` (un `SELECT`) |
| Mismo estado en el sandbox | **Sí** | 557 versiones, máxima `20261026000500` (`SELECT`) |
| Huella de producción posterior actualizada | **Sí, en el repositorio** | PR #925 fusionado (`adffbfb`): `huella-produccion.json` con `main_sha 8a4debd`, 864 migraciones, máxima `20261026000500` y los 3 hashes de las funciones de auditoría cambiados. **No se recapturó la huella contra producción en esta sesión**: se verificó el contenido del archivo fusionado, no su veracidad frente al catálogo real |
| CI de `main` tras #925 | **Terminado: `success`** | Workflow *CI* de `adffbfb`, corrida 37800424655, `success` (la fila anterior decía «pendiente de confirmar»). Los chequeos programados de salud siguen en `success` sobre ese mismo commit |

**Pendientes heredados que siguen abiertos** (no son de este PR y no se dan por cerrados):

- #924: el camino de **borrado de un rol** nunca se ejercitó en producción (nunca hubo un `delete_role`); se sostiene en el arnés y el sandbox (`docs/AUDITORIA_BORRADO_ROLES.md`).
- #922, límite 2: el `SELECT` de órdenes y recepciones exige empresa y proyecto pero no un permiso específico de lectura de compras (`docs/COMPRAS_CIERRE_TECNICO.md`).
- #922, límite 3: los manejadores de avisos de presupuesto y de contabilización con cola siguen capturando excepciones por diseño. *(El de **pagos** ya no: CONC-04.)*
- #922, límite 1: la prueba de pantalla contra el sandbox quedó parcial; **este PR añade la de Operaciones › Órdenes de compra** (§7), no la de Contabilidad.

---

## 2. Matriz de auditoría

Leyenda: **I** implementada · **P** parcial · **X** pendiente. «Evidencia» es lo que se ejecutó o leyó; «Cambio» es lo que este PR hizo (o la decisión que falta).

### A · Proveedores

| Función | Estado | Evidencia | Cambio necesario |
|---|---|---|---|
| Una identidad compartida contabilidad ↔ operación | **I** | `proveedores` es el único catálogo por empresa; 15 tablas lo referencian por `id` (contratos, OC, facturas, pagos, suministros, proformas, evaluaciones…) | `proveedores_energia` es otro catálogo (decisión previa #30, fuera de alcance) |
| Sin duplicar por reescribir el nombre | **P** | NIT/RFC: bloqueado. Carga masiva: rechaza el nombre normalizado repetido. **Alta manual: NO** — «Distribuidora Aguas del Norte», «DISTRIBUIDORA AGUAS DEL NORTE» y «…, S.A.» conviven (reproducido) | **No implementado.** Se escribió la regla (`…0400`) y se **retiró** (`…0600`): choca con una decisión de PR A probada en `proveedores_pr_a/assert_identidad §4` («los nombres parecidos conviven»). **P-5** |
| Alcance por empresa y proyecto | **P** | `alcance`, `proveedor_proyectos`, `proveedor_habilitado_en`. **Pero** una orden, factura, contraseña u orden de pago de la empresa C aceptaba el proveedor o el proyecto de la empresa D (reproducido); y activos fijos, gastos y la obra de la orden también (EV-10) | **Hecho** (`…0000`, `…0800`) |
| Código de proveedor ≠ cuenta contable | **I** | `proveedores.codigo` (único por empresa); ninguna FK lo usa | — |
| Configuración contable por ámbito | **P** | Reglas por proveedor+destino y por categoría/producto, con proyecto y vigencia (`conta_reglas_proveedor`, `conta_reglas_compra`). La **cuenta por pagar** solo existe como mapeo general del evento, no por proveedor | **P-4**. El destino `costo` se puede **guardar** en una regla pero **ningún renglón de orden puede ser «costo»** (reproducido): regla muerta. **P-7** |
| La cuenta habitual es sugerida; renglones distintos | **I** | `orden_compra_lineas.cuenta_id` y `factura_proveedor_lineas.cuenta_id` por renglón; el servidor resuelve y valida | — |
| Autorización, suspensión, vigencia en servidor | **P** | OC (aprobar/emitir), contratos y prórrogas: sí. **Factura sin orden** de un proveedor con autorización vencida o suspendido en el proyecto: se aprueba (reproducido); solo bloquea suspendido/vetado **general** | **P-3** |
| Carga masiva (plantilla, prevalidación, errores, duplicados, reintentos) | **I** | Suite `proveedores_pr_a` (ver §7); un lote reaplicado no duplica | — |
| Históricos ambiguos no se vinculan solos | **P** *(antes I)* | Solo para **contratos, suministros y proformas** (`contratos_vincular_inequivocos`, `operaciones_vincular_proveedor`, con `dry_run` por defecto). `ordenes_compra.proveedor_id` y `gastos_condominio.proveedor_id` admiten `NULL` y no tienen vista previa ni vinculación (VER-10) | Las órdenes no borrador sin proveedor salen en el diagnóstico (`orden_incoherente`). **P-10** |

### B · Contratos y órdenes de compra

| Función | Estado | Evidencia | Cambio necesario |
|---|---|---|---|
| Proveedor vinculado, no texto libre | **I** | Aprobar sin `proveedor_id` → `COMPRAS_PROVEEDOR_REQUERIDO` (reproducido) | — |
| Contrato relacionado | **I** | Ligadura, vigencia, monto máximo y excepción auditada (#920) | — |
| Renglones: cantidad, unidad, precio, impuestos, destino | **I** | Columnas verificadas en el catálogo; `destino_tipo` ∈ inventario / activo fijo / servicio / gasto | Otros impuestos (retenciones) no se modelan: sin solicitud |
| Empresa, proyecto y centro de costo | **P** | Empresa y proyecto: sí. **No existe** estructura de centros de costo (la pestaña «Centro de costos» es un reporte por categoría) | Sin acción: «cuando exista esa estructura» |
| Estados y aprobaciones explícitos, permisos en servidor | **P** | Máquina de estados de la orden en servidor. **Pero** una orden podía **nacer «emitida»**, una recepción **nacer «registrada»**, una factura **nacer «aprobada»** o ponerse «pagada» a mano; y los estados **retrocedían** con solo «editar» (reproducido) | **Hecho** (`…0300`, `…0700`, `…0800`): cada documento nace en su estado inicial (la orden, en borrador o —con el permiso del paso y sin separación activa— aprobada/emitida) y **no retrocede** sin su acción propia |
| Trazabilidad de cambios posteriores a la aprobación | **P** | Condiciones económicas congeladas y devolución con revisión + evento: sí. `numero`, `proveedor_nombre`, `concepto`, `notas`, fechas, **importes y sellos** se reescribían **sin rastro**; y una orden emitida **se borraba** con su historial (reproducido) | **Hecho** (`…0500`, `…0200`, `…0800`) |
| Aprobar no es gasto contabilizado | **I** | Cero asientos con origen `ordenes_compra` tras aprobar y emitir; el aviso de presupuesto es solo una notificación | — |

### C · Recepción, factura y contabilidad

| Función | Estado | Evidencia | Cambio necesario |
|---|---|---|---|
| Recepciones parciales por renglón, responsable, respaldo | **P** *(antes I)* | `compras_tg_recepcion_registrar`, `recepcion_respaldos` (sha256, tipo, quién y cuándo). **El respaldo es opcional** y el responsable, por defecto, es quien registra (VER-11): se registró una recepción sin respaldo y el stock subió | **P-8** |
| Conformidad de servicio | **I** | `recepciones.tipo = 'servicio'`: no mueve inventario; exige responsable | — |
| Inventario solo por recepción aceptada | **I** *(precisado)* | **La compra** no mueve inventario sin recepción aceptada: solo `compras_tg_recepcion_registrar` inserta la entrada desde el circuito; índice único por renglón. Las **entradas manuales** de Suministros (`movimientos_suministro`, permiso de pestaña) siguen permitidas (VER-07) | Regresión (§7, 7a–7e). **P-9** |
| Vínculo factura–OC–recepción | **P** | Factura ↔ renglón de la orden y orden ↔ recepción: sí; el cuadre es **acumulado por renglón** (facturado ≤ recibido) y ahora ese acumulado **solo lo mueve el sistema** (EV-04). **No** hay vínculo de una factura a una recepción concreta | **P-11** |
| Facturas duplicadas | **P** | El mismo número **exacto**: bloqueado. «FAC-001», «fac-001» y « FAC 001 »: bloqueado (`…0400`, ahora con el índice usado: DEP-2). Falso positivo conocido: «1-23» / «12-3» (RG-4). Sin número: no se detecta | Sin número → solo diagnóstico. **P-6** |
| Cantidades e importes excedidos | **I** | Factura contra recepción/orden: bloqueado (`COMPRAS_MATCH_NO_FORZABLE`). Pago: no más del saldo, solo factura aprobada, del mismo proveedor, contabilidad y empresa, una orden viva por contraseña, total de la contraseña derivado (`…0100`, `…0800`) | — |
| Diferencias con flujo de revisión | **I** | Solo precio e IVA son forzables, con justificación y autorizador sellado | — |
| Contabilización e inventario idempotentes | **P** *(antes I)* | Asientos y movimientos: índices únicos por origen y por renglón; escenarios A, B, L. **La creación del pago no lo era** (VER-09): ahora tiene clave de idempotencia | Escenarios T–V de `run.sh` y V… del cierre adversarial |
| Anulación por reversión trazable | **I** | Anular recepción / factura / pago revierte con asiento propio; **si el reverso falla, la anulación falla** (CONC-04). Borrar lo que ya tuvo efecto: bloqueado por evidencia (`…0200`, VER-02) | Anular una factura pagada son dos pasos (§6, P-12) |
| Concurrencia, cierres, aislamiento | **I** | Recepciones y facturas serializadas; pagos con orden único de bloqueo y sin interbloqueo (CONC-01…03); cierre de periodo: el reverso va a la fecha vigente | — |

### D · Seguimiento y permisos

| Función | Estado | Evidencia | Cambio necesario |
|---|---|---|---|
| Comprometido / recibido / facturado / pagado / pendiente desde la OC | **I** | `compras_seguimiento_orden` y `compras_seguimiento_lista`; lo financiero llega `NULL` a quien no ve Contabilidad | — |
| Enlaces a los documentos | **P** | El detalle **lista** recepciones, facturas, pagos, movimientos y activos; con número las recepciones, facturas y activos (los pagos muestran fecha, método y referencia; los movimientos, cantidad y fecha). **No hay navegación** al documento | No implementado: depende de dónde debe abrir (Operaciones no ve las pestañas de Contabilidad). **P-13** |
| Permisos separados: solicitar · aprobar · recibir · contabilizar · pagar | **P** *(antes «Hecho»)* | El servidor exige un permiso **por paso**, pero hay solo **dos llaves** para cinco pasos: `approve` (aprobar orden, contabilizar factura, aprobar pago) y `change_status` (emitir, recibir, anular, pagar). «Solicitar» lo permite el rol `operator` sin `create` (VER-05, VER-06) | **P-1**, **P-14** |
| Sin límites ni autoaprobación inventados | **I** | No se añadió ninguno | **P-1** |

---


## 3. Revisión adversarial: matriz hallazgo → reproducción → corrección → prueba → resultado

La revisión independiente entregó **37 hallazgos**. Cada uno se trató igual: primero una **prueba que falla hoy** (SQL contra un PostgreSQL real, con DML directo como `authenticated`; y **sesiones reales simultáneas** cuando es de concurrencia), después la corrección, y la misma prueba en verde. Nada se corrigió sin reproducirlo antes, y ningún control se debilitó para que una prueba pasara. Resultado:

| Clase | Cantidad |
|---|---|
| Confirmados con prueba roja y corregidos en la migración `20261027000800` | **24** |
| Confirmado con prueba roja y **sin corregir** (espera una decisión de negocio) | **1** (RG-4) |
| Confirmados y corregidos en la pantalla (commit anterior del PR) | **2** (RG-1, RG-2) |
| Documentales / de despliegue (corregidos en texto, script o procedimiento) | **10** |
| **Descartados como falsos** | **0** |

«Rojo» = la prueba sobre la base **sin** la migración 0800 (las cifras son errores/aserciones que fallan, incluidos los montajes que ya no se pueden armar); «verde» = comprobaciones `✓` con la migración. Las pruebas viven en `supabase/tests/compras_bloque_b/hallazgos/<ID>.sql` (+ `<ID>.conc.sh`) y las ejecuta `run.sh` (§5r, §6b). **Pieza** = número de la sección de la migración.

### 3.1 Pagos concurrentes y consistencia pago ↔ asiento (la prioridad)

| ID · sev. | Hallazgo y reproducción | Corrección (0800) | Prueba | Resultado |
|---|---|---|---|---|
| **CONC-01** · alta | Pagar toma factura → folio contable; anular un pago ya pagado toma folio → asiento → factura: **interbloqueo real**. Con dos sesiones, el pago quedó «pagada» con **0 asientos** (`deadlock detected` solo como aviso); con 20 anulaciones y 20 pagos simultáneos de la misma factura: 6 errores 40P01 y 1 pago sin asiento | Pieza 1: `trg_compras_orden_pago_bloqueo` toma, en un solo orden y antes del folio, contraseña → facturas por `id` → asientos vivos del pago | `CONC-01.sql` + `CONC-01.conc.sh` | Rojo 18 · conc. rc=1. Verde 16 ✓ · conc.: 20+20 simultáneas, **0 errores, 0 interbloqueos, 0 pagos sin asiento** |
| **CONC-04** · media | `conta_generar_asiento` y `conta_reversar_automatico` terminan en `EXCEPTION WHEN OTHERS … RETURN NULL`: con `lock_timeout` el pago queda «pagada» **sin asiento** y la anulación deja el asiento original **vivo y sin reverso**, solo con un `WARNING`. Es el «riesgo no confirmado» del documento anterior: **ahora sí se provocó** | Pieza 2: `trg_conta_ordenes_pago_verificar` (AFTER) verifica la postcondición contable y **hace fallar la transacción**: `COMPRAS_PAGO_SIN_ASIENTO` / `COMPRAS_PAGO_REVERSO_FALLIDO`; cancela el borrador pendiente de tipo de cambio al anular | `CONC-04.sql` + `CONC-04.conc.sh` | Rojo 36 · conc. rc=1 (pago «pagada» sin asiento; anulada con asiento vivo). Verde 45 ✓ · conc. rc=0: el pago y la anulación **fallan enteros** y el reintento con el folio libre termina bien |
| **CONC-02** · media | Dos órdenes de pago vivas sobre la misma contraseña se pagan a la vez: la contraseña de 400 queda con **800 pagados** y 2 asientos | Pieza 3: bloqueo de la contraseña + índice único parcial `uq_ordenes_pago_contrasena_viva` (se crea solo si no hay duplicados históricos; en producción no hay: §8) | `CONC-02.sql` + `CONC-02.conc.sh` | Rojo 2 · conc. rc=1. Verde 13 ✓ · conc. rc=0: se paga **una** |
| **CONC-03** · media | Editar una partida de la contraseña mientras se paga su orden: la factura queda con **900 pagados** contra una orden y un asiento de 100 | Pieza 4: `trg_compras_bloqueo_partida` toma la contraseña antes de aceptar el cambio de partida | `CONC-03.sql` + `CONC-03.conc.sh` | Rojo 3 · conc. rc=1. Verde 12 ✓ · conc. rc=0 |
| **VER-09** · media | La orden de pago y la contraseña **no tenían clave de idempotencia**: el mismo `INSERT` dos veces (doble clic) dejó **2 órdenes «pagada»**, 800 pagados de 1 000; con dos sesiones simultáneas igual | Pieza 20 + pantalla: columna opcional `clave_idempotencia` con índice único parcial por empresa (`uq_ordenes_pago_clave`, `uq_contrasenas_pago_clave`), inmutable después de crearla; la pantalla manda una clave por apertura del formulario y trata el choque con ESA clave como «ya se guardó» | `VER-09.sql` + `VER-09.conc.sh` · Vitest `pagosIdempotentes.test.tsx` | Rojo 70. Verde 58 ✓ · conc.: misma clave a la vez → **una** orden; claves distintas → dos; 6 sesiones × 3 rondas → una por ronda |

### 3.2 Aislamiento empresa / proyecto / proveedor

| ID · sev. | Hallazgo y reproducción | Corrección (0800) | Prueba | Resultado |
|---|---|---|---|---|
| **EV-01** · alta | Orden de pago **por contraseña** con proveedor y proyecto distintos de la contraseña y de sus facturas: la factura queda pagada y el asiento se publica **en otra contabilidad** (el devengo en C1, el pago en C2) | Pieza 5: `trg_compras_orden_pago_controles_contrasena` (misma empresa, proveedor y proyecto que la contraseña y cada factura) y `trg_compras_contrasena_cabecera_fija` (empresa, proyecto, proveedor y moneda de la contraseña no cambian) | `EV-01.sql` | Rojo 11. Verde 31 ✓ |
| **EV-02** · alta | `contrasenas_pago.total` editable: las facturas quedan **pagadas por 1 000 y el asiento por 1.00**; mover partidas de una contraseña con orden viva descuadra igual | Pieza 6: `trg_compras_contrasena_total_derivado` (el total lo deriva el servidor), `trg_compras_orden_pago_controles_partidas` y `trg_compras_bloqueo_partida_orden` | `EV-02.sql` | Rojo 10. Verde 28 ✓ |
| **EV-09** · media | Los triggers `SECURITY DEFINER` corren **antes de la RLS** y devuelven en el mensaje de error número, fecha, importe y estado de documentos de **otra empresa**; con la reproducción completa son **13 tablas**, y el rol `anon` (sin sesión) también lo lee en 10 donde conserva DML; una orden de pago de C contra la contraseña de D devolvía su número, total y estado | Pieza 16: guardián `trg_00_compras_rls_empresa` en 18 tablas (mismo error que la RLS, solo si la RLS aplica al rol; no toca `service_role` ni las RPC), guardián propio de `recepcion_respaldos`, `trg_compras_alcance_orden_pago_ref`, `proveedor_habilitado()` sin oráculo y mensajes sin datos de proyectos que la persona no ve | `EV-09.sql` + `EV-09.conc.sh` | Rojo 25 · conc. rc=1. Verde 42 ✓ · conc. rc=0. **Residual no corregido:** `movimientos_suministro` (UUID del suministro ajeno) y otras 41 tablas del producto con la misma clase de trigger: §9 |
| **EV-10** · baja | `activos_fijos.proveedor_id`, `gastos_condominio.proveedor_id` y `ordenes_compra.obra_id` aceptaban un proveedor/obra de **otra empresa** (el gasto además contabiliza) | Pieza 17: `trg_compras_alcance_activo`, `trg_compras_alcance_gasto`, `trg_compras_alcance_orden_obra` (solo lo que nace o cambia) | `EV-10.sql` | Rojo 10. Verde 20 ✓ |
| **DEP-6** · baja | El trigger de alcance revalida **las tres** referencias cuando cambia una: una fila histórica con proveedor ajeno no se podía mover de proyecto, ni se podía purgar el proyecto | Pieza 18: `compras_tg_alcance_documento` reescrita para validar solo lo que cambia | `DEP-6.sql` | Rojo 42. Verde 22 ✓ |
| **RG-3 / DEP-5** · baja | Borrar un proyecto con una orden de pago **aprobada o pagada** fallaba con `COMPRAS_PAGO_INMUTABLE`: la acción `ON DELETE SET NULL` de `project_id` se tomaba por una edición. La matriz de purga (168 casos): el PR rompía **16** que antes funcionaban | Pieza 16 y 5: guarda en `compras_tg_orden_pago_controles` y en la función de EV-01: solo se deja pasar si lo único que cambia es `project_id` de un proyecto **que ya no existe** a `NULL` | `RG-3.sql`, `DEP-5.sql` | Rojo 58 / 67. Verde 34 / 16 ✓; la matriz de purga queda **idéntica a la base sin el PR** (44 bloqueos preexistentes, ajenos) |

### 3.3 Retroceso de estados, evidencia y sellos

| ID · sev. | Hallazgo y reproducción | Corrección (0800) | Prueba | Resultado |
|---|---|---|---|---|
| **EV-03** · alta | Los estados **retroceden** con solo «editar»: factura aprobada → registrada, recepción registrada → borrador; luego se borra y quedan acumulados, existencias y un asiento «publicado» **sin documento** | Pieza 7: máquinas de estado `trg_zcompras_{factura,recepcion,contrasena}_estados` (`COMPRAS_*_TRANSICION`); los retrocesos legítimos son las acciones propias (anular, devolver) | `EV-03.sql` | Rojo 15. Verde 61 ✓ |
| **VER-02** · alta | El no-borrado de 0200 se evade: bastaba retroceder y limpiar el sello (`aprobada_at`) y borrar | Pieza 8: la guarda decide por **evidencia que nadie edita** (asiento, intento de contabilización, kardex, activos) | `VER-02.sql` | Rojo 22. Verde 43 ✓ |
| **VER-04** · alta | Una factura **aprobada y contabilizada** se desvinculaba de su orden, cambiaba de proyecto, moneda y número con solo «editar»; el asiento seguía en el proyecto viejo | Pieza 9: `trg_zcompras_{factura,recepcion}_identidad` y `trg_zcompras_factura_total_cuadra` | `VER-04.sql` | Rojo 22. Verde 54 ✓ |
| **EV-05** · media | `total`, `subtotal`, `iva` de una orden aprobada/emitida se reescribían (1 000 → 1.00) **sin evento**; ese total es el comprometido | Pieza 10: `trg_compras_01_importes_orden` (derivados de los renglones; inmutables fuera de borrador) y `trg_compras_oc_motivos` | `EV-05.sql` + `EV-05.conc.sh` | Rojo 19 · conc. rc=1 (aprobar contra edición de renglón). Verde 33 ✓ · conc. rc=0 |
| **EV-06** · media | `aprobada_por/at`, `pagada_at`, `registrada_at`, `emitida_at`, `match_forzado_por` los sella el servidor **solo en la transición**; antes y después los forjaba cualquiera | Pieza 11: `trg_compras_00_sellos_{orden,recepcion,factura,orden_pago,contrasena}` + `compras_sello_conservar` | `EV-06.sql` | Rojo 35. Verde 45 ✓ |
| **VER-03** · media | Lo que alimenta el asiento (fecha de pago, referencia, método, responsable, fecha de recepción) se reescribía **sin rastro** mientras el asiento conservaba la fecha original | Pieza 12: `trg_zzcompras_congelar_{recepcion,factura,orden_pago}` | `VER-03.sql` | Rojo 19. Verde 33 ✓ |
| **EV-04 / VER-01** · alta | `cantidad_recibida` / `cantidad_facturada` de un renglón en borrador las fijaba el cliente: una factura se **aprobaba y contabilizaba sin ninguna recepción** (recepciones = 0, devengo publicado) | Pieza 13: `trg_compras_oc_linea_acumulados` (`COMPRAS_ACUMULADO_SOLO_SISTEMA`) | `EV-04.sql`, `VER-01.sql` | Rojo 12 / 22. Verde 30 / 18 ✓ |
| **EV-08** · media | El número de la orden, la recepción y la contraseña lo elegía el cliente al crear el borrador: con «el número es inmutable» (0500), una persona con solo «crear» podía **bloquear para siempre las aprobaciones** del proyecto (`uq_ordenes_compra_numero`) sin que el administrador pudiera corregirlo | Pieza 14: el servidor asigna el número (`trg_compras_00_numero_servidor`, `COMPRAS_NUMERO_SOLO_SISTEMA`), queda fijo (`trg_zzcompras_numero_fijo`) y repara el correlativo desfasado | `EV-08.sql` | Rojo 30. Verde 31 ✓ |

### 3.4 Aprobación separada, borrado e índice

| ID · sev. | Hallazgo y reproducción | Corrección (0800) | Prueba | Resultado |
|---|---|---|---|---|
| **DEP-1 / EV-07** · media | 0700 reabrió el hueco que 0300 cerraba: con `compras_config.aprobacion_separada` **encendida**, una orden podía **nacer «aprobada» o «emitida»** por `INSERT` y quedaba `created_by = aprobada_por` con número y evento reales | Pieza 15: `trg_compras_permiso_orden_separada` (BEFORE INSERT) rechaza con el mismo código que el camino por `UPDATE` (`COMPRAS_OC_AUTOAPROBACION`); apagada o sin configuración no cambia nada | `DEP-1.sql`, `EV-07.sql` | Rojo 23 / 23. Verde 29 / 30 ✓ (6 mutantes del arreglo mueren). **Adyacente mayor sin corregir (decisión **P-2**): cualquiera con «Editar» puede apagar el interruptor, autoaprobarse y volver a encenderlo** |
| **DEP-2** · baja | `idx_facturas_prov_numero_norm` (0400) **no lo usaba nunca** la consulta del trigger (`compras_normalizar_numero` no era `STRICT`): 100 altas con 20 000 facturas del proveedor ≈ 6.1–7.2 s | Pieza 19: `compras_normalizar_numero` pasa a `STRICT` (mismo resultado para toda entrada; sin reconstruir el índice ni bloquear la tabla) | `DEP-2.sql` | Rojo 24. Verde 16 ✓ · 100 altas ≈ 30 ms (**240×**), también con 350 000 facturas |
| **RG-4** · baja | «1-23» y «12-3» (serie y correlativo distintos) normalizan igual y se rechazan como duplicado, **sin salida** ni para el administrador | **Sin corregir.** Se midieron seis variantes sobre 20 pares reales (10 duplicados, 5 distintos legítimos, 5 ambiguos): la alternativa A (equivalencia que respeta el separador) bloquea 10/10 duplicados y deja pasar 5/5 distintos; la sugerencia literal del hallazgo pierde 3/10 duplicados | `RG-4.sql` (pendiente de decisión; no entra en `run.sh`) | Confirmado en rojo. Decisión **P-6** |

### 3.5 Pantalla (confirmados y corregidos en el commit anterior del PR)

| ID · sev. | Hallazgo y reproducción | Corrección | Prueba | Resultado |
|---|---|---|---|---|
| **RG-1** · media | Aprobar / emitir / cancelar / pagar con `approve` o `change_status` **sin** `edit`: la pantalla ofrecía el botón, el servidor cambiaba **0 filas** sin error y la pantalla decía «Listo» | `runAfectando` / `SinFilasAfectadasError` en todas las mutaciones de paso; los botones se alinean con lo que el servidor exige (`autorizarPaso` / `cambiarEstadoPaso` = permiso del paso **y** `edit`) | Vitest (10 casos «cero filas ≠ éxito») + prueba de pantalla contra el sandbox | Rojo (UI anterior): 8 de 15 comprobaciones de pantalla; verde (UI nueva): **15/15**, 0 peticiones a producción |
| **RG-2** · baja | «Eliminar» ofrecido en una OC borrador **devuelta** (ya numerada); el servidor la rechaza y la pantalla no decía nada | `sePuedeEliminar` (solo borradores sin número, sin revisión y sin aprobación) + el error del servidor se muestra | Vitest + pantalla sandbox | Verde: «Eliminar» no se ofrece en la devuelta; sin permiso de borrado la pantalla avisa «no aplicó el cambio» y la orden sigue en la lista |

### 3.6 Documentales y de despliegue

| ID · sev. | Hallazgo | Resolución | Evidencia |
|---|---|---|---|
| **VER-05** · media | «Solicitar = `create`» es inexacto: el rol `operator` inserta órdenes, facturas y pagos **sin** ningún permiso de Contabilidad (la política `INSERT` admite `company_owner`, `admin`, `operator` **o** `create`) | §5 corregido; **P-14** (¿debe exigirse `create` también a `operator`?) | Reproducido como `UN` (rol `operator`, sin permisos) |
| **VER-06** · media | «Permisos separados: solicitar · aprobar · recibir · contabilizar · pagar» figuraba como Hecho: cinco pasos comparten **dos** llaves (`approve`, `change_status`) | §2 fila D bajada a **parcial**; **P-1** | Lectura de `0300` y de la propia suite |
| **VER-07** · media | «Solo `compras_tg_recepcion_registrar` inserta la entrada» es falso a nivel de tabla: `movimientos_suministro` admite entradas directas (stock 10 → 1 010 sin orden ni recepción) con el permiso de pestaña de Suministros | §2 fila C precisada («la compra no mueve inventario sin recepción aceptada; las entradas manuales de Suministros siguen permitidas»); **P-9** | Reproducido como `UA` |
| **VER-08** · media | El documento decía «revisión adversarial no completada» y «riesgo no confirmado»; el cuerpo del PR listaba hallazgos | Este documento reescrito (§3, §8, §9) y el cuerpo del PR actualizado; el riesgo de `conta_reversar_automatico` **se provocó** (CONC-04) | — |
| **VER-10** · media | «Históricos ambiguos no se vinculan solos = I» solo valía para contratos, suministros y proformas | §2 fila A acotada a esos tres; las órdenes sin `proveedor_id` salen en el diagnóstico (`orden_incoherente`); **P-10** | Catálogo de funciones |
| **VER-11** · media | Recepción: el respaldo es **opcional** y el responsable por defecto es quien registra | §2 fila C bajada a **parcial**; **P-8** | Reproducido: stock +4 sin respaldo |
| **VER-12** · baja | Cifras menores del documento (escenarios «T–V», 62 suites, «con su número», cabeceras `…0500`) | Corregidas aquí y en las cabeceras del diagnóstico y de la suite | `grep` contra el repositorio |
| **DEP-3** · baja | El par 0400 → 0600 deja a producción con la regla de nombre de proveedor **entre** los dos archivos; reaplicar 0400 después de 0600 la restituye | No se puede editar 0400 (ya está en el sandbox). **Regla de despliegue:** 0400 y 0600 se aplican **en la misma corrida y en orden**; no usar `migration_file` para ellas por separado | Reproducido en base virgen |
| **DEP-4** · baja | 0000 toma `SHARE ROW EXCLUSIVE` sobre 7 tablas en una transacción y sin `lock_timeout`: se reprodujo un interbloqueo con una transacción normal de pago (la del usuario fue la víctima) | **0800 lleva `lock_timeout = 10 s`** (falla limpio y se reintenta). 0000…0700 no se editan: aplicar fuera de pagos/aprobaciones y de cierres | Reproducido con dos sesiones |
| **DEP-7** · baja | Los «CÓMO REVERTIR» de 0300 no son SQL ejecutable (`DROP FUNCTION … compras_tg_permiso_*()`) y omiten una función | `scripts/reversion-compras-controles.sql`: sentencias **generadas del catálogo** por migración, de la 0800 a la 0000; `run.sh` §6c las ejecuta y exige que el catálogo vuelva **exacto** al previo | `run.sh` §6c: 9 613 objetos del catálogo comparados, 0 diferencias |

## 4. Qué se implementó

Nueve migraciones incrementales (**ninguna edita una ya aplicada**; tres corrigen a las anteriores), una pantalla ajustada, un diagnóstico, un script de reversión y las pruebas. Todo es **aditivo**: triggers, funciones, dos columnas opcionales y tres índices parciales; ninguna tabla se vacía ni se reescribe.

| Migración | Qué cierra |
|---|---|
| `20261027000000_compras_aislamiento_referencias` | Proveedor y proyecto de orden, factura, contraseña y orden de pago ∈ la empresa del documento; renglón de orden y de factura ∈ la empresa de su cabecera; cuenta del renglón de factura ∈ la contabilidad de la factura, de detalle y activa; partida de contraseña de una sola empresa |
| `20261027000100_compras_pagos_controles` | Orden de pago: nace en borrador; borrador → aprobada → pagada (y anular); solo factura **aprobada / pagada parcial**, del mismo proveedor, contabilidad y empresa; **no** más del saldo (con la factura bloqueada); contraseña vigente y partidas con saldo al pagar; el servidor sella `solicitada_por`, `aprobada_por/at`, `pagada_at` |
| `20261027000200_compras_documentos_sin_borrado` | Solo se borra lo que nunca tuvo efecto; lo demás se anula o cancela. La purga en cascada de una empresa o un proyecto sigue funcionando *(el proyecto, con RG-3, desde `…0800`)* |
| `20261027000300_compras_permisos_y_estados_por_accion` | Cada transición exige el permiso que la pantalla ya exigía (§5); se nace en el estado inicial; `pagada` y el monto pagado solo los deja el sistema; quién aprueba una orden lo sella el servidor |
| `20261027000400_compras_duplicados_proveedor_y_factura` | Factura: el número equivalente (solo letras y dígitos) del mismo proveedor no se repite. *(La regla de nombre de proveedor que traía se retiró en `…0600`.)* |
| `20261027000500_compras_orden_trazabilidad_posterior` | `numero` y `correlativo` de la orden inmutables; `proveedor_nombre` fijo tras aprobar; cualquier cambio posterior a `concepto`, `descripcion`, `notas`, fechas o importes informativos deja un evento «modificacion» |
| `20261027000600_compras_proveedor_identidad_restaurada` | Devuelve `proveedores_tg_identidad()` a su cuerpo de `20261020000000` (PR A), byte a byte |
| `20261027000700_compras_orden_nace_con_permiso` | La orden puede nacer aprobada (con `approve`) o emitida (con `approve` y `change_status`), camino que PR A usa a propósito |
| **`20261027000800_compras_cierre_hallazgos_adversariales`** | **Veinte piezas** que cierran los 24 hallazgos de §3 (58 disparadores y 37 funciones nuevas, 5 funciones reescritas, `compras_normalizar_numero` a `STRICT`, 2 columnas `clave_idempotencia` y 3 índices únicos parciales). Va en una transacción con `lock_timeout = 10 s`, es idempotente (se aplica dos veces en las pruebas) y su cabecera lista cada hallazgo, el orden de disparo y la reversión |

**Pantalla.** En Operaciones, *Órdenes de compra* ofrece «Aprobar» y «Devolver a borrador» solo con «Autorizar / Denegar — Contabilidad» **y** «Editar»; «Emitir» y «Cancelar» solo con «Cambiar estado — Contabilidad» **y** «Editar» (lo que el servidor realmente exige); no ofrece «Eliminar» en un borrador devuelto; **ningún paso se muestra como hecho si el servidor cambió 0 filas**; y la orden de pago y la contraseña mandan una clave de idempotencia por apertura del formulario.

**Diagnóstico previo (solo lectura).** `scripts/diagnostico-compras-controles.sql`: un `SELECT` que lista referencias cruzadas ya existentes (ahora también activos, gastos y obra de la orden), facturas pagadas por encima de su total, pagos de facturas que nunca se aprobaron, pagos sin asiento, anulaciones sin reverso, contraseñas incoherentes, acumulados sin respaldo, autoaprobaciones, la configuración de la separación, los privilegios de `anon` y **los perfiles que dejarán de poder** aprobar/cambiar estado por API. Resultado en producción: §8.

**Reversión.** `scripts/reversion-compras-controles.sql`: sentencias ejecutables, de la 0800 a la 0000, **generadas del catálogo** de una cadena real y comprobadas por `run.sh` (§6c): tras ejecutarlas el catálogo vuelve **exacto** al previo a `20261027000000`. Una excepción deliberada: la restricción `orden_compra_eventos_tipo_check`, que `…0500` **amplió**, se conserva (las filas ya escritas con los tipos nuevos violarían la anterior).

---

## 5. Mapeo de permisos (el modelo existente, tal como lo usa la pantalla)

| Paso | Transición | Permiso de Contabilidad |
|---|---|---|
| Solicitar | crear la orden, capturar recepción, factura y orden de pago | `create` **o el rol `operator`** (política INSERT, sin cambios; VER-05) |
| Aprobar | orden: borrador → aprobada; devolver a borrador; nacer ya aprobada *(no con la separación activa)* | `approve` |
| Emitir / cancelar / cerrar | orden: → emitida, → cancelada, → cerrada (nacer emitida exige además `approve`) | `change_status` |
| Recibir | recepción: registrar (mueve existencias y contabiliza), anular | `change_status` (capturarla es `create`) |
| Contabilizar | factura: registrada → aprobada (cuadre + devengo) | `approve` |
| Anular | factura, orden de pago, contraseña *(la contraseña no tiene botón en la pantalla)* | `change_status` |
| Pagar | orden de pago: borrador → aprobada | `approve` |
|  | orden de pago: → pagada | `change_status` |

Sigue vigente la política `UPDATE` (`edit`): el nuevo permiso se exige **además**. Administrador y propietario pasan por `conta_puede_escribir`, como siempre. No se aplican a `service_role`, a procesos sin usuario ni a los triggers de sistema. **Cinco pasos comparten dos llaves** (`approve`, `change_status`): ver **P-1**.

---

## 6. Decisiones de negocio pendientes (preguntas concretas)

Nada de esto se implementó ni se asumió. Se indica el comportamiento **actual** y, cuando hay una, una recomendación.

**Antes de fusionar**

- **P-1 · Segregación de funciones.** Con los permisos separados, quien tiene todos (p. ej. un administrador) aún puede solicitar, aprobar, recibir, contabilizar y pagar la misma compra, y **cinco pasos comparten dos llaves**: quien tiene `approve` aprueba la orden, la factura y el pago; quien tiene `change_status` emite, recibe, paga y anula. No existe forma de que «quien recibe no paga» o «quien aprueba la orden no aprueba la factura» se resuelva por permisos. La única regla entre personas (`compras_config.aprobacion_separada`) cubre solo «quien solicita no aprueba la orden» y **no está configurada en ninguna empresa de producción** (§8). ¿Se quieren permisos nuevos por paso (recibir, pagar, aprobar pago), una regla de separación entre pasos (p. ej. quien aprueba la factura no paga, a partir de qué importe), o se acepta el reparto actual? *(No se inventó ningún umbral. Los perfiles actuales de proyecto no se tocaron.)*
- **P-2 · El interruptor de la separación solicitante/aprobador.** Hoy **cualquiera con «Editar» puede apagarlo, autoaprobarse y volver a encenderlo**, lo que anula el control aunque el `INSERT` ya esté cerrado (DEP-1). Hay un prototipo verificado que lo deja solo al administrador de la empresa (`COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN`), con sus pruebas; **no se incluyó** porque cambia quién puede configurar. *Recomendación:* incluirlo en cuanto se encienda la separación en alguna empresa.

**Reglas del negocio**

- **P-3 · Proveedor suspendido o vencido y facturas.** Una factura **sin orden** de un proveedor con autorización vencida o suspendido en el proyecto se aprueba; una **con orden** de un proveedor suspendido *después* de entregar **no** se aprueba, aunque `PROVEEDORES_PR_A.md` dice que lo ya emitido no se altera. ¿Debe bloquearse la factura nueva sin orden? ¿Se permite aprobar lo ya recibido de un proveedor suspendido (con motivo) para poder pagarlo?
- **P-4 · Cuenta por pagar.** Hoy es el mapeo general del evento `cxp_proveedores` por contabilidad. ¿Se necesita una distinta por proveedor o tipo de proveedor, o basta la general?
- **P-5 · Proveedores con el mismo nombre escrito distinto.** El alta manual los acepta (la carga masiva no). PR A decidió que «los nombres parecidos conviven» y lo probó. ¿Se mantiene, o el alta manual rechaza/advierte cuando no hay NIT/RFC ni código que distinga?
- **P-6 · Números de factura (RG-4) y duplicados.** «1-23» y «12-3» se rechazan como duplicado sin salida. *Recomendación (medida):* alternativa A —equivalencia que respeta el separador entre serie y correlativo—, que bloquea 10/10 duplicados reales y deja pasar 5/5 distintos legítimos; B (excepción auditada) como complemento si se quiere salida también para los ambiguos. Los duplicados **históricos** se listan, no se fusionan: ¿quién decide cuáles son la misma factura o el mismo proveedor?
- **P-7 · Destino «costo».** Las reglas lo aceptan pero un renglón de orden solo puede ser inventario / activo fijo / servicio / gasto: esas reglas nunca se aplican. ¿`costo` pasa a ser destino de renglón, o se retira de las reglas?
- **P-8 · Recepción.** El respaldo es opcional y el responsable, por defecto, quien registra. ¿Se exige respaldo y responsable explícito para registrar? ¿Quién puede registrar si Operaciones solo tiene `create`? Además, **no se guarda quién pulsó «registrar»** (`recibido_por` es el responsable que declara quien captura): saberlo exige una columna nueva.
- **P-9 · Entradas manuales de inventario.** `movimientos_suministro` admite entradas directas con el permiso de pestaña de Suministros (stock 10 → 1 010 sin orden ni recepción). ¿Deben exigir origen (recepción) o un permiso/motivo propio cuando llevan costo?
- **P-10 · Históricos sin proveedor del catálogo.** Órdenes y gastos antiguos con `proveedor_id` vacío no tienen vista previa ni vinculación. ¿Se construye (como en contratos) o se dejan?
- **P-11 · Factura ↔ recepción concreta.** El cuadre es por renglón acumulado. ¿Se necesita que una factura declare **qué recepciones cubre**?
- **P-12 · Contabilidad del pago.** (a) **Libro sin catálogo contable**: pagar sin asiento está permitido (no hay dónde asentar); producción no tiene asientos publicados. (b) **Tipo de cambio pendiente**: el asiento queda en borrador pendiente y se acepta. (c) **Cuenta mapeada inactiva**: ahora el pago se rechaza (`COMPRAS_PAGO_SIN_ASIENTO`); antes quedaba «pagada» sin asiento. (d) Anular una factura pagada sigue siendo en **dos pasos** (anular la orden de pago, la factura vuelve a «aprobada», luego anularla). ¿Se confirman?
- **P-13 · Enlaces desde el seguimiento.** ¿A qué pantalla debe llevar cada documento, y qué ve un usuario de Operaciones que no tiene las pestañas de Contabilidad?
- **P-14 · Rol `operator` y `create`.** El rol `operator` inserta órdenes, facturas y pagos **sin** ningún permiso de Contabilidad. ¿Debe exigirse `create` también a `operator`?
- **P-15 · Correcciones legítimas que hoy no tienen camino.** Los controles nuevos cierran la edición directa; falta decidir si cada corrección necesita una **acción propia con permiso, motivo y rastro**: prórroga de la fecha de vencimiento de una factura aprobada; corregir referencia o método de un pago ya hecho; reclasificar la categoría de gasto de una factura contabilizada (con asiento de ajuste); corregir un importe tras emitir (hoy: devolver a borrador con motivo, o cancelar y emitir otra); corregir un sello mal puesto. Además, los procesos sin sesión de usuario (`service_role`) **siguen pudiendo retroceder estados**: si se quiere cerrar también esa puerta hay que decidir qué hacen las correcciones masivas legítimas.
- **P-16 · Menores.** ¿Debe poder aprobarse una orden **sin renglones** (hoy sí, compromete 0)? ¿Una recepción contra una orden «aprobada» pero no emitida (hoy sí)? Numeración: un número reservado antes de la corrección deja un salto; `activos_fijos.codigo` lo captura el usuario y puede bloquear la recepción de activos. ¿Una persona con permiso de crear pero sin acceso al proyecto puede crear documentos en él? ¿Se retira DML de `anon` en las 10 tablas donde lo conserva (§8)? Una contraseña pagada permite reescribir `numero` y `fecha_emision` con solo `edit`.
- **P-17 · Los de siempre** (sin cambios): umbrales y aprobadores por monto, tolerancias, presupuesto bloqueante, compra de emergencia, anticipos, notas de crédito (`COMPRAS_BLOQUE_B.md §3`).

---


---

## 7. Pruebas

Todo se ejecutó en esta sesión, contra un PostgreSQL 16 local con la **cadena completa** de migraciones (la misma que arman los `run.sh`), con DML directo como `authenticated` (`SET ROLE`, el camino de PostgREST) y, para la concurrencia, **sesiones reales simultáneas**.

### 7.1 Base de datos

| Prueba | Resultado |
|---|---|
| `compras_bloque_b/run.sh` **completa** sobre las nueve migraciones (orden → recepción → factura → seguimiento; las 17 suites previas, **24 pruebas de hallazgos** §5r, concurrencia A–U, concurrencia del cierre §6b, **reversión §6c**, histórico append-only) | **rc = 0**, 953 líneas `✓`, 5 min 25 s |
| §5r · una prueba por hallazgo confirmado (`hallazgos/*.sql`) | **24 archivos, 760 comprobaciones, 0 fallos** |
| Las mismas pruebas **sin** la migración 0800 (rojo) | **Todas fallan** (cifras por hallazgo en §3; p. ej. CONC-04 36, EV-06 35, EV-03 15) |
| `assert_controles_servidor.sql` (la suite de la primera entrega) | **130 comprobaciones**, sin cambios, en verde con la 0800 |
| §6b · concurrencia con sesiones reales (`hallazgos/*.conc.sh`) | **7 fragmentos**: sin la migración **todos terminan en rojo** (interbloqueo, doble pago, pago sin asiento, anulación con asiento vivo, orden de otra empresa que espera el bloqueo ajeno, dos pagos con la misma clave); con ella **todos en verde** |
| §6c · reversión | `scripts/reversion-compras-controles.sql` aplicado sobre una copia con todo el bloque: el catálogo vuelve **idéntico** al previo a `20261027000000` (**9 613 objetos** comparados: disparadores, funciones, índices, restricciones, políticas y columnas) |
| Idempotencia de la migración | Se aplica dos veces sin error (también en `probar` y en el barrido) |
| Barrido de las **63 suites** `supabase/tests/*/run.sh` (de una en una, sobre las nueve migraciones) | **63/63 en verde** (`rc = 0`; incluye `compras_bloque_b`, `proveedores_pr_a`, `compras_cierre_tecnico`, `compras_flujo`, `conta_tipo_cambio_mensual`, `conta_pendientes_reproceso`, `conta_reglas_imputacion`), 17 min 47 s en total. `personal_usuario` arrancó al **tercer** intento: los dos primeros fallaron con `could not start server` (choque de puerto del servidor desechable; no llegaron a ejecutar ninguna aserción) y el tercero pasó |
| Guardas: `migrations-guard`, `migrations-append-only` | `migrations-guard` ✅ · `migrations-append-only`: **9 migraciones nuevas, 0 violaciones del histórico** ✅ |
| Conteo contra el tope de diez | **9** pendientes frente a `MAX_APPLY = 10`; no se subió ni se desactivó |

**Rojo y verde de la concurrencia (§6b).**

| Fragmento | Sin la migración | Con la migración |
|---|---|---|
| `CONC-01` anular y pagar la misma factura a la vez; 20 + 20 simultáneas | `deadlock detected`; el pago 2 quedó «pagada» con **0 asientos**; en carga: 6 errores y 1 pago sin asiento | 0 errores, 0 interbloqueos, 0 pagos sin asiento, 0 anulaciones con el asiento vivo |
| `CONC-02` dos órdenes / dos pagos sobre la misma contraseña | dos órdenes vivas y **800 pagados** sobre una contraseña de 400 | entra una (`YA_TIENE_ORDEN`) y se paga una (`CONTRASENA_CERRADA`); 8 pares: 1 orden viva cada una |
| `CONC-03` editar / agregar una partida mientras se paga | factura con **900 pagados** contra una orden y un asiento de 100 | la edición espera y se rechaza (`CERRADA` / `CON_ORDEN`); factura = orden = asiento |
| `CONC-04` espera de bloqueo fallida (`lock_timeout`) | pago «pagada» sin asiento; anulada con el asiento original vivo y sin reverso | pagar y anular **fallan enteros**; el reintento con el folio libre termina bien |
| `EV-05` aprobar contra un renglón nuevo / un total escrito a mano | la orden aprobada queda con otro total | conserva su renglón y su total (1 000); dos editores del mismo borrador suman 1 500 |
| `EV-09` orden de C contra la factura de D | espera el bloqueo de D y devuelve datos de D | se rechaza como «ajena» en 20 ms sin esperar; dos órdenes de C sobre la misma factura de C siguen serializadas |
| `VER-09` la misma clave a la vez | dos órdenes de 400, ambas «pagada», 800 pagados | una orden; claves distintas → dos; 3 rondas × 6 sesiones → una por ronda; contraseña con la misma clave → una cabecera y sin hueco en el correlativo |

### 7.2 Pantalla

| Prueba | Resultado |
|---|---|
| `tsc --noEmit` | sin errores |
| `eslint src --max-warnings=0` | sin avisos |
| `vitest run` (todo el repositorio) | **449 archivos y 7 223 pruebas en verde** (157 omitidas por diseño; 1 archivo omitido). Nuevas: `pagosIdempotentes.test.tsx` (reintento idempotente de la orden de pago y de la contraseña, sin repetir partidas) y las de «cero filas ≠ éxito» |

### 7.3 Sandbox existente (sin resetear) y pantalla real

| Prueba | Resultado |
|---|---|
| Migración `20261027000800` | Aplicada con `apply-migrations-sandbox.yml` (corrida 37971184068, éxito, sobre el commit `deffa34`); el sandbox pasó de `…0700` (565 versiones) a **`…0800` (566)** |
| Guion reversible `sandbox_controles_servidor.sql` (49 comprobaciones; una sola sentencia que termina siempre con una excepción que revierte todo) | **Antes** de aplicarla: `GUION_FALLO`, **8 con FALLO** (7a–7h: el defecto existía en el esquema desplegado). **Después**: `GUION_OK_REVERTIDO`, **49 comprobaciones, 0 con FALLO** |
| Residuo en el sandbox | **0** empresas, órdenes, facturas, pagos, asientos, usuarios y proveedores del padrón `5b700000…` |
| Prueba de pantalla real (Vite local → Chromium → sandbox), `pantalla_sandbox/` | **15/15**: matriz de botones de 4 perfiles × 3 órdenes (cada paso solo con el permiso del paso **y** «Editar»), «Eliminar» ausente en el borrador devuelto, y «Eliminar» sin permiso de borrado **avisa** en vez de callar. Tráfico: solo `127.0.0.1:5199` y `jwpmivhvlstslncrtokb.supabase.co`; **0 peticiones a producción**. Con la interfaz anterior (`a0435c9`): 8/15 |

**Suites existentes que hubo que adaptar** (y por qué). Ninguna aserción se debilitó: cada una *capturaba por la API* un dato que ahora el servidor rechaza, así que el dato se emula como **dato histórico** (`session_replication_role = replica`, el trigger apagado solo en ese punto o la escritura de sistema `conta.allow_system_write`):

- `conta_pendientes_reproceso`, `conta_reglas_imputacion`, `compras_cierre_tecnico`: renglones con cuenta inactiva / agrupadora / de otra contabilidad, borrado de una factura contabilizada, y siembra de acumulados y números como proceso de sistema.
- `conta_tipo_cambio_mensual`, `compras_bloque_b/assert_seguimiento_pantalla.sql`, `assert_contratos_compras.sql`: la orden de pago pasa por «aprobada» antes de «pagada».

**Dos choques con decisiones previas, detectados al correr la batería existente** y corregidos con migraciones nuevas (no editando las aplicadas): el nombre de proveedor (`…0600`, ver P-5) y que PR A inserta órdenes ya aprobadas a propósito (`…0700`).


## 8. Diagnóstico de producción (solo lectura) — resultado

`scripts/diagnostico-compras-controles.sql` se ejecutó **tal cual** contra producción (`nnsqmeigtgewatameexo`) con la herramienta SQL, como un único `SELECT` (el script se revisó antes: no contiene `INSERT`, `UPDATE`, `DELETE`, DDL ni funciones de escritura). **No se escribió nada en producción.**

| Apartado | Filas | Lectura |
|---|---|---|
| `referencia_cruzada` (órdenes, facturas, contraseñas, órdenes de pago, renglones, activos fijos, gastos, obra de la orden) | **0** | Ningún documento apunta a un proveedor, proyecto, cuenta, factura o contraseña de otra empresa |
| `pago_sin_control` | **0** | Ninguna factura pagada por encima de su total, ni pago de factura sin aprobar, ni aprobada sin devengo |
| `duplicado` (proveedores y facturas) | **0** | — |
| `pago_sin_asiento`, `reverso_pendiente` | **0** | Producción tiene **0 asientos publicados** y **0 órdenes de pago** |
| `contrasena_inconsistente` | **0** | Hay **0 contraseñas**: el índice `uq_ordenes_pago_contrasena_viva` se crea sin conflicto |
| `acumulado_sin_respaldo`, `documento_desvinculado` | **0** | — |
| `autoaprobacion`, `configuracion` | **0 y 0** | **Ninguna empresa tiene `compras_config`**: la separación solicitante/aprobador no está configurada en producción |
| `orden_incoherente` | **1** | Una orden histórica (`251e6274-8c55-4f4a-a9e4-56add34e183d`, creada 2026-07-01): estado «recibida», sin número, total **30.00** y **sin renglones**. Es la única orden de producción. Los controles nuevos **no la tocan** (no reescriben filas) ni impiden editarla (solo rechazan *cambiar* importes fuera de borrador); decidir si se corrige a mano |
| `perfil_afectado` | **0** | **Ningún perfil** dejaría de poder aprobar o cambiar estado: no hace falta asignar permisos antes de aplicar. *(Los perfiles y las asignaciones de proyecto actuales no se tocaron.)* |
| `privilegio_anon` | **10 tablas** | `anon` conserva `SELECT, INSERT, UPDATE, DELETE` en `activos_fijos`, `contratos_proveedores`, `evaluaciones_proveedor`, `gastos_condominio`, `movimientos_suministro`, `obras_mejoras`, `proformas_condominio`, `proveedor_documentos`, `proveedores` y `suministros_condominio` (la RLS lo contiene; las tablas del circuito —órdenes, recepciones, facturas, pagos, contraseñas— **no** lo tienen). **P-16** |

Contexto de volumen (lectura): 1 orden de compra, 1 factura, 0 recepciones, 0 órdenes de pago, 0 contraseñas, 4 proveedores. Con estos volúmenes, **ninguna de las migraciones reescribe ni rechaza datos existentes**.

---

## 9. Límites y riesgos declarados

- **No se tocó producción.** Solo lecturas (versiones de migración y el diagnóstico de §8). La huella de producción no se recapturó.
- **Sandbox (`control-agua-rls-sandbox`, el existente, sin resetear).** Cada migración se aplicó con `apply-migrations-sandbox.yml`, una por corrida y en orden. Detalle y resultados en §7.
- **No se probaron `DELETE` en el sandbox** (la herramienta SQL se cuelga con ellos, límite documentado desde #922): los caminos de borrado, la purga de un proyecto y la cascada de una empresa se probaron solo en el PostgreSQL desechable (matriz de purga de 168 casos).
- **Prueba de pantalla** contra el sandbox: solo *Operaciones › Órdenes de compra* (matriz de botones por perfil, «Eliminar» con y sin permiso). **No** se hizo la de *Contabilidad* (Compras, Cuentas por pagar): ahí solo hay pruebas de componentes (Vitest) y la clave de idempotencia de pagos solo está probada por Vitest y por la base.
- **Concurrencia.** Probada con sesiones reales en PostgreSQL 16 local (interbloqueo, doble pago, pago vs. edición de partidas, claves repetidas). No se probó carga sostenida ni PostgreSQL 17 (producción) ni el pooler de Supabase.
- **Fuera del circuito.** El guardián de empresa (EV-09) cubre 18 tablas del circuito más los respaldos; `movimientos_suministro` (UUID del suministro ajeno en el mensaje) y **41 tablas más** del producto tienen triggers `SECURITY DEFINER` BEFORE que lanzan errores con datos y no están cubiertas. `compras_tg_rls_empresa()` es genérica y se puede añadir tabla por tabla.
- **Procesos sin sesión de usuario** (`service_role`, triggers de sistema) siguen pudiendo retroceder estados y escribir sellos: es deliberado (correcciones de soporte) y está en **P-15**.
- **Falsos positivos de duplicado** de factura (RG-4) y duplicados históricos: ver P-6.
- **Codificación.** El PostgreSQL local de esta sesión es `SQL_ASCII`; las pruebas nuevas no dependen de acentos. Producción es UTF-8.
- **Compatibilidad.** Todo se restringe hacia adelante: no repara datos existentes. Los controles de alcance, de duplicados y de pagos se evalúan cuando la fila nace o cambia lo que la identifica, para no bloquear a las filas históricas.

## 10. Despliegue y recuperación

- **Tope de diez por despliegue.** Fusionar **dispara** `apply-migrations-prod.yml`; con respecto al máximo de producción (`20261026000500`) quedan **9** migraciones pendientes (`…0000` a `…0800`) y el tope `MAX_APPLY = 10` **no se tocó ni se desactivó**: queda **una de margen**. Si antes de fusionar entra otra migración a `main`, se vuelve a contar; con diez o más, el workflow aborta sin tocar producción.
- **No fusionar** sin: (a) la respuesta a **P-1** y **P-2**; (b) la aprobación del *environment* de producción; (c) revisar la orden histórica de §8. Cada migración se aplica sola, en orden y con el historial registrado por el workflow.
- **Orden.** `…0400` y `…0600` van en la misma corrida y en orden (DEP-3). `…0800` se aplica con `lock_timeout = 10 s`: si falla por una tabla ocupada, no deja nada a medias y se reintenta. Conviene una hora sin pagos, aprobaciones ni cierre de mes (DEP-4: `…0000` toma `SHARE ROW EXCLUSIVE` sobre 7 tablas sin `lock_timeout`).
- Refrescar `huella-produccion.json` con una captura real tras el despliegue; mientras tanto el auditor las muestra como cambios planificados.
- **Recuperación.** `scripts/reversion-compras-controles.sql` (de la 0800 a la 0000; ejecutable; comprobada en `run.sh` §6c: deja el catálogo exacto). Revertir **reabre los defectos** descritos. No hay datos que borrar ni migrar, salvo las claves de idempotencia de la 0800.

