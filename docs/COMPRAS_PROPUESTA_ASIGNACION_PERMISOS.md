# Compras · propuesta de asignación de permisos (Alexander Monterroso y plantillas)

> **Lecturas de producción del 2026-10-10, releídas el 2026-10-11 en lo que cambia esta revisión (y, para `[Q31]` y `[Q32]`, una vez más el 2026-10-11 a las 05:06 UTC) · SOLO LECTURA.** Cada cifra de este documento sale de un `SELECT` contra producción (`nnsqmeigtgewatameexo`) y la consulta que la produjo está citada (`[Q#]`, texto completo en el **Apéndice**). **No se escribió nada** en producción, en el sandbox ni en la base de preview, y **este documento no concede ningún permiso**: es la propuesta que una persona con autoridad debe aceptar o rechazar con las decisiones de §7. Se refiere a la migración `20261027000900` del PR #926 (en **borrador**, y **sigue en borrador hasta que se responda A-1**), que por diseño **no concede ninguna llave** a nadie. La propuesta ejecutable es `scripts/propuesta-asignaciones-permisos-compras.sql`: siempre comentada, con tres seguros (comentario, una excepción que exige confirmar, `ROLLBACK`) y **probada** en una base desechable con el esquema real de las diez migraciones (§10).

## 0. Lectura rápida

| Pregunta | Respuesta |
|---|---|
| ¿Se concedió algo? | **No.** Ni a personas, ni a roles, ni a plantillas. |
| ¿Qué exige HOY el servidor, en producción? | **Para las seis acciones, solo `platform.contabilidad.edit`** (políticas `UPDATE`). **No existen** `compras_exigir_accion` ni los disparadores `compras_tg_permiso_*` (los trae este PR en la 0300): ni las políticas `UPDATE` ni los 31 disparadores de las cinco tablas del circuito consultan `approve` ni `change_status`. Por eso hoy **cualquier** persona con `edit` puede las seis acciones y, tras la 0900, las pierde; hoy solo Alexander tiene `edit`, `approve` y `change_status` (0 personas más) `[Q29]`. Las columnas «hoy» de las matrices miden las llaves genéricas de la pantalla y de la cadena 0300–0800 de este PR, **no** un control del servidor de producción (§1). **Pero `approve` y `change_status` sí gobiernan otras cosas en el servidor:** en producción **15 funciones públicas** los consultan (`change_status` en 14, `approve` en 1; 11 ejecutables por `authenticated`), ninguna de ellas una de las seis transiciones; la que importa para el circuito de compras es `compras_oc_excepcion_contrato` (autorizar la excepción de contrato con que una orden se aprueba o se emite), que Alexander conserva con cualquier paquete (§1, §5.3) `[Q31]` |
| ¿Quién pierde acciones al aplicar la 0900? | **1 persona** (Alexander Monterroso: pierde 5 de las 6 acciones y conserva «aprobar orden de compra»), **2 plantillas de sistema** («Admin Plataforma» y «Finanzas / Contador», sin ninguna persona asignada) y **1 rol de empresa** (la copia «Finanzas / Contador» de Prestadora de Servicios S.A., con 1 persona: Alexander) `[Q1]`. **Gana** 1 plantilla («Administrador General», acción 1, sin efecto práctico: §4) |
| ¿Quién más puede las seis acciones sin ninguna llave? | **3 cuentas por perfil:** Marco Santos Godoy (`admin`, solo en sus 3 proyectos), la cuenta propietaria (`company_owner`) y el superadministrador (`super_admin`), estas dos sin límite de proyecto `[Q7]`. Ninguna llave les quita nada |
| ¿Hay uso real de las seis acciones? | **Prácticamente no.** 1 orden de compra histórica sin autor; 1 factura (anulada) creada y aprobada por la cuenta propietaria con 10,5 s de diferencia; **0** recepciones, órdenes de pago, contraseñas, pagos y asientos. Alexander **no figura como autor de ninguna fila de negocio** y su último inicio de sesión registrado es del 2026-08-13 `[Q8–Q11, Q30]` (§3) |
| Tres paquetes (§5) | **A · ninguna llave por ahora:** 0 usos y ningún inicio de sesión registrado desde el 2026-08-13 (§3); se concede en un minuto cuando vuelva a operar; **el PR puede fusionarse igual** aceptando el efecto transitorio. **B · recepción + factura + orden de pago (RECOMENDADA):** `recepcion_registrar`, `factura_aprobar` y `orden_pago_aprobar`; **no** `pago_ejecutar` ni `pago_anular` (ejecutar el pago saca el efectivo y anularlo reversa un egreso ya hecho: segunda firma, §5.1). **C · continuidad total** (= lo que Alexander puede hoy): las **cinco** llaves. Diferencia B–C: exactamente dos llaves; A–B: tres. Plantillas y rol de empresa: **no conceder nada ahora** en ningún paquete. La concesión, desde el panel por Marco, **después** del despliegue de la 0900 (§5, §6) |
| ¿Qué falta para avanzar? | Responder **A-1** (§7): qué paquete. El PR #926 **sigue en borrador hasta entonces**; **A es una respuesta válida**. Además, dos decisiones que la base no puede dar: qué **persona** hay detrás de la cuenta propietaria y quién **paga** en Cascadas de Vista Hermosa, La Arboleda CVH y Viñas del Sur Condominio 3 (§5.4) |
| Proyectos | Las concesiones **no tocan** `user_project_assignments`: Alexander conserva sus 6 proyectos y Marco sus 3 (§6.4) |
| Orden de despliegue | **#928** (`20261026000600`) → **#926** (`20261027000000…0900`) → futuro PR de **alcance por proyecto** (`20261027001000`, justo tras la 0900) → **#927** (`20261028000000`), cada uno en su propio *push* a `main` (§6.1) |
| Hallazgos inesperados | (1) el rol de empresa de Alexander tiene **1 193 de las 1 201 llaves** del catálogo (la plantilla, 63): **1 106 concedidas en bloque por la cuenta propietaria el 2026-08-13 21:52:53** y **87 sin actor** entre 2026-06-12 y 2026-09-10; (2) «Monterroso» y «Santos» coinciden con **3 cuentas cada uno** y hay dos empresas de nombre casi igual: la propuesta anterior filtraba por nombre; (3) las copias de empresa son fotografías: no se refrescan; (4) nada impide aprobar una factura que uno mismo creó (solo existe esa regla para la orden de compra, y apagada); (5) **con cualquier paquete** Alexander conserva `approve` y `change_status` genéricos y con ellos puede anular facturas (sin pagos aplicados), recepciones y contraseñas, cancelar o cerrar órdenes y **autorizar excepciones de contrato** (`compras_oc_excepcion_contrato`, que no es una de las seis acciones y exige solo `change_status`) (§5.3). Detalle en §9 |

---

## 1. Qué exige el servidor a cada acción

Fuente: `supabase/migrations/20261027000900_…` (comprobación común `compras_exigir_permiso`: empresa → permiso → proyecto), las políticas RLS de producción `[Q14]` y las definiciones de las funciones en producción `[Q16]`.

> **Qué exige HOY el servidor en producción (releído el 2026-10-11 `[Q29]`).** Producción está en la migración `20261026000500` (0 versiones `≥ 20261027`). **No existen** `compras_exigir_accion`, `compras_exigir_permiso` ni `compras_sesion_usuario`, ni ningún disparador `compras_tg_permiso_*`: ninguno de los 31 disparadores de las cinco tablas del circuito, ni las funciones que ejecutan, consulta `approve`, `change_status`, `user_has_permission` ni `conta_puede_escribir`, y ninguna política `UPDATE` de esas tablas los menciona. Las políticas `UPDATE` piden **solo `platform.contabilidad.edit`** (o los perfiles `admin`/`company_owner`/`super_admin`). Es decir: **para las seis transiciones el servidor de producción exige solo `edit`** (`approve` y `change_status` solo gobiernan, para ellas, la pantalla), y hoy cualquier persona con `edit` puede las seis acciones por la API (hoy solo Alexander tiene `edit`, `approve` y `change_status`: 0 personas más). La cadena `…0300` a `…0800` **de este PR** es la que empieza a exigir `approve`/`change_status` en el servidor para esas transiciones, y la 0900 las sustituye por la llave de cada acción. **Por eso la columna «Llave que exigía antes» describe la cadena 0300–0800 de este PR, no producción**: hoy el servidor solo pide `edit`, y con la 0900 pasa a pedir además la llave de cada acción.
>
> **Lo que SÍ gobiernan `approve` y `change_status` en producción `[Q31]`.** Una búsqueda en `pg_proc` (`prosrc` que consulta `conta_puede_escribir('change_status')`, `conta_puede_escribir('approve')` o la llave `platform.contabilidad.change_status`/`.approve`) devuelve **15 funciones públicas** (las 5 funciones `agua_*` que también mencionan «change_status» consultan llaves del módulo de agua, `agua.cobros.change_status` y `agua.lecturas.change_status`, y no entran). **Ninguna es una de las seis transiciones.** `change_status` en 14, `approve` en 1; 11 son ejecutables por `authenticated`, 2 son disparadores y 2 no son ejecutables por la API (una función auxiliar y la de ajustes):
>
> | Función pública | Llave | Qué protege | ¿Importa para el circuito de compras? |
> |---|---|---|---|
> | `compras_oc_excepcion_contrato` | `change_status` | autorizar la **excepción de contrato** (monto o vigencia) con que una orden en borrador se aprueba o una aprobada se emite; `SECURITY DEFINER`, ejecutable por `authenticated`; rechaza la autoautorización solo si `compras_config.aprobacion_separada` está activa (apagada en todas las empresas) | **Sí, directo.** Alexander la conserva con cualquier paquete (§5.3, A-6, A-7) |
> | `conta_reprocesar_factura_proveedor` | `create` + `change_status` | reintentar la contabilización de una factura de proveedor aprobada que quedó sin asiento | Sí, indirecto: el asiento de una factura del circuito |
> | `conta_facturas_pendientes` | `create` + `change_status` | bandeja de facturas aprobadas sin asiento; las llaves solo deciden el indicador `puede_aplicar` que la pantalla usa para ofrecer el reproceso | Lectura; solo gobierna un botón |
> | `cxp_tg_proveedor_estado` (disparador de `proveedores`) | `change_status` | autorizar un proveedor | Alimenta el circuito (el proveedor autorizado) |
> | `proveedor_proyectos_tg` (disparador de `proveedor_proyectos`) | `change_status` | habilitar un proveedor en un proyecto | Alimenta el circuito |
> | `conta_publicar_asiento`, `conta_anular_asiento` | `change_status` | publicar o anular un asiento | Contabilidad general; no es una transición del circuito |
> | `banco_conciliar_movimiento`, `banco_desconciliar_movimiento`, `conta_incidencia_resolver` | `change_status` | conciliar o desconciliar un movimiento bancario y resolver incidencias de conciliación | No |
> | `conta_cargos_pendientes`, `conta_reprocesar_cargo`, `conta_saldos_favor`, `conta_sf_autorizar` (no ejecutable por la API) | `create` + `change_status` | cargos y saldos a favor de clientes (cuotas, cobros) | No |
> | `conta_ajuste_bloquear_para_revision` (no ejecutable por la API) | `approve` | bloquear un ajuste para revisión | No |
>
> Cada fila es una función o grupo de funciones que consulta esa llave; la lista completa son esas 15. **Dónde importa para esta propuesta:** (a) `compras_oc_excepcion_contrato`, porque con ella un `operator` con `change_status` puede dejar pasar una orden fuera del monto o de la vigencia de su contrato (§5.3); (b) lo demás no cambia con ningún paquete, pero confirma que `approve` y `change_status` **no son llaves muertas**: quitárselas al rol de Alexander (decisión A-6) afectaría también a todo lo de la tabla.

| # | Acción | Llave que exige la 0900 | Llave que exigía antes: cadena 0300–0800 de este PR y pantalla (**NO producción**: allí solo `edit`) | Transición que protege |
|---|---|---|---|---|
| 1 | Aprobar orden de compra | `condominios.tab.ordenes_compra.approve` (ya existía) | `platform.contabilidad.approve` | borrador → aprobada; devolver una aprobada; **nacer aprobada** (con solo esta llave). **Nacer emitida exige, además, `platform.contabilidad.change_status`** (la de emitir, que no cambia): `compras_tg_permiso_orden`, rama `INSERT`, pide las dos |
| 2 | Registrar recepción | `platform.contabilidad.compras.recepcion_registrar` (nueva) | `platform.contabilidad.change_status` | borrador → registrada |
| 3 | Aprobar factura de proveedor | `platform.contabilidad.compras.factura_aprobar` (nueva) | `platform.contabilidad.approve` | registrada → aprobada |
| 4 | Aprobar orden de pago | `platform.contabilidad.compras.orden_pago_aprobar` (nueva) | `platform.contabilidad.approve` | borrador → aprobada (reserva lo que se va a pagar) |
| 5 | Ejecutar pago | `platform.contabilidad.compras.pago_ejecutar` (nueva) | `platform.contabilidad.change_status` | aprobada → pagada (contabiliza el egreso) |
| 6 | Anular pago | `platform.contabilidad.compras.pago_anular` (nueva) | `platform.contabilidad.change_status` | cualquier estado → anulada, **también una ya pagada** (reversa el egreso) |

* **Además de la llave de la acción hace falta `platform.contabilidad.edit`**, porque la política `UPDATE` de las cuatro tablas del circuito la exige y la 0900 no la toca: `ordenes_compra` y `recepciones` por `conta_puede_escribir('edit')` (que es `super_admin`, `company_owner`/`admin` **o** `user_has_permission('platform.contabilidad.edit')`) y `facturas_proveedor` y `ordenes_pago` por `user_has_permission('platform.contabilidad.edit')` `[Q14, Q16]`. La columna «edit» de las tablas siguientes refleja esa llave. Nacer ya aprobada o emitida exige además `create` (o el perfil `operator`) en el `INSERT`. **Qué trigger rige (comprobado en el SQL de la cadena):** `compras_tg_permiso_orden` se creó en `20261027000300` (toda orden nacía en borrador), se reemplazó en `20261027000700` (nacer aprobada exige `approve`; nacer emitida, `approve` **y** `change_status`) y se reemplazó por última vez en `20261027000900` (misma estructura; la llave de «aprobar» pasa a ser la de la pestaña de órdenes, y se comprueban empresa y proyecto). La `20261027000800` no la redefine: añade otra función, `compras_tg_permiso_orden_separada`. En la rama `INSERT` de la 0900, «aprobada» llama una vez a `compras_exigir_permiso` (`condominios.tab.ordenes_compra.approve`) y «emitida» la llama dos veces (esa y `platform.contabilidad.change_status`).
* **Reglas de evaluación** (definición de `user_has_permission` en producción `[Q16]`): los perfiles `super_admin`, `superadmin`, `company_owner` y `admin` **pasan toda llave**; para el resto, un `deny` en un rol vigente **gana** a cualquier `allow`; una asignación con `expires_at` vencido **no cuenta**. La función **no mira `app_users.activo`**.
* **Proyecto:** `can_access_project(p)` es verdadero si `p` es `NULL`, si la persona es **exenta** (`super_admin`, `superadmin`, `company_owner`, o `admin` **sin** filas en `user_project_assignments`) o si la persona **tiene acceso al proyecto**, que es lo que decide `user_has_project_access(p)`: una fila en `user_project_assignments` **o** que `app_users.project_id` sea ese proyecto (definición de `20260327000003`; `can_access_project` y `user_is_project_exempt` son de `20260815000000`; la cadena de migraciones no redefine ninguna de las tres; el texto original salió de `[Q16]` y la definición de producción **no se releyó** al corregir esto). `app_users.project_id` **no** cuenta para la exención: `user_is_project_exempt()` solo mira las filas de `user_project_assignments`, así que un `admin` con `project_id` pero sin filas sigue siendo exento. Un `admin` **con** asignaciones (Marco) pasa por perfil pero solo en los suyos.
* **No hay otra regla entre personas** que la del interruptor `compras_config.aprobacion_separada` («quien solicita la orden no la aprueba», solo para la orden de compra: `created_by = auth.uid()` en borrador → aprobada, o al nacer aprobada). Para recepción, factura, orden de pago, pago y anulación el servidor no compara personas. En producción el interruptor **no existe en ninguna empresa** (0 filas en `compras_config`) `[Q8]`.

---

## 2. Hechos de producción (2026-10-10)

### 2.1 Las dos personas `[Q2, Q3, Q12, Q22]`

