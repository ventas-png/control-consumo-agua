# Captura autoritativa de lecturas de agua

> Migraciones `20260910000200_registrar_lectura_autoritativa.sql` y
> `20260910000300_reporte_inconsistencias_lecturas.sql`.

## El problema que cierra

Una lectura de agua era un `INSERT` directo del navegador a `registros`, y el
navegador mandaba **todas** las columnas del cargo:

```
lectura_anterior, consumo, tarifa_aplicada, tarifa_exceso_aplicada,
canon_aplicado, monto_calculado, tipo_cobro, project_id, cliente_id, estado
```

La policy `registros_insert` contesta una sola pregunta —«¿puede este usuario
escribir en ESTE proyecto?»— y no mira ni un valor. Un `POST` a
`/rest/v1/registros` con `consumo: 0`, `monto_calculado: 0` y `estado: 'pagado'`
entraba: un recibo de agua en cero, firmado por la base.

Y aun sin mala fe el dato salía mal, porque `lectura_anterior` la elegía el
navegador con los registros que tenía **en memoria**:

- `getUltimaLectura` ordenaba sólo por `fecha`, y dos lecturas del mismo día
  tienen la misma `fecha` (ambas al mediodía): el desempate lo decidía el motor
  de JS.
- La lista en memoria está recortada (`limit(5000)`, RLS del rol, filtro de
  proyecto). Si la última lectura del contador no bajaba, el cliente creía que
  era la **primera** y facturaba contra `contadores.lectura_inicial`.
- Dos lecturistas sobre el mismo contador leían ambos el mismo «anterior» y
  ninguno veía al otro: no había bloqueo en ninguna parte.

## Cómo queda

`registrar_lectura(...)` recibe **sólo lo que el operador sabe** y resuelve el
resto en el servidor, dentro de una transacción:

| El cliente aporta | El servidor resuelve |
| --- | --- |
| contador, lectura actual, fecha | `lectura_anterior`, `consumo`, `secuencia` |
| foto (path), GPS, notas | `tarifa_aplicada`, `tarifa_exceso_aplicada`, `canon_aplicado` |
| llave de idempotencia | `monto_calculado`, `tipo_cobro` |
| reset + lectura final del medidor retirado | `project_id`, `cliente_id`, `cliente_nombre` |
| inicio de servicio (sólo la 1ª lectura) | `estado` inicial, `fecha`, `dias_servicio` |

No es que los campos de cobro se ignoren: **no se pueden expresar**. La RPC no
tiene parámetro donde escribirlos.

Dentro de la transacción, en este orden:

1. Se toma `pg_advisory_xact_lock` **por contador** (no por fila: un lock de
   fila no existe cuando aún no hay ninguna lectura, que es justo el caso de la
   primera captura).
2. Se valida el acceso al contador (empresa + `can_access_project`).
3. Se obtiene la lectura vigente con **orden total** `(secuencia, fecha,
   created_at, id)`, ignorando `deleted_at`.
4. Se lee la **tarifa vigente desde la base** por `contadores.tarifa_id`; si no
   hay o no está activa, la captura se rechaza (antes salía un recibo en cero).
5. Se calcula consumo e importe en `NUMERIC`, con el redondeo del contrato
   (`round(x, 2)` = *half away from zero* = `redondear2`).
6. Se inserta y se devuelve la fila final.

### La autorización sigue siendo la policy

`registrar_lectura` es **SECURITY INVOKER** a propósito: el `INSERT` lo ejecuta
el usuario y lo juzga `registros_insert`. Con `SECURITY DEFINER` habría que
copiar esa lógica dentro del cuerpo, donde un `CREATE OR REPLACE` futuro puede
perderla sin que nadie lo note — el incidente que documenta `20260729000200`.

La única pieza `SECURITY DEFINER` es `agua_lectura_contexto`, y por una razón
concreta: un operador de campo puede tener `agua.lecturas.create` **sin**
`agua.lecturas.view`. Con los privilegios del invocante, la consulta de la
lectura vigente devolvería cero filas justo para esas cuentas, el servidor
concluiría «primera lectura» y facturaría contra `lectura_inicial`. El fallo
sería silencioso y a favor de quien captura. La función tiene su propio guard de
alcance, así que no es un oráculo.

