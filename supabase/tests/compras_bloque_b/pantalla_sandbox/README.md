# Prueba de pantalla de los controles de compras (sandbox)

Comprueba **en la interfaz real** (Vite local → Chromium → sandbox `control-agua-rls-sandbox`) lo que la pantalla de
Operaciones › Órdenes compra ofrece y cómo reacciona cuando el servidor no cambia ninguna fila. **Nunca producción.**

## Qué verifica (18 comprobaciones: 5 perfiles × 3 órdenes + 3 de borrado)
1. **Matriz de botones por perfil** (5 perfiles × 3 órdenes): cada paso se ofrece solo si el perfil tiene la llave de la
   acción **y** «Editar» de Contabilidad (lo que el servidor exige). Aprobar una orden y devolver una aprobada exigen la
   llave de la pestaña (`condominios.tab.ordenes_compra.approve`), no el «Autorizar / Denegar» genérico de Contabilidad (D1):
   por eso «Autorizar + Editar» y «Autorizar sin Editar» la reciben en el padrón. «Autorizar sin Editar» no ve ni Aprobar ni
   Devolver (falta «Editar»); el cuarto perfil **«solo genérico»** (genérico + «Editar», SIN la llave de la orden) tampoco:
   es el que prueba, en la interfaz real, que el genérico ya no basta. «Eliminar» no se ofrece en un borrador devuelto/numerado.
2. **Cero filas ≠ éxito**: un perfil sin permiso de borrado pulsa «Eliminar»; el servidor no borra nada y la pantalla
   **avisa** («El servidor no aplicó el cambio…») en vez de callar.
3. Con permiso de borrado (administrador) el borrador sí se borra.

## Cómo se corre
1. Sembrar el padrón **una vez** en el sandbox: `padron_ui_controles.sql.tpl` (sustituir `__PW__`). Aborta si ya existe.
   Un padrón sembrado con la versión anterior (4 perfiles, sin la llave de la orden en `rq` ni `rs`) se pone al día con
   `padron_ui_controles_actualizacion.sql.tpl` (sustituir `__PW__` por la MISMA contraseña): aditivo e idempotente, concede la llave
   a esos dos roles y crea el cuarto perfil; no borra ni modifica nada. Ninguna de las dos plantillas se aplica desde este repositorio:
   las ejecuta quien administra el sandbox. Ambas se comprobaron sobre bases locales desechables (la actualización sobre un padrón viejo
   deja exactamente las mismas filas que la plantilla completa sobre una base limpia).
2. Levantar la app apuntando al sandbox, sin archivos `.env`: `VITE_SUPABASE_URL=https://jwpmivhvlstslncrtokb.supabase.co`
   y la llave **pública** de ese proyecto (su payload JWT dice `ref: jwpmivhvlstslncrtokb`); verificar antes que ni la URL
   ni la llave contienen la referencia de producción.
3. `ZZ_UI_PW=… CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node supabase/tests/compras_bloque_b/pantalla_sandbox/pantalla_controles.mjs`
   (`CHROMIUM_PATH` solo hace falta si Playwright no encuentra su navegador; si hay `HTTPS_PROXY`, `127.0.0.1` y `localhost` van directos).

## Salvaguardas del guion
- Toda petición a la referencia de producción se **aborta y se cuenta**; el resumen imprime el destino de red
  (esperado: solo `127.0.0.1` y el host del sandbox) y las peticiones bloqueadas (esperado: 0).
- Sin `ZZ_UI_PW` no corre; la contraseña no se guarda en el repositorio.

## Contraste automático sin sandbox
`src/components/condominios/tabs/__tests__/padronSandbox.test.tsx` (vitest, corre en el CI) lee las filas de
`padron_ui_controles.sql.tpl` y el `ESPERADO` de `pantalla_controles.mjs`, monta la pantalla real de Órdenes compra con las llaves de
cada perfil y exige que ofrezca exactamente los botones esperados. No sustituye la corrida contra el sandbox (no prueba el servidor ni
la sesión real), pero evita que la plantilla, el guion y la pantalla vuelvan a divergir sin que nadie se entere.

## Evidencia
**Corrida del 2026-10-10 contra el sandbox (`jwpmivhvlstslncrtokb`): 18/18 en verde** con el guion actual de 5 perfiles
(`pantalla_controles.mjs`, blob `bfb79ba`) y la pantalla de la rama en `87202d2dc` (`src/` sin cambios locales). El padrón 5b5b2000,
que estaba sembrado con la versión anterior (22 permisos, 4 usuarios, 3 roles), se puso al día con
`padron_ui_controles_actualizacion.sql.tpl` (queda en 32 permisos, 5 usuarios, 4 roles; ninguna llave por acción de la 0900 concedida a
nadie del padrón). Tráfico de red: solo `127.0.0.1` (2883 peticiones) y `jwpmivhvlstslncrtokb.supabase.co` (2298), **0 peticiones a
producción** bloqueadas.
- La primera corrida también dio 18/18, pero la comprobación 18 pasó por la rama «ya se había borrado en una corrida anterior»
  (el borrador «para borrar (admin)» no existía), es decir, sin ejercer el borrado con permiso. Se repuso ese borrador con el mismo
  contenido que da `padron_ui_controles.sql.tpl` (orden `…e4` y un renglón, creada por el administrador del padrón) y se repitió: 18/18
  con el borrado real, comprobado también en el servidor (la orden y su renglón ya no existen; «para borrar (sin permiso)» sigue ahí
  porque el servidor no aplicó el borrado).
