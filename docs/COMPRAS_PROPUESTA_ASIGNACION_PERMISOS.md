# Compras · propuesta de asignación de permisos (Alexander Monterroso y plantillas)

> **Lecturas de producción del 2026-10-10 · SOLO LECTURA.** Cada cifra de este documento sale de un `SELECT` contra producción (`nnsqmeigtgewatameexo`) y la consulta que la produjo está citada (`[Q#]`, texto completo en el **Apéndice**). **No se escribió nada** en producción, en el sandbox ni en la base de preview, y **este documento no concede ningún permiso**: es la propuesta que una persona con autoridad debe aceptar o rechazar con las decisiones de §7. Se refiere a la migración `20261027000900` del PR #926 (en **borrador**), que por diseño **no concede ninguna llave** a nadie. La propuesta ejecutable, siempre comentada y con `ROLLBACK` por defecto, es `scripts/propuesta-asignaciones-permisos-compras.sql`.

## 0. Lectura rápida

| Pregunta | Respuesta |
|---|---|
| ¿Se concedió algo? | **No.** Ni a personas, ni a roles, ni a plantillas. |
| ¿Quién pierde acciones al aplicar la 0900? | **1 persona** (Alexander Monterroso: pierde 5 de las 6 acciones y conserva «aprobar orden de compra»), **2 plantillas de sistema** («Admin Plataforma» y «Finanzas / Contador», sin ninguna persona asignada) y **1 rol de empresa** (la copia «Finanzas / Contador» de Prestadora de Servicios S.A., con 1 persona: Alexander) `[Q1]`. **Gana** 1 plantilla («Administrador General», acción 1, sin efecto práctico: §4) |
| ¿Quién más puede las seis acciones sin ninguna llave? | **3 cuentas por perfil:** Marco Santos Godoy (`admin`, solo en sus 3 proyectos), la cuenta propietaria (`company_owner`) y el superadministrador (`super_admin`), estas dos sin límite de proyecto `[Q7]`. Ninguna llave les quita nada |
| ¿Hay uso real de las seis acciones? | **Prácticamente no.** 1 orden de compra histórica sin autor; 1 factura (anulada) creada y aprobada por la cuenta propietaria con 10,5 s de diferencia; **0** recepciones, órdenes de pago, contraseñas, pagos y asientos. Alexander **no figura como autor de ninguna fila de negocio** y su último inicio de sesión registrado es del 2026-08-13 `[Q8–Q11]` (§3) |
| Propuesta recomendada | A Alexander: **conceder** `recepcion_registrar`, `factura_aprobar` y `orden_pago_aprobar`; **no conceder** `pago_ejecutar` ni `pago_anular`. Plantillas y rol de empresa: **no conceder nada ahora**. La concesión, desde el panel «Ajustes individuales», **después** del despliegue de la 0900 (§5, §6) |
| Alternativa | «Continuidad total» = lo que Alexander puede hoy: las **cinco** llaves. La diferencia con la recomendada es **exactamente dos llaves**: `pago_ejecutar` y `pago_anular` |
| Proyectos | Las concesiones **no tocan** `user_project_assignments`: Alexander conserva sus 6 proyectos y Marco sus 3 (§6.4) |
| Hallazgos inesperados | (1) el rol de empresa de Alexander tiene **1 193 de las 1 201 llaves** del catálogo (la plantilla, 63), concedidas en bloque el 2026-08-13; (2) «Monterroso» coincide con **3 cuentas** y la propuesta anterior filtraba por nombre; (3) las copias de empresa son fotografías: no se refrescan; (4) nada impide aprobar una factura que uno mismo creó (solo existe esa regla para la orden de compra, y apagada). Detalle en §9 |

---

## 1. Qué exige el servidor a cada acción

Fuente: `supabase/migrations/20261027000900_…` (comprobación común `compras_exigir_permiso`: empresa → permiso → proyecto), las políticas RLS de producción `[Q14]` y las definiciones de las funciones en producción `[Q16]`.

| # | Acción | Llave que exige la 0900 | Llave que exigía antes (0300/0700) | Transición que protege |
|---|---|---|---|---|
| 1 | Aprobar orden de compra | `condominios.tab.ordenes_compra.approve` (ya existía) | `platform.contabilidad.approve` | borrador → aprobada; devolver una aprobada; nacer aprobada o emitida |
| 2 | Registrar recepción | `platform.contabilidad.compras.recepcion_registrar` (nueva) | `platform.contabilidad.change_status` | borrador → registrada |
| 3 | Aprobar factura de proveedor | `platform.contabilidad.compras.factura_aprobar` (nueva) | `platform.contabilidad.approve` | registrada → aprobada |
| 4 | Aprobar orden de pago | `platform.contabilidad.compras.orden_pago_aprobar` (nueva) | `platform.contabilidad.approve` | borrador → aprobada (reserva lo que se va a pagar) |
| 5 | Ejecutar pago | `platform.contabilidad.compras.pago_ejecutar` (nueva) | `platform.contabilidad.change_status` | aprobada → pagada (contabiliza el egreso) |
| 6 | Anular pago | `platform.contabilidad.compras.pago_anular` (nueva) | `platform.contabilidad.change_status` | cualquier estado → anulada, **también una ya pagada** (reversa el egreso) |