## Las tres reglas de negocio

Decididas explícitamente, no inferidas del código:

| Caso | Regla |
| --- | --- |
| **Varias lecturas el mismo día** | Se permiten y se **encadenan**. La segunda del día toma como anterior a la primera; la tercera, a la segunda. El orden lo da `secuencia`, asignada bajo el bloqueo. El índice único natural `(contador, lectura, fecha)` sigue rechazando el reenvío idéntico. |
| **Lectura retroactiva** | Se **rechaza** (`22023`). La fecha no puede ser anterior al día de la lectura vigente. Corregir el histórico es un flujo aparte, con revisión: esta RPC no reescribe importes ya calculados. |
| **Reset / cambio físico de medidor** | El operador captura la lectura **final del medidor retirado** y el consumo es el real: `consumo = (final_retirado − anterior) + lectura_actual`. El motivo en notas pasa a **obligatorio** (mínimo 10 caracteres) y la fila queda marcada (`es_reset`, `lectura_final_retirada`). Antes se guardaba consumo 0, que regalaba el agua consumida por el medidor viejo desde su última lectura. |

Además, una lectura con fecha futura (más de un día por delante de la zona del
tenant) se rechaza.

## Idempotencia por operación

`registros.idempotency_key` identifica la **operación** de captura, no la
lectura. La clave natural `(contador · lectura · fecha)` no servía para eso: dos
lecturas legítimas del mismo contador, el mismo día y con el mismo número —el
medidor no se movió, o el lecturista re-capturó— son indistinguibles de un
reenvío, y la cola offline descartaba una lectura real creyéndola un reintento.

La llave se genera una vez al guardar y viaja con la lectura hasta que entra,
reintentos incluidos. Su índice único **no** es parcial por `deleted_at`: si la
lectura se borró, reintentar la misma operación no la resucita.

La cola offline (`src/lib/lecturasOutbox.ts`) ya no hace `check-then-insert`:
llama a la RPC con su llave y el servidor decide. Las pendientes encoladas por
una app anterior se migran al leer la cola, con una llave **determinista**
derivada de su clave natural.

## La transición del `INSERT` directo

El `INSERT` directo no lo hace sólo el navegador: la app nativa (Capacitor) ya
está publicada con el bundle viejo y puede llevar lecturas en su cola local
durante semanas. Revocar el `INSERT` hoy no cerraría un agujero: tiraría
lecturas de campo que nadie puede volver a tomar.

Lo que sí se cierra hoy, que es el agujero: **los valores de ese cliente dejan
de creerse**. `trg_agua_lectura_autoritativa` (BEFORE INSERT) los recalcula con
el mismo motor que la RPC y reescribe `project_id`, `cliente_id`,
`lectura_anterior`, `consumo`, tarifas, importe, `tipo_cobro`, `secuencia`, el
estado inicial y todo el desglose de factura. A partir de esta migración no hay
dos juegos de reglas: hay dos puertas al mismo cálculo.

Y una de ellas tiene fecha de cierre, escrita en el cuerpo del trigger:

> **A partir del 2026-12-01 el `INSERT` directo lanza `42501`.**

`registros.origen` (`'rpc'` / `'directo'`) es la métrica para confirmar que la
cola se vació antes de que llegue:

```sql
SELECT origen, count(*), max(created_at)
FROM public.registros
WHERE created_at > now() - interval '30 days'
GROUP BY origen;
```

Cuando `'directo'` deje de crecer, la fecha del trigger puede adelantarse y el
`INSERT` revocarse del todo con un
`REVOKE INSERT ON public.registros FROM authenticated`.

`service_role` queda fuera del trigger a propósito: es el sembrado de E2E, los
backfills y las edge functions —no el navegador, que es el sujeto del
problema— y varias de esas escrituras son históricas por definición. Lo que
escriba por ahí lo audita igual el reporte.

El cliente viejo pierde exactamente una capacidad: **no puede registrar resets**
(no sabe expresar la lectura final del medidor retirado). Es el único caso en
que su número estaba mal de todas formas.

## El inventario de lo que ya está mal

