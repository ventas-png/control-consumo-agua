# Proveedores · contratos · compras · contabilidad — diagnóstico inicial

Alcance: PR A de la cadena A → B → C (ver `docs/PROVEEDORES_PR_A.md`).
Base: `main` en `aa6e046` (#902). Fecha: 2026-10-01.

Todo lo de abajo sale de leer el código y las migraciones del repo, no de las
pantallas. Donde algo "no se ve" en la UI pero existe en la base, se dice.

## 0. Solapamientos con trabajo en vuelo

| PR abierto | Toca | Solapamiento con PR A | Decisión |
| --- | --- | --- | --- |
| [#904](https://github.com/ventas-png/control-consumo-agua/pull/904) (borrador) Contabilidad 5–11 | migraciones `20261007…20261014`, `database.types.ts` (+1238 líneas), `ContabilidadSection`, `MapeoCuentasTab`, `AsientoFormModal`, `coverage.json` del harness RLS | **Archivos** (`ContabilidadSection.tsx`, `coverage.json`) y **versión de migración**. No toca proveedores, contratos, compras ni importadores. | Rama independiente desde `main`. Migraciones desde `20261020…` (por encima de las de #904). **No** se regenera `database.types.ts` (el cliente no está tipado con `Database`, ver `src/lib/supabase.ts`) para no chocar con #904. Ediciones a `ContabilidadSection` y `coverage.json` acotadas a una línea/entrada. Orden de fusión: si PR A entra antes que #904, #904 queda "intercalada" y debe renumerarse (regla de `scripts/schema-drift/auditar.mjs`). |
| #905, #906 | dependabot (`package.json`) | Ninguno. | — |

## 1. Lo que ya existe (y por tanto se reutiliza)

* **Un solo catálogo de proveedores por empresa**: `public.proveedores`
  (`20260611010000`). `UNIQUE(company_id, nombre)`; **sin** unicidad por
  identificación fiscal, **sin** país, **sin** código visible, **sin** vínculo a
  proyectos.
* **Autorización** del proveedor: `proveedores.estado`
  (`borrador→en_revision→autorizado→suspendido|vetado`), sello autor/fecha,
  vigencia, trigger de sincronía con `activo`, y `proveedor_habilitado(uuid)`
  (`20260821000000`). Papelería: `proveedor_documentos` (referencias, no hay
  bucket).
* **Operaciones ya consulta a Contabilidad**: `OrdenesCompraTab` usa
  `useProveedoresQuery` (catálogo contable) y filtra con `proveedorHabilitado`.
  `ordenes_compra` **es** el motor contable evolucionado (`20260821000100`):
  `proveedor_id` FK, líneas (`orden_compra_lineas` con `destino_tipo`,
  `cuenta_id`, `suministro_id`), aprobación con candado de proveedor autorizado.
* **Recepción, GR/IR y factura**: `recepciones`/`recepcion_lineas`
  (`20260821000200`), `factura_proveedor_lineas` + match
  (`20260821000300`), contraseñas de pago (`20260821000400`).
  Devengo de factura en `conta_tg_facturas_prov` (`20260928000000`).
* **Motor de imputación contable** (`20260926000000` → `20260929000000`):
  `conta_reglas_proveedor` (proveedor + destino → cuenta),
  `conta_reglas_cargo`, `conta_resolver_imputacion[_interno]`,
  `conta_resoluciones` (bitácora, incluye los `sin_resolver`), destinos
  declarados `gasto|costo|inventario|activo_fijo|compras_por_facturar`.
  Precedencia actual: línea explícita → regla de proveedor → regla de
  cliente/unidad/categoría → mapeo del evento → **nada** (`sin_resolver`).
* **Permisos**: `conta_puede_escribir(accion)` (rol legacy o
  `platform.contabilidad.<accion>`), `user_has_permission(clave)`,
  permisos por pestaña `condominios.tab.*` (RLS de `contratos_proveedores` →
  `condominios.tab.proveedores`), `can_access_project(uuid)` /
  `user_has_project_access(uuid)` / `user_is_project_exempt()`.
* **Importación**: `ImportModal` compartido (plantilla, vista previa por fila,
  descarga de errores) y `writeXlsx`/`exportData` con escape anti-fórmula.
* **Arnés SQL real**: `supabase/tests/*/run.sh` levanta un PostgreSQL local y
  aplica la **cadena completa** de migraciones; es lo que usa PR A.

## 2. Matriz

Leyenda *PR*: **A** = esta entrega · **B** = compra/recepción/factura ·
**C** = consumo/excepciones/seguimiento.

| # | Funcionalidad | Implementación actual | Brecha | Cambio propuesto | Prueba | PR |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Identidad canónica del proveedor por empresa | `proveedores` por `company_id`; unicidad solo por nombre exacto (sensible a mayúsculas) | Sin NIT/RFC normalizado ni país; dos filas con el mismo NIT conviven; sin tratamiento de proveedor sin identificación | `pais`, `identificacion_norm` (calculada en servidor), guarda anti-duplicado con candado consultivo, reporte de duplicados **legados** sin fusionar | `assert` SQL: duplicado por NIT con distinto formato, mismo NIT otro país, mismo NIT otra empresa, sin NIT | **A** |
| 2 | Código visible vs. FK | Las FK usan `id`; no existe código visible | Sin código de proveedor; riesgo de que el código contable se use como identificador | `proveedores.codigo` (único por empresa, case-insensitive, asignable por correlativo); nada lo usa como FK; separado de `conta_cuentas.codigo` | SQL: código repetido; búsqueda por código/NIT/nombre | **A** |
| 3 | Proveedor en varios proyectos / ámbito empresa | Proveedor es de la empresa; no hay relación con proyectos | No se puede restringir ni habilitar por proyecto; no hay "habilitación por proyecto" distinta de la autorización general | `proveedores.alcance` (`empresa`\|`proyectos`) + `proveedor_proyectos` (estado `pendiente/habilitado/suspendido/retirado`, config por proyecto) + `proveedor_habilitado_en(proveedor, proyecto)`; el candado de OC la consulta | SQL: proveedor en 2 proyectos con config distinta; acceso cruzado; OC en proyecto no habilitado | **A** |
| 4 | Proveedor de servicios + suministros + equipos | `categoria_default` (un solo texto) | No se puede declarar qué abastece | `proveedores.abastece text[]` con CHECK | SQL + zod | **A** |
| 5 | Contactos del proveedor | Un `contacto_nombre`/`email`/`telefono` en la fila | Sin múltiples contactos; contrato no puede reutilizarlos | `proveedor_contactos`; el contrato referencia `contacto_id` **y** conserva su contacto específico | SQL: contacto de otro proveedor/empresa rechazado | **A** |
| 6 | Autorización general | `estado` + sello + vigencia; trigger exige `change_status` | Correcto. **Pero** `proveedor_documentos_select` deja leer RTU/DPI/referencia bancaria a **cualquier** usuario de la empresa | Restringir lectura de papelería a quien puede ver Contabilidad; sin cambios al ciclo de autorización | SQL: operador sin permiso contable no lee papelería | **A** |
| 7 | Contratos ↔ proveedor | `contratos_proveedores`: `proveedor_nombre/contacto/telefono/email` en **texto libre**, sin FK, `project_id NOT NULL`, `monto_mensual` | Dos mundos: el contrato no usa el catálogo; no se puede llegar del proveedor al contrato | `proveedor_id` FK (verificado empresa/proyecto), selector del catálogo en contratos **nuevos**; históricos intactos | SQL + componente | **A** |
| 8 | Fotografía del contrato | `proveedor_nombre` es texto (de facto fotografía) pero editable | Cambiar el proveedor o editar el contrato reescribe lo firmado | `proveedor_snapshot jsonb` + trigger de congelación tras activación; ediciones económicas solo en `borrador` | SQL: modificar proveedor no altera contratos; contrato activo rechaza cambios de condiciones | **A** |
| 9 | Servicios recurrentes y compras por demanda | Solo `monto_mensual` | Fuerza un monto mensual | `modalidad` (`recurrente`/`por_demanda`), `periodicidad`, `moneda`, `importe_periodico`, `monto_maximo`, `alcance`, `responsable`; `monto_mensual` se mantiene y se proyecta solo si `periodicidad='mensual'` | SQL: por demanda sin importe periódico; recurrente exige periodicidad | **A** |
| 10 | Estado del contrato vs autorización del proveedor | `estado` activo/vencido/terminado sin CHECK; la UI deja **borrar** | Borrado físico con documentos relacionados; sin motivo ni historial | Estados `borrador/activo/suspendido/vencido/terminado/cancelado`; `contrato_proveedor_eventos` (append-only); `DELETE` solo en `borrador` sin relaciones; terminación/cancelación con motivo | SQL: borrar contrato con evaluación/OC/archivo falla; terminar con motivo deja evento | **A** |
| 11 | Suspensión del proveedor | `proveedor_habilitado` bloquea aprobar/emitir OC | No está definido qué más bloquea ni qué vías quedan abiertas | Matriz de acciones bloqueadas/permitidas (ver `PROVEEDORES_PR_A.md §4`); implementada para contratos nuevos y OC | SQL: suspender no borra obligaciones; permite terminar contrato y recibir/pagar lo anterior | **A** |
| 12 | Respaldo del contrato | `documento_url` apunta a `condominios-media`, cuyo acceso se autoriza **por proyecto** (cualquier residente con acceso al proyecto) | El respaldo del contrato no es privado | Bucket privado `contratos-respaldo`, ruta `<empresa>/<proyecto>/<contrato>/…`, policies que resuelven permiso desde la fila del contrato | SQL: usuario de otro proyecto/empresa/sin permiso no lee ni escribe | **A** |
| 13 | Evaluaciones | `evaluaciones_proveedor.proveedor_id` **apunta a `contratos_proveedores`** (nombre engañoso); `nombre_proveedor` texto | Evaluación no llega al proveedor compartido | Vista `evaluaciones_por_proveedor` (security_invoker) que resuelve el proveedor compartido vía contrato; se documenta la trampa del nombre | SQL: la vista respeta RLS | **A** |
| 14 | Contrato ↔ orden de compra | No existe | Sin relación | `ordenes_compra.contrato_id` (nullable) con trigger de coherencia (empresa, proveedor, proyecto). Sin generación automática | SQL: contrato de otro proveedor/proyecto rechazado | **A** (columna) / **C** (recurrentes) |
| 15 | Contrato no genera documentos | Hoy no genera nada | Debe quedar garantizado y probado | Prueba de que activar/terminar no inserta facturas, pagos, OC ni asientos | SQL: conteos antes/después | **A** |
| 16 | Cuentas sugeridas por categoría/producto | Reglas solo por **proveedor+destino** (todo un proveedor a una cuenta por destino); regla por categoría (`conta_reglas_cargo`) **sin consumidor**: el trigger de factura pasa `categoria = NULL` | No hay configuración por categoría o producto/servicio para compras; vigencia solo `activa` | `conta_reglas_compra` (ledger, destino, categoría y/o producto, proveedor opcional, **vigencia**); `compras_resolver_cuenta_linea()` que **delega** en el motor existente; `compras_sugerir_cuenta()` | SQL: precedencia completa, vigencia, ámbito, aptitud, cambio de predeterminado no altera históricos | **A** (modelo+sugerencia) / **B** (cableado al devengo) |
| 17 | CxP del proveedor vs destino de la compra | CxP = mapeo de evento `cxp_proveedores`; destino = regla/evento. Ya son conceptos distintos | Falta hacerlo visible y detectar configuración incompleta | `compras_config_estado()` (qué destino/categoría no resuelve y por qué); sin cuenta genérica; sin subcuenta por proveedor (el auxiliar por proveedor es `facturas_proveedor.proveedor_id` + `cxp_antiguedad_saldos`) | SQL + UI | **A** |
| 18 | Validación de cuentas en servidor | Trigger `conta_tg_regla_cuenta_valida` (ledger, detalle, activa) | No valida aptitud del tipo de cuenta para el destino | Aptitud: gasto/costo → `gasto`; inventario/activo_fijo → `activo` | SQL | **A** |
| 19 | Importadores | `ImportModal`: valida **en el cliente** e inserta por lotes de 100 desde el navegador | (a) Acepta `.csv` y `.xls` pero parsea todo con exceljs: **CSV y XLS no funcionan**; (b) celdas numéricas pierden ceros; (c) fórmulas se evalúan por su resultado en caché; (d) fallo a mitad de camino deja lotes aplicados y el reintento los duplica; (e) sin registro de lote/actor; (f) `ImportSuministrosModal` enlaza el proveedor **por nombre** | Flujo propio **servidor-autoritativo**: el cliente solo parsea a JSON (CSV real + XLSX seguro) y el servidor valida, calcula acción y diferencias, registra lote/filas y aplica de forma idempotente. Se reutiliza `writeXlsx`, `ModalPortal` y las columnas/plantillas del `ImportModal`; no se modifica el modal compartido | vitest (parser, normalización) + SQL (lotes, repetición, ámbito, "importar no autoriza") | **A** |
| 20 | Permisos del importador | Cualquier usuario con la pestaña | No hay chequeo de permiso/ámbito en servidor | RPC exige `conta_puede_escribir('create'/'edit')` (proveedores) o permiso de pestaña (contratos) y acceso al proyecto | SQL: acceso cruzado y sin permiso | **A** |
| 21 | Históricos sin proveedor vinculado | Texto libre; sin migración de vínculo | Sin vista previa ni reversión | `contratos_sin_proveedor_vista_previa()` (inequívoco/ambiguo/sin coincidencia, conteos antes/después), `contrato_vincular_proveedor()` manual, `contratos_vincular_inequivocos(dry_run)` y `contratos_vinculos_revertir(lote)`. **No se ejecuta en producción** | SQL: ambiguos no se vinculan solos; no se borran/fusionan; reversión | **A** |
| 22 | Interfaz: mismo proveedor en Contabilidad y Operaciones | Operaciones: pestaña "Proveedores" que en realidad es **Contratos**; Contabilidad: "Proveedores" = catálogo | Misma palabra para dos cosas; contexto empresa/proyecto implícito | Pestaña de Operaciones se llama **Contratos**; selector compartido; ficha de proveedor con enlaces a contratos/órdenes/recepciones/facturas/pagos **según permisos**; banner de contexto empresa/proyecto | vitest de componentes | **A** |
| 23 | Datos sensibles en vistas operativas | `proveedores` no guarda banco; `proveedor_documentos` sí es sensible | Se expone a toda la empresa | Ver fila 6; la ficha operativa no consulta papelería | vitest + SQL | **A** |
| 24 | Orden operativa y contable: un motor | Ya es un motor (`ordenes_compra`) | Líneas sin proyecto/clasificación propios; aprobación de necesidad ≠ presupuesto ≠ recepción no están separadas | Interfaz documentada | — | **B** |
| 25 | Recepción física vs conformidad de servicio, parciales, rechazo | `recepciones` cubre bienes y parciales | Conformidad de servicios, rechazo y diferencias trazables | Interfaz documentada | — | **B** |
| 26 | Conciliación línea a línea OC–recepción–factura; duplicados | Match en `20260821000300`; único por (proveedor, número) | Duplicación de recepciones/asientos/pagos no cubierta de punta a punta | Interfaz documentada | — | **B** |
| 27 | Factura antes de entrega, anticipos, excepciones | Se puede capturar factura sin recepción | Camino autorizado explícito para excepciones/anticipos | Interfaz y decisiones pendientes documentadas | — | **B** |
| 28 | Consumo/salida, devoluciones, tablero comprometido→pagado | `movimientos_suministro` (trigger de stock) | Destino/responsable, reversos vinculados, tablero | Interfaz documentada | — | **C** |
| 29 | Órdenes recurrentes desde contratos | No existe | Idempotencia por contrato+periodo | Interfaz documentada; PR A deja `modalidad/periodicidad` y `contrato_id` | — | **C** |
| 30 | `proveedores_energia` | Tercer catálogo independiente (módulo de energía) | No se unifica en PR A | Fuera de alcance; decisión pendiente | — | pendiente |
| 31 | Otros tabs de Operaciones que usan contratos como lista de proveedores (`SuministrosTab`, `ProformasTab`, `EvaluacionProveedorTab`, `ImportSuministrosModal`) | Pasan `ctx.contratosProveedores` como "proveedores"; suministros guardan nombre | Mismo problema de identidad | Se documenta; se corrige lo mínimo sin romper (la evaluación sigue ligada a contrato) | — | **B/C** |

## 3. Hallazgos que condicionan el diseño

1. **`evaluaciones_proveedor.proveedor_id` es un id de contrato.** Cualquier
   código nuevo que lo lea como proveedor del catálogo se equivoca en silencio.
2. **Las reglas por categoría existen pero nadie las consulta** (la factura pasa
   `categoria = NULL`). Añadir reglas por categoría sin cablearlas sería una
   pantalla que promete y no cambia ningún asiento; por eso PR A las expone como
   *sugerencia al capturar la línea* (la línea guarda la cuenta elegida, que es
   la selección explícita del escalón 1) y deja el cableado al devengo para PR B.
3. **El borrado de contratos es físico y desde el navegador**
   (`deleteCondominioRow`), con política `DELETE` abierta a owner/admin.
4. **El respaldo del contrato vive en un bucket cuyo acceso es por proyecto.**
5. **El importador compartido no sirve tal cual** para estos requisitos (fila 19).
6. **`can_access_project(NULL)` devuelve `true`** ("ambiguo, no ajeno"): para
   decidir ámbito de proveedor/contrato no se puede usar sin comprobar `NULL`
   aparte.
7. **Tipos de cuenta**: `conta_cuentas.tipo ∈ {activo,pasivo,capital,ingreso,gasto}`;
   no existe `costo`. Los destinos `gasto` y `costo` exigen cuentas de tipo `gasto`.
8. **El sandbox no se tocó.** El servidor MCP de Supabase no conectó en esta
   sesión (`ERR_PROXY_TUNNEL`) y, de todos modos, PR A se valida contra un
   PostgreSQL local con la cadena completa. Ver `PROVEEDORES_PR_A.md §9`.