* **Además de la llave de la acción hace falta `platform.contabilidad.edit`**, porque la política `UPDATE` de las cuatro tablas del circuito la exige y la 0900 no la toca: `ordenes_compra` y `recepciones` por `conta_puede_escribir('edit')` (que es `super_admin`, `company_owner`/`admin` **o** `user_has_permission('platform.contabilidad.edit')`) y `facturas_proveedor` y `ordenes_pago` por `user_has_permission('platform.contabilidad.edit')` `[Q14, Q16]`. La columna «edit» de las tablas siguientes refleja esa llave. Nacer ya aprobada/emitida exige además `create` (o el perfil `operator`) en el `INSERT`.
* **Reglas de evaluación** (definición de `user_has_permission` en producción `[Q16]`): los perfiles `super_admin`, `superadmin`, `company_owner` y `admin` **pasan toda llave**; para el resto, un `deny` en un rol vigente **gana** a cualquier `allow`; una asignación con `expires_at` vencido **no cuenta**. La función **no mira `app_users.activo`**.
* **Proyecto:** `can_access_project(p)` es verdadero si `p` es `NULL`, si la persona es **exenta** (`super_admin`, `superadmin`, `company_owner`, o `admin` **sin** filas en `user_project_assignments`) o si el proyecto está asignado `[Q16]`. Un `admin` **con** asignaciones (Marco) pasa por perfil pero solo en los suyos.
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
| Roles asignados (`user_roles`) | **1:** «Finanzas / Contador» de la empresa (`d915897c-b350-431a-8447-b37c61f97e8a`), clonado de la plantilla `00000000-0000-0000-0000-000000000003`, `service = condominios`, asignado el 2026-08-13 21:52:57 sin autor, **sin vencimiento**, 1 193 `allow` y 0 `deny` | **3**, todos de la empresa, sin vencimiento, 0 `deny`: «Admin Agua» (66 `allow`, clon de `…0101`), «Admin Plataforma» (90, clon de `…0201`) y «Administrador General» (189, clon de `…0001`) |
| Rol de ajustes individuales | **no tiene** (hay 0 en toda la base) | no tiene |

**El nombre no identifica:** `full_name ILIKE '%Monterroso%'` devuelve **3 cuentas** (Alexander Monterroso `operator`; Alex Monterroso e Isabel Monterroso, `cliente`, sin empresa) `[Q2]`. Por eso el script usa el **id** y exige perfil, empresa y estado.

### 2.2 Las llaves relacionadas de Alexander `[Q4a, Q4b, Q4c, Q5]`

Su rol de empresa tiene `allow` (y ningún `deny`) en las 48 llaves de Contabilidad/compras que se consultaron:

* `platform.contabilidad.{view, create, edit, delete, approve, change_status}` — las **seis**;
* `condominios.tab.ordenes_compra` y `.{approve, change_status, create, delete, edit}` — las **seis** (incluida la que exige la 0900 para la acción 1);
* las seis de cada una de estas pestañas: `condominios.tab.contabilidad`, `presupuesto`, `comparativo_presupuesto`, `plan_pago`, `proveedores` y `eval_proveedor` (36).

No tiene ninguna de las cinco llaves nuevas: **no existen todavía en el catálogo de producción** (0 filas `platform.contabilidad.compras.%` en `permissions`) y hay **0 concesiones** en `role_permissions` `[Q17, Q22]`. Del catálogo de 1 201 llaves `[Q7b]`, a ese rol le faltan solo 8 (`agua.{contadores,dashboard,lecturas,rutas,tabla,tarifas}.delete`, `condominios.areas.manage`, `platform.clientes.delete`) `[Q4b]`.

> **Hallazgo.** La plantilla de sistema «Finanzas / Contador» trae **63** llaves `allow` y la copia de Alexander **1 193**. La bitácora `permission_audit_log` muestra **1 106 `grant_permission` en el mismo segundo** (2026-08-13 21:52:53) hechos por la **cuenta propietaria** de la empresa, más 2 `update_role` entre las 21:52 y las 21:54 `[Q5]`; las otras 87 tienen el actor vacío (copia de la plantilla y migraciones de catálogo, del 2026-06-12 al 2026-09-10). En la práctica el rol es «casi todo el catálogo»: las llaves que decide esta propuesta son una parte pequeña de lo que ese rol ya le da. No se propone aquí recortarlo (decisión A-6).

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

### 2.6 Proyectos `[Q12]`

| Proyecto | Alexander | Marco | Personas asignadas | OC / facturas |
|---|---|---|---|---|
| 21B+ | sí | sí | 13 | 1 / 1 |
| Edificio SQ | sí | sí | 12 | 0 / 0 |
| Parajes Vermont | sí | sí | 6 | 0 / 0 |
| Cascadas de Vista Hermosa | sí | **no** | 5 | 0 / 0 |
| La Arboleda CVH | sí | **no** | 3 | 0 / 0 |
| Viñas del Sur Condominio 3 | sí | **no** | 4 | 0 / 0 |
| «test» (suspendido) | no | no | 0 | 0 / 0 |
| «VSC General» | no | no | 0 | 0 / 0 |

Los 3 proyectos de Marco están dentro de los 6 de Alexander. En **Cascadas de Vista Hermosa, La Arboleda CVH y Viñas del Sur Condominio 3** la única persona no exenta con alcance es Alexander; ahí cualquier acción que él no tenga solo la pueden hacer la cuenta propietaria o el superadministrador.

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

* **Alexander:** barrido de todas las columnas `uuid` de autoría de las tablas base de `public` (`created_by`, `creado_por`, `*_por`, `actor*`, `updated_by`, `user_id`, `registrado*`, `solicitad*`, `aprobad*`, `recibid*`, `pagad*`, `autoriz*`): **0 filas de negocio** a su nombre. Solo aparece en `security_logs` (15), `permission_audit_log` como destinatario (15), `user_notifications` (13), `user_project_assignments` (6), `user_roles` (1) y `user_presence` (1). `security_logs`: **12** inicios de sesión entre 2026-06-15 y 2026-08-13 21:54 y 3 cierres (el último 2026-08-13 21:58); **ningún inicio de sesión registrado después del 2026-08-13** (58 días a la fecha de la lectura).
* **Marco:** 36 inicios de sesión hasta 2026-09-30; filas a su nombre solo en reservas de amenidades (11 creadas, 10 aprobadas), cuotas de condominio (7), reservas STR (7) y 1 unidad: **ninguna del circuito de compras**.

**Límites de esta evidencia:** el `audit_log` genérico **no cubre** las tablas del circuito (solo `cuotas_condominio`, `tickets_mantenimiento`, `subscriptions` y `companies`) `[Q24]`; el barrido ve columnas `uuid` con nombres de autoría, no autoría guardada con otros nombres o como texto; y `security_logs` registra lo que registra (un acceso por otro camino no aparecería). Lo que sí es concluyente: **las tablas del circuito casi no tienen filas**, así que no hay historia que demuestre quién usa cada acción.