`agua_lecturas_inconsistencias(p_project_id)` y su
`_resumen(...)` publican, en **sólo lectura**, las lecturas históricas cuyo dato
es internamente contradictorio o sospechoso:

| Severidad | Hallazgo | Qué dice |
| --- | --- | --- |
| alta | `cadena_rota` | `lectura_anterior` no es la lectura vigente que la precede |
| alta | `consumo_incoherente` | el consumo no es la resta de sus propias lecturas |
| alta | `monto_cero_con_consumo` | consumo positivo cobrado en cero |
| alta | `cruce_proyecto` | la lectura vive en un proyecto distinto al de su contador |
| alta | `pagada_sin_pago` | nació `'pagado'`, sin pago ni fecha |
| media | `varias_el_mismo_dia` | varias lecturas vivas del mismo contador y día |
| media | `retroactiva` | se escribió después de otra que ya cubría una fecha posterior |
| media | `sin_contador` | no hay base contra la cual encadenar ni auditar |
| media | `monto_sin_redondear` | importe con más de dos decimales (flotante de JS) |
| informativa | `difiere_de_tarifa_actual` | difiere del cálculo de hoy (la tarifa pudo cambiar) |

Ambas funciones son `STABLE`: no pueden escribir aunque el SQL lo intentara.
**Nada se corrige automáticamente.** Cada una de esas filas puede ser un recibo
emitido, cobrado y contabilizado; reescribirlas en lote movería dinero de
clientes reales sin que nadie lo hubiera mirado.

Desde la línea de comandos:

```bash
SUPABASE_URL="https://<ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role>" \
node scripts/reporte-lecturas-inconsistencias.mjs --csv /tmp/lecturas.csv
```

## Verificación

- `supabase/tests/registrar_lectura/run.sh` — 38 invariantes contra un Postgres
  real: el payload falsificado, el encadenado del mismo día, el replay del
  outbox, el reset y sus límites, la retroactiva, la soft-deleted, el cruce de
  tenant/proyecto, la concurrencia con **dos conexiones**, la ACL y el camino
  ejercido como `authenticated`. Corre en CI (`coverage.yml`).
- `src/lib/__tests__/paridadCostoTarifa.test.ts` — la paridad del importe entre
  `calcularCostoTarifa` (TypeScript) y `agua_costo_tarifa` (SQL), sobre el mismo
  `paridad-casos.json` que ejercita el harness de SQL. Los valores esperados
  están escritos a mano en el fichero: si las dos implementaciones se
  equivocaran igual, seguiría fallando.
- `src/__tests__/registrarLecturaAutoritativa.test.ts` — guards estáticos sobre
  el SQL, para que nadie le agregue a la RPC el parámetro que la vaciaría de
  sentido.

## Despliegue

Las dos migraciones tienen que estar aplicadas **antes** de que llegue un
cliente que llame a `registrar_lectura`, y ese cliente es el propio despliegue
de pruebas: la suite E2E corre contra el sandbox fijo que declara
`E2E_EXPECTED_SUPABASE_REF`, no contra la preview branch del PR. Sin la RPC en
esa base, `POST /rest/v1/rpc/registrar_lectura` responde **404** y las tres
pruebas que capturan una lectura fallan.

Ese 404 no es ruido de infraestructura ajeno al cambio: **es exactamente lo que
este PR despliega**. El orden es el mismo que para cualquier RPC en el camino de
dinero:

1. Aplicar `20260910000200` y después `20260910000300` (la segunda usa
   `agua_costo_tarifa`, que crea la primera) al sandbox de E2E.
2. Comprobar que la función existe con su firma exacta y su ACL:

   ```sql
   SELECT p.oid::regprocedure::text            AS firma,
          p.prosecdef                          AS es_security_definer,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS la_ejecuta_authenticated,
          has_function_privilege('anon',          p.oid, 'EXECUTE') AS la_ejecuta_anon
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'registrar_lectura';
   ```

   Lo esperado es `es_security_definer = false` (la autorización sigue siendo
   la policy `registros_insert`), `authenticated = true` y `anon = false`.
3. Recién entonces exigir la suite completa: **25 de 25**, sin omisiones.

