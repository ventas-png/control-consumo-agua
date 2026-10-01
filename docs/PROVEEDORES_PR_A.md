# PR A — Proveedores compartidos, contratos y carga masiva

Primero de tres PR encadenados (A: proveedores/contratos/carga masiva · B: compra/recepción/factura ·
C: consumo/excepciones/seguimiento). Este documento es la referencia del PR A y fija las interfaces
que B y C consumen. El diagnóstico previo y la matriz de brechas están en
[`PROVEEDORES_DIAGNOSTICO.md`](./PROVEEDORES_DIAGNOSTICO.md).

> **No se escribió en ningún entorno remoto.** Todo se validó contra un PostgreSQL 16 local con la
> cadena completa de migraciones (ver «Verificación»). No se tocó el sandbox ni producción, no se
> ejecutó saneamiento de datos y no se envió nada a proveedores.

## 1. Decisión de diseño: un solo catálogo, un solo motor

| Pieza | Decisión |
|---|---|
| Proveedor | **Una** tabla, `proveedores`, por empresa. Contabilidad y Operaciones leen la misma fila por `id`. No hay catálogo paralelo. |
| Compras | `ordenes_compra` sigue siendo **el** motor. No se crea un segundo. El contrato solo se *prepara* para relacionarse (`ordenes_compra.contrato_id`). |
| Contrato | `contratos_proveedores` (el que ya usaba Operaciones) gana `proveedor_id` (FK), fotografía, ciclo de vida e historial. La pestaña se llama ahora **«Contratos»**; «Proveedores» vive solo en Contabilidad. |
| Contabilidad | Reutiliza `conta_reglas_proveedor`, `conta_resolver_imputacion_interno`, `conta_mapeo_cuentas` y la honra de `orden_compra_lineas.cuenta_id` en la recepción. Añade `conta_reglas_compra` para lo que faltaba (categoría/producto). |

### Identidad canónica del proveedor (por empresa)

* La **identidad** es el `id` (FK en todo). El **código visible** (`PRV-00001`, correlativo por empresa,
  editable) es distinto de la **cuenta contable**: no se crean subcuentas por proveedor.
* **Duplicados:** `identificacion_norm` (columna generada: mayúsculas, solo alfanuméricos) + `pais`.
  Un trigger con *advisory lock* rechaza `PROVEEDOR_DUPLICADO`; país nulo actúa como comodín. **Nunca**
  se fusiona por nombre parecido. Los duplicados legados se *listan* (`proveedores_duplicados_fiscales()`),
  no se tocan.
* **Multi-proyecto sin compartir entre empresas:** `proveedor_proyectos` (pendiente / habilitado /
  suspendido / retirado). La **autorización general** (`proveedores.estado`) y la **habilitación por
  proyecto** son dos cosas: para comprar en un proyecto hacen falta ambas (`proveedor_habilitado_en`),
  salvo `alcance = 'empresa'` (lo legado: sirve a todos los proyectos). Un trigger en `ordenes_compra`
  lo hace cumplir en el servidor.
* **Qué abastece:** `abastece text[]` ∈ servicios / suministros / equipos.
* Contactos reutilizables: `proveedor_contactos`; un contrato puede además llevar un contacto propio.
* La papelería sensible (RTU, DPI, referencia bancaria) deja de leerla toda la empresa:
  `prov_puede_ver_papeleria()` la limita a quien ve Contabilidad.

## 2. Configuración contable: precedencia completa

Resuelve el servidor (`compras_resolver_cuenta_linea`); la UI solo la enseña
(`ReglasCompraSection`) y la consume al capturar una línea de orden de compra.

1. **Cuenta elegida explícitamente en la línea** (`orden_compra_lineas.cuenta_id`) — siempre gana.
2. **Regla de compra** (`conta_reglas_compra`), de más a menos específica:
   producto+proveedor › producto › categoría+proveedor › categoría. Por empresa/proyecto, con vigencia.
3. **Regla de cuenta por proveedor** (`conta_reglas_proveedor`, existente).
4. **Mapeo general del evento** (`conta_mapeo_cuentas`, existente).
5. **Sin resolver:** se *muestra* («configuración incompleta», `compras_config_estado`), no se contabiliza
   en silencio ni se inventa una cuenta.

Reglas de integridad (triggers, no solo UI):

* Alcance, vigencia y **aptitud** de la cuenta validados en servidor: gasto/costo → cuenta de gasto;
  inventario/activo fijo → cuenta de activo; de detalle y activa; de la misma empresa/proyecto.
* **Sin códigos de cuenta fijos** en ninguna parte; no se manda todo un proveedor a una sola cuenta
  (la regla clasifica por *lo que se compra*).