---

## 4. (A) Tabla exacta: HOY → DESPUÉS DE LA 0900 SIN CONCEDER → PROPUESTA

Cada celda se lee **HOY (antes de la 0900) → DESPUÉS DE LA 0900 sin conceder → PROPUESTA**. «HOY» y «DESPUÉS» son las columnas del diagnóstico `[Q1]` (llave genérica contra llave de la acción, **más** `platform.contabilidad.edit` para las personas; para roles y plantillas se mide solo la llave, y `edit` va en su columna). Propuesta: **CONCEDER** · **NO CONCEDER** · **YA LO TIENE**. La columna `edit` es la llave `platform.contabilidad.edit`, imprescindible para las seis (§1).

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
2. **Alexander · 2 Recepción (CONCEDER):** es una acción de su función que hoy hace con `change_status`, no amplía lo que hoy puede, y en 3 de sus 6 proyectos nadie más con alcance parcial podría hacerla (§2.6).
3. **Alexander · 3 Factura (CONCEDER):** aprobar la factura es el núcleo de un rol «Finanzas / Contador» y hoy lo hace con `approve`; concederla mantiene la continuidad sin ampliar nada respecto de hoy.
4. **Alexander · 4 Orden de pago (CONCEDER):** aprobar la orden prepara y reserva lo que se va a pagar pero **no mueve dinero**; mantiene su flujo de preparación y deja el paso de salida de dinero a otra mano.
5. **Alexander · 5 Pago y 6 Anular (NO CONCEDER en la recomendada):** son los dos pasos en que sale o se revierte dinero (anular alcanza incluso un pago ya hecho), no hay un solo uso demostrado en producción (0 órdenes de pago) y retenerlas pone a una segunda cuenta —administrador o propietario— antes de que el dinero salga; se conceden en un minuto desde el panel si se decide lo contrario (en la alternativa «continuidad total» sí se conceden, igual que hoy).
6. **Alexander · edit (YA LO TIENE):** sin esta llave ninguna de las seis acciones funciona (política `UPDATE`); ya la tiene y no se toca.
7. **Rol de empresa «Finanzas / Contador» (NO CONCEDER):** concederle una llave se la da a quien lo tenga mañana, y editarlo desde la pantalla reemplazaría el conjunto completo de 1 193 llaves (`set_role_permissions`); lo propuesto va a la persona, no al rol.
8. **Plantilla «Finanzas / Contador» (NO CONCEDER ahora):** tiene 0 personas, solo llega a copias futuras (la copia de Alexander ya existe y no se refresca), no se copia sola a empresas nuevas y la pantalla no la edita; se decide cuando haya una segunda empresa o se asigne a otra persona (A-2.1).
9. **Plantilla «Admin Plataforma» (NO CONCEDER):** es la plantilla que las funciones de borde asignan a los nuevos `admin`, que pasan toda llave por su perfil, así que concederle llaves no cambia a nadie; y su copia en la empresa —la de Marco— ya no tenía las llaves genéricas y no las necesita.
10. **Plantilla «Administrador General» (YA LO TIENE en la acción 1):** la «ganancia» viene de la propia plantilla, que ya traía la llave de la pestaña; sin `platform.contabilidad.edit` (que no trae) no puede aprobar nada y no tiene personas; no se concede nada más.
11. **Copias «Admin Plataforma» y «Administrador General»:** sin cambio (no → no); Marco pasa por su perfil `admin`.
12. **Las otras 13 plantillas y 15 roles:** no tienen ninguna de las cuatro llaves; no cambian.
13. **Marco, cuenta propietaria y superadministrador (YA LO TIENEN):** pasan toda llave por su perfil y ninguna asignación los toca; Marco sigue limitado a sus 3 proyectos.

**Alternativa «continuidad total»** — idéntica salvo para Alexander: las celdas 5 y 6 pasan a **CONCEDER**. Con ella el diagnóstico de la persona sale «sí → sí» en las seis.

---

## 5. (B) Recomendación

### 5.1 Criterio (explícito)

1. **Mínimo privilegio.** Se concede solo lo que (a) corresponde a la función demostrada de la persona y (b) **no amplía** nada de lo que hoy puede. Como en producción **nadie** ha usado las acciones nuevas (§3), la prueba para conceder es la función, no el historial; y lo que no es indispensable queda sin conceder, porque conceder es reversible en un minuto y un pago no.
2. **Continuidad operativa.** No dejar sin camino una acción que hoy solo Alexander puede hacer en un proyecto concreto. Ya hay tres proyectos (Cascadas de Vista Hermosa, La Arboleda CVH y Viñas del Sur Condominio 3) donde él es la única persona no exenta con alcance (§2.6); las cuentas exentas (propietaria y superadministrador) siempre pueden.
3. **Separación de funciones real, sin inventar nada.** Se reparte *qué llave tiene quién*; **no** se escribe ninguna prohibición entre personas ni umbral por monto. Las llaves solo pueden separar a Alexander de las tres cuentas que pasan por perfil: a estas no se les puede quitar ninguna.

### 5.2 La propuesta recomendada

* **Alexander:** CONCEDER `recepcion_registrar`, `factura_aprobar`, `orden_pago_aprobar`. NO CONCEDER `pago_ejecutar` ni `pago_anular`.
* **Rol de empresa «Finanzas / Contador», plantillas «Finanzas / Contador», «Admin Plataforma» y «Administrador General», demás roles:** no conceder nada (A-2). Marco: nada.
* **Cómo:** por el rol de «Ajustes individuales» de Alexander, desde el panel, **después** del despliegue de la 0900 (§6).

**Quién puede qué después de la propuesta recomendada:**