A producción llegan por `apply-migrations-prod.yml` con el push a `main`, como
cualquier otra migración.


## El otro lado de la puerta: el `UPDATE`

> Migración `20260910235732_proteger_update_registros_y_cobro_autoritativo.sql`.

`20260910000200` cerró la CREACIÓN de la lectura, pero su trigger es BEFORE
**INSERT**. La policy `registros_update` autoriza por FILA y no mira ni una
columna, así que lo que no se podía escribir al crear se podía escribir un
milisegundo después:

```
PATCH /rest/v1/registros?id=eq.<uuid>
{ "monto_calculado": 0, "consumo": 0, "estado": "pagado",
  "monto_pagado": 999999, "factura_estado": "pagada" }
```

Y no es una hipótesis: `supabase/tests/proteger_update_registros/` **desactiva el
trigger nuevo, hace ese PATCH como `authenticated` con la RLS puesta y comprueba
que entra**; después lo reactiva y comprueba que deja de entrar. Si algún día el
agujero dejara de reproducirse, la invariante 1 falla y avisa.

### Qué paraba ya la RLS, y qué no

Conviene ser exacto. `registros_update` no declara `WITH CHECK`; cuando falta,
Postgres reutiliza el `USING` sobre la fila nueva, y además aplica la policy de
SELECT al resultado. Entre las dos, **`project_id` no se puede mover a un
proyecto que la cuenta no vea**. Eso es todo lo que paraban: dentro del alcance
que la cuenta ya tiene, la lectura entera se reescribía —incluido el `contador_id`,
que reasigna la lectura al medidor de otra unidad y otro cliente— y el cobro se
fabricaba entero.

### Las tres clases de columna

| Clase | Columnas | Quién puede |
| --- | --- | --- |
| **Inmutables** | contador, proyecto, cliente, fecha, lecturas, consumo, tarifas, canon, importe, tipo de cobro, secuencia, llave de idempotencia, origen, reset, mes, creación | **Nadie** por `UPDATE`. Para corregir una lectura se anula y se vuelve a capturar: eso deja rastro |
| **De cobro** | estado, factura_estado, abonado, fecha de pago, vencimiento, IVA, totales, mora, sellos de emisión/pago/anulación | Sólo con la llave `agua.cobro_autoritativo`, que encienden las RPC de abajo |
| **Libres** | notas, foto, gps, borrado lógico | `UPDATE` normal: no fabrican un cobro |

El trigger es **SECURITY INVOKER** a propósito, y la primera versión no lo era:
dentro de una función DEFINER `current_user` es el DUEÑO, así que la lista de
roles exentos se cumplía siempre y el guard no paraba nada. Lo cazó la
invariante 2. (El mismo detalle hace que la comprobación `current_user =
'service_role'` de `20260910000200` sea inalcanzable; allí la exención funciona
por el claim del JWT, que es lo que manda Supabase.)

La exención es una **allowlist cerrada** —`service_role`, `postgres`,
`supabase_admin`—, así que un rol nuevo nace protegido. Lo que queda fuera está
enumerado en la cabecera de la migración: timbrado fiscal, purga de fotos, cron
de mora y de cierre de ciclo, y los backfills.

### El camino autorizado

Una RPC por transición real, todas con permiso explícito y **auditoría** en
`security_logs`:

| RPC | Permiso | Qué calcula el servidor |
| --- | --- | --- |
| `agua_factura_emitir` | `agua.cobros.change_status` | tasa de IVA (de `companies`), días de vencimiento (regla de mora activa), IVA, total |
| `agua_registro_acreditar_pago_externo` | sólo `service_role` | el abono del payfac que `confirm-charge` concilia: suma, liquidación y cierre de factura |
| `agua_factura_anular` | `agua.cobros.change_status` | la transición y su sello |
| `agua_factura_registrar_pago` | `agua.cobros.create` | abonado acumulado, si liquida, fecha de pago (zona del tenant) y la transición de la factura |
| `agua_registro_marcar_mora` | `agua.cobros.change_status` | el alcance se comprueba **por fila**, no por lote |
| `agua_registro_cambiar_estado` | `agua.lecturas.change_status` | sólo `pendiente` \| `mora` |