| | Alexander Monterroso | Marco Santos Godoy |
|---|---|---|
| id | `327ffeda-85e8-4ea4-9423-af9b206ee886` | `86440f9d-e34b-49ba-91c7-3531ed365460` |
| Perfil (`app_users.role`) | `operator` | `admin` |
| Empresa | Prestadora de Servicios S.A. (`24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31`) | la misma |
| Activo / alta | sí / 2026-06-12 | sí / 2026-05-13 |
| Proyectos asignados (todos `permission_type = total`) | **6:** 21B+ · Cascadas de Vista Hermosa · Edificio SQ · La Arboleda CVH · Parajes Vermont · Viñas del Sur Condominio 3 (asignados el 2026-08-13 21:53:50). Huella md5 `89b81779cee9b2b1b7aeaf4ad42362fb` | **3:** 21B+ · Edificio SQ · Parajes Vermont (2026-05-19). Huella md5 `1d3dc6bd1682b02e445d9cbe567fcc38` |
| ¿Exento de proyecto? | no | **no** (admin con 3 asignaciones: pasa toda llave pero solo actúa en esos 3) |
| Roles asignados (`user_roles`) | **1:** «Finanzas / Contador» de la empresa (`d915897c-b350-431a-8447-b37c61f97e8a`), clonado de la plantilla `00000000-0000-0000-0000-000000000003`, `service = condominios`, asignado el 2026-08-13 21:52:57 (`user_roles.assigned_by` vacío, pero la bitácora `permission_audit_log` registra ese `assign_role`, en el mismo instante, con la **cuenta propietaria** como actor, tras un `remove_role` suyo a las 21:43:29; la asignación original del 2026-06-12 17:36:18 sí carece de actor `[Q32]`), **sin vencimiento**, 1 193 `allow` y 0 `deny` | **3**, todos de la empresa, sin vencimiento, 0 `deny`: «Admin Agua» (66 `allow`, clon de `…0101`), «Admin Plataforma» (90, clon de `…0201`) y «Administrador General» (189, clon de `…0001`) |
| Rol de ajustes individuales | **no tiene** (hay 0 en toda la base) | no tiene |

**El nombre no identifica:** `full_name ILIKE '%Monterroso%'` devuelve **3 cuentas** (Alexander Monterroso `operator`; Alex Monterroso e Isabel Monterroso, `cliente`, sin empresa) `[Q2]`, y `ILIKE '%Santos%'` otras **3**: Marco Santos Godoy (`admin`), **«Marco Santos»** (una cuenta `cliente` **sin empresa**) y **«Eduardo Santos»** (`viewer` de la misma empresa) `[Q27]`. Además existen **dos empresas de nombre casi igual** —«Prestadora de Servicios S.A.» (22 usuarios, 18 roles, 8 proyectos) y «Prestadora de Servicios» (0, 0, 0)— y la cuenta propietaria se llama «Prestadora de Servicios Básicos S.A.» `[Q27]`. Por eso el script usa el **id** y exige perfil, empresa y estado; y por la pantalla hay que abrir la fila de Alexander Monterroso **de la empresa «Prestadora de Servicios S.A.»** y comprobar su id (`327ffeda…`), nunca buscar por nombre.

### 2.2 Las llaves relacionadas de Alexander `[Q4a, Q4b, Q4c, Q5]`

Su rol de empresa tiene `allow` (y ningún `deny`) en las 48 llaves de Contabilidad/compras que se consultaron:

* `platform.contabilidad.{view, create, edit, delete, approve, change_status}` — las **seis**;
* `condominios.tab.ordenes_compra` y `.{approve, change_status, create, delete, edit}` — las **seis** (incluida la que exige la 0900 para la acción 1);
* las seis de cada una de estas pestañas: `condominios.tab.contabilidad`, `presupuesto`, `comparativo_presupuesto`, `plan_pago`, `proveedores` y `eval_proveedor` (36).

No tiene ninguna de las cinco llaves nuevas: **no existen todavía en el catálogo de producción** (0 filas `platform.contabilidad.compras.%` en `permissions`) y hay **0 concesiones** en `role_permissions` `[Q17, Q22]`. Del catálogo de 1 201 llaves `[Q7b]`, a ese rol le faltan solo 8 (`agua.{contadores,dashboard,lecturas,rutas,tabla,tarifas}.delete`, `condominios.areas.manage`, `platform.clientes.delete`) `[Q4b]`.

> **Hallazgo.** La plantilla de sistema «Finanzas / Contador» trae **63** llaves `allow` y la copia de Alexander **1 193**. La bitácora `permission_audit_log` muestra **1 106 `grant_permission` en el mismo segundo** (2026-08-13 21:52:53) hechos por la **cuenta propietaria** de la empresa, más 2 `update_role` entre las 21:52 y las 21:54 `[Q5]`; las otras 87 tienen el actor vacío (copia de la plantilla y migraciones de catálogo, del 2026-06-12 al 2026-09-10): 1 106 + 87 = 1 193 `[Q30]`. En la práctica el rol es «casi todo el catálogo»: las llaves que decide esta propuesta son una parte pequeña de lo que ese rol ya le da. No se propone aquí recortarlo (decisión A-6).

### 2.3 Roles y plantillas con llaves relacionadas, y cuántas personas las tienen `[Q6, Q18, Q19, Q20]`

«Llaves clave» = las cuatro que miden el cambio: `platform.contabilidad.approve`, `platform.contabilidad.change_status`, `platform.contabilidad.edit` y `condominios.tab.ordenes_compra.approve`.

| Rol | Tipo | `allow` | Llaves clave que trae | Personas activas con la asignación vigente |
|---|---|---|---|---|
| «Admin Plataforma» | plantilla de sistema | 96 | 3 (`approve`, `change_status`, `edit`) | **0** |
| «Finanzas / Contador» | plantilla de sistema | 63 | 3 (`approve`, `change_status`, `edit`) | **0** |
| «Administrador General» | plantilla de sistema | 1 104 | 1 (la de la pestaña de órdenes; **no** trae `platform.contabilidad.*`) | **0** |
| «Finanzas / Contador» | copia de la empresa | 1 193 | 4 | **1** (Alexander) |
| «Admin Plataforma» | copia de la empresa | 90 | 0 | **1** (Marco) |
| «Administrador General» | copia de la empresa | 189 | 0 | **1** (Marco) |

* Las **otras 13 plantillas** (de 16) y los **otros 15 roles de empresa** (de 18) no traen ninguna de las cuatro llaves. **0** asignaciones directas a plantillas en toda la base `[Q7b]`; **0** personas inactivas con esos tres nombres de rol; la única asignación con vencimiento de la base es «Administrador del Condominio» (hasta 2026-12-31), ajena a estas llaves `[Q20]`.
* Las copias **no coinciden** con su plantilla (90 contra 96, 189 contra 1 104, 1 193 contra 63): una copia es la fotografía de las llaves de la plantilla **en el momento de crearse**.
* De las 5 filas de `companies`, solo **«Prestadora de Servicios S.A.»** tiene roles (18) y proyectos (8), y 22 de las 23 personas con empresa (la otra pertenece a «Mi Empresa», sin roles ni proyectos) `[Q23]`.

### 2.4 Quién más pasa toda llave por su perfil `[Q7]`

| Perfil | Personas activas | Con proyectos asignados | Notas |
|---|---|---|---|
| `admin` | 1 | 1 | Marco: pasa toda llave, solo en 3 proyectos |
| `company_owner` | 1 | 0 | cuenta propietaria; exenta de proyecto; es el actor de §2.2 y de la única factura (§3) |
| `super_admin` | 1 | 0 | exento de proyecto |
| `operator` | 7 | 7 | entre ellos Alexander; **insertan** en las tablas del circuito sin ninguna llave (VER-05) |
| `viewer` | 13 | 13 | — |
| `cliente` | 9 | 0 | sin empresa |

Entre las **30 personas activas no exentas** `[Q1]` solo Alexander y Marco tienen alguna de las seis acciones, antes o después `[Q1, Q13]`. Ninguna llave puede **quitar** nada a las tres cuentas que pasan por perfil.

### 2.5 La matriz del diagnóstico `[Q1]`

`scripts/diagnostico-permisos-compras.sql` (md5 `e845d06064bd9d245272c19207ee4d5c`), ejecutado **tal cual** como un único `SELECT`. Resultado: fila `resumen` = «30 personas activas no exentas» y «1 persona(s) pierden alguna acción; 2 plantilla(s) de sistema y 1 rol(es) de empresa pierden alguna». Las filas coinciden con la matriz de `COMPRAS_CONTROLES_SERVIDOR.md §5.2`.

### 2.6 Proyectos `[Q12, Q28]`

| Proyecto | Alexander | Marco | Filas de asignación (incluyen huérfanas) | Personas reales | OC / facturas |
|---|---|---|---|---|---|
| 21B+ | sí | sí | 13 | 9 | 1 / 1 |
| Edificio SQ | sí | sí | 12 | 10 | 0 / 0 |
| Parajes Vermont | sí | sí | 6 | 5 | 0 / 0 |
| Cascadas de Vista Hermosa | sí | **no** | 5 | 3 | 0 / 0 |
| La Arboleda CVH | sí | **no** | 3 | 3 | 0 / 0 |
| Viñas del Sur Condominio 3 | sí | **no** | 4 | 3 | 0 / 0 |
| «test» (suspendido) | no | no | 0 | 0 | 0 / 0 |
| «VSC General» | no | no | 0 | 0 | 0 / 0 |

`user_project_assignments` tiene **43 filas**, de las cuales **10 son huérfanas** (6 usuarios sin fila en `app_users`): las columnas «filas» cuentan esas 10; «personas reales» no. Los 3 proyectos de Marco están dentro de los 6 de Alexander. En **Cascadas de Vista Hermosa, La Arboleda CVH y Viñas del Sur Condominio 3** Alexander es la **única persona con alcance y con `edit` en Contabilidad**: hay otras 2 personas con alcance en cada uno (2 `operator`, 2 `operator` y 2 `viewer`), pero ninguna tiene `edit` ni llave alguna, así que no pueden ninguna de las seis acciones. Ahí cualquier acción que él no tenga solo la pueden hacer la cuenta propietaria o el superadministrador (Marco no está asignado).

---

## 3. Evidencia de uso real de las seis acciones (producción, 2026-10-10)

| Acción | Dónde queda la huella | Filas | Quién |
|---|---|---|---|
| 1 Aprobar orden de compra | `ordenes_compra.aprobada_por/aprobada_at`; `orden_compra_eventos` | 1 orden (`251e6274…`, estado `recibida`, creada 2026-07-01 00:31, `created_by` vacío); `aprobada_por` y `aprobada_at` vacíos; **0** eventos y **0** excepciones `[Q8, Q9]` | **Nadie** (orden histórica sin autor) |
| 2 Registrar recepción | `recepciones`, `recepcion_respaldos` | **0** y **0** `[Q8]` | **No hay uso** |
| 3 Aprobar factura | `facturas_proveedor.aprobada_por/aprobada_at` | **1** factura, estado `anulada`, `monto_pagado` 0.00, creada 2026-08-10 22:40:21 y aprobada 22:40:31 (**10,5 s** después) `[Q9]` | La **cuenta propietaria** (`82a6f67d…`) la creó y la aprobó. No Alexander, no Marco |
| 4 Aprobar orden de pago | `ordenes_pago.aprobada_por` | **0** `[Q8]` | **No hay uso** |
| 5 Ejecutar pago | `ordenes_pago.pagada_at`; `conta_asientos` | **0** y **0** `[Q8]` | **No hay uso** |
| 6 Anular pago | `ordenes_pago` en `anulada`; asientos de reverso | **0** y **0** `[Q8]` | **No hay uso** |

También **0** contraseñas de pago, **0** intentos de contabilización y **0** filas en `compras_config` (el interruptor no está configurado en ninguna empresa) `[Q8]`. **Ningún documento del circuito está sin proyecto** (0 de 2) `[Q21]`.

**Actividad de las dos personas** `[Q10, Q11]`:

* **Alexander:** barrido de todas las columnas `uuid` de autoría de las tablas base de `public` (`created_by`, `creado_por`, `*_por`, `actor*`, `updated_by`, `user_id`, `registrado*`, `solicitad*`, `aprobad*`, `recibid*`, `pagad*`, `autoriz*`): **0 filas de negocio** a su nombre. Solo aparece en `security_logs` (15), `permission_audit_log` como destinatario (15), `user_notifications` (13), `user_project_assignments` (6), `user_roles` (1) y `user_presence` (1). `security_logs`: **12** inicios de sesión entre 2026-06-15 y 2026-08-13 21:54 y 3 cierres (el último 2026-08-13 21:58); **ningún inicio de sesión registrado después del 2026-08-13** (el último, `auth.users.last_sign_in_at`, es del 2026-08-13 21:54:15 UTC: **58,3 días transcurridos** a las 05:06 UTC del 2026-10-11, `[Q32]`; el «58» de la lectura del 2026-10-10 y el «59» de la relectura del 2026-10-11 en versiones anteriores eran diferencias de fechas de calendario, no tiempo transcurrido, por eso este documento da la fecha y no un número de días). Lo confirman `auth.users.last_sign_in_at` = 2026-08-13 21:54:15 UTC, **0 filas** en `auth.sessions` y `user_presence.last_seen` = 2026-08-13 21:58:15 `[Q30]`; su rol de 1 193 llaves se le reasignó a las 21:52:57 y sus 6 proyectos a las 21:53:50 de ese mismo día, minutos antes de su último acceso.
* **Marco:** 36 inicios de sesión hasta 2026-09-30; filas a su nombre solo en reservas de amenidades (11 creadas, 10 aprobadas), cuotas de condominio (7), reservas STR (7) y 1 unidad: **ninguna del circuito de compras**.

**Límites de esta evidencia:** el `audit_log` genérico **no cubre** las tablas del circuito (solo `cuotas_condominio`, `tickets_mantenimiento`, `subscriptions` y `companies`) `[Q24]`; el barrido ve columnas `uuid` con nombres de autoría, no autoría guardada con otros nombres o como texto; y `security_logs` registra lo que registra (un acceso por otro camino no aparecería). Lo que sí es concluyente: **las tablas del circuito casi no tienen filas**, así que no hay historia que demuestre quién usa cada acción.

---

## 4. (A) Tabla exacta: HOY → DESPUÉS DE LA 0900 SIN CONCEDER → PROPUESTA

Cada celda se lee **HOY (antes de la 0900) → DESPUÉS DE LA 0900 sin conceder → PROPUESTA**. «HOY» y «DESPUÉS» son las columnas del diagnóstico `[Q1]` (llave genérica contra llave de la acción, **más** `platform.contabilidad.edit` para las personas; para roles y plantillas se mide solo la llave, y `edit` va en su columna). Propuesta: **CONCEDER** · **NO CONCEDER** · **YA LO TIENE**. La columna `edit` es la llave `platform.contabilidad.edit`, imprescindible para las seis (§1).

**Cómo leer «HOY».** Es el estado de la pantalla y de la cadena 0300–0800 de este PR (llave genérica `approve`/`change_status` **más** `edit`); en producción el servidor hoy exige solo `edit` (§1). Las celdas «sí» de HOY coinciden igual, porque Alexander tiene `edit`, pero el motivo no es que el servidor pida `approve`/`change_status`. **La columna «propuesta» de Alexander muestra el paquete B (recomendado):** el paquete A deja en NO CONCEDER todas sus celdas 2 a 6 y el C pone CONCEDER también en las celdas 5 y 6 (§5.2). Las celdas se reprodujeron exactas en una revisión independiente (diagnóstico del repo y comportamiento real en una base desechable) y no cambian en esta versión.