| Acción | Alexander (6 proyectos) | Marco (3 proyectos) | Cuenta propietaria y superadministrador (todos) |
|---|---|---|---|
| 1 Aprobar orden de compra | sí | sí | sí |
| 2 Registrar recepción | sí | sí | sí |
| 3 Aprobar factura | sí | sí | sí |
| 4 Aprobar orden de pago | sí | sí | sí |
| 5 Ejecutar pago | **no** | sí | sí |
| 6 Anular pago | **no** | sí | sí |

Ejecutar y anular pagos queda en **21B+, Edificio SQ y Parajes Vermont** para Marco, la cuenta propietaria y el superadministrador, y en **Cascadas de Vista Hermosa, La Arboleda CVH, Viñas del Sur Condominio 3, «test» y «VSC General»** solo para la cuenta propietaria y el superadministrador (Marco no está asignado).

### 5.3 Qué concentración queda si Alexander es la única persona de finanzas

* **Con la recomendada:** Alexander puede, **él solo**, llevar una compra desde la orden de compra aprobada hasta una **orden de pago aprobada** (acciones 1 a 4: aprobar la orden, registrar la recepción, aprobar la factura, aprobar la orden de pago), y no puede ejecutar ni anular el pago. Lo que sí queda es una **concentración en una persona de cuatro aprobaciones**: quien aprueba la factura y quien aprueba la orden de pago es la misma persona, y las llaves no pueden separarlo mientras él sea el único no administrador con ellas. El control que se gana es uno solo, y está donde sale el dinero: ejecutar el pago exige a otra cuenta.
* **Con la alternativa «continuidad total» (las cinco):** puede hacer las **seis** y, siendo `operator`, además **crear** la orden de compra: el ciclo completo, de la creación al pago y su anulación, **sin ninguna segunda persona** (que es exactamente lo que ocurre hoy).
* **Quienes pasan por perfil** (Marco en sus 3 proyectos, la cuenta propietaria y el superadministrador) pueden las seis acciones y **ninguna llave los frena**. Un caso real lo muestra: la única factura de producción la **creó y la aprobó la cuenta propietaria con 10,5 s de diferencia** y el servidor lo permitió, porque para la factura no existe ninguna regla entre personas.
* **Lo que mitiga el interruptor `aprobacion_separada` y lo que no.** Apagado (hoy, y en todas las empresas), quien crea una orden puede aprobarla: Alexander, siendo `operator`, puede **crear y aprobar** su propia orden. Encendido, el servidor rechaza solo ese caso (`created_by = auth.uid()` al pasar de borrador a aprobada o al nacer aprobada, `COMPRAS_OC_AUTOAPROBACION`), y solo para la acción 1. **No mitiga** recepción, factura, orden de pago, pago ni anulación; **no** frena a una orden sin autor (`created_by` vacío); y los procesos de sistema (`service_role`) pueden cambiarlo con rastro. Encenderlo tiene un costo concreto: como Alexander es el único no administrador con la llave de aprobar órdenes, las que él mismo cree las tendría que aprobar Marco (en sus 3 proyectos) o la cuenta propietaria/superadministrador (en los otros). Hoy, mientras ningún otro `operator` tenga la llave, las órdenes creadas **por otras personas** ya las aprueba de hecho alguien distinto de quien las crea. Encenderlo no se recomienda ni se desaconseja aquí (A-7).

**Costo de la recomendada, dicho sin adornos:** en los tres proyectos donde solo Alexander tiene alcance, pagar y anular depende de la cuenta propietaria o del superadministrador (desde la base no se puede saber qué persona hay detrás de la cuenta propietaria: su nombre es el de la empresa, y por eso la bitácora no atribuye a una persona lo que ella hace). Es aceptable hoy porque hay **0 órdenes de pago**; si el negocio lo considera un freno, la alternativa lo elimina a cambio de la concentración descrita.

### 5.4 La alternativa («continuidad total») y su diferencia exacta

Conceder a Alexander **las cinco** (`recepcion_registrar`, `factura_aprobar`, `orden_pago_aprobar`, `pago_ejecutar`, `pago_anular`): reproduce **exactamente** lo que hoy puede (A-1 de `COMPRAS_CONTROLES_SERVIDOR.md §5.3`). **Diferencia con la recomendada: dos llaves, `platform.contabilidad.compras.pago_ejecutar` y `platform.contabilidad.compras.pago_anular`.** Es también la que elimina cualquier efecto transitorio para Alexander. No existe una tercera opción más estricta en esta propuesta; cada llave es independiente y se decide por separado (§7), de modo que, por ejemplo, retener también `orden_pago_aprobar` es una decisión posible que traslada la aprobación de la orden de pago al administrador y a la cuenta propietaria.

---

## 6. (C) Pasos exactos para conceder, después del despliegue de la 0900

### 6.1 Orden y precondiciones