* Cuenta por pagar y destino de compra son configuraciones distintas.
* **No se altera lo histórico:** una regla que ya rige es inmutable; cambiar un predeterminado cierra la
  vigente y abre otra con `compras_reemplazar_regla_cuenta` desde una fecha futura. Lo ya capturado
  conserva su cuenta.
* En la captura de la orden **solo una regla de compra** se guarda en la línea (`cuenta_id`); si el origen
  es regla del proveedor o mapeo, la línea queda vacía y el posteo se resuelve como hoy. Así este PR
  no cambia el asiento de ningún documento existente.

## 3. Contratos

* `proveedor_id` obligatorio al crear (selector del catálogo, no texto libre); el servidor verifica que
  sea de la misma empresa y toma la **fotografía** (`proveedor_snapshot`: nombre, NIT, contacto) y el
  `proveedor_nombre`; editar el proveedor después no altera el contrato.
* Alcance, modalidad (`recurrente` / `por_demanda`), periodicidad, moneda, importe periódico, monto
  máximo, vigencia, responsable, notas, respaldo **privado** (bucket `contratos-respaldo`, política por
  fila del contrato; nunca el bucket público del proyecto).
* **Estados:** `borrador → activo → suspendido / vencido → terminado / cancelado` (los dos últimos son
  finales). **Suspender, terminar y cancelar exigen motivo**, y debe ser *nuevo* en cada transición.
  Eventos en `contrato_proveedor_eventos` (solo inserción).
* **Activar no genera facturas, pagos ni asientos.** Tras activar se congelan proveedor, modalidad,
  importes e inicio: para cambiarlos se termina y se crea otro.
* **No se borra** un contrato con documentos: solo un *borrador limpio* se elimina; lo demás se termina
  o cancela con motivo e historial.
* **Estado del contrato ≠ autorización del proveedor.**

### Suspensión: qué se bloquea y qué no

| Evento | Efecto |
|---|---|
| Proveedor deja de estar *autorizado* (suspendido / vetado / vencido) | No se le emiten órdenes nuevas (`proveedor_habilitado`). Lo ya emitido, recepciones y facturas existentes **no** se alteran. |
| Habilitación de proyecto *suspendida / retirada* | No se le emiten órdenes **en ese proyecto**; en los demás sigue igual. |
| Contrato *suspendido / vencido / terminado / cancelado* | Informa y sirve de base a B/C (no se puede ligar una orden nueva a un contrato no activo). No toca documentos ya emitidos. |
| Cualquiera de los anteriores | Nunca borra ni reescribe historia ni asientos. |

## 4. Históricos (sin ejecutar saneamiento)

Los contratos previos tienen el proveedor en texto libre (`proveedor_id` nulo) y `evaluaciones_proveedor.proveedor_id`
apunta en realidad a un contrato. Herramientas incluidas — **ninguna se ejecuta sola ni se ejecutó en
producción**:

* `contratos_sin_proveedor_vista_previa()` clasifica: **inequívoca** (un único proveedor con el mismo
  nombre normalizado o solo difiere la forma societaria / mismo correo), **ambigua** (varios candidatos →
  vínculo manual) o **sin coincidencia**.
* `contrato_vincular_proveedor` (manual), `contratos_vincular_inequivocos(p_dry_run default **true**)`,
  `contratos_vinculacion_resumen()` (conteos antes/después).
* Conserva ids, textos y documentos; no borra ni fusiona proveedores; no crea autorizaciones ni datos fiscales.
* **Reversión:** cada vínculo masivo queda en un lote; `contratos_vinculos_revertir(lote, motivo)` lo
  deshace (restaura el texto original) con su evento.
* Vista `evaluaciones_por_proveedor` (security_invoker) expone las evaluaciones por proveedor del catálogo.

Estrategia recomendada para el entorno real (decisión de quien administra, fuera de este PR):
1) aplicar las migraciones en sandbox; 2) simular (`dry_run`) y revisar ambiguos; 3) aplicar inequívocos
por lote; 4) comparar conteos antes/después; 5) revertir por lote si algo no cuadra.

## 5. Carga masiva

Tipos: **proveedores**, **asignaciones a proyecto**, **contratos**. CSV o XLSX con plantillas descargables
(hoja «Instrucciones»; códigos y NIT como **texto**).

* **El servidor decide.** El navegador solo lee el archivo y envía texto. `proveedores_importar_previsualizar`
  valida y guarda un *lote* (nada toca el catálogo); `proveedores_importar_aplicar` lo aplica.
* Vista previa con errores y advertencias **por fila**, crear vs. actualizar, **campos que cambian**
  (antes → después), duplicados en el archivo y contra la base (clave `id:<país>:<norm>`).
