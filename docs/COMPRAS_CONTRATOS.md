# Compras · Contratos de proveedor conectados con las compras

Conecta los contratos de proveedores (#911/#913) con las órdenes de compra y su seguimiento (#916/#918).
**Reutiliza** el catálogo compartido de proveedores, los permisos existentes y el circuito
orden → aprobación → recepción → factura → pago. **No hay** un segundo catálogo ni un segundo circuito de
órdenes. **Fuera de alcance** (a propósito): anticipos, notas de crédito y mecanismos de pago nuevos.

Todo va en migraciones **incrementales** (`20261024000000`–`20261025000000`); no se editó ninguna migración aplicada.

## 1. Alcance: qué se reutilizó, qué se implementó y qué queda pendiente

### 1.1 Reutilizado (sin cambios de comportamiento)

| Pieza | De dónde viene | Cómo se usa aquí |
|---|---|---|
| Catálogo compartido de proveedores (`proveedores`) y su autorización | #911 | El contrato, la orden y la evaluación se ligan **por id**; no hay catálogo paralelo |
| Contratos (`contratos_proveedores`): alcance empresa/proyecto, estados, historial, respaldo privado | #911/#913 | Se les añade vigencia, renovación y seguimiento; sus validaciones siguen |
| **Carga masiva** de proveedores y contratos (vista previa, errores por fila, `todo_o_nada` / `filas_validas`, importar nunca autoriza ni activa) | #911/#913 | Intacta; probada de nuevo (ver §5) |
| **Vinculación de contratos históricos** (`contratos_sin_proveedor_vista_previa`, `contratos_vincular_inequivocos` con `dry_run` por defecto, vínculo manual, reversión por lote) | #911/#913 | Intacta: solo se vinculan los inequívocos; **las ambiguas y las sin coincidencia quedan pendientes** para revisión manual, sin borrar ni fusionar nada |
| Circuito de la orden: aprobar, emitir, recibir, facturar, pagar; separación solicitante/aprobador; historial de la orden | #916/#918 | La orden con contrato usa el mismo circuito |
| Pendientes por renglón y diferencia de precio aparte | #918 | El seguimiento del contrato lee de `compras_seguimiento_orden`, no recalcula |
| Permisos: `condominios.tab.proveedores`, `condominios.tab.ordenes_compra`, cambio de estado de Contabilidad | existentes | Sin permisos nuevos |
| Proveedor autorizado para aprobar/emitir | #916 | Sigue mandando: un proveedor suspendido bloquea aunque el contrato esté vigente |

### 1.2 Implementado en este PR

| Pieza | Dónde |
|---|---|
| Ligar una orden a un contrato exige mismo proveedor, proyecto, empresa **y moneda** | `20261024000000` y, al **editar**, `20261025000000` |
| Aprobar y emitir exigen contrato **vigente** (activo y dentro de fechas) y, si tiene monto máximo, que no se rebase | `20261024000000` |
| **Excepción** explícita, con motivo y auditada (`orden_compra_excepciones`, inmutable), acotada a orden+revisión+etapa+causas **y a las condiciones autorizadas** (contrato, proveedor, moneda e importe) | `…0000` y `20261025000000` |
| Renovar (contrato nuevo en borrador), prorrogar y **ampliar monto** (clave idempotente, motivo obligatorio) con historial | `20261024000100` |
| Seguimiento del contrato: contratado / comprometido / recibido / facturado / pagado, por moneda | `20261024000200` |
| Evaluaciones ligadas al proveedor compartido y, si aplica, contrato/orden | `20261024000300` |
| UI: selector de contrato en la orden, flujo de excepción, modal de seguimiento, renovar/prorrogar/ampliar, evaluaciones con contrato/orden | `src/…` |

### 1.3 Pendiente (no incluido)

- **Producción**: no se tocó. Al fusionar, `apply-migrations-prod` aplicará las 5 migraciones (con la aprobación del environment).
- **Refrescar `huella-produccion.json`** tras aplicarlas en producción, con una captura real de solo lectura (**requiere autorización**). Mientras tanto el auditor las muestra como cambios planificados, no como drift.
- **Anticipos y notas de crédito**: fuera de alcance.
- **Capturas de pantalla contra el sandbox**: no hay; la UI está cubierta por Vitest.
- Decisión abierta: conservar o retirar el padrón de pruebas `5b5b1000…` del sandbox (OC-000003 y un respaldo en REC-000001); no se borra sin autorización.

## 2. Migraciones

| Migración | Contenido |
|---|---|
| `20261024000000_compras_contrato_orden_vigencia` | `contrato_vigente`, `contrato_monto_maximo_vigente`, trigger de ligadura (proveedor, proyecto, empresa, moneda), trigger de vigencia/monto al aprobar y emitir, tabla `orden_compra_excepciones`, RPC de excepción, tipos de evento |
| `20261024000100_contratos_renovacion_ampliacion` | `renovado_de`, RPC de renovar/prorrogar/ampliar, `contrato_ampliaciones`, historial y candados contra `UPDATE`/`INSERT` directos sin motivo |
| `20261024000200_compras_contrato_seguimiento` | RPC `compras_contrato_seguimiento(uuid)` |
| `20261024000300_proveedor_evaluaciones_integradas` | columnas de contrato/orden/evaluador, trigger, RLS por proyecto, vista `evaluaciones_por_proveedor` |
| `20261025000000_compras_contrato_coherencia_excepcion` | **Corrige dos huecos de `…0000` hallados al probar por la API directa** (ver §3.1): revalida la ligadura al editar, y ata la excepción a sus condiciones |

### 2.1 Los dos huecos que se encontraron y corrigieron

1. **Editar una orden en borrador conservando el contrato.** `compras_tg_oc_contrato()` salía en cuanto `contrato_id` no cambiaba, así que un `UPDATE` directo (la misma vía que PostgREST) podía cambiar el proveedor, la moneda o el proyecto y dejar la orden ligada a un contrato que ya no le corresponde. Ahora la ligadura se revalida cuando cambia el contrato **o** cualquiera de esos datos; el estado y la vigencia del contrato siguen exigiéndose solo al ligar y al aprobar/emitir (un contrato que venció después no impide corregir un borrador). Cambiar proveedor, moneda **y** contrato a la vez, de forma coherente, sí se permite.
2. **Una excepción se reutilizaba tras cambiar las condiciones.** Se identificaba por (orden, revisión, etapa, causas): cambiar el contrato o el importe de la orden en borrador la dejaba «vigente» para otra cosa (p. ej., autorizada por 1200 y usada para 5000, o dada para un contrato y usada con otro). Ahora guarda **contrato, proveedor, moneda e importe** y el trigger exige que coincidan; si cambió alguno hace falta una autorización nueva y la anterior queda como historial. Las filas previas a la migración no tienen esos datos (NULL) y por eso no autorizan nada nuevo.

## 3. Reglas (todas las decide el **servidor**; la pantalla solo ofrece)

1. **Ligar y editar.** Una orden con `contrato_id` exige el mismo proveedor, proyecto, empresa y moneda que el contrato (`COMPRAS_CONTRATO_PROVEEDOR` / `_PROYECTO` / `_AJENO` / `_MONEDA`), al crearla **y cada vez que cambia** alguno de esos datos; al ligar, además, que el contrato esté vigente (`COMPRAS_CONTRATO_FUERA_DE_VIGENCIA`).
2. **Aprobar y emitir** revalidan que el contrato siga vigente y, solo si tiene `monto_maximo`, que lo comprometido no lo rebase (`COMPRAS_CONTRATO_NO_VIGENTE`). El monto se verifica al **aprobar**. Monto vigente = original + ampliaciones documentadas. **Sin monto máximo = sin límite total** (nunca se inventa uno).
3. **El contrato no es obligatorio.** Una orden sin contrato se comporta como siempre; las reglas aplican solo cuando está ligada.
4. **Excepción** (única vía para aprobar/emitir con contrato no vigente o sobre su monto): quien tenga el permiso de cambio de estado de Contabilidad, con **motivo** obligatorio. Queda en `orden_compra_excepciones` (inmutable) y en el historial de la orden. Vale para **esas** condiciones: la de *aprobar* no cubre *emitir*; devolver la orden a borrador (revisión + 1) la invalida; cambiar el contrato, el proveedor, la moneda o el importe exige una nueva; reintentar la misma devuelve la misma; con separación de funciones activa no se autoriza la propia orden; y **no tapa** a un proveedor no autorizado.
5. **Renovar** crea un contrato **nuevo en borrador** que apunta al anterior; el anterior conserva estado, condiciones, documentos e historial («renovado por»). **Prorrogar** y **ampliar** exigen motivo; la ampliación lleva clave idempotente. Nada de esto genera facturas, pagos, asientos ni órdenes.
6. **Seguimiento.** Separa contratado ≠ comprometido (aprobada/emitida/recibida/cerrada) ≠ recibido ≠ facturado ≠ pagado, **por moneda**, con pendientes por renglón y diferencia de precio de #918. Contratos recurrentes: importe y vigencia mensual, sin total inventado. Los importes de facturas y pagos llegan `NULL` desde el servidor a quien no tiene Contabilidad.
7. **Evaluaciones.** Ligadas a un proveedor del catálogo de la empresa; el contrato debe ser de ese proveedor; el servidor sella al evaluador. Una evaluación negativa **no** suspende al proveedor ni toca el contrato.

> Nota de permisos que condiciona las pruebas: en este sistema un `operator` **inserta** órdenes pero **no las actualiza** (la política de UPDATE exige admin/propietario o permiso de edición de Contabilidad). Por eso las pruebas de edición de borradores se hacen como administrador; con un operador el `UPDATE` afecta 0 filas y «no falla» sin ser un defecto.

## 4. Matriz por ambiente

| Migración | Local / CI | Sandbox existente | Producción |
|---|---|---|---|
| `20261024000000` | aplicada y probada | **aplicada** (workflow, corrida 43) | **pendiente** (se aplica al fusionar, con aprobación del environment) |
| `20261024000100` | aplicada y probada | **aplicada** (corrida 44) | **pendiente** |
| `20261024000200` | aplicada y probada | **aplicada** | **pendiente** |
| `20261024000300` | aplicada y probada | **aplicada** | **pendiente** |
| `20261025000000` | aplicada y probada | **aplicada** (corrida 47) | **pendiente** |

## 5. Evidencia — entornos distintos (no se mezclan)

| Entorno | Qué es | Resultado aquí |
|---|---|---|
| **Postgres desechable** (`supabase/tests/compras_bloque_b/run.sh` y `proveedores_pr_a/run.sh`; en CI, jobs «RLS sandbox de recepción» y «RLS harness») | Clúster vacío creado y destruido en cada corrida; cadena completa de migraciones + datos sintéticos; **sesiones reales simultáneas** | Ver detalle abajo |
| **Sandbox existente** (`control-agua-rls-sandbox`, `jwpmivhvlstslncrtokb`) | Proyecto Supabase persistente; **no** es producción | Las 5 migraciones aplicadas **por el workflow, una por corrida y en orden**; tres guiones reversibles ejecutados **por SQL** (detalle abajo); **0 residuo**. No se tocó el padrón `5b5b1000…` |
| **Supabase Preview** (rama del PR) | Base efímera que Supabase crea al abrir el PR | Solo prueba que las migraciones se aplican y que el seed corre. **No** corre pruebas de comportamiento |
| **CI** del PR | GitHub Actions | Type-check/test/build, auditor de drift, RLS harness, RLS desechable, E2E y coverage (ver el estado del PR) |

**Postgres desechable**
- `run.sh` completo del bloque: **EXIT 0, 771 ✓** (incluye las suites 5o y 5p, la protección de inventario y la concurrencia).
- `assert_contratos_compras.sql`: **137 ✓** — aislamiento entre empresas y proyectos, Operaciones vs Contabilidad, proveedor suspendido, contrato vencido, renovación, órdenes parciales, cancelaciones y reintentos sin duplicados.
- `assert_contratos_coherencia.sql` (suite **5p**, nueva): **24 ✓** — edición de borradores conservando el contrato y reutilización de excepciones (§2.1). **Probada primero en rojo**: contra las definiciones anteriores de los triggers, el primer `UPDATE` directo («cambiar el proveedor conservando el contrato») **no fue rechazado**; con `20261025000000` pasa completa.
- Una primera corrida completa con la suite 5p falló en la preparación de la concurrencia por un **choque de ids** entre las dos suites (mismo prefijo `cf1…`); se cambió el prefijo de 5p y la corrida final pasa.
- Concurrencia con sesiones reales: **Q** dos aprobaciones de 600 sobre máximo 1000 (una pasa, una se rechaza), **R** misma renovación a la vez (un contrato, un evento), **S** misma ampliación a la vez (una ampliación).
- `proveedores_pr_a/run.sh` (carga masiva, históricos y demás de PR A) con la migración nueva en la cadena: **EXIT 0, 535 ✓**.

**Sandbox existente** (resultados reales, ejecutados por SQL, no por pantalla)

| Guion | Resultado |
|---|---|
| `sandbox_contratos_compras.sql` (ligar, vigencia, monto, ampliación, excepción, renovación, seguimiento, permisos, evaluaciones) | **65 comprobaciones, 0 fallos**, antes **y** después de aplicar `20261025000000` |
| `sandbox_contratos_coherencia.sql` (§2.1) | **Sin la migración: 15 comprobaciones, 8 fallos** — los `UPDATE` de proveedor, moneda y proyecto sobre una orden en borrador con contrato **se aplicaron sin error**; la excepción de 1200 sirvió para 5000; la dada para un contrato sirvió para otro (con importe igual) y la de un contrato vencido para otro. **Con la migración: 15 comprobaciones, 0 fallos** |
| `sandbox_importacion_historicos.sql` (carga masiva y vinculación de históricos) | **26 comprobaciones, 0 fallos** |

**Carga masiva y vinculación de históricos** siguen funcionando (guion del sandbox + harness de PR A): la vista previa no escribe; `todo_o_nada` con errores no aplica nada; `filas_validas` aplica las buenas y se declara **parcial**; importar **no autoriza** proveedores (ignora `estado`) ni **activa** contratos (quedan en borrador) ni genera asientos; reintentar un lote no duplica. En históricos: 1 **inequívoco** (se vincula), 2 **ambiguos** (forma societaria, homónimos) y 1 **sin coincidencia** quedan **pendientes**; el vínculo manual con motivo funciona; sin la pestaña de proveedores no se ve ni se vincula; no se borra ni fusiona nada.

Frontend: `tsc` y `eslint` sin errores; Vitest completo **7 116 ✓** (157 omitidas de antes). Esta corrección es solo de servidor; la pantalla ya muestra el mensaje del servidor (`COMPRAS_CONTRATO_NO_VIGENTE`) y, con permiso, ofrece autorizar de nuevo.

**Límites declarados**
- Los guiones del sandbox son una sola transacción: la **concurrencia** y los **reintentos entre sesiones** solo se probaron en el Postgres desechable.
- «API directa» = DML como `authenticated` con el `sub` del JWT fijado (lo que ejecuta PostgREST), **no** una llamada HTTP real con un token de usuario: no hay credenciales de usuario de prueba en el sandbox.
- No hay capturas de pantalla contra el sandbox; la UI está cubierta por Vitest.
- La herramienta SQL del sandbox se cuelga con `DELETE … WHERE` y `DROP INDEX`; los guiones no los usan (todo se revierte con una excepción final) y no se intentó esquivar.

## 6. Cómo validar (revisor)

1. `bash supabase/tests/compras_bloque_b/run.sh` (necesita PostgreSQL local) → EXIT 0; incluye 5o (137 ✓) y 5p (24 ✓).
2. `bash supabase/tests/proveedores_pr_a/run.sh` → EXIT 0 (carga masiva e históricos).
3. En el sandbox (ya con las migraciones), ejecutar cada guion de `supabase/tests/compras_bloque_b/`: debe terminar con `GUION_OK_REVERTIDO` (65 / 15 / 26 comprobaciones, 0 fallos).
4. Pantalla: orden de un proveedor con contrato vigente → el selector ofrece solo contratos activos y vigentes de ese proveedor y proyecto; con un contrato vencido, aprobar se rechaza y, con permiso de Contabilidad, ofrece la excepción con motivo; si después cambia el contrato o el importe, vuelve a pedirla.