| Principal | 1 Aprobar OC · `…ordenes_compra.approve` | 2 Recepción · `recepcion_registrar` | 3 Factura · `factura_aprobar` | 4 Orden de pago · `orden_pago_aprobar` | 5 Pago · `pago_ejecutar` | 6 Anular · `pago_anular` | `edit` |
|---|---|---|---|---|---|---|---|
| **Alexander Monterroso** (`operator`, 6 proyectos) | sí → sí → **YA LO TIENE** | sí → no → **CONCEDER** | sí → no → **CONCEDER** | sí → no → **CONCEDER** | sí → no → **NO CONCEDER** (alt.: CONCEDER) | sí → no → **NO CONCEDER** (alt.: CONCEDER) | sí → sí → **YA LO TIENE** |
| Rol de empresa «Finanzas / Contador» (Prestadora; 1 persona) | sí → sí → **YA LO TIENE** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → sí → **YA LO TIENE** |
| Plantilla «Finanzas / Contador» (0 personas) | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → sí → **YA LO TIENE** |
| Plantilla «Admin Plataforma» (0 personas) | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → no → **NO CONCEDER** | sí → sí → **YA LO TIENE** |
| Plantilla «Administrador General» (0 personas) | no → sí → **YA LO TIENE** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** |
| Copias de empresa «Admin Plataforma» y «Administrador General» (1 persona cada una: Marco) | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** |
| Las otras 13 plantillas y 15 roles de empresa | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** | no → no → **NO CONCEDER** |
| **Marco Santos Godoy** (`admin`, 3 proyectos) — control | sí → sí → **YA LO TIENE** | sí → sí → **YA LO TIENE** | sí → sí → **YA LO TIENE** | sí → sí → **YA LO TIENE** | sí → sí → **YA LO TIENE** | sí → sí → **YA LO TIENE** | sí → sí → **YA LO TIENE** |
| Cuenta propietaria (`company_owner`) y superadministrador — control | sí → sí → **YA LO TIENEN** | sí → sí → **YA LO TIENEN** | sí → sí → **YA LO TIENEN** | sí → sí → **YA LO TIENEN** | sí → sí → **YA LO TIENEN** | sí → sí → **YA LO TIENEN** | sí → sí → **YA LO TIENEN** |

**Por qué, una frase por grupo de celdas**

1. **Alexander · 1 Aprobar OC (YA LO TIENE):** su rol trae la llave de la pestaña de órdenes y `edit`; la 0900 no le quita ni le añade nada (hoy lo hacía con `approve` genérica y seguirá pudiendo con la llave de la pestaña).
2. **Alexander · 2 Recepción (CONCEDER en B y C):** es una de las tres acciones que su rol «Finanzas / Contador» le asigna y que no sacan efectivo (aunque la recepción registrada genera su asiento contable); hoy la hace (con `edit`), no amplía lo que hoy puede, y en 3 de sus 6 proyectos nadie más con alcance y `edit` podría hacerla (§2.6). No hay uso registrado (§3).
3. **Alexander · 3 Factura (CONCEDER en B y C):** aprobar la factura es el núcleo de un rol «Finanzas / Contador»; hoy puede hacerlo y concederla mantiene la continuidad sin ampliar nada respecto de hoy. No hay uso registrado (§3).
4. **Alexander · 4 Orden de pago (CONCEDER en B y C):** aprobar la orden prepara y reserva el saldo que se va a pagar pero **no saca efectivo**; mantiene su flujo de preparación y deja el paso en que el efectivo sale a otra mano. No hay uso registrado (§3).
5. **Alexander · 5 Pago y 6 Anular (NO CONCEDER en A y B; CONCEDER en C):** son los dos pasos en que el efectivo sale (ejecutar) o un egreso ya hecho se reversa (anular alcanza incluso un pago ya pagado). Lo que las separa de las otras tres **no es la continuidad** (la cumplen igual que ellas) sino la **segunda firma para la salida de efectivo** (§5.1, criterio 2). No hay un solo uso demostrado en producción (0 órdenes de pago) y retenerlas pone a una segunda cuenta —administrador o propietario— antes de que el dinero salga; se conceden en un minuto desde el panel si se decide lo contrario (el paquete C las concede, igual que hoy).
6. **Alexander · edit (YA LO TIENE):** sin esta llave ninguna de las seis acciones funciona (política `UPDATE`); ya la tiene y no se toca.
7. **Rol de empresa «Finanzas / Contador» (NO CONCEDER):** concederle una llave se la da a quien lo tenga mañana, y editarlo desde la pantalla reemplazaría el conjunto completo de 1 193 llaves (`set_role_permissions`); lo propuesto va a la persona, no al rol.
8. **Plantilla «Finanzas / Contador» (NO CONCEDER ahora):** tiene 0 personas, solo llega a copias futuras (la copia de Alexander ya existe y no se refresca), no se copia sola a empresas nuevas y la pantalla no la edita; se decide cuando haya una segunda empresa o se asigne a otra persona (A-2.1).
9. **Plantilla «Admin Plataforma» (NO CONCEDER):** es la plantilla que las funciones de borde asignan a los nuevos `admin`, que pasan toda llave por su perfil, así que concederle llaves no cambia a nadie; y su copia en la empresa —la de Marco— ya no tenía las llaves genéricas y no las necesita.
10. **Plantilla «Administrador General» (YA LO TIENE en la acción 1):** la «ganancia» viene de la propia plantilla, que ya traía la llave de la pestaña; sin `platform.contabilidad.edit` (que no trae) no puede aprobar nada y no tiene personas; no se concede nada más.
11. **Copias «Admin Plataforma» y «Administrador General»:** sin cambio (no → no); Marco pasa por su perfil `admin`.
12. **Las otras 13 plantillas y 15 roles:** no tienen ninguna de las cuatro llaves; no cambian.
13. **Marco, cuenta propietaria y superadministrador (YA LO TIENEN):** pasan toda llave por su perfil y ninguna asignación los toca; Marco sigue limitado a sus 3 proyectos.

**Paquetes A y C** — idénticos al B salvo para Alexander. En el **A** sus celdas 2 a 6 pasan a **NO CONCEDER** (el diagnóstico de la persona sale «sí → sí» solo en la 1 y «sí → no» en las otras cinco); en el **C** sus celdas 5 y 6 pasan a **CONCEDER** (el diagnóstico sale «sí → sí» en las seis).

---

## 5. (B) Recomendación: tres paquetes

### 5.1 Criterios (explícitos)

1. **Función asignada y sin ampliar lo que hoy puede (lo cumplen las cinco llaves por igual).** Se concede lo que (a) corresponde a la **función asignada por su rol** («Finanzas / Contador» de la empresa) y (b) **no amplía** nada de lo que hoy puede. Hoy puede las seis acciones y su rol de 1 193 llaves abarca las seis, así que **este criterio, por sí solo, llevaría al paquete C: no distingue entre las cinco llaves.** Tampoco lo sostiene el historial: **no hay uso registrado** de ninguna de las cinco acciones por parte de Alexander (§3: 0 filas de negocio), de modo que ni la función ni el historial *demuestran* nada; por eso un paquete que no concede ninguna (el A) es tan defendible como el que concede las que su rol le asigna.
2. **Segunda firma para la salida de efectivo (lo que separa `pago_ejecutar` y `pago_anular` de las otras tres).** Ejecutar un pago es el paso en que el efectivo sale, y anularlo reversa un egreso ya contabilizado (alcanza incluso un pago ya pagado): en esos dos pasos se pide que intervenga otra cuenta, y por eso no se conceden en la recomendada. **No se dice que las otras tres «no muevan dinero»:** la recepción registrada y la factura aprobada **sí generan asientos contables** (lo comprueba `run.sh`, paso 6: «UN solo asiento» de recepción y de factura) y la orden de pago aprobada **reserva** saldo; lo que ninguna de las tres hace es sacar efectivo. Conceder una llave es reversible en un minuto; un pago ya ejecutado no se deshace quitando la llave (anularlo es otra operación, con su propio asiento).
3. **Continuidad operativa.** No dejar sin camino una acción que hoy solo Alexander puede hacer en un proyecto concreto. En Cascadas de Vista Hermosa, La Arboleda CVH y Viñas del Sur Condominio 3 él es la **única persona con alcance y con `edit` en Contabilidad** (§2.6); las cuentas exentas (propietaria y superadministrador) siempre pueden. Este criterio pesa completo en el **C**, solo para las tres aprobaciones (acciones 2 a 4) en el **B** (pagar y anular quedan con otras cuentas por el criterio 2, §5.4) y no pesa en el **A** (se acepta el efecto transitorio).
4. **Reparto de llaves (no hay separación entre personas salvo el pago).** Se reparte *qué llave tiene quién*; **no** se escribe ninguna prohibición entre personas ni umbral por monto. Las llaves solo pueden separar a Alexander de las tres cuentas que pasan por perfil: a estas no se les puede quitar ninguna. Con el B una sola persona puede crear la orden, aprobarla, recibir, aprobar la factura y aprobar la orden de pago; **la única separación es que ejecutar y anular el pago exigen a otra cuenta**.

### 5.2 Los tres paquetes

| | **A · ninguna llave por ahora** | **B · recepción + factura + orden de pago (RECOMENDADA)** | **C · continuidad total** |
|---|---|---|---|
| Llaves que se conceden a Alexander | ninguna | `recepcion_registrar`, `factura_aprobar`, `orden_pago_aprobar` | las cinco: B + `pago_ejecutar` + `pago_anular` |
| Bloques del script | ninguno | `P-1.1`, `P-1.2`, `P-1.3` | `P-1.1` a `P-1.5` |
| De las seis acciones, Alexander puede | solo la 1 | 1, 2, 3 y 4 | las seis (como hoy) |
| Cambio en la base | ninguno | `role_permissions` +3, `user_roles` +1, `roles` +1 | +5, +1, +1 |
| Por qué | **0 usos** y **ningún inicio de sesión registrado desde el 2026-08-13** (§3): no hay nada que continuar. Se concede **en un minuto** desde el panel cuando vuelva a operar. **El PR puede fusionarse igual** aceptando el efecto transitorio: desde el despliegue de la 0900 y hasta que se conceda, Alexander conserva solo «aprobar orden de compra» y el servidor rechaza las otras cinco con `COMPRAS_PERMISO_ACCION` | Dos criterios (§5.1): continuidad de las tres acciones que su rol le asigna y que **no sacan efectivo** (recepcionar y aprobar la factura, que sí contabilizan; aprobar la orden de pago, que solo reserva el saldo) y segunda firma para las dos que **sacan o reversan efectivo**. Sigue sin uso registrado | Reproduce **exactamente** lo que hoy puede; elimina cualquier efecto transitorio. Es lo único que mantiene a Alexander como persona de pago en los tres proyectos donde nadie más con `edit` tiene alcance |
| Costo | si vuelve a operar sin que se le haya concedido, alguien (Marco, la cuenta propietaria o el superadministrador) debe concederle o hacer la acción | pagar y anular dependen de otra cuenta (§5.4) | no hay ninguna segunda persona en todo el ciclo (§5.3) |

**Quién puede qué después de cada paquete** (Marco, la cuenta propietaria y el superadministrador no cambian):

| Acción | Alexander · A | Alexander · B | Alexander · C | Marco (3 proyectos) | Cuenta propietaria y superadministrador (todos) |
|---|---|---|---|---|---|
| 1 Aprobar orden de compra | sí | sí | sí | sí | sí |
| 2 Registrar recepción | **no** | sí | sí | sí | sí |
| 3 Aprobar factura | **no** | sí | sí | sí | sí |
| 4 Aprobar orden de pago | **no** | sí | sí | sí | sí |
| 5 Ejecutar pago | **no** | **no** | sí | sí | sí |
| 6 Anular pago | **no** | **no** | sí | sí | sí |

Con A o B, ejecutar y anular pagos queda en **21B+, Edificio SQ y Parajes Vermont** para Marco, la cuenta propietaria y el superadministrador, y en **Cascadas de Vista Hermosa, La Arboleda CVH, Viñas del Sur Condominio 3, «test» y «VSC General»** solo para la cuenta propietaria y el superadministrador (Marco no está asignado). Plantillas, rol de empresa «Finanzas / Contador», demás roles y Marco: no conceder nada (A-2, A-3) en ningún paquete.

**Verificado con los bloques reales del script (§10):** en una base desechable con las diez migraciones y el padrón de Alexander, ejecutadas las concesiones de cada paquete, Alexander (como `authenticated`, bajo RLS) pasa las acciones 1 a 6 así: A → solo la 1; B → 1, 2, 3 y 4, y las acciones 5 y 6 se rechazan con `COMPRAS_PERMISO_ACCION` (42501); C → las seis.

### 5.3 Qué concentración queda si Alexander es la única persona de finanzas

* **Con el B:** Alexander puede, **él solo**, llevar una compra **desde la creación de la orden hasta una orden de pago aprobada**. Siendo `operator` **crea sin ninguna llave** la orden de compra, la recepción, la factura y la orden de pago (las políticas `INSERT` aceptan al perfil `operator`), y aprueba con llave la orden (ya la tiene), registra la recepción, aprueba la factura y aprueba la orden de pago (acciones 1 a 4). No puede ejecutar ni anular el pago. Lo que queda es una **concentración en una persona de cuatro aprobaciones**: quien aprueba la factura y quien aprueba la orden de pago es la misma persona, y las llaves no pueden separarlo mientras él sea el único no administrador con ellas. A eso se suma, con cualquier paquete, que **autoriza él mismo las excepciones de contrato** de las órdenes que crea y aprueba (siguiente punto). El control que se gana es uno solo, y está donde sale el efectivo: ejecutar el pago exige a otra cuenta.
* **Lo que NO cambia (con cualquier paquete, también con el A).** Alexander conserva `platform.contabilidad.approve` y `platform.contabilidad.change_status` **genéricos** (su rol de 1 193 llaves) y con ellos la 0900 le sigue dejando hacer lo que **no** es una de las seis acciones. Probado como él, bajo RLS, en la base desechable de §10: **emitir, cancelar y cerrar una orden de compra; anular una recepción registrada; anular una factura aprobada sin pagos aplicados** —**incluso una que ya tiene una orden de pago aprobada** (la orden queda aprobada con su factura anulada; pagarla después se rechaza con `COMPRAS_FACTURA_NO_PAGABLE`)— **y anular una contraseña de pago**. Siguen rechazadas: anular la orden de pago (`pago_anular`, 42501) y anular una factura con pagos aplicados (`CXP_BLOQUEADO`, 23514). Es decir, anular documentos del circuito (sin sacar efectivo) **no depende de ninguna de las cinco llaves**; si eso no es aceptable, es una decisión sobre el rol de 1 193 llaves (A-6), no sobre estas cinco. Está también en `COMPRAS_CONTROLES_SERVIDOR.md §5.1`.
* **Autorizar excepciones de contrato (con cualquier paquete, también con el A).** `compras_oc_excepcion_contrato(orden, etapa, motivo)` es `SECURITY DEFINER`, ejecutable por `authenticated`, y en producción exige **solo** `conta_puede_escribir('change_status')` (más empresa y proyecto de la orden) `[Q31]`. No es una de las seis acciones ni la gobierna ninguna de las cinco llaves, así que **Alexander la conserva** con su `change_status` genérico (su rol de 1 193 llaves). Con ella puede, siendo `operator` (que crea la orden sin llave), crear una orden fuera del monto máximo o de la vigencia de su contrato, **autorizar él mismo la excepción** y aprobarla con la llave de la pestaña de órdenes (acción 1, que también conserva) y emitirla. El único freno entre personas es `compras_config.aprobacion_separada` (la función rechaza que quien creó la orden autorice su excepción, `COMPRAS_EXCEPCION_AUTOAUTORIZACION`), y está **apagada** en todas las empresas (0 filas en `compras_config`). Cada excepción queda registrada (`orden_compra_excepciones` y un evento `excepcion_contrato`), pero nada impide que sea la misma persona. Se enlaza con A-6 (recortar el rol) y A-7 (encender el interruptor).
* **Con el C (las cinco):** puede hacer las **seis** y, siendo `operator`, además **crear** la orden de compra: el ciclo completo, de la creación al pago y su anulación, **sin ninguna segunda persona** (que es exactamente lo que ocurre hoy).
* **Quienes pasan por perfil** (Marco en sus 3 proyectos, la cuenta propietaria y el superadministrador) pueden las seis acciones y **ninguna llave los frena**. Un caso real lo muestra: la única factura de producción la **creó y la aprobó la cuenta propietaria con 10,5 s de diferencia** y el servidor lo permitió, porque para la factura no existe ninguna regla entre personas.
* **Lo que mitiga el interruptor `aprobacion_separada` y lo que no.** Apagado (hoy, y en todas las empresas), quien crea una orden puede aprobarla: Alexander, siendo `operator`, puede **crear y aprobar** su propia orden. Encendido, el servidor rechaza solo ese caso (`created_by = auth.uid()` al pasar de borrador a aprobada o al nacer aprobada, `COMPRAS_OC_AUTOAPROBACION`) y que quien creó la orden autorice su propia excepción de contrato (`COMPRAS_EXCEPCION_AUTOAUTORIZACION`), y solo eso: la acción 1 y esa excepción. **No mitiga** recepción, factura, orden de pago, pago ni anulación; **no** frena a una orden sin autor (`created_by` vacío); y los procesos de sistema (`service_role`) pueden cambiarlo con rastro. Encenderlo tiene un costo concreto: como Alexander es el único no administrador con la llave de aprobar órdenes, las que él mismo cree las tendría que aprobar Marco (en sus 3 proyectos) o la cuenta propietaria/superadministrador (en los otros). Hoy, mientras ningún otro `operator` tenga la llave, las órdenes creadas **por otras personas** ya las aprueba de hecho alguien distinto de quien las crea. Encenderlo no se recomienda ni se desaconseja aquí (A-7).