* **Celdas vacías no borran** salvo la opción explícita «vaciar celdas vacías». Actualizar existentes es
  opción (por defecto solo crea).
* Valida proyectos y cuentas dentro del alcance autorizado del usuario.
* **Modos:** `todo_o_nada` (una fila mala → no se guarda nada) o `filas_validas` (las buenas se guardan y las
  erróneas quedan en el informe). Nunca queda un parcial sin informar: el resultado dice qué se aplicó y qué no.
  Informe CSV por fila descargable.
* **Reintentos sin duplicar:** aplicar es idempotente (bloqueo de fila del lote; el mismo contenido ya aplicado
  se avisa); si los datos cambiaron desde la vista previa el lote vuelve a `previsualizado` con
  `desactualizado: true`.
* **Importar nunca autoriza, habilita ni activa:** columnas de estado/autorización están prohibidas.
* **Seguridad del archivo:** sin ejecutar fórmulas, macros ni vínculos; se rechazan `.xlsm/.xls/.xlsb`, celdas
  que empiezan con `=`/`@`, archivos > 5 MB o > 2000 filas. Toda exportación neutraliza fórmulas
  (`escaparCeldaCsv`, una única definición compartida con `exportData`).
* Lote con actor, fecha y resultado por fila; visible solo para quien lo creó (o roles exentos de proyecto).

## 6. Interfaz

* **Contabilidad → Proveedores:** catálogo de la empresa (código, país, abastece, alcance, ficha, carga
  masiva, alerta de duplicados legados, búsqueda por nombre/código/NIT).
* **Operaciones → Contratos:** contratos de **este proyecto**, con el selector del catálogo, ciclo de vida,
  historial, respaldo privado y panel de históricos sin vincular.
* `ContextoActivo` muestra siempre **empresa y proyecto** activos y el nivel (empresa vs. proyecto).
* **Ficha del proveedor** (misma en ambos lados): contactos, proyectos y habilitación, contratos, y órdenes,
  recepciones, facturas y pagos **según permiso**; la papelería sensible no se consulta sin permiso.
* **Cuentas sugeridas** en Contabilidad → Reglas de imputación y en la captura de líneas de orden de compra.

Capturas: [`docs/capturas/proveedores/`](./capturas/proveedores/) (generadas con datos de ejemplo
sobre los componentes reales; no hay entorno remoto).

## 7. Seguridad y permisos

Permisos **reutilizados** (no se agregó ninguno): `contabilidad` (ver/crear/editar/cambiar estado),
`condominios.tab.proveedores`, `conta_puede_escribir(accion)`, `can_access_project`. **Sin excepciones de
autoaprobación nuevas:** habilitar o suspender requiere el permiso de cambio de estado y un proveedor
autorizado; quien carga no se autoriza a sí mismo.

RLS en todas las tablas nuevas, aislamiento por empresa y proyecto en tablas, RPC y archivos; `anon` sin
privilegios; funciones internas no ejecutables por `authenticated`; correlativos deny-all.

## 8. Matriz de aceptación

| # | Criterio | Evidencia |
|---|---|---|
| 1 | Un solo catálogo por empresa, id como FK | `assert_identidad` |
| 2 | Duplicado por NIT+país rechazado; nombres parecidos no se fusionan; concurrente = 1 fila | `assert_identidad`, concurrencia A |
| 3 | Mismo proveedor en dos proyectos con configuración distinta | `assert_identidad`, `assert_reglas` |
| 4 | Sin acceso cruzado entre empresas/proyectos (tablas, RPC, archivos) | `assert_permisos`, `assert_contratos` |
| 5 | Habilitación por proyecto exigida en servidor | `assert_identidad` |
| 6 | Precedencia de cuentas completa y cambios de predeterminado sin alterar histórico | `assert_reglas` |
| 7 | Contrato: snapshot, estados, motivo, congelamiento, no-delete, activar sin asientos | `assert_contratos` |
| 8 | Editar el proveedor no altera documentos históricos | `assert_contratos` |
| 9 | Históricos ambiguos → manual; dry-run por defecto; reversión por lote | `assert_historicos` |
| 10 | Importar no autoriza/activa/contabiliza; reintento no duplica; todo-o-nada y filas válidas | `assert_importacion`, concurrencia B |
| 11 | Sin fórmulas/macros; exportaciones neutralizadas | `csv.test.ts`, `importacion.test.ts` |
| 12 | UI: contexto, «Contratos» ≠ «Proveedores», selector, import, reglas | `proveedoresUI.test.tsx` |
| 13 | Migraciones nuevas únicamente; append-only; guard de RLS/SECURITY DEFINER | `migrations-guard`, `rlsInitplan` |