**`'pagado'` a mano se rechaza.** El modal de Historial lo ofrecía y era un
`UPDATE` de una columna: un recibo cobrado sin monto, sin fecha y sin rastro —el
hallazgo `pagada_sin_pago` del reporte, y la vía por la que se producía. Ahora se
cobra registrando el pago, que exige el monto.

La auditoría entra por `agua_cobro_auditar`, que es SECURITY DEFINER porque
`authenticated` dejó de escribir en `security_logs` (20260910000001) —con razón:
un log en el que cualquiera escribe no es un log—. No lo reabre: exige la llave
de capacidad, así que llamarla suelta desde la API no escribe nada.

### El reporte dejaba ver el proyecto entero

`agua_lecturas_inconsistencias` es SECURITY DEFINER y autorizaba con
`company_id` + `can_access_project`. Ninguna de las dos mira si la cuenta tiene
permiso de LECTURA sobre agua. Una cuenta de campo asignada al proyecto —con
`agua.lecturas.create` como único permiso, que no puede leer ni una fila de
`registros`— recibía el informe completo del condominio: consumos, importes,
nombres de cliente y quién debe. Un residente también.

Ahora exige lo mismo que la rama interna de `registros_select`: uno de los cinco
permisos de lectura de agua, empresa resuelta, proyecto de esa empresa y acceso
al proyecto; y el rol `cliente` queda fuera explícitamente. Sigue siendo
SECURITY DEFINER porque cruza `contadores`, `tarifas` y `companies` para
recalcular: con los privilegios del invocante el informe saldría a medias y en
silencio, que en un artefacto de auditoría es peor que no salir.

## Los tres agujeros que dejó la primera versión

La revisión de `20260910235732` encontró que había cerrado el `PATCH` con tres
defectos de fondo. Los cierra `20260911031701`.

### 1 · La exención de `postgres` era una puerta, no una excepción

El guard eximía a `current_user IN ('service_role','postgres','supabase_admin')`.
Pero **una función `SECURITY DEFINER` se ejecuta como su propietario**, y aquí el
propietario es `postgres`: cualquier función DEFINER —incluida una que
`authenticated` pueda invocar— pasaba el guard sin llave. La lista pretendía
nombrar al cron y a la plataforma; en realidad nombraba «casi todo».

Se va. Los dos caminos de sistema que de verdad escriben columnas de cobro
reciben la llave **por función**: la encienden al entrar con
`set_config('agua.cobro_autoritativo', 'on', true)` y la apagan antes de salir,
así que la capacidad vive mientras esa función corre —y mientras corre lo que
ella llame— y no una sentencia más, y está enumerada.

### Por qué en el cuerpo y no en `proconfig`

La primera versión la ponía con `ALTER FUNCTION … SET`, que es la forma limpia de
decirlo: el par vive en `pg_proc.proconfig`, se enciende al entrar y se restaura
al salir pase lo que pase. **No se puede.** `agua.cobro_autoritativo` es un GUC de
clase personalizada —ninguna extensión lo define, así que para Postgres es un
*placeholder*— y meter un placeholder en un array de configuración está reservado
al **superusuario**: `validate_option_array_item()` responde
`42501 permission denied to set parameter`. El razonamiento de Postgres es bueno:
al resolverse, el placeholder podría resultar ser una variable `SUSET`, y
entonces ya sería tarde para comprobar el permiso.

En una Supabase gestionada el rol que aplica las migraciones (`postgres`) no es
superusuario, así que esa cláusula **aborta la migración y toda la cadena detrás
de ella**. Se vio en la Supabase Preview de #847 el 2026-09-11, y no se había
visto antes porque el arnés de pruebas levanta Postgres con `initdb`, donde
`postgres` sí es superusuario — el mismo par «pasa en local, falla en la branch»
de #855, sólo que al revés. La regla (f) de `migrations-guard` lo caza ahora
estáticamente, y la invariante 25 del arnés exige que **nadie** lo lleve en
`proconfig`.