Orden de despliegue acordado en `COMPRAS_CONTROLES_SERVIDOR.md §10.2`: (1) PR de seguridad de `user_project_assignments`, (2) este PR (#926, las diez), (3) #927, (4) —futuro, si se aprueba— el PR de alcance por proyecto (§8). **Las concesiones van después del paso (2)**, nunca antes: las cinco llaves no existen hasta que la 0900 las siembra y `role_permissions.permission_key` es llave foránea de `permissions(key)` `[Q25]`.

Antes de conceder: (a) respuestas **por escrito** a A-1.1…A-1.7 (§7); (b) volver a correr `scripts/diagnostico-permisos-compras.sql` `[Q1]` y confirmar que la columna `pierde` sigue siendo la de §0; (c) correr en el script `P-0.1`–`P-0.4` y `V-1`, `V-3`, `V-4` y **guardar la salida** (huellas de §2.1 y V-4).

### 6.2 Ruta recomendada: la pantalla del producto

La hace **Marco Santos Godoy** (`admin` de la misma empresa) o la cuenta propietaria; las políticas de `roles`, `role_permissions` y `user_roles` exigen `company_owner` o `admin` de la empresa de la persona. No la puede hacer un `operator`.

1. **Empresa › Usuarios**, fila de Alexander Monterroso, botón **Roles y permisos** (icono de llave) (`EmpresaUsuariosSection` → `RolPermisosModal`).
2. En el panel de **permisos efectivos / «Ajustes individuales»** (el mecanismo «Ajustes finos»), abrir el grupo **«Plataforma: Compras y pagos»** (aparece solo cuando el catálogo ya tiene las llaves, es decir, después de la 0900) y marcar **solo** las casillas decididas: «Registrar una recepción», «Aprobar una factura de proveedor» y «Aprobar una orden de pago» (en la recomendada); y además «Ejecutar un pago» y «Anular un pago» (en la alternativa). **No** tocar los roles asignados ni sus vencimientos.
3. **Guardar.** El producto, en `handleSave`: crea el rol oculto de ajustes `Ajustes individuales — Alexander Monterroso (327ffeda)` (`is_system = false`, `user_override_for` = su id, color `#7E9389`), se lo asigna con `expires_at = NULL` (la expiración no aplica a los ajustes) e inserta una fila `role_permissions` con `effect = allow` por casilla marcada. Cada paso deja huella en `permission_audit_log` con **la persona administradora como actor** (`create_role`, `assign_role`, `grant_permission` ×N) `[V-5]`.

### 6.3 Ruta alternativa: SQL (`scripts/propuesta-asignaciones-permisos-compras.sql`)

Para una persona con acceso al editor SQL (rol de la base, no `authenticated`): extraer **un bloque** `P-1.x` por llave decidida, quitar el prefijo `--SQL `, ejecutarlo y revisar el `SELECT` de verificación; el bloque **termina en `ROLLBACK;`** y solo se confirma editando esa línea a `COMMIT;`. Hace lo mismo que la pantalla (mismo nombre, color y campos del rol de ajustes), pero **sin actor** en la bitácora (`auth.uid()` es nulo) y sin probarse en esta sesión (§10). Preferir la pantalla.

### 6.4 Comprobación posterior (debe dar «sí → sí» donde corresponde)

* **`V-3` del script / `[Q15]`** (o la fila `usuario` de `[Q1]`):

| Alexander | recomendada | alternativa |
|---|---|---|
| 1 Aprobar orden de compra | sí → sí | sí → sí |
| 2 Registrar recepción | **sí → sí** | **sí → sí** |
| 3 Aprobar factura | **sí → sí** | **sí → sí** |
| 4 Aprobar orden de pago | **sí → sí** | **sí → sí** |
| 5 Ejecutar pago | sí → **no** | **sí → sí** |
| 6 Anular pago | sí → **no** | **sí → sí** |

  En el diagnóstico completo la fila de Alexander debe mostrar `roles_asignados` = «Ajustes individuales — Alexander Monterroso (327ffeda); Finanzas / Contador»; la fila `resumen` sigue diciendo «1 persona(s) pierden alguna acción» con la recomendada y «**0** persona(s)…» con la alternativa; Marco queda «sí → sí» en las seis.
* **Contadores `V-4`:** con la recomendada, `role_permissions` +3, `user_roles` +1 y `roles` +1 (el rol de ajustes); con la alternativa +5, +1 y +1; `concesiones_de_las_cinco_llaves` = 3 (o 5). Lectura previa del 2026-10-10: 3 661, 26 y 34 (si otra persona cambió roles en el intervalo, comparar contra una lectura hecha justo antes).
* **`V-1` y `V-4`, proyectos:** las huellas de §2.1 y la global (43 filas, md5 `d32daf1d38d862b1cdd938a59ad2ff5f`) **no deben cambiar**: ninguna concesión toca `user_project_assignments`. Alexander **conserva sus 6 proyectos** y Marco **sus 3**.
* **Reversión:** desmarcar las casillas en el mismo panel (el producto borra el rol oculto si no quedan ajustes) o borrar las filas concedidas en `role_permissions`. Las llaves de `permissions` no se borran (borrarlas elimina en cascada toda concesión).

### 6.5 Efecto en proyectos

Las concesiones **no cambian ni amplían** ninguna asignación de proyecto. La comprobación de proyecto de la 0900 (`can_access_project`) sigue rigiendo cada acción: Alexander actúa en sus 6 y Marco en sus 3. Dos salvedades que **no** vienen de las concesiones: un documento **sin proyecto** se trata como «de la empresa» (hoy no hay ninguno, §8) y la asignación de proyecto es **autoasignable** hasta que se despliegue el PR de seguridad de `user_project_assignments` (paso 1); por eso la comprobación de proyecto no es un límite contra un usuario hostil mientras ese PR no esté en producción.

### 6.6 Plantillas: cómo funcionan de verdad en el producto

* Las plantillas son los roles `is_system = true` (sin empresa). **No se asignan**: «Usar plantilla» (y crear un usuario con un rol de sistema) llama a `ensureCompanyRoleFromTemplate`, que **busca o crea la copia de empresa** (nombre de la plantilla, `cloned_from_role_id`) y **copia sus `role_permissions` en ese momento**. Una copia fiel que ya existe **se reutiliza y nunca se refresca**.
* **No hay copia automática al crear una empresa nueva** (ninguna migración ni función de borde siembra roles de empresa a partir de plantillas: la copia nace solo en la pantalla). Una plantilla con llaves nuevas llega a las copias que se creen **después**; las existentes (la de Alexander, la de Marco) no cambian.
* **Excepción que importa saber:** las funciones de borde `create-user` y `accept-invitation` asignan **directamente la plantilla de plataforma** que corresponde al perfil, sin copia (`admin` → «Admin Plataforma», `operator` → «Operador Plataforma», `viewer` → «Visualizador Plataforma», `collector` → «Cobrador Plataforma»; `supabase/functions/*/validate.ts`). Ese vínculo **sí es vivo** (un cambio en la plantilla llega de inmediato; la pantalla lo muestra como «heredada»). Hoy hay **0** asignaciones directas a plantillas `[Q7b]`. Para las seis acciones solo importa «Admin Plataforma», y quien la recibe es un `admin`, que ya pasa toda llave por su perfil: por eso conceder llaves a esa plantilla no cambia a nadie.
* La pantalla **no edita plantillas** («Usar plantilla» y «Personalizar» clonan); su `role_permissions` solo lo escribe el superadministrador (la política de `INSERT` exige `is_super_admin()` para un rol de sistema) o una migración. Por eso conceder a una plantilla es una decisión de producto (A-2.1), no una urgencia: no cambia a ninguna persona actual. Si se decide, es el bloque `P-5` del script (con `ROLLBACK` por defecto) y, para que figure en el historial, mejor en una migración propia dentro de su despliegue (**no** en el PR #926, que está en el tope de diez).

---

## 7. (D) Decisiones que necesita el usuario (responder sí/no)

| Ref. | Pregunta | Recomendación |
|---|---|---|
| **A-1.1** | ¿Conceder a Alexander Monterroso **registrar recepciones** (`platform.contabilidad.compras.recepcion_registrar`)? | **SÍ** |
| **A-1.2** | ¿Conceder a Alexander **aprobar facturas de proveedor** (`…factura_aprobar`)? | **SÍ** |
| **A-1.3** | ¿Conceder a Alexander **aprobar órdenes de pago** (`…orden_pago_aprobar`)? | **SÍ** |
| **A-1.4** | ¿Conceder a Alexander **ejecutar pagos** (`…pago_ejecutar`)? | **NO** (alternativa «continuidad total»: SÍ) |
| **A-1.5** | ¿Conceder a Alexander **anular pagos** (`…pago_anular`)? | **NO** (alternativa: SÍ) |
| **A-1.6** | Si A-1.4 o A-1.5 es NO: ¿se acepta que ejecutar y anular pagos en Cascadas de Vista Hermosa, La Arboleda CVH y Viñas del Sur Condominio 3 (donde Marco no está asignado) los haga solo la cuenta propietaria o el superadministrador? Si no, hay que conceder A-1.4/A-1.5 a Alexander o asignar a otra persona. | **SÍ**, mientras no haya órdenes de pago |
| **A-1.7** | ¿La concesión se hace desde la pantalla («Ajustes individuales», actor registrado) por Marco o por la cuenta propietaria, y no por SQL? | **SÍ** |
| **A-2.1** | ¿Se conceden llaves nuevas a las **plantillas de sistema** «Finanzas / Contador» y «Admin Plataforma» ahora? | **NO** (0 personas; solo afectaría copias futuras; decidir antes de crear una segunda empresa o de asignar la plantilla a otra persona) |
| **A-2.2** | ¿Se conceden llaves nuevas al **rol de empresa** «Finanzas / Contador»? | **NO** (se concede a la persona) |
| **A-2.3** | ¿Se deja la plantilla «Administrador General» como está (trae la llave de la pestaña de órdenes y por eso «gana» la acción 1, sin efecto práctico)? | **SÍ** |
| **A-3** | Marco Santos Godoy: nada que conceder (es `admin`, conserva las seis en sus 3 proyectos). ¿Se confirma? | **SÍ** |
| **A-4** | **P-PERM-1 · R1.** ¿Se aprueba preparar, como migración y PR propios (después del despliegue de #926; **no** como undécima migración), que la captura directa exija el proyecto asignado y la empresa de la sesión? (§8) | **SÍ** |
| **A-5** | **P-PERM-1 · R2.** ¿Se prohíbe a quien **no** es exento de proyecto crear, aprobar o pagar documentos **sin proyecto** y sacar su propio documento de su proyecto dejándolo sin proyecto? (§8) | **SÍ** |
| **A-6** | ¿Se revisa el rol de empresa «Finanzas / Contador» (1 193 de 1 201 llaves, concedidas en bloque el 2026-08-13) para acercarlo a la plantilla (63)? Esta propuesta **no** recorta nada. | Decisión del negocio |
| **A-7** | ¿Se enciende el interruptor de separación solicitante/aprobador (`aprobacion_separada`) en Prestadora de Servicios S.A.? (cubre solo la acción 1; costo en §5.3) | Sin recomendación |
| **A-8** | ¿Se concede **inmediatamente** tras desplegar la 0900, aunque A-4/A-5 y el PR de asignaciones aún no estén en producción? | **SÍ** con la recomendada: no amplía nada de lo que hoy puede y hoy hay 0 documentos sin proyecto |

*Opcional (no es sí/no):* si la recepción debe quedar en una persona de operación y no en finanzas, la llave `recepcion_registrar` se concede a esa persona en vez de a Alexander; no se propone porque exigiría designar a alguien.

---

## 8. Capturas en proyectos no asignados y ampliaciones mediante `project_id = NULL` (propuesta; **no aplicada**)

**Hechos de producción `[Q14, Q16, Q21]`.** Las políticas `INSERT` de `ordenes_compra`, `recepciones`, `facturas_proveedor`, `ordenes_pago` y `contrasenas_pago` piden la empresa y (el perfil `operator`/`admin`/`company_owner` **o** `create`), pero **no miran el proyecto**; las políticas `SELECT` sí (`project_id IS NULL OR can_access_project(project_id)`). Y `can_access_project(NULL)` es **verdadero**. Hay 0 documentos sin proyecto en las cinco tablas. La RPC `compras_orden_crear` sí exige el proyecto asignado cuando recibe uno; el `INSERT` directo (la API) no.

| Vector | Hoy | Quién |
|---|---|---|
| V1 · Capturar un **borrador** en un proyecto no asignado (`INSERT` directo con `project_id` ajeno) | Permitido (las decisiones posteriores sí exigen proyecto, pero el borrador queda creado) | los 7 `operator` (entre ellos Alexander) y Marco; también quien tenga `create` |
| V2 · Crear, aprobar o pagar documentos con `project_id = NULL`: «sin proyecto = de la empresa» | Permitido a toda persona con la llave: **un documento sin proyecto escapa a la asignación por proyecto** | cualquiera con la llave, incluida Alexander tras la concesión |
| V3 · **Mover** el propio documento a «sin proyecto» (`UPDATE … SET project_id = NULL`) | Permitido: lo ve y puede actuar sobre él **toda** la empresa con la llave | quien tiene `edit` y el proyecto de origen |
| V4 · `INSERT` por una función `SECURITY DEFINER` con `company_id` ajeno | Un borrador de otra empresa pasa (la RLS no rige al dueño de la función); hoy no existe ninguna función así | — |

**Propuesta** (en migración y PR propios, **después** del despliegue de #926; no es una undécima migración del #926 y no se sube `MAX_APPLY`):

* **R1 (bajo riesgo; A-4).** Un disparador `BEFORE INSERT` en las cinco tablas, solo para sesiones de usuario: si `NEW.project_id IS NOT NULL`, exigir `can_access_project(NEW.project_id)` (`COMPRAS_ALCANCE_PROYECTO`, 42501) **y** que `NEW.company_id` sea la empresa de la sesión salvo el superadministrador. Cierra V1 y V4 y no cambia ninguna pantalla.
* **R2 (decisión de fondo; A-5).** Para quien **no** es exento de proyecto (`NOT user_is_project_exempt()`): exigir `NEW.project_id IS NOT NULL` en el `INSERT`, y rechazar el `UPDATE` de `project_id` de un valor a `NULL` (`OLD.project_id IS NOT NULL AND NEW.project_id IS NULL`), conservando la excepción de la acción referencial `ON DELETE SET NULL` cuando el proyecto ya no existe. Cierra V2 y V3. Afecta a Marco (administrador **con** asignaciones, no exento) igual que a Alexander. No hay datos que migrar: hoy hay 0 documentos sin proyecto.
* **Pruebas necesarias:** las ya existentes `PERM-1…4` deben seguir en verde, más casos nuevos de rechazo (borrador en proyecto ajeno; `INSERT` sin proyecto de no exento; mover a «sin proyecto» de no exento; empresa ajena) y de aceptación (exento mueve a «sin proyecto»; entre **sus** proyectos sigue permitido).
* **Estado honesto:** el prototipo de R2 sobre «sacar de su proyecto» se corrió en la ronda anterior en una base desechable (con la condición, `PERM-1…4` siguieron en 166 / 115 / 119 / 137 y las cinco sondas dieron lo esperado: solo-A → «sin proyecto» rechazado; administrador con asignaciones rechazado; administrador sin asignaciones aceptado; A→B entre sus proyectos aceptado). Ese registro está en el *scratchpad* de la sesión anterior, **no en el repositorio**, y **no se repitió en esta sesión**; la migración definitiva hay que escribirla y probarla en su propio PR.
* **Qué cubre y qué no.** R1/R2 cierran *dónde* se captura y *cuándo* un documento deja de pertenecer a un proyecto; no cierran la **autoasignación de proyectos** (`user_project_assignments`, paso 1 del orden de despliegue), de la que depende que la asignación de proyecto sea un límite real. Con las concesiones recomendadas nada es más ancho que hoy: Alexander ya puede las seis hoy sobre documentos sin proyecto.

---

## 9. Hallazgos inesperados

1. **El rol de Alexander tiene 1 193 de las 1 201 llaves del catálogo** (la plantilla trae 63), concedidas en bloque por la cuenta propietaria el 2026-08-13 `[Q4, Q5, Q6]`. El texto anterior del script describía solo ~10 llaves.
2. **El nombre no identifica:** `ILIKE '%Monterroso%'` coincide con 3 cuentas (2 `cliente` sin empresa) `[Q2]`. La versión anterior de `propuesta-asignaciones-permisos-compras.sql` filtraba por nombre **dentro de los bloques de concesión**; su comprobación previa devolvería 3 filas y lo advertía, pero un bloque ejecutado habría intentado crear roles de ajustes para las tres cuentas. Las dos `cliente` no tienen empresa y la restricción `roles_company_or_system_chk` (un rol que no es de sistema exige empresa) habría hecho fallar la sentencia entera, así que no se habría escrito nada, pero por una casualidad de la restricción y no por diseño. Ahora el filtro es por id, perfil, empresa y estado.
3. **Las copias de empresa son fotografías que divergen de su plantilla** (90 contra 96, 189 contra 1 104, 1 193 contra 63) y la plantilla nunca las refresca; no hay copia automática al crear una empresa `[Q6]`. Además, `create-user` y `accept-invitation` siguen asignando la plantilla de plataforma **directamente** (vínculo vivo, sin copia) según el perfil, aunque hoy no haya ninguna asignación así `[Q7b]`.
4. **La única factura se creó y se aprobó por la misma cuenta en 10,5 s** `[Q9]`: para la factura (y la recepción, la orden de pago y el pago) no existe ninguna regla entre personas; la del interruptor es solo para la orden de compra y está apagada.
5. **Alexander no tiene ningún inicio de sesión registrado desde el 2026-08-13 ni filas de negocio a su nombre** `[Q10, Q11]`: la «continuidad operativa» es una expectativa de función, no un hecho de uso.
6. **`role_permissions` no tiene política ni bitácora de `UPDATE`:** el `ON CONFLICT … DO UPDATE SET effect = 'allow'` de la versión anterior del script habría **volteado en silencio un `deny`** y sin rastro. En producción `role_permissions` solo tiene políticas de `SELECT`, `INSERT` y `DELETE` y un disparador de bitácora `AFTER INSERT OR DELETE` `[Q26]`. Hoy hay 0 `deny` en toda la base `[Q7b]`; ahora los bloques usan `DO NOTHING` y `P-0.4` descarta antes cualquier `deny`.
7. **La pantalla de roles guarda con `set_role_permissions`, que deja el rol *exactamente* con la lista enviada:** editar así un rol de 1 193 llaves y guardar una lista incompleta lo recortaría. Otra razón para conceder por ajustes individuales.
8. **«Ganar» la acción 1 es teórico para «Administrador General»:** la plantilla trae la llave de la pestaña pero no `platform.contabilidad.edit`, que las cuatro políticas `UPDATE` exigen; y no tiene personas.
9. **Tres proyectos dependen solo de Alexander** (entre las personas no exentas) y dos proyectos («test», «VSC General») no tienen a nadie asignado `[Q12]`.

---

## 10. Lo que NO se hizo

* **No se concedió, creó ni borró nada** en ninguna base. Todo lo anterior son `SELECT`.
* Las **sentencias de concesión del script no se ejecutaron en ninguna base** en esta sesión: no se asignó una base desechable y el sandbox y la preview están vedados para escritura. Según el informe de la ronda anterior, la versión anterior de esos bloques se probó en una copia desechable (registro en el *scratchpad* de aquella sesión, no en el repositorio, y no revisado de nuevo aquí); esta versión cambia el filtro (id, perfil, empresa, estado), el nombre del rol (idéntico al de la pantalla) y el tratamiento del conflicto (`DO NOTHING`). Lo que sí se verificó contra producción, solo con `SELECT`: las comprobaciones `P-0.1`–`P-0.4`, `V-1`–`V-5` (se ejecutan y devuelven lo indicado), el predicado de los bloques (la persona se identifica con una sola fila, el nombre de rol que se crearía no choca con ninguno existente y no hay rol de ajustes previo) y que las claves de conflicto (`user_roles` y `role_permissions`, llaves primarias) existen `[Q25]`. **Antes de activar un bloque hay que correrlo en una base desechable o en el sandbox con una persona de prueba.**
* No se editó `COMPRAS_CONTROLES_SERVIDOR.md`, ninguna migración ni ningún permiso; no se hizo `commit`.
* La propuesta de §8 no está implementada ni probada en esta sesión.

---

## 11. (E) Bloque para el cuerpo del PR

````markdown
### Permisos por acción: matriz propuesta (SIN conceder; lectura de producción 2026-10-10)

Detalle, consultas y pasos: `docs/COMPRAS_PROPUESTA_ASIGNACION_PERMISOS.md`. La 0900 no concede nada. Celda = «hoy → tras la 0900 sin conceder» y, al final, la propuesta (**C** = conceder · **N** = no conceder · ya = ya lo tiene).

| Principal | OC | Recep. | Factura | O. pago | Pago | Anular | edit |
|---|---|---|---|---|---|---|---|
| Alexander Monterroso (operator, 6 proy.) | sí→sí ya | sí→no **C** | sí→no **C** | sí→no **C** | sí→no **N** | sí→no **N** | sí ya |
| Rol de empresa «Finanzas / Contador» (1 pers.) | sí→sí ya | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí ya |
| Plantilla «Finanzas / Contador» (0 pers.) | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí ya |
| Plantilla «Admin Plataforma» (0 pers.) | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí→no N | sí ya |
| Plantilla «Administrador General» (0 pers.) | no→sí ya | no→no N | no→no N | no→no N | no→no N | no→no N | no N |
| Marco Santos Godoy (admin, 3 proy.) | sí→sí ya | sí→sí ya | sí→sí ya | sí→sí ya | sí→sí ya | sí→sí ya | sí ya |

- **Recomendada:** a Alexander, por «Ajustes individuales» y tras la 0900, recepción + factura + orden de pago; **no** pago ni anulación (quedan con administrador/propietario). Plantillas y rol de empresa: nada ahora. **Alternativa «continuidad total»** (= hoy): +`pago_ejecutar` y `pago_anular` (diferencia exacta: 2 llaves).
- Concentración que queda: Alexander puede por sí solo aprobar la orden, recibir, aprobar la factura y aprobar la orden de pago; el interruptor de separación (apagado en todas las empresas) solo cubre «quien solicita no aprueba la orden de compra».
- Uso real en producción: 1 OC histórica sin autor, 1 factura anulada creada y aprobada por la cuenta propietaria en 10,5 s; 0 recepciones, órdenes de pago, pagos y asientos. Alexander: 0 filas de negocio, sin inicio de sesión registrado desde 2026-08-13.
- Proyectos sin cambios: Alexander 6, Marco 3 (huellas antes/después en el documento). Marco, la cuenta propietaria y el superadministrador pasan toda llave por perfil.
- Hallazgos: el rol de Alexander tiene 1 193 de 1 201 llaves (plantilla: 63); «Monterroso» coincide con 3 cuentas (el script usa el id); las plantillas no se propagan a copias existentes ni a empresas nuevas.
- Decisiones: A-1.1…A-1.7 (llaves de Alexander), A-2.1…A-2.3 (plantillas/rol), A-4/A-5 (proyecto sin asignar y `project_id` vacío: PR propio posterior), A-6 (recorte del rol), A-7 (interruptor), A-8 (cuándo conceder).
````

---

## Apéndice · Consultas citadas (producción, solo `SELECT`, 2026-10-10)

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
-- resultado: solo Alexander (11 llaves de Contabilidad/órdenes) y Marco (solo la visibilidad de la pestaña de órdenes)
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

**Archivos del repositorio leídos:** `supabase/migrations/20260817000000_set_role_permissions_rpc.sql`, `20260612100000_roles_template_lineage.sql`, `20260612100100_roles_user_override.sql`, `20260612100300_rbac_assignments_to_company_roles.sql`, `20260518000004_rbac_schema.sql` y `20260518000008_rbac_helpers_and_sync.sql` (políticas y bitácora de roles), `20261027000900_…` (la comprobación común y las seis llaves), `20261021000600_compras_correcciones_revision.sql` (la regla del interruptor), `src/domain/empresa/roles.ts` (`ensureCompanyRoleFromTemplate`, `createOverrideRole`, `setRolePermissions`), `src/components/empresa/RolPermisosModal.tsx` y `EmpresaUsuariosSection.tsx` (el flujo de la pantalla), `src/lib/platformPermissions.ts` (el grupo «Plataforma: Compras y pagos») y `supabase/functions/create-user/validate.ts` y `accept-invitation/validate.ts` (la plantilla de plataforma que se asigna según el perfil).