**Costo de los paquetes A y B, dicho sin adornos:** en los tres proyectos donde solo Alexander tiene alcance y `edit`, pagar y anular depende de la cuenta propietaria o del superadministrador. Desde la base **no se puede saber qué persona hay detrás de la cuenta propietaria**: su nombre es el de la empresa, y por eso la bitácora no atribuye a una persona lo que ella hace. Es aceptable hoy porque hay **0 órdenes de pago**; si el negocio lo considera un freno, el paquete C lo elimina a cambio de la concentración descrita.

### 5.4 Dos decisiones que ninguna consulta contesta

1. **¿Quién, con nombre y apellido, está detrás de la cuenta propietaria?** Es la cuenta que creó y aprobó la única factura en 10,5 s y concedió las 1 106 llaves en un segundo, y en A y B es una de las dos únicas que pagan en tres de los proyectos. Mientras no se sepa, «otra cuenta paga» no identifica a ninguna persona (A-1.8).
2. **¿Quién paga en Cascadas de Vista Hermosa, La Arboleda CVH y Viñas del Sur Condominio 3?** Marco no está asignado ahí. Opciones: la cuenta propietaria o el superadministrador (lo que pasa sin hacer nada), el paquete C, o designar a otra persona (lo que exigiría asignarle proyecto y llave: no se propone aquí) (A-1.6).

---

## 6. (C) Pasos exactos para conceder, después del despliegue de la 0900

### 6.1 Orden y precondiciones

Orden de despliegue acordado en `COMPRAS_CONTROLES_SERVIDOR.md §10.2`, **cada uno en su propio *push* a `main`**: **(1) PR #928** de seguridad de `user_project_assignments` (`20261026000600`), **(2) este PR #926** (`20261027000000…0900`, las diez), **(3)** —futuro, si se aprueba— el PR de **alcance por proyecto** (§8; migración `20261027001000`, justo tras la 0900) y **(4) PR #927** (`20261028000000`). **Las concesiones van después del paso (2)**, nunca antes: las cinco llaves no existen hasta que la 0900 las siembra y `role_permissions.permission_key` es llave foránea de `permissions(key)` `[Q25]`. Con el paquete A no hay concesión que hacer en este momento.

Antes de conceder: (a) respuesta **por escrito** a A-1 (qué paquete) y, según el caso, a A-1.6, A-1.7 y A-1.8 (§7); (b) volver a correr `scripts/diagnostico-permisos-compras.sql` `[Q1]` y confirmar que la columna `pierde` sigue siendo la de §0, **y correr además, el día del despliegue, la fila `perfil_afectado` de `scripts/diagnostico-compras-controles.sql` (debe seguir en 0)**: `[Q1]` y `V-3` miden las llaves genéricas, no el servidor de producción, y una persona con `edit` y sin `approve`/`change_status` hoy puede las seis acciones y no figuraría como «pierde» en esas columnas aunque las vaya a perder todas; hoy hay 0 personas así (solo Alexander tiene `edit`, `approve` y `change_status`) `[Q29]`; (c) correr en el script `P-0.1`–`P-0.4` y `V-1`, `V-3`, `V-4` y **guardar la salida** (huellas de §2.1 y V-4).

### 6.2 Ruta recomendada: la pantalla del producto

La hace **Marco Santos Godoy** (cuenta personal, `admin` de la misma empresa) **desde la pantalla**, para que la bitácora nombre a una persona: probado bajo RLS en una base desechable, `permission_audit_log` registra como actor a quien guarda (Marco) en `create_role`, `assign_role` y cada `grant_permission`, y un `operator` es rechazado (`new row violates row-level security policy`). La cuenta propietaria también puede, pero su nombre es el de la empresa y la bitácora no atribuiría lo hecho a ninguna persona; **por SQL el actor queda vacío (`NULL`) en todas las filas**. Las políticas de `roles`, `role_permissions` y `user_roles` exigen `company_owner` o `admin` de la empresa de la persona.

1. **Empresa › Usuarios**, fila de Alexander Monterroso, botón **Roles y permisos** (icono de llave) (`EmpresaUsuariosSection` → `RolPermisosModal`).
2. En el panel de **permisos efectivos / «Ajustes individuales»** (el mecanismo «Ajustes finos»), abrir el grupo **«Plataforma: Compras y pagos»** (aparece solo cuando el catálogo ya tiene las llaves, es decir, después de la 0900) y marcar **solo** las casillas decididas: «Registrar una recepción», «Aprobar una factura de proveedor» y «Aprobar una orden de pago» (paquete B); y además «Ejecutar un pago» y «Anular un pago» (paquete C). Con el paquete A no se marca ninguna. **No** tocar los roles asignados ni sus vencimientos.
3. **Guardar.** El producto, en `handleSave`: crea el rol oculto de ajustes `Ajustes individuales — Alexander Monterroso (327ffeda)` (`is_system = false`, `user_override_for` = su id, color `#7E9389`), se lo asigna con `expires_at = NULL` (la expiración no aplica a los ajustes) e inserta una fila `role_permissions` con `effect = allow` por casilla marcada. Cada paso deja huella en `permission_audit_log` con **la persona administradora como actor** (`create_role`, `assign_role`, `grant_permission` ×N) `[V-5]`.

### 6.3 Ruta alternativa: SQL (`scripts/propuesta-asignaciones-permisos-compras.sql`)

Para una persona con acceso al editor SQL (rol de la base, no `authenticated`): extraer **un bloque** `P-1.x` por llave decidida **a un archivo** (`sed -n '/^-- ▶ P-1.2/,/^-- ◀ P-1.2/p' … | sed 's/^--SQL //' > bloque.sql`) y ejecutarlo **entero en una sola conexión** (`psql … -f bloque.sql`). Hace lo mismo que la pantalla (mismo nombre, color y campos del rol de ajustes), pero **sin actor** en la bitácora (`auth.uid()` es nulo). **Preferir la pantalla.** Tiene **tres seguros**:

1. **Todo viene comentado** (`--SQL `): ejecutar el archivo completo solo corre `SELECT` de lectura.
2. **La escritura va dentro de un `DO` que levanta excepción** salvo que la transacción tenga `prop.confirmar = 'si'`. La línea que lo fija viene **comentada** (`-- SET LOCAL prop.confirmar = 'si';`) y quien confirma por escrito le quita el `-- `. Es `SET LOCAL` a propósito: vale solo dentro de esa transacción, así que un cliente que parte el bloque en sentencias sueltas, abre una conexión por sentencia o corta en cada `;` **no escribe nada** (el `INSERT` va dentro de una cadena del `DO`: ni siquiera existe como sentencia suelta).
3. **El bloque termina en `ROLLBACK;`.** Para confirmarlo hay que editar a mano esa línea y ponerla en `COMMIT;` después de revisar el `SELECT` de verificación del bloque.

**Advertencia: ejecutar el bloque COMPLETO en UNA sola sesión.** El `ROLLBACK` solo deshace lo hecho en su propia transacción. En la versión anterior del script (sin el segundo seguro), un cliente que ejecutara las sentencias una por una, cada una en su conexión o en *autocommit* (un editor que parte el script, un *pooler* en modo sentencia, o pegar solo el `INSERT`), **dejaba confirmado el `INSERT` suelto y el `ROLLBACK` posterior no hacía nada**: reproducido en la base desechable (`role_permissions` 2 922 → 2 923, `user_roles` 5 → 6, `roles` 18 → 19). Con el segundo seguro ese caso no escribe nada (§10), pero no es excusa: nunca pegar solo una parte del bloque.

### 6.4 Comprobación posterior (debe dar «sí → sí» donde corresponde)

* **`V-3` del script / `[Q15]`** (o la fila `usuario` de `[Q1]`):

| Alexander | A · ninguna | B · recomendada | C · continuidad total |
|---|---|---|---|
| 1 Aprobar orden de compra | sí → sí | sí → sí | sí → sí |
| 2 Registrar recepción | sí → **no** | **sí → sí** | **sí → sí** |
| 3 Aprobar factura | sí → **no** | **sí → sí** | **sí → sí** |
| 4 Aprobar orden de pago | sí → **no** | **sí → sí** | **sí → sí** |
| 5 Ejecutar pago | sí → **no** | sí → **no** | **sí → sí** |
| 6 Anular pago | sí → **no** | sí → **no** | **sí → sí** |

  Esta tabla se obtuvo ejecutando el `V-3` real del script, y el comportamiento (`user_has_permission` y las seis transiciones como `authenticated`), en la base desechable tras cada paquete (§10). En el diagnóstico completo la fila de Alexander debe mostrar `roles_asignados` = «Ajustes individuales — Alexander Monterroso (327ffeda); Finanzas / Contador» (B y C); la fila `resumen` sigue diciendo «1 persona(s) pierden alguna acción» con A y con B y «**0** persona(s)…» con C; Marco queda «sí → sí» en las seis.
* **Contadores `V-4`:** A, sin cambios; B, `role_permissions` +3, `user_roles` +1 y `roles` +1 (el rol de ajustes); C, +5, +1 y +1; `concesiones_de_las_cinco_llaves` = 0, 3 o 5. La bitácora suma 5 filas con B (`create_role`, `assign_role` y 3 `grant_permission`) y 7 con C. Lectura previa del 2026-10-10: 3 661, 26 y 34 (si otra persona cambió roles en el intervalo, comparar contra una lectura hecha justo antes).
* **`V-1` y `V-4`, proyectos:** las huellas de §2.1 y la global (43 filas, md5 `d32daf1d38d862b1cdd938a59ad2ff5f`) **no deben cambiar**: ninguna concesión toca `user_project_assignments` (comprobado: md5 de las asignaciones idéntico antes y después de cada paquete y de la reversión). Alexander **conserva sus 6 proyectos** y Marco **sus 3**.
* **Reversión exacta:** **desmarcar las casillas en el mismo panel** (el producto borra el rol oculto si no quedan ajustes) **o** `DELETE FROM roles WHERE user_override_for = <id>` (bloque `P-9` del script, con los mismos tres seguros): la asignación (`user_roles`) y las filas de `role_permissions` del rol de ajustes caen en cascada. **Borrar solo las filas de `role_permissions` NO basta**: deja un rol de ajustes **vacío** y su asignación (`roles` +1 y `user_roles` +1 respecto del estado previo). Comprobado en la base desechable: con `P-9` los md5 de `role_permissions`, `user_roles`, `roles` y `user_project_assignments` quedan **idénticos** a los del estado previo; la bitácora (que solo se añade) conserva el rastro y **no se borra** (con C: +7 filas de `revoke_permission`, `remove_role` y `delete_role`). Las llaves de `permissions` no se borran (borrarlas elimina en cascada toda concesión).

### 6.5 Efecto en proyectos

Las concesiones **no cambian ni amplían** ninguna asignación de proyecto. La comprobación de proyecto de la 0900 (`can_access_project`) sigue rigiendo cada acción: Alexander actúa en sus 6 y Marco en sus 3. Dos salvedades que **no** vienen de las concesiones: un documento **sin proyecto** se trata como «de la empresa» (hoy no hay ninguno, §8) y la asignación de proyecto es **autoasignable** hasta que se despliegue el PR de seguridad de `user_project_assignments` (paso 1); por eso la comprobación de proyecto no es un límite contra un usuario hostil mientras ese PR no esté en producción.

### 6.6 Plantillas: cómo funcionan de verdad en el producto

