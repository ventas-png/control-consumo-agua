# Captura autoritativa de lecturas de agua

> Migraciones `20260910000001_registrar_lectura_autoritativa.sql` y
> `20260910000101_reporte_inconsistencias_lecturas.sql`.

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
