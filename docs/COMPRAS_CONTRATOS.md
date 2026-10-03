# Compras · Contratos de proveedor conectados con las compras

Conecta los contratos de proveedores (#911/#913) con las órdenes de compra y su seguimiento (#916/#918).
**Reutiliza** el catálogo compartido de proveedores, los permisos existentes y el circuito
orden → aprobación → recepción → factura → pago. **No hay** un segundo catálogo ni un segundo circuito de
órdenes. **Fuera de alcance** (a propósito): anticipos, notas de crédito y mecanismos de pago nuevos.

Todo va en migraciones **incrementales** (`20261024000000`–`0300`); no se editó ninguna migración aplicada.

## 1. Matriz: qué existía, qué estaba incompleto, qué es nuevo

| Pieza | Estado antes | Qué hace este PR |
|---|---|---|
| Catálogo compartido de proveedores (`proveedores`, #911) | existe | Se reutiliza tal cual; el contrato y la evaluación se ligan **por id** |
| Contratos (`contratos_proveedores`, #911/#913): proveedor por id, alcance empresa/proyecto, estados, carga masiva, vinculación de históricos (`dry_run` por defecto, ambiguos manuales, reversión por lote) | existe | Sin cambios: la carga masiva y sus validaciones siguen igual; los históricos ambiguos siguen pendientes (no se borra ni se fusiona nada) |
| Orden de compra con `contrato_id` | **incompleto**: el trigger solo comparaba proveedor/proyecto | Compara también **empresa y moneda** y exige contrato **vigente** al aprobar y emitir |
| Aprobación / recepción / factura / pago / pendientes por renglón (#916/#918) | existe | Se reutiliza sin tocar; el seguimiento del contrato lee de ahí |
| Proveedor autorizado para aprobar/emitir | existe | Sigue mandando: un proveedor suspendido bloquea aunque el contrato esté vigente |
| Vigencia por fechas (`contrato_vigente`) | nuevo | `activo` **y** `fecha_inicio ≤ hoy` **y** (`fecha_fin` nula o `≥ hoy`) |
| Excepción explícita y auditada | nuevo | `orden_compra_excepciones` (inmutable) + RPC `compras_oc_excepcion_contrato` |
| Renovación, prórroga y ampliación de monto con historial | nuevo | `contrato_renovar`, `contrato_prorrogar`, `contrato_ampliar_monto` + `contrato_ampliaciones` |
| Seguimiento del contrato | nuevo | RPC `compras_contrato_seguimiento` (por moneda) + modal en la pestaña de contratos |
| Evaluaciones de proveedor | **incompleto**: texto libre | Ligadas al proveedor compartido y, si aplica, contrato/orden; el servidor sella al evaluador |

## 2. Migraciones

| Migración | Contenido |
|---|---|
| `20261024000000_compras_contrato_orden_vigencia` | `contrato_vigente`, `contrato_monto_maximo_vigente`, trigger de ligadura (proveedor, proyecto, empresa, moneda), trigger de vigencia/monto al aprobar y emitir, tabla `orden_compra_excepciones`, RPC de excepción, tipos de evento |
| `20261024000100_contratos_renovacion_ampliacion` | `renovado_de`, RPC de renovar/prorrogar/ampliar, `contrato_ampliaciones`, historial y candados contra `UPDATE`/`INSERT` directos sin motivo |
| `20261024000200_compras_contrato_seguimiento` | RPC `compras_contrato_seguimiento(uuid)` |
| `20261024000300_proveedor_evaluaciones_integradas` | columnas de contrato/orden/evaluador, trigger, RLS por proyecto, vista `evaluaciones_por_proveedor` |

## 3. Reglas (todas las decide el **servidor**; la pantalla solo ofrece)

1. **Ligar.** Una orden con `contrato_id` exige el mismo proveedor, proyecto, empresa y moneda que el contrato
   (`COMPRAS_CONTRATO_PROVEEDOR` / `_PROYECTO` / `_AJENO` / `_MONEDA`) y que el contrato esté vigente
   (`COMPRAS_CONTRATO_FUERA_DE_VIGENCIA`).
2. **Aprobar y emitir** revalidan que el contrato siga vigente y, solo si tiene `monto_maximo`, que lo
   comprometido no lo rebase (`COMPRAS_CONTRATO_NO_VIGENTE`). El monto se verifica al **aprobar**.
   Monto vigente = original + ampliaciones documentadas. **Sin monto máximo = sin límite total** (nunca se
   inventa uno).
3. **El contrato no es obligatorio.** Una orden sin contrato se comporta como siempre; las reglas aplican solo
   cuando está ligada. (Decisión: hacerlo obligatorio rompería las compras puntuales y no estaba pedido.)
4. **Excepción** (única vía para aprobar/emitir con contrato no vigente o sobre su monto): quien tenga el
   permiso de cambio de estado de Contabilidad, con **motivo** obligatorio, queda en `orden_compra_excepciones`
   (inmutable) y en el historial de la orden. Está acotada a (orden, revisión, etapa, causas): la de *aprobar* no
   cubre *emitir*, devolver la orden a borrador (revisión + 1) la invalida, reintentar devuelve la misma, con
   separación de funciones activa no se autoriza la propia orden y **no tapa** a un proveedor no autorizado.
5. **Renovar** crea un contrato **nuevo en borrador** que apunta al anterior; el anterior conserva estado,
   condiciones, documentos e historial (se registra «renovado por»). **Prorrogar** y **ampliar** exigen motivo;
   la ampliación lleva clave idempotente (misma clave y contenido = misma ampliación; distinto contenido =
   rechazo). Nada de esto genera facturas, pagos, asientos ni órdenes.
6. **Seguimiento.** Separa contratado ≠ comprometido (aprobada/emitida/recibida/cerrada) ≠ recibido ≠ facturado
   ≠ pagado, **por moneda**, con pendientes por renglón y diferencia de precio de #918. Contratos recurrentes:
   importe y vigencia mensual, sin total inventado. Los importes de facturas y pagos llegan `NULL` desde el
   servidor a quien no tiene Contabilidad.
7. **Evaluaciones.** Ligadas a un proveedor del catálogo de la empresa; el contrato debe ser de ese proveedor;
   el evaluador, la fecha y los criterios los fija el servidor/formulario. Una evaluación negativa **no**
   suspende al proveedor ni toca el contrato.

## 4. Matriz por ambiente

| Migración | Local / CI | Sandbox existente | Producción |
|---|---|---|---|
| `20261024000000` | aplicada y probada | **aplicada** (workflow, corrida 43) | **pendiente** (se aplica al fusionar, con aprobación del environment) |
| `20261024000100` | aplicada y probada | **aplicada** (corrida 44) | **pendiente** |
| `20261024000200` | aplicada y probada | **aplicada** | **pendiente** |
| `20261024000300` | aplicada y probada | **aplicada** | **pendiente** |

## 5. Evidencia — tres entornos distintos (no se mezclan)

| Entorno | Qué es | Resultado aquí |
|---|---|---|
| **Postgres desechable** (`supabase/tests/compras_bloque_b/run.sh`; en CI, jobs «RLS sandbox de recepción» y «RLS harness») | Clúster vacío creado y destruido en cada corrida; cadena completa de migraciones + datos sintéticos; **sesiones reales simultáneas** | `run.sh` EXIT 0. `assert_contratos_compras.sql`: **137 ✓** (aislamiento entre empresas y proyectos, Operaciones vs Contabilidad, proveedor suspendido, contrato vencido, renovación, órdenes parciales, cancelaciones, reintentos sin duplicados). Concurrencia: **Q** dos aprobaciones de 600 sobre máximo 1000 (una pasa, una se rechaza), **R** misma renovación a la vez (un contrato, un evento), **S** misma ampliación a la vez (una ampliación). Los harnesses de PR A (`proveedores_pr_a`) siguen en EXIT 0 |
| **Sandbox existente** (`control-agua-rls-sandbox`, `jwpmivhvlstslncrtokb`) | Proyecto Supabase persistente; **no** es producción | Las 4 migraciones aplicadas **por el workflow, una por corrida y en orden**, y registradas en `schema_migrations`. Guion reversible `sandbox_contratos_compras.sql`: **65 comprobaciones, 0 fallos** (`GUION_OK_REVERTIDO`), ejecutado **por SQL**, no por pantalla; **0 residuo** (empresas, usuarios, contratos, órdenes, proveedores y excepciones `5b5e0000…` = 0). No se tocó el padrón `5b5b1000…` |
| **Supabase Preview** (rama del PR) | Base efímera que Supabase crea al abrir el PR | Solo prueba que las migraciones se aplican y el seed corre: ✅ en `72b688c4`. **No** corre pruebas de comportamiento |
| **CI** del PR (SHA `72b688c4`) | GitHub Actions | Type-check/test/build ✅, auditor de drift ✅, RLS harness ✅, RLS sandbox desechable ✅, E2E ✅, Coverage gate ✅ |

Frontend: `tsc` y `eslint` sin errores; Vitest completo **7 116 ✓** (157 omitidas de antes), con pruebas nuevas
de dominio (`contratosCompras.test.ts`), selector y excepción en órdenes, modal de seguimiento, renovar/ampliar
y evaluaciones.

**Límites declarados**
- El guion del sandbox es una sola sentencia (una transacción): la **concurrencia** y los **reintentos entre
  sesiones** solo se probaron en el Postgres desechable.
- No hay capturas de pantalla contra el sandbox en este PR; la UI está cubierta por Vitest.
- La herramienta SQL del sandbox se cuelga con `DELETE … WHERE` y `DROP INDEX`; el guion no los usa (todo se
  revierte con una excepción final) y no se intentó esquivar.

## 6. Cómo validar (revisor)

1. `bash supabase/tests/compras_bloque_b/run.sh` (necesita PostgreSQL local) → EXIT 0 y 137 ✓ de contratos.
2. En el sandbox (ya con las migraciones): ejecutar `supabase/tests/compras_bloque_b/sandbox_contratos_compras.sql`;
   debe terminar con `GUION_OK_REVERTIDO · 65 comprobaciones, 0 fallos`.
3. Pantalla: en un proyecto, crear una orden de un proveedor con contrato vigente → el selector ofrece solo
   contratos activos y vigentes de ese proveedor y proyecto; con un contrato vencido, aprobar se rechaza y, con
   permiso de Contabilidad, ofrece la excepción con motivo; el modal de seguimiento muestra montos por moneda.

## 7. Pendiente / requiere autorización

- **Producción no se tocó.** Al fusionar, `apply-migrations-prod` aplicará las 4 migraciones (con la aprobación
  del environment).
- Tras aplicarlas en producción habrá que **refrescar `huella-produccion.json`** con una captura real de solo
  lectura (**requiere autorización**); mientras tanto el auditor mostrará estas migraciones como cambios
  planificados, no como drift.
- Decisión abierta: conservar o retirar el padrón de pruebas `5b5b1000…` del sandbox (OC-000003, un respaldo en
  REC-000001); no se borra sin autorización.
- Fuera de alcance, para después: anticipos y notas de crédito.