* Las plantillas son los roles `is_system = true` (sin empresa). **No se asignan**: «Usar plantilla» (y crear un usuario con un rol de sistema) llama a `ensureCompanyRoleFromTemplate`, que **busca o crea la copia de empresa** (nombre de la plantilla, `cloned_from_role_id`) y **copia sus `role_permissions` en ese momento**. Una copia fiel que ya existe **se reutiliza y nunca se refresca**.
* **No hay copia automática al crear una empresa nueva:** ninguna migración o función siembra copias al crear una empresa; **la única siembra fue la conversión única `20260612100300_rbac_assignments_to_company_roles.sql`**, que creó una copia por cada (empresa, plantilla en uso) y re-apuntó `user_roles` —es el origen de las copias de Alexander y de Marco, todas con `created_at` = 2026-06-12 17:36:18 `[Q30]`—. Después, la copia nace solo en la pantalla. Una plantilla con llaves nuevas llega a las copias que se creen **después**; las existentes (la de Alexander, la de Marco) no cambian.
* **Excepción que importa saber:** las funciones de borde `create-user` y `accept-invitation` asignan **directamente la plantilla de plataforma** que corresponde al perfil, sin copia (`admin` → «Admin Plataforma», `operator` → «Operador Plataforma», `viewer` → «Visualizador Plataforma», `collector` → «Cobrador Plataforma»; `supabase/functions/*/validate.ts`). Ese vínculo **sí es vivo** (un cambio en la plantilla llega de inmediato; la pantalla lo muestra como «heredada»). Hoy hay **0** asignaciones directas a plantillas `[Q7b]`. Para las seis acciones solo importa «Admin Plataforma», y quien la recibe es un `admin`, que ya pasa toda llave por su perfil: por eso conceder llaves a esa plantilla no cambia a nadie.
* La pantalla **no edita plantillas** («Usar plantilla» y «Personalizar» clonan); su `role_permissions` solo lo escribe el superadministrador (la política de `INSERT` exige `is_super_admin()` para un rol de sistema) o una migración. Por eso conceder a una plantilla es una decisión de producto (A-2.1), no una urgencia: no cambia a ninguna persona actual. Si se decide, es el bloque `P-5` del script (con `ROLLBACK` por defecto) y, para que figure en el historial, mejor en una migración propia dentro de su despliegue (**no** en el PR #926, que está en el tope de diez).

---

## 7. (D) Decisiones que necesita el usuario (responder sí/no)

**El PR #926 sigue en borrador hasta que se responda A-1.** A-1.0 elige uno de tres paquetes; **A («ninguna llave por ahora») es una respuesta válida y permite fusionar igual**. A-1.1 a A-1.5 se contestan solas según el paquete (A: NO ×5 · B: SÍ, SÍ, SÍ, NO, NO · C: SÍ ×5).

| Ref. | Pregunta | Recomendación |
|---|---|---|
| **A-1.0** | **¿Qué paquete?** **A** ninguna llave por ahora · **B** recepción + factura + orden de pago · **C** continuidad total (las cinco, = lo que Alexander puede hoy) (§5.2) | **B** (A es válida y no bloquea la fusión) |
| **A-1.1** | ¿Conceder a Alexander Monterroso **registrar recepciones** (`platform.contabilidad.compras.recepcion_registrar`)? | **SÍ** (B y C) |
| **A-1.2** | ¿Conceder a Alexander **aprobar facturas de proveedor** (`…factura_aprobar`)? | **SÍ** (B y C) |
| **A-1.3** | ¿Conceder a Alexander **aprobar órdenes de pago** (`…orden_pago_aprobar`)? | **SÍ** (B y C) |
| **A-1.4** | ¿Conceder a Alexander **ejecutar pagos** (`…pago_ejecutar`)? | **NO** (solo el paquete C: SÍ) |
| **A-1.5** | ¿Conceder a Alexander **anular pagos** (`…pago_anular`)? | **NO** (solo el paquete C: SÍ) |
| **A-1.6** | Si A-1.4 o A-1.5 es NO: **¿quién paga y anula** en Cascadas de Vista Hermosa, La Arboleda CVH y Viñas del Sur Condominio 3 (donde Marco no está asignado y Alexander es la única persona con alcance y con `edit`)? ¿Se acepta que lo haga solo la cuenta propietaria o el superadministrador? Si no: paquete C, o designar a otra persona (exigiría asignarle proyecto y llave: no se propone aquí). | **SÍ** se acepta, mientras no haya órdenes de pago |
| **A-1.7** | ¿La concesión se hace desde la pantalla («Ajustes individuales») **por Marco Santos Godoy (cuenta personal), para que la bitácora nombre a una persona**, y no por SQL (donde el actor queda vacío) ni por la cuenta propietaria (cuyo nombre es el de la empresa)? | **SÍ** |
| **A-1.8** | **¿Qué persona concreta está detrás de la cuenta propietaria** (la que creó y aprobó la única factura en 10,5 s y concedió las 1 106 llaves en un segundo)? Sin ese dato, «otra cuenta paga» no identifica a nadie. | Dato del negocio; no se puede leer en la base |
| **A-2.1** | ¿Se conceden llaves nuevas a las **plantillas de sistema** «Finanzas / Contador» y «Admin Plataforma» ahora? | **NO** (0 personas; solo afectaría copias futuras; decidir antes de crear una segunda empresa o de asignar la plantilla a otra persona) |
| **A-2.2** | ¿Se conceden llaves nuevas al **rol de empresa** «Finanzas / Contador»? | **NO** (se concede a la persona) |
| **A-2.3** | ¿Se deja la plantilla «Administrador General» como está (trae la llave de la pestaña de órdenes y por eso «gana» la acción 1, sin efecto práctico)? | **SÍ** |
| **A-3** | Marco Santos Godoy: nada que conceder (es `admin`, conserva las seis en sus 3 proyectos). ¿Se confirma? | **SÍ** |
| **A-4** | **P-PERM-1 · R1.** ¿Se aprueba preparar, como migración y PR propios (`20261027001000`, justo tras la 0900; después del despliegue de #926; **no** como undécima migración), que la captura directa **exija un proyecto al que la persona tenga acceso**? **Qué cierra el paquete entregado** (probado: `PRJ-1`, 890 comprobaciones en verde y 0 en rojo): el `INSERT` de un borrador en un **proyecto no asignado** (V1) —por la API, por las RPC y por cualquier función `SECURITY DEFINER`—, los renglones de una cabecera de un proyecto ajeno y, con A-5, dejar el documento «sin proyecto» (`NULL` solo para las personas exentas). **Qué NO cierra: V4** (`INSERT` por una función `SECURITY DEFINER` con `company_id` ajeno): el paquete **no compara la empresa** del documento con la de la sesión (decisión D-5 de su README = NO; `PRJ-1` deja tres `[límite D-5]` que pasan en verde). V4 queda **abierta** hasta un PR aparte (D-5), que antes debe corregir la siembra de `supabase/tests/conta_reglas_imputacion/assert.sql:490-493` (siembra una factura de la empresa B con la sesión de A: con el bloque de empresa puesto, esa suite se rompe). Por la API la empresa sí se compara (la RLS y `trg_00_compras_rls_empresa`); lo que queda abierto es solo la vía de una función `SECURITY DEFINER`, y en la cadena armada ninguna función `SECURITY DEFINER` pública inserta en esas tablas (verificación independiente, por catálogo; producción no se releyó para esto). Responder **SÍ aprueba solo lo que cierra**, no V4. (§8) | **SÍ** a lo que cierra. V4 es otra decisión (D-5 del README del paquete: «SÍ, después, en otro PR») |
| **A-5** | **P-PERM-1 · R2.** ¿Se prohíbe a quien **no** es exento de proyecto crear, aprobar o pagar documentos **sin proyecto** y sacar su propio documento de su proyecto dejándolo sin proyecto? (§8) | **SÍ** |
| **A-6** | ¿Se revisa el rol de empresa «Finanzas / Contador» (**1 193 llaves, 1 106 de ellas concedidas en bloque por la cuenta propietaria el 2026-08-13 21:52:53; 87 sin actor entre 2026-06-12 y 2026-09-10**) para acercarlo a la plantilla (63)? Esta propuesta **no** recorta nada. Es también donde viven `approve` y `change_status`, con los que Alexander puede anular documentos y **autorizar excepciones de contrato** (`compras_oc_excepcion_contrato`) con cualquier paquete (§5.3); quitárselas afectaría además a las otras 14 funciones de §1. | Decisión del negocio |
| **A-7** | ¿Se enciende el interruptor de separación solicitante/aprobador (`aprobacion_separada`) en Prestadora de Servicios S.A.? (cubre solo la acción 1; costo en §5.3) | Sin recomendación |
| **A-8** | ¿Se concede **inmediatamente** tras desplegar la 0900, aunque A-4/A-5 (el PR de alcance por proyecto, paso 3) aún no estén en producción? El orden acordado pone #928 antes de #926, así que solo A-4/A-5 quedan pendientes; si por algún motivo se invirtiera, la asignación de proyecto seguiría siendo autoasignable (§6.5). | **SÍ** con el paquete B (o el A, que no concede nada): no amplía nada de lo que hoy puede y hoy hay 0 documentos sin proyecto |

*Opcional (no es sí/no):* si la recepción debe quedar en una persona de operación y no en finanzas, la llave `recepcion_registrar` se concede a esa persona en vez de a Alexander; no se propone porque exigiría designar a alguien.

---

## 8. Capturas en proyectos no asignados y ampliaciones mediante `project_id = NULL` (propuesta; **no aplicada**)

**Hechos de producción `[Q14, Q16, Q21]`.** Las políticas `INSERT` de `ordenes_compra`, `recepciones`, `facturas_proveedor`, `ordenes_pago` y `contrasenas_pago` piden la empresa y (el perfil `operator`/`admin`/`company_owner` **o** `create`), pero **no miran el proyecto**; las políticas `SELECT` sí (`project_id IS NULL OR can_access_project(project_id)`). Y `can_access_project(NULL)` es **verdadero**. Hay 0 documentos sin proyecto en las cinco tablas. La RPC `compras_orden_crear` sí exige el proyecto asignado cuando recibe uno; el `INSERT` directo (la API) no.

| Vector | Hoy | Quién |
|---|---|---|
| V1 · Capturar un **borrador** en un proyecto no asignado (`INSERT` directo con `project_id` ajeno) | Permitido (las decisiones posteriores sí exigen proyecto, pero el borrador queda creado) | los 7 `operator` (entre ellos Alexander) y Marco; también quien tenga `create` |
| V2 · Crear, aprobar o pagar documentos con `project_id = NULL`: «sin proyecto = de la empresa» | Permitido a toda persona con la llave: **un documento sin proyecto escapa a la asignación por proyecto** | cualquiera con la llave, incluida Alexander tras la concesión |
| V3 · **Mover** el propio documento a «sin proyecto» (`UPDATE … SET project_id = NULL`) | Permitido: lo ve y puede actuar sobre él **toda** la empresa con la llave | quien tiene `edit` y el proyecto de origen |
| V4 · `INSERT` por una función `SECURITY DEFINER` con `company_id` ajeno | Un borrador de otra empresa pasa (la RLS no rige al dueño de la función); hoy no existe ninguna función así | — (**con el paquete entregado sigue igual**: no compara la empresa; ver R1 y D-5) |

**Propuesta** (en migración y PR propios, **después** del despliegue de #926 —orden #928 → #926 → este PR → #927—; migración `20261027001000`, justo tras la 0900; no es una undécima migración del #926 y no se sube `MAX_APPLY`):

* **R1 (bajo riesgo; A-4).** Lo que se escribió y se probó (el paquete) es un disparador `BEFORE INSERT OR UPDATE OF project_id` en las cinco cabeceras y otro en los cuatro renglones, solo para sesiones de usuario: el `INSERT` exige que la persona pueda destinar el proyecto del documento (`compras_puede_destinar_proyecto`: un proyecto al que tiene acceso —`can_access_project`—, o `NULL` solo si es exenta; `COMPRAS_ALCANCE_PROYECTO`, 42501). **Cierra V1** y, por esa misma regla (que es también la de R2), el crear «sin proyecto» de quien no es exento (V2, solo en su parte de crear) y el mover el propio documento a «sin proyecto» (V3). **No cierra V4:** la comprobación de que `NEW.company_id` sea la empresa de la sesión (salvo el superadministrador), que esta propuesta incluía en R1, **no está en el paquete** (D-5 = NO): la medición mostró que rompe `conta_reglas_imputacion/assert.sql:490-493`, que siembra una factura de la empresa B con la sesión de A. V4 queda abierta hasta el PR de D-5, que primero corrige esa siembra y después añade el bloque de empresa (cinco líneas, medidas; `PRJ-1` pasaría sus tres `[límite D-5]` a rechazo). Sin tocar pantallas salvo la preselección de proyecto de Contabilidad (D-8, `ui_mensajes.patch`).
* **R2 (decisión de fondo; A-5).** Para quien **no** es exento de proyecto (`NOT user_is_project_exempt()`): exigir `NEW.project_id IS NOT NULL` en el `INSERT`, y rechazar el `UPDATE` de `project_id` de un valor a `NULL` (`OLD.project_id IS NOT NULL AND NEW.project_id IS NULL`), conservando la excepción de la acción referencial `ON DELETE SET NULL` cuando el proyecto ya no existe. El paquete la implementa (en el mismo punto de decisión que R1; también rechaza reclamar para un proyecto un documento que está sin proyecto). Cierra V3 y, de V2, el **crear** sin proyecto; **no** cierra aprobar o pagar un documento que *ya* está sin proyecto (D-4 del README del paquete: queda abierto a propósito y hoy hay 0 documentos así; cerrarlo es una línea). Afecta a Marco (administrador **con** asignaciones, no exento) igual que a Alexander. No hay datos que migrar: hoy hay 0 documentos sin proyecto.
* **Pruebas:** existen y están en el repositorio, en `supabase/tests/compras_bloque_b/pendientes_decision/proyectos/`: `PRJ-1.sql` (tabla × brecha × vía × clase de persona, lo legítimo y los límites; **ROJA sin la propuesta, VERDE con ella**) y tres parches (`adaptaciones_aserciones.patch`, `reversion_script.patch`, `ui_mensajes.patch`). Las `PERM-1…4` siguen en verde con el paquete armado (166 / 115 / 119 / 137 comprobaciones, medidas por la cuarta verificación independiente; `adaptaciones_aserciones.patch` ajusta antes una aserción de `PERM-3` que montaba un documento «de la empresa» con una persona no exenta).
* **Estado honesto:** el prototipo **ya existe y está probado**, ya no es un registro del *scratchpad*: `propuesta_alcance_proyecto.sql` (se copia como `20261027001000_compras_alcance_proyecto_captura.sql`; idempotente, con pre-vuelo y reversión autónoma). Medido en PostgreSQL 16 desechable: `PRJ-1` con la propuesta **890 comprobaciones en verde y 0 en rojo** (sin ella, modo informe: 750 en verde y 140 en rojo); `run.sh` de `compras_bloque_b` con el paquete armado, `rc = 0` y 988 líneas `✓`. Lo que **no** se probó y sigue abierto está en el README del paquete (§6 y §7): PostgREST/HTTP real, la pantalla en un navegador, PostgreSQL 17 (producción), concurrencia real, y las decisiones D-4, D-5, D-6, D-9 y D-10. Este documento no repite el detalle: la fuente es ese README.
* **Qué cubre y qué no.** R1/R2, tal como las implementa el paquete, cierran *dónde* se captura (V1) y *cuándo* un documento deja de pertenecer a un proyecto (V3, y el crear sin proyecto de V2); **no** cierran V4 (la empresa del `INSERT` no se compara: D-5), ni actuar sobre un documento que ya está sin proyecto (D-4), ni los demás límites que lista el README del paquete (D-6, D-9, D-10); tampoco cierran la **autoasignación de proyectos** (`user_project_assignments`, paso 1 del orden de despliegue), de la que depende que la asignación de proyecto sea un límite real. Con las concesiones recomendadas nada es más ancho que hoy: Alexander ya puede las seis hoy sobre documentos sin proyecto.

---

## 9. Hallazgos inesperados

1. **El rol de Alexander tiene 1 193 de las 1 201 llaves del catálogo** (la plantilla trae 63): **1 106 concedidas en bloque por la cuenta propietaria el 2026-08-13 21:52:53 y 87 sin actor** entre 2026-06-12 y 2026-09-10 `[Q4, Q5, Q6, Q30]`. El texto anterior del script describía solo ~10 llaves.
2. **El nombre no identifica:** `ILIKE '%Monterroso%'` coincide con 3 cuentas (2 `cliente` sin empresa) `[Q2]`, `ILIKE '%Santos%'` con otras 3 (Marco Santos Godoy `admin`, una cuenta `cliente` «Marco Santos» sin empresa y «Eduardo Santos» `viewer`) y hay dos empresas de nombre casi igual `[Q27]`. La versión anterior de `propuesta-asignaciones-permisos-compras.sql` filtraba por nombre **dentro de los bloques de concesión**; su comprobación previa devolvería 3 filas y lo advertía, pero un bloque ejecutado habría intentado crear roles de ajustes para las tres cuentas. Las dos `cliente` no tienen empresa y la restricción `roles_company_or_system_chk` (un rol que no es de sistema exige empresa) habría hecho fallar la sentencia entera, así que no se habría escrito nada, pero por una casualidad de la restricción y no por diseño. Ahora el filtro es por id, perfil, empresa y estado.
3. **Las copias de empresa son fotografías que divergen de su plantilla** (90 contra 96, 189 contra 1 104, 1 193 contra 63) y la plantilla nunca las refresca; no hay copia automática al crear una empresa `[Q6]`. Además, `create-user` y `accept-invitation` siguen asignando la plantilla de plataforma **directamente** (vínculo vivo, sin copia) según el perfil, aunque hoy no haya ninguna asignación así `[Q7b]`.
4. **La única factura se creó y se aprobó por la misma cuenta en 10,5 s** `[Q9]`: para la factura (y la recepción, la orden de pago y el pago) no existe ninguna regla entre personas; la del interruptor es solo para la orden de compra y está apagada.
5. **Alexander no tiene ningún inicio de sesión registrado desde el 2026-08-13 ni filas de negocio a su nombre** `[Q10, Q11]`: la «continuidad operativa» es una expectativa de función, no un hecho de uso.
6. **`role_permissions` no tiene política ni bitácora de `UPDATE`:** el `ON CONFLICT … DO UPDATE SET effect = 'allow'` de la versión anterior del script habría **volteado en silencio un `deny`** y sin rastro. En producción `role_permissions` solo tiene políticas de `SELECT`, `INSERT` y `DELETE` y un disparador de bitácora `AFTER INSERT OR DELETE` `[Q26]`. Hoy hay 0 `deny` en toda la base `[Q7b]`; ahora los bloques usan `DO NOTHING` y `P-0.4` descarta antes cualquier `deny`.
7. **La pantalla de roles guarda con `set_role_permissions`, que deja el rol *exactamente* con la lista enviada:** editar así un rol de 1 193 llaves y guardar una lista incompleta lo recortaría. Otra razón para conceder por ajustes individuales.
8. **«Ganar» la acción 1 es teórico para «Administrador General»:** la plantilla trae la llave de la pestaña pero no `platform.contabilidad.edit`, que las cuatro políticas `UPDATE` exigen; y no tiene personas.
9. **Tres proyectos dependen solo de Alexander** (entre las personas con alcance **y** con `edit`; hay otras 2 personas con alcance en cada uno, sin ninguna llave) y dos proyectos («test», «VSC General») no tienen a nadie asignado `[Q12, Q28]`.
10. **Con cualquier paquete Alexander conserva `approve` y `change_status` genéricos** (su rol de 1 193 llaves) y con ellos puede cancelar y cerrar órdenes, anular recepciones, contraseñas y facturas sin pagos aplicados, incluso una factura que tiene una orden de pago aprobada (probado en la base desechable, §5.3), y **autorizar excepciones de contrato** (`compras_oc_excepcion_contrato`, función de producción que exige solo `change_status`, §1 `[Q31]`). Las cinco llaves no cambian eso; es una decisión sobre el rol (A-6) y sobre el interruptor (A-7).
11. **Para las seis acciones, el servidor de producción hoy solo exige `edit`**; para ellas `approve` y `change_status` solo gobiernan la pantalla `[Q29]` (§1). Pero **no son llaves muertas:** 15 funciones públicas de producción las consultan, entre ellas `compras_oc_excepcion_contrato` (§1, `[Q31]`). La cadena 0300–0800 de este PR ya había hecho valer `approve`/`change_status` para las seis transiciones; la 0900 las sustituye por la llave de cada acción.
12. **Dos criterios, no uno, justifican el paquete B** (§5.1): la continuidad de lo que el rol le asigna y hoy puede (la cumplen las cinco llaves por igual) y la segunda firma para la salida de efectivo (lo que retiene `pago_ejecutar` y `pago_anular`). La recepción registrada y la factura aprobada contabilizan (generan asientos); lo que no hacen es sacar efectivo.

---

## 10. Lo que se probó y lo que NO se hizo

* **No se concedió, creó ni borró nada** en producción, en el sandbox ni en la base de preview. Todo lo de producción son `SELECT` (`[Q1]`–`[Q32]`).
* **El script se probó en una base desechable local** (PostgreSQL 16, cadena de migraciones del PR #926 aplicada hasta la `…0900` con el mecanismo de `supabase/tests/compras_bloque_b/run.sh`, y un padrón con los ids reales de Alexander, de Marco, de los 8 proyectos y de su rol de 1 193 llaves; la base y los *scripts* de prueba no están en el repositorio). Resultados, comando por comando:
  * **Archivo completo, una sesión, tal cual:** 0 errores, 0 cambios (huella md5 de `role_permissions`, `user_roles`, `roles`, `user_project_assignments` y conteo de la bitácora idénticos) y cero sentencias de escritura sin comentar.
  * **Cada bloque (`P-1.1` a `P-1.5`, `P-3`, `P-4`, `P-5`, `P-9`) SIN confirmar:** el bloque completo en una sesión levanta `SIN CONFIRMAR` y deja 0 cambios; **una conexión de `psql` por sentencia**, partido tanto con un separador que respeta `$$` como con uno que corta en cada `;`, deja 0 cambios; con la confirmación descomentada pero **una conexión por sentencia**, 0 cambios (el `SET LOCAL` no sobrevive a la conexión); con la confirmación pero **sin el `BEGIN`** (*autocommit*, una sola sesión), rechazado y 0 cambios.
  * **Confirmado + `ROLLBACK`**, bloque completo en una sesión: el `SELECT` de verificación ve la fila dentro de la transacción y al final 0 cambios.
  * **Confirmado + `COMMIT`:** paquete B → `role_permissions` 2 922 → 2 925, `user_roles` 5 → 6, `roles` 18 → 19, bitácora +5 con actor vacío; paquete C → 2 927 / 6 / 19, bitácora +7; repetir `P-1.1` no cambia nada. `V-3` tras B: Alexander «sí» en 1 a 4 y «no» en 5 y 6; tras C: «sí → sí» en las seis; Marco «sí → sí». `user_has_permission` de Alexander: B → `t,t,t,f,f` para recepción, factura, orden de pago, pago y anulación; C → `t` en las cinco. Huella md5 de `user_project_assignments` idéntica en todo. `P-3` (con los marcadores sustituidos), `P-4` y `P-5`: +5/+1/+1, +1 y +3. **`P-9` (reversión):** `role_permissions`, `user_roles`, `roles` y `user_project_assignments` vuelven a los md5 originales; la bitácora crece (+7 con C).
  * **Filtros:** con Alexander cambiado a `viewer`, inactivo o de otra empresa, y `P-3` con el id de la cuenta `cliente` «Marco Santos» (sin empresa), el bloque no escribe nada **aunque esté confirmado y con `COMMIT`**; un `deny` previo en su rol de ajustes no se voltea; antes de la 0900 (llaves ausentes) el bloque falla por `role_permissions_permission_key_fkey` sin dejar residuo.
  * **Comportamiento real** de Alexander (`authenticated`, bajo RLS) tras cada paquete, sobre documentos de un proyecto suyo: A → pasa solo la acción 1; B → pasan 1 a 4 y 5 y 6 se rechazan con `COMPRAS_PERMISO_ACCION` (42501); C → pasan las seis. Con **cualquier** paquete pasan emitir, cancelar y cerrar una orden, anular una recepción, anular una factura (con o sin orden de pago aprobada) y anular una contraseña, y crear la orden, la recepción, la factura y la orden de pago; se rechazan anular una factura con pagos aplicados (`CXP_BLOQUEADO`, 23514) y pagar una orden cuya factura se anuló (`COMPRAS_FACTURA_NO_PAGABLE`, 23514). Como Marco (`admin`) bajo RLS, crear el rol de ajustes, asignarlo y conceder deja `actor = Marco` en la bitácora; como Alexander (`operator`) el mismo `INSERT` en `roles` es rechazado por RLS.
  * **La versión anterior de los bloques** (sin el segundo seguro) se reprodujo con una conexión por sentencia: dejó `role_permissions` 2 922 → 2 923, `user_roles` 5 → 6 y `roles` 18 → 19 a pesar del `ROLLBACK`. Con el segundo seguro, 0.
* **Lo que NO se pudo probar:** (1) un *pooler* real (pgbouncer en modo sentencia o transacción, el *pooler* de Supabase) ni el editor SQL de Supabase: no hay uno disponible, y «una conexión por sentencia» se simuló con una invocación de `psql` por sentencia; (2) PostgreSQL 17 (producción): la base desechable es 16; (3) la pantalla React real («Roles y permisos»): su ruta se simuló con las mismas sentencias que guarda `handleSave`, bajo RLS como Marco; no se verificaron los textos visibles de las casillas; (4) el **script de concesión** (§6) sobre una cadena con el PR #928 (`20261026000600`) intercalado: la cadena en sí **sí** se probó después (tercera ronda, sobre `e9764d3a` con la 0600 de `b9b630b1`: la batería `compras_bloque_b` da `rc = 0` y 986 ✓, 988 con el paquete de alcance por proyecto; la verificación independiente la probó además en el orden inverso), pero el script no se volvió a correr sobre esa cadena; (5) la propuesta de §8, que sigue siendo un prototipo no aplicado ni repetido en esta sesión.
* No se editó `COMPRAS_CONTROLES_SERVIDOR.md`, ninguna migración ni ningún permiso; no se hizo `commit`.

---

## 11. (E) Bloque para el cuerpo del PR

````markdown
### Permisos por acción: matriz propuesta (SIN conceder; lectura de producción 2026-10-10, releída 2026-10-11)

Detalle, consultas y pasos: `docs/COMPRAS_PROPUESTA_ASIGNACION_PERMISOS.md`. La 0900 no concede nada. Celda = «hoy → tras la 0900 sin conceder» y, al final, la propuesta del paquete B (**C** = conceder · **N** = no conceder · ya = ya lo tiene). «Hoy» mide las llaves genéricas de la pantalla y de la cadena 0300–0800 de este PR: **en producción el servidor hoy exige solo `platform.contabilidad.edit` para las seis acciones** (no existen `compras_exigir_accion` ni `compras_tg_permiso_*`; `approve` y `change_status` sí los consultan 15 funciones públicas ajenas a esas seis transiciones, entre ellas `compras_oc_excepcion_contrato`) y solo Alexander tiene `edit`, `approve` y `change_status`.

| Principal | OC | Recep. | Factura | O. pago | Pago | Anular | edit |
|---|---|---|---|---|---|---|---|
| Alexander Monterroso (operator, 6 proy.) | sí→sí ya | sí→no **C** | sí→no **C** | sí→no **C** | sí→no **N** | sí→no **N** | sí ya |
| Rol de empresa «Finanzas / Contador» (1 pers.) | sí→sí ya | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí ya |
| Plantilla «Finanzas / Contador» (0 pers.) | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí ya |
| Plantilla «Admin Plataforma» (0 pers.) | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí ya |
| Plantilla «Administrador General» (0 pers.) | no→sí ya | no→no N | no→no N | no→no N | no→no N | no→no N | no N |
| Marco Santos Godoy (admin, 3 proy.) | sí→sí ya | sí→sí ya | sí→sí ya | sí→sí ya | sí→sí ya | sí→sí ya | sí ya |

- **Tres paquetes (decisión A-1; el PR sigue en borrador hasta responderla, y A es una respuesta válida):** **A** ninguna llave por ahora (0 usos, sin inicio de sesión registrado desde el 2026-08-13; se concede en un minuto cuando vuelva a operar; el PR puede fusionarse igual aceptando el efecto transitorio) · **B (recomendada)** recepción + factura + orden de pago; no pago ni anulación (los dos pasos en que sale o se reversa efectivo: segunda firma) · **C** continuidad total (= hoy): las cinco; B–C difieren en exactamente 2 llaves. La tabla muestra el paquete B. Se concede desde el panel «Ajustes individuales», **por Marco** (la bitácora nombra a una persona; por SQL el actor queda vacío), después de la 0900. Plantillas y rol de empresa: nada ahora.
- Concentración: con B, Alexander (operator) crea sin llave y recorre solo la cadena hasta «orden de pago aprobada». Con **cualquier** paquete conserva `approve`/`change_status` genéricos y puede cancelar/cerrar órdenes, anular recepciones, contraseñas y facturas sin pagos y **autorizar excepciones de contrato** (`compras_oc_excepcion_contrato`, con `change_status`; no es una de las seis acciones). En producción esas dos llaves no «solo gobiernan la pantalla»: 15 funciones públicas las consultan (§1). El interruptor de separación (apagado en todas las empresas) solo cubre «quien solicita no aprueba la orden».
- Dos decisiones de personas: quién está detrás de la cuenta propietaria y quién paga en Cascadas, La Arboleda y Viñas (ahí Alexander es la única persona con alcance y con `edit`).
- Uso real: 1 OC histórica sin autor, 1 factura anulada creada y aprobada por la cuenta propietaria en 10,5 s; 0 recepciones, órdenes de pago, pagos y asientos. Alexander: 0 filas de negocio, sin acceso desde 2026-08-13.
- Proyectos sin cambios: Alexander 6, Marco 3. Marco, la cuenta propietaria y el superadministrador pasan toda llave por perfil.
- Hallazgos: el rol de Alexander tiene 1 193 de 1 201 llaves (1 106 en bloque por la cuenta propietaria el 2026-08-13; 87 sin actor); «Monterroso» y «Santos» coinciden con 3 cuentas cada uno (el script usa el id); las plantillas no se propagan a copias existentes ni a empresas nuevas.
- Script probado en una base desechable: sin confirmar → 0 cambios (también sentencia por sentencia); confirmado + ROLLBACK → 0; confirmado + COMMIT → +3/+1/+1 (B) o +5/+1/+1 (C); reversión exacta con `P-9`.
- Orden de despliegue, cada uno en su push: #928 (`20261026000600`) → #926 → PR de alcance por proyecto (`20261027001000`) → #927 (`20261028000000`).
- Decisiones: A-1 (paquete) y A-1.6…A-1.8, A-2.1…A-2.3, A-4/A-5 (PR propio posterior), A-6 (recorte del rol), A-7 (interruptor), A-8 (cuándo conceder).
````

---

## Apéndice · Consultas citadas (producción, solo `SELECT`, 2026-10-10 y 2026-10-11)

Todas se ejecutaron tal cual contra `nnsqmeigtgewatameexo` con la herramienta SQL (una sentencia de solo lectura cada una).

**`[Q1]`** `scripts/diagnostico-permisos-compras.sql`, **íntegro**, un único `SELECT` (md5 del archivo `e845d06064bd9d245272c19207ee4d5c`; las líneas 1–46 son comentarios y se ejecutó desde `WITH` hasta el final). Resultado en §0, §2.5 y §4.

**`[Q2]`** Personas
```sql
SELECT u.id, u.full_name, u.role, u.company_id, c.nombre AS empresa, u.activo, u.created_at, u.permission_type, u.project_id,
       (SELECT count(*) FROM public.user_project_assignments upa WHERE upa.user_id=u.id) AS proyectos_asignados,
       (SELECT count(*) FROM public.app_users x WHERE x.full_name ILIKE '%Monterroso%' OR x.full_name ILIKE '%Santos Godoy%') AS coincidencias_nombre
  FROM public.app_users u LEFT JOIN public.companies c ON c.id=u.company_id
 WHERE u.full_name ILIKE '%Monterroso%' OR u.full_name ILIKE '%Santos Godoy%' OR u.full_name ILIKE '%Alexander%' OR u.full_name ILIKE '%Marco%'
 ORDER BY u.full_name;
-- y el filtro del script: SELECT id, full_name, role, company_id, activo FROM public.app_users WHERE full_name ILIKE '%Monterroso%' ORDER BY full_name;  → 3 filas
```

**`[Q3]`** Roles asignados
```sql
SELECT u.full_name, u.role AS rol_app, r.id AS role_id, r.name AS rol, r.is_system, r.company_id, r.user_override_for, r.cloned_from_role_id, tpl.name AS plantilla_origen, tpl.is_system AS plantilla_es_sistema, r.service,
       ur.assigned_at, ur.assigned_by, ur.expires_at, (ur.expires_at IS NOT NULL AND ur.expires_at <= now()) AS vencido,
       (SELECT count(*) FROM public.role_permissions rp WHERE rp.role_id=r.id AND rp.effect='allow') AS n_allow,
       (SELECT count(*) FROM public.role_permissions rp WHERE rp.role_id=r.id AND rp.effect='deny') AS n_deny
  FROM public.app_users u
  JOIN public.user_roles ur ON ur.user_id=u.id
  JOIN public.roles r ON r.id=ur.role_id
  LEFT JOIN public.roles tpl ON tpl.id=r.cloned_from_role_id
 WHERE u.id IN ('327ffeda-85e8-4ea4-9423-af9b206ee886','86440f9d-e34b-49ba-91c7-3531ed365460')
 ORDER BY u.full_name, r.name;
```

**`[Q4a]`** Llaves de Contabilidad/compras del rol de Alexander (48 filas, todas `allow`)
```sql
SELECT rp.permission_key, rp.effect, p.category
  FROM public.role_permissions rp LEFT JOIN public.permissions p ON p.key=rp.permission_key
 WHERE rp.role_id='d915897c-b350-431a-8447-b37c61f97e8a'
   AND (rp.permission_key ILIKE '%contab%' OR rp.permission_key ILIKE '%compra%' OR rp.permission_key ILIKE '%proveedor%' OR rp.permission_key ILIKE '%pago%' OR rp.permission_key ILIKE '%factura%' OR rp.permission_key ILIKE '%recepcion%' OR rp.permission_key ILIKE '%orden%' OR rp.permission_key ILIKE '%cuentas_por%' OR rp.permission_key ILIKE '%presupuesto%' OR rp.permission_key ILIKE '%contrato%')
 ORDER BY rp.permission_key;
```
**`[Q4b]`** Lo que le falta (8 llaves) y la plantilla (63)
```sql
SELECT 'ausente_en_rol_Alexander' AS tipo, p.key, p.category FROM public.permissions p
 WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id='d915897c-b350-431a-8447-b37c61f97e8a' AND rp.permission_key=p.key AND rp.effect='allow')
 UNION ALL
 SELECT 'allow_fuera_de_catalogo', rp.permission_key, NULL FROM public.role_permissions rp
 WHERE rp.role_id='d915897c-b350-431a-8447-b37c61f97e8a' AND NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key=rp.permission_key)
 UNION ALL
 SELECT 'plantilla_Finanzas_n_allow', r.id::text, count(*)::text FROM public.roles r JOIN public.role_permissions rp ON rp.role_id=r.id AND rp.effect='allow' WHERE r.id='00000000-0000-0000-0000-000000000003' GROUP BY r.id
 ORDER BY 1,2;
```
**`[Q4c]`** Por categoría
```sql
SELECT coalesce(p.category,'(sin catalogo)') AS categoria, count(*) AS n_allow
  FROM public.role_permissions rp LEFT JOIN public.permissions p ON p.key=rp.permission_key
 WHERE rp.role_id='d915897c-b350-431a-8447-b37c61f97e8a' AND rp.effect='allow'
 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 80;
```

**`[Q5]`** Quién concedió las llaves del rol de Alexander
```sql
SELECT action, actor_id IS NULL AS actor_nulo, count(*) AS n, min(occurred_at) AS desde, max(occurred_at) AS hasta
  FROM public.permission_audit_log
 WHERE target_role_id='d915897c-b350-431a-8447-b37c61f97e8a' OR target_user_id='327ffeda-85e8-4ea4-9423-af9b206ee886'
 GROUP BY 1,2 ORDER BY 4;
SELECT a.actor_id, u.full_name AS actor, u.role AS rol_actor, count(*) AS n, min(a.occurred_at) AS desde, max(a.occurred_at) AS hasta
  FROM public.permission_audit_log a LEFT JOIN public.app_users u ON u.id=a.actor_id
 WHERE a.target_role_id='d915897c-b350-431a-8447-b37c61f97e8a' AND a.action IN ('grant_permission','update_role') AND a.actor_id IS NOT NULL
 GROUP BY 1,2,3 ORDER BY 5;
-- resultado: 1 106 grant_permission + 2 update_role con actor (la cuenta propietaria, company_owner) del 2026-08-13 21:52:53 al 21:54:46; 87 grant_permission con actor vacío (2026-06-12 a 2026-09-10)
```

**`[Q6]`** Inventario de roles y plantillas
```sql
SELECT r.id, r.name, r.is_system, r.company_id IS NOT NULL AS con_empresa, r.user_override_for IS NOT NULL AS ajustes, r.cloned_from_role_id, r.service,
       (SELECT count(*) FROM public.role_permissions rp WHERE rp.role_id=r.id AND rp.effect='allow') AS n_allow,
       (SELECT count(*) FROM public.role_permissions rp WHERE rp.role_id=r.id AND rp.effect='deny') AS n_deny,
       (SELECT count(*) FROM public.role_permissions rp WHERE rp.role_id=r.id AND rp.effect='allow' AND rp.permission_key IN ('platform.contabilidad.approve','platform.contabilidad.change_status','platform.contabilidad.edit','condominios.tab.ordenes_compra.approve')) AS n_llaves_clave,
       (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur JOIN public.app_users u ON u.id=ur.user_id AND u.activo WHERE ur.role_id=r.id AND (ur.expires_at IS NULL OR ur.expires_at>now())) AS personas_activas_vigentes,
       (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur WHERE ur.role_id=r.id) AS asignaciones_totales,
       r.created_at
  FROM public.roles r ORDER BY r.is_system DESC, r.name;
```

**`[Q7]`** Perfiles de `app_users`
```sql
SELECT u.role, u.activo, (u.company_id IS NOT NULL) AS con_empresa, count(*) AS personas,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id=u.id)) AS con_asignaciones,
       string_agg(CASE WHEN u.role IN ('super_admin','superadmin','company_owner','admin') THEN u.full_name END, '; ' ORDER BY u.full_name) AS nombres_si_pasan_toda_llave
  FROM public.app_users u GROUP BY u.role, u.activo, (u.company_id IS NOT NULL) ORDER BY 1,2,3;
```
**`[Q7b]`** Totales de la base
```sql
SELECT (SELECT count(*) FROM public.companies) AS empresas, (SELECT count(DISTINCT company_id) FROM public.roles WHERE company_id IS NOT NULL) AS empresas_con_roles,
       (SELECT count(*) FROM public.roles WHERE is_system) AS plantillas, (SELECT count(*) FROM public.roles WHERE NOT is_system) AS roles_empresa,
       (SELECT count(*) FROM public.roles WHERE user_override_for IS NOT NULL) AS roles_ajustes_individuales,
       (SELECT count(*) FROM public.user_roles WHERE expires_at IS NOT NULL) AS asignaciones_con_vencimiento,
       (SELECT count(*) FROM public.user_roles WHERE expires_at IS NOT NULL AND expires_at <= now()) AS asignaciones_vencidas,
       (SELECT count(*) FROM public.role_permissions WHERE effect='deny') AS denys_en_toda_la_base,
       (SELECT count(*) FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE r.is_system) AS asignaciones_a_plantillas,
       (SELECT count(*) FROM public.role_permissions WHERE permission_key LIKE 'platform.contabilidad.compras.%') AS concesiones_llaves_nuevas;
SELECT 'catalogo' AS fuente, count(*)::text AS n FROM public.permissions;   -- 1 201
```

**`[Q8]`** Filas de las tablas del circuito
```sql
SELECT 'ordenes_compra' t, count(*) n, min(created_at) desde, max(created_at) hasta FROM public.ordenes_compra
UNION ALL SELECT 'orden_compra_lineas', count(*), min(created_at), max(created_at) FROM public.orden_compra_lineas
UNION ALL SELECT 'orden_compra_eventos', count(*), min(created_at), max(created_at) FROM public.orden_compra_eventos
UNION ALL SELECT 'orden_compra_excepciones', count(*), min(created_at), max(created_at) FROM public.orden_compra_excepciones
UNION ALL SELECT 'recepciones', count(*), min(created_at), max(created_at) FROM public.recepciones
UNION ALL SELECT 'recepcion_respaldos', count(*), min(created_at), max(created_at) FROM public.recepcion_respaldos
UNION ALL SELECT 'facturas_proveedor', count(*), min(created_at), max(created_at) FROM public.facturas_proveedor
UNION ALL SELECT 'contrasenas_pago', count(*), min(created_at), max(created_at) FROM public.contrasenas_pago
UNION ALL SELECT 'ordenes_pago', count(*), min(created_at), max(created_at) FROM public.ordenes_pago
UNION ALL SELECT 'conta_asientos', count(*), min(created_at), max(created_at) FROM public.conta_asientos
UNION ALL SELECT 'conta_intentos_contabilizacion', count(*), min(created_at), max(created_at) FROM public.conta_intentos_contabilizacion
UNION ALL SELECT 'compras_config', count(*), NULL, NULL FROM public.compras_config;
```

**`[Q9]`** Autor de la orden y de la factura
```sql
SELECT 'factura' AS doc, f.id::text, f.estado, f.created_by::text AS creado_por, (SELECT full_name FROM public.app_users WHERE id=f.created_by) AS creado_por_nombre, f.created_at,
       f.aprobada_por::text, f.aprobada_at, f.match_forzado_por::text, f.project_id::text, f.monto_pagado::text AS monto_pagado
  FROM public.facturas_proveedor f
UNION ALL
SELECT 'orden_compra', o.id::text, o.estado, o.created_by::text, (SELECT full_name FROM public.app_users WHERE id=o.created_by), o.created_at,
       o.aprobada_por::text, o.aprobada_at, NULL, o.project_id::text, NULL FROM public.ordenes_compra o;
```

**`[Q10]`** Barrido de columnas de autoría (solo lectura: `query_to_xml` ejecuta `SELECT count(*)`)
```sql
WITH cols AS (
  SELECT c.table_name, c.column_name
    FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
   WHERE c.table_schema='public' AND c.data_type='uuid'
     AND c.column_name ~ '(created_by|creado_por|_por$|_por_id$|actor|updated_by|user_id$|registrado|solicitad|aprobad|recibid|pagad|autoriz)'
), cnt AS (
  SELECT table_name, column_name,
    (xpath('/row/a/text()', query_to_xml(format('select count(*) as a from public.%I where %I = %L', table_name, column_name, '327ffeda-85e8-4ea4-9423-af9b206ee886'), false, true, '')))[1]::text::int AS alexander,
    (xpath('/row/a/text()', query_to_xml(format('select count(*) as a from public.%I where %I = %L', table_name, column_name, '86440f9d-e34b-49ba-91c7-3531ed365460'), false, true, '')))[1]::text::int AS marco
  FROM cols
)
SELECT table_name, column_name, alexander, marco FROM cnt WHERE alexander>0 OR marco>0 ORDER BY alexander DESC, marco DESC, 1;
```

**`[Q11]`** Inicios de sesión
```sql
SELECT u.full_name, s.event_type, count(*) AS n, min(s."timestamp") AS desde, max(s."timestamp") AS hasta
  FROM public.security_logs s JOIN public.app_users u ON u.id=s.user_id
 WHERE s.user_id IN ('327ffeda-85e8-4ea4-9423-af9b206ee886','86440f9d-e34b-49ba-91c7-3531ed365460')
 GROUP BY 1,2 ORDER BY 1,2;
```

**`[Q12]`** Proyectos y asignaciones
```sql
SELECT p.nombre, p.activo, p.estado,
       EXISTS (SELECT 1 FROM public.user_project_assignments a WHERE a.project_id=p.id AND a.user_id='327ffeda-85e8-4ea4-9423-af9b206ee886') AS alexander,
       EXISTS (SELECT 1 FROM public.user_project_assignments a WHERE a.project_id=p.id AND a.user_id='86440f9d-e34b-49ba-91c7-3531ed365460') AS marco,
       (SELECT count(*) FROM public.user_project_assignments a WHERE a.project_id=p.id) AS personas_asignadas_total,
       (SELECT count(*) FROM public.ordenes_compra o WHERE o.project_id=p.id) AS oc, (SELECT count(*) FROM public.facturas_proveedor f WHERE f.project_id=p.id) AS facturas
  FROM public.projects p WHERE p.company_id='24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31' ORDER BY p.nombre;
-- y las asignaciones con fecha: SELECT u.full_name, p.nombre, upa.permission_type, upa.created_at FROM public.user_project_assignments upa JOIN public.app_users u ON u.id=upa.user_id JOIN public.projects p ON p.id=upa.project_id WHERE upa.user_id IN ('327ffeda-85e8-4ea4-9423-af9b206ee886','86440f9d-e34b-49ba-91c7-3531ed365460') ORDER BY 1,2;
```

**`[Q13]`** Quién tiene las llaves relacionadas por sus roles (`allow`)
```sql
WITH claves(k) AS (VALUES ('platform.contabilidad.view'),('platform.contabilidad.create'),('platform.contabilidad.edit'),('platform.contabilidad.delete'),('platform.contabilidad.approve'),('platform.contabilidad.change_status'),
  ('condominios.tab.ordenes_compra'),('condominios.tab.ordenes_compra.create'),('condominios.tab.ordenes_compra.edit'),('condominios.tab.ordenes_compra.approve'),('condominios.tab.ordenes_compra.change_status'),('condominios.tab.ordenes_compra.delete'))
SELECT u.full_name, u.role, u.activo, c.k,
       EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id=ur.role_id WHERE ur.user_id=u.id AND rp.permission_key=c.k AND rp.effect='allow' AND (ur.expires_at IS NULL OR ur.expires_at>now())) AS tiene_allow
  FROM public.app_users u CROSS JOIN claves c
 WHERE EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id=ur.role_id WHERE ur.user_id=u.id AND rp.permission_key=c.k AND rp.effect='allow')
 ORDER BY u.full_name, c.k;
-- resultado: solo Alexander (las 12 llaves de la lista: 6 de Contabilidad y 6 de la pestaña de órdenes) y Marco (solo la visibilidad de la pestaña de órdenes)
```

**`[Q14]`** Políticas RLS de las cinco tablas
```sql
SELECT tablename, policyname, cmd, roles::text, qual, with_check FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('ordenes_compra','recepciones','facturas_proveedor','ordenes_pago','contrasenas_pago')
 ORDER BY tablename, cmd, policyname;
```

**`[Q15]`** = `V-3` del script `scripts/propuesta-asignaciones-permisos-compras.sql` (matriz por persona, antes y después, con `edit`). Resultado del 2026-10-10: Alexander, antes «sí» en las 6 y después «sí» solo en la 1; Marco «sí → sí» en las 6.

**`[Q16]`** Definiciones en producción
```sql
SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('user_has_permission','get_user_permissions','user_is_project_exempt','conta_puede_escribir','conta_puede_leer','can_access_project','user_has_project_access')
 ORDER BY 1;
```

**`[Q17]`** Las cinco llaves no existen aún
```sql
SELECT key, category, label FROM public.permissions WHERE key LIKE 'platform.contabilidad.compras.%' ORDER BY key;   -- 0 filas
```

**`[Q18]`** Llaves relacionadas de las plantillas
```sql
SELECT r.name AS plantilla, rp.permission_key, rp.effect
  FROM public.roles r JOIN public.role_permissions rp ON rp.role_id=r.id
 WHERE r.is_system AND rp.permission_key IN ('platform.contabilidad.approve','platform.contabilidad.change_status','platform.contabilidad.edit','platform.contabilidad.create','platform.contabilidad.delete','platform.contabilidad.view','condominios.tab.ordenes_compra.approve','condominios.tab.ordenes_compra.change_status','condominios.tab.ordenes_compra.create','condominios.tab.ordenes_compra.edit','condominios.tab.ordenes_compra.delete','condominios.tab.ordenes_compra')
 ORDER BY 1,2;
```

**`[Q19]`** Titulares de los tres nombres de rol
```sql
SELECT 'persona_activa_con_rol_empresa_Finanzas' AS dato, count(DISTINCT ur.user_id)::text AS valor FROM public.user_roles ur JOIN public.app_users u ON u.id=ur.user_id AND u.activo JOIN public.roles r ON r.id=ur.role_id WHERE r.name='Finanzas / Contador' AND (ur.expires_at IS NULL OR ur.expires_at>now())
UNION ALL SELECT 'asignaciones_vigentes_a_copias_Admin_Plataforma_Administrador_General_Finanzas', count(*)::text FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE r.name IN ('Admin Plataforma','Administrador General','Finanzas / Contador') AND NOT r.is_system AND (ur.expires_at IS NULL OR ur.expires_at>now())
UNION ALL SELECT 'copias_por_empresa_con_linaje_a_plantillas_afectadas', count(*)::text FROM public.roles r WHERE r.cloned_from_role_id IN ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000001')
UNION ALL SELECT 'usuarios_inactivos_con_rol_Finanzas_Admin_Plataforma_Admin_General', count(DISTINCT ur.user_id)::text FROM public.user_roles ur JOIN public.app_users u ON u.id=ur.user_id AND NOT u.activo JOIN public.roles r ON r.id=ur.role_id WHERE r.name IN ('Admin Plataforma','Administrador General','Finanzas / Contador');
-- resultado: 1, 3, 3 y 0
```

**`[Q20]`** Asignaciones con vencimiento
```sql
SELECT r.name AS rol, r.is_system, ur.expires_at, ur.expires_at > now() AS vigente, u.role AS rol_app, u.activo,
       EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=r.id AND rp.permission_key IN ('platform.contabilidad.approve','platform.contabilidad.change_status','platform.contabilidad.edit','condominios.tab.ordenes_compra.approve')) AS rol_con_llaves_relacionadas
  FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id JOIN public.app_users u ON u.id=ur.user_id
 WHERE ur.expires_at IS NOT NULL;
```

**`[Q21]`** Documentos sin proyecto
```sql
SELECT 'ordenes_compra' AS tabla, count(*) AS total, count(*) FILTER (WHERE project_id IS NULL) AS sin_proyecto FROM public.ordenes_compra
UNION ALL SELECT 'recepciones', count(*), count(*) FILTER (WHERE project_id IS NULL) FROM public.recepciones
UNION ALL SELECT 'facturas_proveedor', count(*), count(*) FILTER (WHERE project_id IS NULL) FROM public.facturas_proveedor
UNION ALL SELECT 'contrasenas_pago', count(*), count(*) FILTER (WHERE project_id IS NULL) FROM public.contrasenas_pago
UNION ALL SELECT 'ordenes_pago', count(*), count(*) FILTER (WHERE project_id IS NULL) FROM public.ordenes_pago;
```

**`[Q22]`** Huellas y contadores (`V-1` y `V-4` del script)
```sql
SELECT u.full_name, u.role, count(*) AS proyectos, string_agg(p.nombre, '; ' ORDER BY p.nombre) AS lista, md5(string_agg(p.id::text, ',' ORDER BY p.id)) AS huella
  FROM public.app_users u JOIN public.user_project_assignments upa ON upa.user_id = u.id JOIN public.projects p ON p.id = upa.project_id
 WHERE u.id IN ('327ffeda-85e8-4ea4-9423-af9b206ee886', '86440f9d-e34b-49ba-91c7-3531ed365460') GROUP BY u.full_name, u.role ORDER BY u.full_name;
SELECT (SELECT count(*) FROM public.user_project_assignments) AS asignaciones_total,
       (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM public.user_project_assignments) AS huella_asignaciones,
       (SELECT count(*) FROM public.role_permissions) AS role_permissions_total, (SELECT count(*) FROM public.user_roles) AS user_roles_total,
       (SELECT count(*) FROM public.roles) AS roles_total,
       (SELECT count(*) FROM public.role_permissions WHERE permission_key LIKE 'platform.contabilidad.compras.%') AS concesiones_de_las_cinco_llaves;
-- resultado: Alexander 6 / 89b81779cee9b2b1b7aeaf4ad42362fb · Marco 3 / 1d3dc6bd1682b02e445d9cbe567fcc38 · 43 / d32daf1d38d862b1cdd938a59ad2ff5f · 3661 / 26 / 34 / 0
```

**`[Q23]`** Empresas
```sql
SELECT c.id, c.nombre, c.activa, c.created_at, (SELECT count(*) FROM public.app_users u WHERE u.company_id=c.id) AS usuarios, (SELECT count(*) FROM public.roles r WHERE r.company_id=c.id) AS roles, (SELECT count(*) FROM public.projects p WHERE p.company_id=c.id) AS proyectos
  FROM public.companies c ORDER BY c.created_at;
```

**`[Q24]`** El `audit_log` genérico no cubre el circuito
```sql
SELECT table_name, count(*) AS n, count(*) FILTER (WHERE actor_id='327ffeda-85e8-4ea4-9423-af9b206ee886') AS alexander, count(*) FILTER (WHERE actor_id='86440f9d-e34b-49ba-91c7-3531ed365460') AS marco, min(occurred_at) AS desde, max(occurred_at) AS hasta
  FROM public.audit_log GROUP BY 1 ORDER BY 2 DESC LIMIT 40;
-- 4 tablas: cuotas_condominio (29), tickets_mantenimiento (26), subscriptions (2), companies (2); filtrando por ~ '(ordenes_compra|orden_compra|recepcion|facturas_proveedor|ordenes_pago|contrasenas|conta_asientos|proveedores|compras)' → 0 filas
```

**`[Q25]`** Claves para `ON CONFLICT`, llaves foráneas y predicado de los bloques del script
```sql
SELECT conrelid::regclass::text AS tabla, conname, contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid IN ('public.role_permissions'::regclass, 'public.user_roles'::regclass, 'public.roles'::regclass) AND contype IN ('p','u','f','c') ORDER BY 1, 3, 2;
-- role_permissions_pkey (role_id, permission_key) · user_roles_pkey (user_id, role_id) · FK role_permissions.permission_key → permissions(key) · UNIQUE (company_id, name) en roles · índice único parcial idx_roles_user_override (user_override_for)
WITH u AS (
  SELECT id, company_id, full_name FROM public.app_users
   WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND role = 'operator' AND activo AND company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31'
), r0 AS (SELECT r.id FROM public.roles r JOIN u ON r.user_override_for = u.id)
SELECT u.id, 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')' AS nombre_rol_que_se_crearia,
       (SELECT count(*) FROM r0) AS roles_de_ajustes_existentes,
       (SELECT count(*) FROM public.roles x WHERE x.company_id = u.company_id AND x.name = 'Ajustes individuales — ' || u.full_name || ' (' || left(u.id::text, 8) || ')') AS choque_de_nombre
  FROM u;
-- resultado: 1 fila, «Ajustes individuales — Alexander Monterroso (327ffeda)», 0 roles de ajustes previos, 0 choques de nombre
```

**`[Q26]`** Políticas y disparadores de `role_permissions`
```sql
SELECT 'policy' AS tipo, policyname AS nombre, cmd AS detalle FROM pg_policies WHERE schemaname='public' AND tablename='role_permissions'
UNION ALL
SELECT 'trigger', t.tgname, pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgrelid='public.role_permissions'::regclass AND NOT t.tgisinternal
ORDER BY 1,2;
-- resultado: role_permissions_delete (DELETE), role_permissions_insert (INSERT), role_permissions_select (SELECT); trg_audit_role_permissions AFTER INSERT OR DELETE
```

**`[Q27]`** Homónimos y empresas de nombre casi igual (2026-10-11)
```sql
SELECT u.full_name, u.role, COALESCE(c.nombre, '(sin empresa)') AS empresa, u.activo
  FROM public.app_users u LEFT JOIN public.companies c ON c.id = u.company_id
 WHERE u.full_name ILIKE '%Santos%' OR u.full_name ILIKE '%Monterroso%' OR u.full_name ILIKE '%Marco%' ORDER BY u.full_name;
SELECT c.nombre, (SELECT count(*) FROM public.app_users x WHERE x.company_id = c.id) AS usuarios, (SELECT count(*) FROM public.roles r WHERE r.company_id = c.id) AS roles, (SELECT count(*) FROM public.projects p WHERE p.company_id = c.id) AS proyectos
  FROM public.companies c ORDER BY c.created_at;
SELECT u.role, u.full_name FROM public.app_users u WHERE u.role IN ('company_owner', 'super_admin', 'superadmin');
-- resultado: «Santos» → Eduardo Santos (viewer, Prestadora de Servicios S.A.), Marco Santos (cliente, sin empresa), Marco Santos Godoy (admin); «Monterroso» → Alex Monterroso (cliente), Alexander Monterroso (operator), Isabel Monterroso (cliente)
--   empresas: Mi Empresa Agua S.A. 0/0/0 · Mi Empresa 1/0/0 · Prestadora de Servicios S.A. 22/18/8 · g&e 0/0/0 · Prestadora de Servicios 0/0/0; la cuenta propietaria se llama «Prestadora de Servicios Básicos S.A.»
```

**`[Q28]`** Filas de asignación contra personas reales, por proyecto (2026-10-11)
```sql
SELECT p.nombre, count(*) AS filas_asignacion, count(*) FILTER (WHERE u.id IS NULL) AS huerfanas, count(DISTINCT u.id) AS personas_reales,
       count(DISTINCT u.id) FILTER (WHERE u.role = 'operator') AS operators, count(DISTINCT u.id) FILTER (WHERE u.role = 'viewer') AS viewers, count(DISTINCT u.id) FILTER (WHERE u.role = 'admin') AS admins
  FROM public.user_project_assignments a JOIN public.projects p ON p.id = a.project_id LEFT JOIN public.app_users u ON u.id = a.user_id
 GROUP BY p.nombre ORDER BY filas_asignacion DESC, p.nombre;
SELECT count(*) AS filas_total, count(*) FILTER (WHERE u.id IS NULL) AS huerfanas, count(DISTINCT a.user_id) FILTER (WHERE u.id IS NULL) AS usuarios_huerfanos,
       (SELECT md5(string_agg(id::text, ',' ORDER BY id)) FROM public.user_project_assignments) AS huella
  FROM public.user_project_assignments a LEFT JOIN public.app_users u ON u.id = a.user_id;
-- resultado: 21B+ 13/4/9 · Edificio SQ 12/2/10 · Parajes Vermont 6/1/5 · Cascadas de Vista Hermosa 5/2/3 (3 operators) · Viñas del Sur Condominio 3 4/1/3 (1 operator, 2 viewers) · La Arboleda CVH 3/0/3 (3 operators); total 43 filas, 10 huérfanas, 6 usuarios, huella d32daf1d38d862b1cdd938a59ad2ff5f
```

**`[Q29]`** Qué exige HOY el servidor en producción, y quién tiene `edit`/`approve`/`change_status` (2026-10-11)
```sql
SELECT (SELECT max(version) FROM supabase_migrations.schema_migrations) AS max_migracion,
       (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version >= '20261027') AS versiones_ge_20261027,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (p.proname LIKE 'compras\_exigir%' OR p.proname LIKE 'compras\_tg\_permiso%' OR p.proname = 'compras_sesion_usuario')) AS funciones_exigir,
       (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname LIKE 'compras\_tg\_permiso%') AS triggers_permiso;
WITH tg AS (SELECT DISTINCT p.oid AS fn, p.proname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname IN ('ordenes_compra','recepciones','facturas_proveedor','ordenes_pago','contrasenas_pago'))
SELECT (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname IN ('ordenes_compra','recepciones','facturas_proveedor','ordenes_pago','contrasenas_pago')) AS triggers_no_internos,
       (SELECT string_agg(proname, ', ') FROM tg WHERE pg_get_functiondef(fn) ~ '(contabilidad\.approve|contabilidad\.change_status|ordenes_compra\.approve)') AS funciones_que_mencionan_approve_change_status,
       (SELECT string_agg(proname, ', ') FROM tg WHERE pg_get_functiondef(fn) ~ '(user_has_permission|conta_puede_escribir)') AS funciones_que_consultan_permisos,
       (SELECT string_agg(tablename || '.' || policyname, ', ') FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('ordenes_compra','recepciones','facturas_proveedor','ordenes_pago','contrasenas_pago') AND cmd = 'UPDATE' AND (qual ~ '(approve|change_status)' OR with_check ~ '(approve|change_status)')) AS politicas_update_que_las_mencionan;
-- y, tal cual, el CTE `perfiles` y la rama `perfil_afectado` de scripts/diagnostico-compras-controles.sql, más conteos de quién tiene edit / approve / change_status
-- resultado: max_migracion 20261026000500; 0 versiones ≥ 20261027; 0 funciones compras_exigir*/compras_tg_permiso*/compras_sesion_usuario; 0 disparadores compras_tg_permiso_*; 31 disparadores no internos en las 5 tablas, ninguna de sus funciones menciona approve/change_status ni consulta user_has_permission/conta_puede_escribir; 0 políticas UPDATE que las mencionen (piden solo conta_puede_escribir('edit') o user_has_permission('platform.contabilidad.edit'), ver [Q14])
--   perfil_afectado: 0 filas · personas activas no exentas ni admin: 29 (30 con Marco) · con edit: 1 · con approve: 1 · con change_status: 1 · con las tres: 1 (Alexander Monterroso, operator)
--   (esta lectura solo vio 4 funciones públicas que consultan platform.contabilidad.change_status: banco_conciliar_movimiento, banco_desconciliar_movimiento, conta_anular_asiento, conta_publicar_asiento; la lista COMPLETA son 15, en [Q31])
```

**`[Q31]`** Todas las funciones públicas que consultan `change_status` o `approve` de Contabilidad (2026-10-11, segunda revisión)
```sql
SELECT p.proname, p.prosecdef AS definer, (p.prorettype = 'trigger'::regtype) AS es_trigger,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS exec_authenticated,
       (p.prosrc ~ 'conta_puede_escribir\(\s*''change_status''' OR p.prosrc ~ 'platform\.contabilidad\.change_status') AS change_status,
       (p.prosrc ~ 'conta_puede_escribir\(\s*''approve''' OR p.prosrc ~ 'platform\.contabilidad\.approve') AS approve
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND (p.prosrc ~ 'conta_puede_escribir\(\s*''(change_status|approve)''' OR p.prosrc ~ 'platform\.contabilidad\.(change_status|approve)')
 ORDER BY es_trigger, p.proname;
-- resultado: 15 filas. change_status (14): banco_conciliar_movimiento, banco_desconciliar_movimiento, compras_oc_excepcion_contrato, conta_anular_asiento, conta_cargos_pendientes, conta_facturas_pendientes, conta_incidencia_resolver,
--   conta_publicar_asiento, conta_reprocesar_cargo, conta_reprocesar_factura_proveedor, conta_saldos_favor, conta_sf_autorizar (INVOKER; no ejecutable por authenticated) y los dos disparadores cxp_tg_proveedor_estado (tabla proveedores)
--   y proveedor_proyectos_tg (tabla proveedor_proyectos). approve (1): conta_ajuste_bloquear_para_revision (no ejecutable por authenticated). 11 son ejecutables por authenticated, todas SECURITY DEFINER.
-- Una búsqueda más ancha, prosrc ILIKE '%change_status%', añade 5 funciones agua_* (agua_cerrar_ciclo, agua_factura_anular, agua_factura_emitir, agua_registro_cambiar_estado, agua_registro_marcar_mora) que consultan las llaves
--   'agua.cobros.change_status' y 'agua.lecturas.change_status' del módulo de agua: no son las de Contabilidad y no entran.
-- Texto de compras_oc_excepcion_contrato (SELECT prosrc FROM pg_proc WHERE proname = 'compras_oc_excepcion_contrato'): exige sesión, etapa «aprobar» o «emitir», motivo de 10+ caracteres, orden en la empresa/proyecto de la sesión,
--   conta_puede_escribir('change_status'), contrato ligado y estado borrador/aprobada; rechaza la autoautorización SOLO si compras_config.aprobacion_separada está activa (COMPRAS_EXCEPCION_AUTOAUTORIZACION); inserta en orden_compra_excepciones y orden_compra_eventos.
```

**`[Q32]`** Quién asignó el rol a Alexander (bitácora) y cuánto tiempo lleva sin sesión (2026-10-11, segunda revisión)
```sql
SELECT a.occurred_at, a.action, a.actor_id, (SELECT u.full_name || ' / ' || u.role FROM public.app_users u WHERE u.id = a.actor_id) AS actor, a.target_user_id
  FROM public.permission_audit_log a
 WHERE a.target_role_id = 'd915897c-b350-431a-8447-b37c61f97e8a' AND a.action IN ('assign_role','remove_role','update_role','create_role') ORDER BY a.occurred_at;
SELECT ur.assigned_at, ur.assigned_by FROM public.user_roles ur WHERE ur.user_id = '327ffeda-85e8-4ea4-9423-af9b206ee886';
SELECT last_sign_in_at, now() AS ahora, round((extract(epoch from now() - last_sign_in_at) / 86400)::numeric, 2) AS dias_transcurridos, (now()::date - last_sign_in_at::date) AS dias_de_calendario
  FROM auth.users WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886';
-- resultado: create_role y assign_role originales 2026-06-12 17:36:18.803843 sin actor; remove_role 2026-08-13 21:43:29.321768, update_role 21:52:53.726843, assign_role 21:52:57.828331 (= user_roles.assigned_at) y update_role 21:54:46.234765,
--   todos con actor = la cuenta propietaria (company_owner); user_roles.assigned_by = NULL. last_sign_in_at 2026-08-13 21:54:15 UTC; a las 05:06 UTC del 2026-10-11: 58,30 días transcurridos y 59 de calendario.
```

**`[Q30]`** Reparto de las 1 193 llaves, último acceso de Alexander, siembra de copias y documentos sin proyecto (2026-10-11)
```sql
SELECT count(*) FILTER (WHERE actor_id IS NOT NULL) AS con_actor, min(occurred_at) FILTER (WHERE actor_id IS NOT NULL) AS desde_con_actor, max(occurred_at) FILTER (WHERE actor_id IS NOT NULL) AS hasta_con_actor,
       count(*) FILTER (WHERE actor_id IS NULL) AS sin_actor, min(occurred_at) FILTER (WHERE actor_id IS NULL) AS desde_sin_actor, max(occurred_at) FILTER (WHERE actor_id IS NULL) AS hasta_sin_actor
  FROM public.permission_audit_log WHERE target_role_id = 'd915897c-b350-431a-8447-b37c61f97e8a' AND action = 'grant_permission';
SELECT (SELECT last_sign_in_at FROM auth.users WHERE id = '327ffeda-85e8-4ea4-9423-af9b206ee886') AS last_sign_in_at,
       (SELECT count(*) FROM auth.sessions WHERE user_id = '327ffeda-85e8-4ea4-9423-af9b206ee886') AS sesiones,
       (SELECT max(last_seen) FROM public.user_presence WHERE user_id = '327ffeda-85e8-4ea4-9423-af9b206ee886') AS last_seen,
       (SELECT max("timestamp") FROM public.security_logs WHERE user_id = '327ffeda-85e8-4ea4-9423-af9b206ee886' AND event_type = 'login_success') AS ultimo_login, now() AS ahora;
SELECT r.name, left(r.id::text, 8), r.created_at FROM public.roles r WHERE r.company_id = '24aad0e6-e4fe-4d9a-810b-f2bf3aa61a31' AND r.name IN ('Finanzas / Contador','Admin Plataforma','Administrador General','Admin Agua');
-- Q21 repetida: documentos sin proyecto
-- resultado: 1 106 con actor, todas en 2026-08-13 21:52:53.879461+00; 87 sin actor entre 2026-06-12 17:36:18.803843 y 2026-09-10 17:38:27.732876 (1 106 + 87 = 1 193); último acceso 2026-08-13 21:54:15 (UTC), 0 sesiones, last_seen 2026-08-13 21:58:15, 12 login_success hasta 21:54:17 y 3 logout hasta 21:58:26; a «ahora» (2026-10-11 01:04 UTC) la diferencia de fechas de calendario era 59, pero el tiempo transcurrido era de 58,1 días (58,3 a las 05:06 UTC, `[Q32]`); las cuatro copias de empresa de Alexander y Marco: created_at 2026-06-12 17:36:18.803843; 0 documentos sin proyecto de 2; Alexander 6 / 89b81779cee9b2b1b7aeaf4ad42362fb y Marco 3 / 1d3dc6bd1682b02e445d9cbe567fcc38; 3 661-26-34 en role_permissions-user_roles-roles; catálogo 1 201, 0 llaves nuevas
```

**Archivos del repositorio leídos:** `supabase/migrations/20260817000000_set_role_permissions_rpc.sql`, `20260612100000_roles_template_lineage.sql`, `20260612100100_roles_user_override.sql`, `20260612100300_rbac_assignments_to_company_roles.sql`, `20260518000004_rbac_schema.sql` y `20260518000008_rbac_helpers_and_sync.sql` (políticas y bitácora de roles), `20261027000300_…` y `20261027000900_…` (la cadena que ya exige `approve`/`change_status`, la comprobación común y las seis llaves), `20261021000600_compras_correcciones_revision.sql` (la regla del interruptor), `src/domain/empresa/roles.ts` (`ensureCompanyRoleFromTemplate`, `createOverrideRole`, `setRolePermissions`), `src/components/empresa/RolPermisosModal.tsx` y `EmpresaUsuariosSection.tsx` (el flujo de la pantalla), `src/lib/platformPermissions.ts` (el grupo «Plataforma: Compras y pagos») y `supabase/functions/create-user/validate.ts` y `accept-invitation/validate.ts` (la plantilla de plataforma que se asigna según el perfil).