- **Estado tras la corrida:** «ZZ UI borrador para borrar (admin)» ya no existe. Una repetición del guion necesita reponerlo (o dará
  la comprobación 18 por la rama «ya se había borrado», que no prueba el borrado).
- Histórico (2026-10-09, guion de 4 perfiles y 15 comprobaciones, pantalla anterior a las llaves por acción; no vale para el guion
  actual): contra la interfaz **anterior** (`a0435c9`) **8/15** (rojo: «Eliminar» ofrecido en borradores devueltos, «Autorizar sin
  Editar» viendo Aprobar/Devolver, borrado sin permiso en silencio); contra la interfaz de entonces **15/15**.

---

# Contabilidad › Compras y Contabilidad › Cuentas por pagar (sandbox)

Prueba **en navegador real** (Vite local → Chromium de Playwright → sandbox `control-agua-rls-sandbox`) del circuito completo de
compras y pagos por las pantallas de `ComprasTab.tsx` y `CuentasPorPagarTab.tsx`: creación, aprobación, recepción, factura, orden de pago,
pago, **reintento tras un corte de red**, anulación y contrastes de permisos. Cada paso lo ejecuta **la persona que tiene SOLO esa llave**;
después de cada paso se comprueban el **saldo de la factura** y los **asientos contables**. **Nunca producción.**

Archivos: `padron_ui_contabilidad.sql.tpl` (padrón), `pantalla_contabilidad.mjs` (guion), `retiro_padron_ui_contabilidad.sql` (retiro).

## Qué verifica
Fases (se pueden correr por separado con `FASE=1,2,…`; el estado pasa de una a otra por `ZZ_UI_SALIDA/estado.json`):

| Fase | Persona(s) | Qué se comprueba |
|---|---|---|
| 1 | solicitante | crea la orden de compra (proveedor autorizado, proyecto A, un renglón); aparece como borrador y **no** ofrece Aprobar / Emitir / Cancelar |
| 2 | aprobador de orden · emisor | solo quien tiene `condominios.tab.ordenes_compra.approve` ve «Aprobar»; solo quien tiene «Cambiar estado» ve «Emitir»; el servidor sella quién aprobó; aprobar no genera asiento |
| 3 | receptor · solicitante | el receptor crea y registra la recepción; el solicitante no ve «Registrar» y la API le responde `COMPRAS_PERMISO_ACCION`; un asiento «recepcion_registrada» que cuadra |
| 4 | solicitante · aprobador de facturas | factura **contra la orden** por renglón (flujo transaccional), cuadre de 3 vías, aprobación; saldo = total; asiento de devengo `factura_prov_aprobada` |
| 5 | solicitante · aprobador de órdenes de pago · pagador | pago **parcial** y luego el **resto**; la respuesta de la creación de la orden de pago se **aborta en la red** después de que el servidor la procesó (5a: monto que cabe en el saldo; 5b: monto = saldo total) y se reintenta con el mismo formulario; lo mismo con «Marcar pagada» (5c); una sola orden, un solo asiento por pago, saldo correcto |
| 6 | sin llave · anulador | quien no tiene `pago_anular` no ve «Anular» y su PATCH directo recibe `COMPRAS_PERMISO_ACCION`; el anulador anula: el saldo se restituye, el asiento original queda con `anulado_por_id`, hay un asiento de reverso publicado y el efecto neto es cero |
| 7 | solicitante · revocada · pagador | 7a doble clic en «Crear orden»; 7b **cero filas**: con el diálogo de «Anular» ya abierto un administrador le quita «Editar» (y luego su llave) a quien lo pulsó: la pantalla **avisa** y nunca muestra éxito; 7c doble clic en «Marcar pagada» |
| 8 | solicitante | números de factura `1-23` y `12-3` (se aceptan), `123` y `FAC001` con `FAC-001` ya registrada (se rechazan con el aviso de número duplicado y el formulario queda abierto) |
| 9 | genéricos · sin asignación | con `approve`/`change_status` genéricos y sin llave por acción: sin botón y `COMPRAS_PERMISO_ACCION` por API; con las seis llaves pero asignada solo al proyecto B: no ve nada del proyecto A y sus PATCH afectan 0 filas |
| 10 | (lectura) | conciliación: saldo = suma de los pagos vivos, un asiento por pago, un reverso, ninguno huérfano ni sin líneas, todos cuadran |