## 9. Verificación

* `bash supabase/tests/proveedores_pr_a/run.sh` — PostgreSQL 16 local, cadena de migraciones completa, 459+
  aserciones, 2 pruebas con sesiones concurrentes reales y chequeo append-only.
* `npm run type-check`, `npm run lint`, `npm test`, `npm run build`.
* `node scripts/migrations-guard.mjs`.

## 10. Entornos y sincronización

**No se escribió en ningún entorno remoto** (el conector de Supabase del entorno no estaba disponible y
no se intentó eludirlo). `src/types/database.types.ts` **no** se regeneró a propósito: el cliente no está
tipado con `Database` y regenerarlo chocaría con el PR 904; el workflow de deriva de tipos es informativo.

Migraciones nuevas (orden de aplicación):

1. `20261020000000_proveedores_identidad_y_proyectos.sql`
2. `20261020000100_contratos_proveedor_vinculados.sql`
3. `20261020000200_contratos_historicos_vinculacion.sql`
4. `20261020000300_compras_reglas_cuenta.sql`
5. `20261020000400_proveedores_importacion_lotes.sql`

Procedimiento autorizado para el sandbox existente (identificarlo antes de cualquier escritura): el flujo
normal de migraciones del repo (workflows en `.github/workflows`), sin `reset` ni `repair` masivo. Si el sandbox exige
sincronización previa, presentar esta lista exacta y esperar autorización.

Notas:

* Las versiones se eligieron por encima de la mayor del PR 904 (`20261014…`). Si este PR se fusiona antes,
  el 904 quedaría «intercalado» y habría que renumerarlo.
* Deriva preexistente ajena a este PR: `conta_ec_*` (PR 901/902) aún no figura en la huella de producción.

## 11. Interfaces para PR B (compra / recepción / factura)

Lo que B puede asumir de A, sin rehacerlo:

* **Proveedor:** `proveedores.id`; `proveedor_habilitado_en(proveedor, proyecto)` para validar al emitir.
* **Contrato:** `ordenes_compra.contrato_id` ya existe con trigger de coherencia (mismo proveedor, empresa y
  proyecto; contrato `activo`). B decide el *uso* (vincular al emitir, descontar de `monto_maximo`).
* **Cuenta de la línea:** `compras_resolver_cuenta_linea(...)` y `compras_sugerir_cuenta(...)`; B debe
  llamarlas al **devengar** la recepción/factura para las líneas con `cuenta_id` nulo (hoy se difiere:
  el posteo sigue con el mapeo existente). Config incompleta: `compras_config_estado`.
* **Alta de proveedor desde compras:** crear siempre en el catálogo (`proveedores`), nunca texto libre.
* **Documentos del proveedor:** vista de actividad por proveedor ya existente en la ficha.

Pendiente para B (no incluido): devengo con regla de compra, tolerancias de recepción/factura, anticipos,
recepciones parciales contra contrato, conciliación orden-recepción-factura por contrato.

## 12. Interfaces para PR C (consumo / excepciones / seguimiento)

* **Contrato recurrente / por demanda** (`modalidad`, `periodicidad`, `importe_periodico`, `monto_maximo`) es
  la base para medir consumo y desviaciones.
* **Eventos del contrato** (`contrato_proveedor_eventos`, solo inserción) para trazabilidad de excepciones.
* **Evaluaciones** por proveedor del catálogo: vista `evaluaciones_por_proveedor`.
* **Sin autoaprobación:** C debe definir excepciones con un aprobador distinto de quien las solicita.

Pendiente para C: medición de consumo, alertas de desviación, flujo de excepciones y seguimiento.

## 13. Decisiones de negocio pendientes (antes de automatizar)

No se asumió ningún valor. Se necesita la decisión de negocio para:

* **Umbrales** de monto que exigen aprobación o contrato.
* **Tolerancias** de recepción y de facturación (cantidad y precio).
* **Excepciones**: quién las aprueba, vigencia y tope; confirmación de que nunca se autoaprueban.
* **Anticipos**: si se admiten, con qué límite y cómo se concilian.
* **Autorizaciones**: vigencia por defecto de la autorización de proveedores y papelería exigible por tipo.
* **Qué hacer con los duplicados fiscales legados** (listados, no fusionados).

## 14. Alcance explícito fuera de este PR

* Las pestañas de Suministros y Proformas de Operaciones siguen usando `contratosProveedores` como lista de
  proveedores (lectura); migrarlas al selector compartido corresponde a B.
* `proveedores_energia` (módulo de servicios de energía) es otro dominio y no se tocó.
* No se ejecuta saneamiento de producción.