La mora del cron la recibe de una **envoltura** nueva en vez de tocar la función
real, y no por gusto: `aplicar_mora_facturas_vencidas` es una de las que se
editaron a mano en producción (drift declarado, inventario en #826). Reescribirla
desde el repositorio dejaría a producción, a `main` y al PR diciendo tres cosas
distintas del mismo objeto, que es justo el *cambio ambiguo* que el auditor de
tres vías cierra en falso a propósito. Cuando #826 reconcilie la función, la
envoltura se colapsa en ella.

El inventario completo de escritores de `public.registros` está en la cabecera de
la migración. Resumido:

| Camino | Cómo entra ahora |
| --- | --- |
| las 5 RPC de cobro, y la del payfac | encienden la llave ellas mismas |
| `agua_cerrar_ciclo_nucleo` (y sus dos llamadores, uno del cron) | enciende la llave en su cuerpo y la apaga al salir |
| `aplicar_mora_facturas_vencidas` | la envoltura `agua_mora_cron_aplicar`, que lleva la llave y es a la que apunta el job |
| edge `confirm-charge` | `service_role`, vía `agua_registro_acreditar_pago_externo` |
| purgas de `foto` (2 funciones + 1 edge) | nada: `foto` no fabrica un cobro |
| backfills históricos | corren **antes** que el guard en el orden de migraciones |

Para que quitar la exención no deje al equipo sin salida ante un histórico malo,
existe una segunda llave explícita, `agua.lectura_correccion_autorizada`, que
sólo un `SET LOCAL` de una migración revisada enciende. No la enciende ninguna
función de la aplicación, un cliente no puede ponerla (los GUC no se tocan desde
la Data API) y es greppable.

### 2 · El pago no se serializaba

`agua_factura_registrar_pago` leía `monto_pagado` y escribía después **sin
bloquear la fila**: dos abonos simultáneos partían del mismo previo y el segundo
pisaba al primero —dinero cobrado al cliente y perdido en la factura—. Ahora toda
transición financiera relee la fila con `agua_cobro_bloquear`, que es un
`SELECT … FOR UPDATE`, así que emitir, anular, pagar, mora y cambio de estado se
serializan por registro.

`confirm-charge` tenía el mismo defecto en JavaScript, y era peor: el retorno del
portal y el cron de reconciliación son dos confirmaciones que llegan a la vez.
Ya no hace `UPDATE`: llama a `agua_registro_acreditar_pago_externo`, que bloquea
igual. **No** rechaza el sobrepago, y es a propósito: el dinero ya salió de la
tarjeta y rechazarlo dejaría al cliente cobrado y al recibo sin acreditar; lo
registra y lo audita.

### 3 · `p_dias_vencimiento` era un parámetro de cobro

Volvía a poner en el cliente una decisión que mueve dinero: el vencimiento decide
cuándo aplica la mora. Se elimina de la firma pública —`agua_factura_emitir` sólo
recibe `p_registro_id`— y el plazo sale de `reglas_mora_config` o del valor
seguro del servidor (30). Una excepción manual, si operación llega a necesitarla,
es otra RPC con su permiso, sus límites, su motivo obligatorio y su auditoría; no
un argumento más de la emisión.

## La conciliación del payfac era un check-then-insert

`confirm-charge`, tras preguntarle al proveedor si el cobro se aprobó, hacía
cuatro pasos **cada uno en su propia transacción**: un `SELECT` de idempotencia
por `referencia`, el `INSERT` del pago, el `UPDATE` del ítem y el cierre de la
solicitud. El retorno del portal y el cron de reconciliación confirman la misma
solicitud a la vez, así que los cuatro fallos son de todos los días:

| Momento | Qué queda |
| --- | --- |
| dos confirmaciones pasan el `SELECT` antes de que ninguna inserte | **dos pagos y doble acreditación** — no había UNIQUE que lo impidiera |
| rotura entre el `INSERT` y el `UPDATE` | pago escrito, recibo sin acreditar; y el reintento encuentra el pago y sale por «already», así que **nunca** acredita |
| rotura entre el `UPDATE` y el cierre | la solicitud queda `pending` para siempre |
| el guard miraba la `referencia`, no la solicitud | dos `payment_requests` con la misma referencia se tapaban entre sí |

`conciliar_pago_externo(p_payment_request_id)` (migración `20260911042839`) hace
los cuatro pasos en **una** transacción: bloquea la solicitud con `FOR UPDATE`,
sale si ya está `succeeded`, inserta el pago, bloquea el recibo o la cuota,
acredita y cierra. **Recibe sólo el id**: el monto, el ítem, el método y la
referencia salen de la fila bloqueada, así que el edge no tiene dónde mentir. Y
el orden de bloqueos —solicitud, después ítem— es siempre el mismo, así que dos
solicitudes distintas del mismo recibo no pueden interbloquearse.

### Dos defensas, y las dos hacen falta

La idempotencia deja de ser una consulta para ser una **restricción**:
`pagos.payment_request_id` con `UNIQUE`. Una consulta se puede correr dos veces
a la vez; un índice único, no.

Medido por mutación sobre la invariante 34:

| Mutante | Resultado |
| --- | --- |
| sin `FOR UPDATE`, con el conflicto **cortando** | correcto igual — el índice lo sostiene |
| sin `FOR UPDATE`, con el conflicto **tragado** | **doble acreditación** |

La segunda fila es la lección, y salió de equivocarse: no basta con que el
`INSERT` no duplique el pago. Al chocar con la llave hay que **salir**, porque
el choque significa «esto ya se acreditó». Seguir de largo deja el pago sin
duplicar y el importe sumado dos veces — peor que fallar.

### Verificación

`supabase/tests/proteger_update_registros/run.sh` — **39 invariantes** contra un
Postgres real, en `coverage.yml`: el agujero ejercido y cerrado, las 18 columnas
de la lectura y las 16 del cobro una por una (exigiendo el mensaje del guard, no
un rechazo cualquiera), el ciclo emitir → pagar → anular con sus números, la
mora, el `'pagado'` rechazado, la auditoría, la cuenta sin permiso, el otro
tenant, la ACL, la excepción de `service_role`, los cuatro perfiles contra el
reporte, y el camino completo ejercido COMO `authenticated`.

A esas se suman, por los tres agujeros de arriba:

- **23-25** — una `SECURITY DEFINER` ejecutable por `authenticated` intenta
  cambiar `monto_calculado`/`estado` sin llave y recibe `42501`; la llave de
  cobro no abre las columnas de la lectura; y la capacidad por función deja pasar
  a los dos caminos de sistema enumerados **y sólo a ellos**.
- **26-27** — concurrencia **real, con dos conexiones** (`dblink_send_query`, no
  un `lock_timeout` que pasaría igual sin el `FOR UPDATE`): dos abonos solapados
  se contabilizan los dos, una sola vez cada uno, y el saldo cuadra; dos
  emisiones solapadas emiten una sola factura.
- **28-30** — las carreras pagar/anular, pagar/mora y el estado a mano sobre una
  factura ya pagada.
- **31-33** — la RPC del payfac: revocada de `authenticated`, cerrada también a
  una `SECURITY DEFINER` suya (el `GRANT` no basta; el chequeo de rol sí), y
  sumando, liquidando y auditando cuando la llama quien debe.
- **34-39** — la conciliación transaccional: dos confirmaciones **concurrentes**
  de la misma solicitud dejan un pago y una acreditación; un fallo **provocado**
  entre el `INSERT` y la acreditación (un trigger de prueba que revienta el
  `UPDATE` del recibo) revierte todo y el reintento cuadra; dos solicitudes
  distintas del mismo recibo suman los dos abonos; repetir una ya conciliada es
  un no-op; y ni `authenticated` ni una `DEFINER` suya la alcanzan.

Las invariantes 26, 32 y 34 están comprobadas **por mutación**: quitar el `FOR
UPDATE` hace fallar la 26 («se perdió uno»), quitar el chequeo de rol hace
fallar la 32, y tragarse el conflicto de la llave única hace fallar la 34 («la
segunda confirmación volvió a conciliar»). Una prueba que pasa con y sin el
arreglo no prueba nada.

`src/__tests__/protegerUpdateRegistros.test.ts` — guards estáticos sobre el SQL:
la lista de columnas protegidas y las firmas de las RPC, para que nadie les
agregue el parámetro que las vaciaría de sentido.