Lo que **no** ofrece la pantalla (los PATCH de contraste de las fases 3, 4, 6 y 9, la preparación y revocación de permisos de la fase 7b y la lectura de verificación)
se hace por la API **con la sesión de la persona** y se rotula «vía API» en cada línea; nada se simula con SQL. El administrador del padrón solo **verifica**
(lee saldos y asientos) y prepara la revocación de la fase 7b por la API del editor de roles; no ejecuta ningún paso del circuito.

## Cómo se corre
1. Sembrar el padrón **una vez**: `padron_ui_contabilidad.sql.tpl` con `__PW__` sustituido en memoria al enviarlo con la herramienta SQL del sandbox
   (la contraseña no se guarda en el repositorio). Aborta si ya existe y también si falta una llave del catálogo (migración 0900) o un mapeo contable
   del proyecto A (método de pago «transferencia», cuentas por pagar, puente de compras): sin ellos el pago no generaría asiento.
2. Levantar la app apuntando al sandbox (como en la sección anterior), por ejemplo en el puerto 5198, y comprobar que el JS servido no contiene la referencia de producción.
3. `ZZ_UI_PW=… ZZ_UI_SALIDA=<carpeta> CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node supabase/tests/compras_bloque_b/pantalla_sandbox/pantalla_contabilidad.mjs`
   (`UI_BASE` cambia la dirección de la app; `FASE=1,2,3` corre solo esas fases; si hay `HTTPS_PROXY`, `127.0.0.1` y `localhost` van directos).
   Escribe en `ZZ_UI_SALIDA`: capturas `.png`, `resultado.json` (comprobaciones, hallazgos, hosts de red, peticiones bloqueadas) y `estado.json` (solo ids).
   Sale con código 1 si alguna comprobación falla.
4. Al terminar: ejecutar `retiro_padron_ui_contabilidad.sql` (ver abajo) y detener la app.

## Salvaguardas del guion
- Toda petición a la referencia de producción se **aborta y se cuenta**; el resumen imprime el destino de red (esperado: solo `127.0.0.1` y el host del sandbox) y las
  peticiones bloqueadas (esperado: 0). Si la sesión o una petición apunta a producción, el guion se detiene.
- Sin `ZZ_UI_PW` no corre; la contraseña no se guarda en el repositorio, ni las llaves ni los tokens en la salida (la llave pública se toma de las peticiones de la propia app).
- Los avisos de la pantalla (los «toast» de `notify`) se registran **todos**, con su texto, para poder afirmar que una acción rechazada o sin filas **nunca** mostró éxito.
- La prueba de red usa `page.route`: la petición llega al servidor (`route.fetch()`) y solo la **respuesta** se aborta (`connectionreset`), igual que un corte real.
- Todo dato escrito es simulado, de la empresa «ZZ UI Contabilidad» (prefijo de id `5b5b3000-…`) y de usar y tirar.

## Retiro del padrón
`retiro_padron_ui_contabilidad.sql` borra **solo** filas del prefijo `5b5b3000-` y sus dependientes, en una sola transacción, **sin** `session_replication_role`
ni desactivar triggers:
1. `DELETE` de la fila de la empresa del padrón: la purga en cascada de una empresa es el camino soportado (los documentos «no se borran» salvo en esa cascada,
   `20261027000200`). Las cuentas del catálogo base solo se borran con el GUC documentado `conta.allow_system_write = on` (`conta_cuenta_proteger_borrado`), que se activa
   con `set_config(…, true)` únicamente alrededor de ese `DELETE` y se apaga justo después.
2. Lo que no cuelga de la empresa por clave foránea: `public.app_users` y `auth.users` por prefijo (la cascada de `auth` se lleva sesiones e identidades).
3. Las huellas de auditoría de esas entidades (`audit_log`, `permission_audit_log`), solo las filas cuyo contenido nombra el prefijo.
4. Comprobación: ninguna columna `uuid` de `public` ni de `auth` conserva el prefijo; si queda algo, todo se deshace.

**Particularidad del sandbox (medida):** la herramienta SQL corta a los 60 s y, en este sandbox, un `DELETE` que corre directamente en la transacción tras fijar un GUC
no termina en 60 s ni para una fila; dentro de un sub-bloque `BEGIN … EXCEPTION … END` termina en milisegundos y la cascada de la empresa en ~1 s. Por eso cada `DELETE`
del retiro va en su propio sub-bloque (el error se vuelve a lanzar: no cambia ningún resultado).

## Estado conocido al escribir esta sección
Con la pantalla actual, las comprobaciones del **reintento tras un corte de red con el saldo total** (5b) y del **doble clic en «Crear orden» con el monto por omisión** (7a)
**fallan**: el servidor sí deja una sola orden, pero la pantalla muestra `COMPRAS_PAGO_EXCEDE_SALDO` («ya hay … reservado en otras órdenes») porque la segunda petición con la misma
clave de idempotencia topa con el control de saldo del trigger antes que con el índice único, y `useCrearOrdenPagoMutation` solo recupera la orden previa en el caso del índice único.
Con un monto que cabe en el saldo (5a) el reintento termina en éxito. No es un fallo del guion: es el resultado que debe verse hasta que se corrija la pantalla (o el trigger).
