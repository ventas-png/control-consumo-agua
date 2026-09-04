# Propuesta — retirar el acceso público a `net._http_response` y `net.http_request_queue`

> **NO APLICADA, y NO aplicable como una migración normal.** No hay ningún
> archivo en `supabase/migrations/**` que la implemente, y no debe crearse desde
> este PR — ni desde ningún otro, hasta resolver el punto siguiente, que manda
> sobre todo lo demás.

## Lo primero: el pipeline NO puede ejecutar este REVOKE

Medido contra el catálogo real:

| Objeto | Dueño | Otorgante de los grants a `PUBLIC` |
| --- | --- | --- |
| `net._http_response` | `supabase_admin` | `supabase_admin` |
| `net.http_request_queue` | `supabase_admin` | `supabase_admin` |
| `net.http_request_queue_id_seq` | `supabase_admin` | `supabase_admin` |

El ejecutor habitual de las migraciones es **`postgres`**, que en un proyecto
Supabase gestionado **no es superusuario**, **no es miembro de `supabase_admin`**
y **no tiene grant option** sobre esos objetos.

En PostgreSQL, un `REVOKE` emitido por un rol sin autoridad sobre el objeto
**no falla**:

```
WARNING:  no privileges could be revoked for "_http_response"
REVOKE
```

Sale **0**. La migración quedaría registrada como aplicada, el pipeline en
verde, y `PUBLIC` conservándolo todo. Es un falso negativo de seguridad
perfecto: el registro dice que la vía se cerró, y la vía sigue abierta.

**Por eso esto no se abre como «una migración más».** Hace falta una operación
soportada, ejecutada con la autoridad del propietario — en la práctica,
**a través de Supabase Support**, que es quien puede actuar como
`supabase_admin` en un proyecto gestionado. Hay que abrir el caso describiendo
el objetivo (retirar los grants a `PUBLIC` sobre las tablas y la secuencia de
`pg_net`, conservando el `USAGE` del esquema) y pedir que lo apliquen ellos, o
que habiliten un mecanismo soportado para hacerlo.

### Atajos PROHIBIDOS

Ninguno es una solución; todos escalan privilegios por la puerta de atrás y
dejan la base peor de como está:

| Atajo | Por qué no |
| --- | --- |
| `SET ROLE supabase_admin` | Escalada de privilegios. Si funcionara sería un agujero peor que el que se intenta cerrar; si no funciona, es ruido en el log. |
| `ALTER TABLE net.… OWNER TO postgres` | Arrebatarle a la extensión sus objetos. La próxima actualización de `pg_net` puede fallar o revertirlo, y mientras tanto `postgres` queda dueño de las tablas de una extensión gestionada. |
| Un wrapper `SECURITY DEFINER` que corra el `REVOKE` | Fabricar exactamente la clase de puerta trasera que este auditor existe para detectar. Y habría que crearla con autoridad de `supabase_admin`, con lo que el problema es el mismo. |
| `ALTER EXTENSION pg_net …`, reinstalar o parchear la extensión | Modificar una extensión gestionada por el proveedor. Se pierde en la próxima actualización y puede romper las integraciones salientes. |

## Lo medido

* el esquema **`net` concede `USAGE` a `PUBLIC`**;
* **`net._http_response`** y **`net.http_request_queue`** conceden a `PUBLIC`
  los **ocho** privilegios de tabla: `SELECT`, `INSERT`, `UPDATE`, `DELETE`,
  `TRUNCATE`, `REFERENCES`, `TRIGGER` y —producción va por PostgreSQL 17—
  `MAINTAIN`;
* **`net.http_request_queue_id_seq`** concede a `PUBLIC` `SELECT`, `USAGE` y
  `UPDATE`.

`net` es el esquema de la extensión **`pg_net`**, que instala Supabase para que
la base pueda hacer peticiones HTTP salientes (webhooks, llamadas a pasarelas de
pago, notificaciones). Los grants son de esa instalación gestionada: **ninguna
migración de este repositorio los declara**, y la reconstrucción local no los
reproduce.

### Los tres que se olvidan

De los ocho, cinco son los de siempre. Los otros tres importan y no estaban
medidos hasta este PR:

| Privilegio | Qué habilita |
| --- | --- |
| `REFERENCES` | Colgar una clave foránea de la tabla ajena, y con eso condicionar sus borrados desde afuera. |
| `TRIGGER` | El peor: **instalar código que corre con las escrituras de `pg_net`**, con lo que se lee o se altera cada petición y cada respuesta sin tocar la tabla directamente. |
| `MAINTAIN` (PostgreSQL 17) | `VACUUM`, `ANALYZE`, `REINDEX`, `CLUSTER` y `REFRESH MATERIALIZED VIEW` sobre la tabla ajena. |

## Qué implica

`PUBLIC` incluye a **todo rol de la base**, presente y futuro, sin necesidad de
que nadie le conceda nada. Pero «tener el privilegio en el catálogo» y «poder
usarlo desde afuera» no son lo mismo, y conviene no mezclarlos:

| Vía | Estado | Por qué |
| --- | --- | --- |
| **Credencial directa a Postgres** (`drift_readonly`, o cualquier rol que se cree después) | 🔴 **RIESGO CONFIRMADO** | Se conecta al puerto de Postgres, no a la API HTTP. El privilegio de `PUBLIC` le alcanza sin más: está medido, y es exactamente por esto que el guard del auditor **rechaza** una credencial provisionada según el README. |
| **`anon` / `authenticated` por el SPA o la Data API** | 🟠 **A VERIFICAR, no confirmado** | `anon` **es** parte de `PUBLIC` en PostgreSQL, así que tiene el privilegio en el catálogo. Pero PostgREST sólo sirve los esquemas declarados en **Data API → Exposed schemas**, y `net` normalmente **no** está ahí. Si no lo está, la vía HTTP no se abre — el privilegio queda latente, no explotable por esa ruta. |

**Qué hay que comprobar, y no dar por hecho:** abrir el panel de Supabase en
*Project Settings → Data API → Exposed schemas* y ver si `net` figura. Si figura,
la fila naranja pasa a roja y la urgencia cambia de categoría. Si no figura,
sigue habiendo que cerrar la vía —el riesgo confirmado de la primera fila no
depende de la Data API— pero sin el agravante de exposición pública por HTTP.

No se afirma acá que el SPA lea `net`: no está medido. Lo que sí está medido es
el catálogo, y el catálogo dice que cualquier rol de la base llega.

Y lo que hay del otro lado no son métricas:

| Objeto | Qué guarda |
| --- | --- |
| `net._http_response` | El **cuerpo** y las cabeceras de cada respuesta HTTP que recibió la base. No tiene secuencia propia: su `id` viene del de la petición. |
| `net.http_request_queue` | Las peticiones pendientes, con su URL, sus cabeceras y su cuerpo. Su `id` sale de **`net.http_request_queue_id_seq`**. |

Las cabeceras de una petición saliente son el sitio natural de una clave de API
o de un `Authorization: Bearer`, y el cuerpo de una respuesta es lo que devolvió
la pasarela. Con `SELECT` eso se lee; con `UPDATE` e `INSERT` se puede fabricar
una respuesta que la base tomará por verdadera; con `DELETE` y `TRUNCATE` se
borra el rastro; con `TRIGGER` se instala código que ve todo lo anterior.

**Por eso no se agrega `net` a `LECTURA_TOLERADA`.** La tolerancia de
`pg_stat_statements` existe porque son contadores; esto es el contenido de las
integraciones, con escritura encima. Tolerarlo sería declarar aceptable justo lo
que este auditor existe para no dejar pasar.

## El rechazo esperado

Con la credencial provisionada exactamente como prescribe el README —`USAGE`
sobre `public` y `extensions`, y nada más— el guard **rechaza**, y está bien que
rechace. El diagnóstico nombra las tablas y dice que el privilegio llega **vía
`PUBLIC`**, así que propone revocarle a `PUBLIC` y **no** al auditor: revocarle
al auditor no quitaría nada, porque nunca se le concedió nada.

Está fijado por `--prueba-live`, que construye esa misma forma en un clúster
desechable y exige el rechazo.

## La propuesta: UN SOLO LOTE, UNA SOLA TRANSACCIÓN

**Supabase Support tiene que ejecutar el lote completo como una única
transacción.** No dividido en partes, no por pasos, no «primero las tablas y
después la secuencia». Es la condición que sostiene todo lo demás:

* la **precondición** aborta antes de que se ejecute un solo `REVOKE` si quien
  ejecuta no tiene autoridad sobre **los tres** objetos;
* la **postcondición** sólo protege si puede **revertir** los `REVOKE` de arriba.
  Fuera de la transacción ya no puede, y un lote a medio aplicar —tablas
  cerradas, secuencia abierta— es peor que no haber empezado, porque el registro
  dice que se hizo.

**Ejecutar con `ON_ERROR_STOP` activo** (en `psql`, `-v ON_ERROR_STOP=1`). Sin
él, `psql` sigue después del error y **sale 0**: la transacción se revierte
igual —el `COMMIT` de un bloque abortado es un `ROLLBACK`— pero el código de
salida diría que salió bien. Está probado en los dos modos.

La **sección de regrants va vacía**, y a propósito no lleva placeholders: un
`<rol>` sin sustituir es un error de sintaxis en el mejor caso y un rol
inventado en el peor. Si el análisis de impacto identifica algún consumidor
legítimo que dependa del grant a `PUBLIC`, se agregan ahí líneas `GRANT`
concretas, con el rol real, **antes** de enviar el lote.

### Autoridad suficiente: tres cosas, y `WITH GRANT OPTION` no es una

La precondición acepta **sólo**:

1. ser **superusuario**;
2. `current_user` = el **propietario** del objeto;
3. **membresía efectiva** en el rol propietario (`pg_has_role(…, 'USAGE')`).

`WITH GRANT OPTION` **no cuenta**, y no es un descuido. Un `REVOKE` retira los
privilegios que otorgó **el rol que lo ejecuta** (o un rol del que sea
miembro). El grant option habilita a *conceder*, y a revocar lo que uno mismo
concedió; no alcanza el grant que hizo otro otorgante. Un migrador con los ocho
privilegios `WITH GRANT OPTION` sobre estas tablas seguiría sin poder tocar los
grants que hizo `supabase_admin`: el `REVOKE` saldría 0 sin revocar nada — el
mismo falso negativo, con mejor disfraz.

Por eso la precondición **mira e informa** el grant option **y el otorgante
real** de cada grant a `PUBLIC`, pero ninguno de los dos participa de la
decisión. Y hay una regresión que lo fija: el migrador recibe los ocho
privilegios `WITH GRANT OPTION`, la precondición lo rechaza igual, y su `REVOKE`
deja la ACL **byte por byte** intacta.

### Las DOS capas del ACL

Un `GRANT SELECT (headers) ON net.http_request_queue TO PUBLIC` **no aparece en
`pg_class.relacl`**: vive en `pg_attribute.attacl`, y alcanza igual para leer
las cabeceras de cada petición saliente —que es donde vive un
`Authorization: Bearer`—. Por eso la precondición y la postcondición miran las
dos:

* **`pg_class.relacl`** — los privilegios de nivel de objeto, sobre los tres;
* **`pg_attribute.attacl`** — `SELECT`, `INSERT`, `UPDATE` y `REFERENCES` por
  columna, sobre **todas** las columnas no eliminadas (`attnum > 0 AND NOT
  attisdropped`) de las dos tablas.

El `REVOKE ALL PRIVILEGES ON TABLE` del lote **sí** retira también los grants por
columna —PostgreSQL los revoca en cascada al revocar a nivel de tabla—, pero eso
es precisamente lo que la postcondición tiene que comprobar en vez de suponer.
Verificado en el clúster desechable: `attacl` queda vacío.

### El otorgante decide, no sólo informa

De cada grant a `PUBLIC` se lee **objeto, columna, privilegio y otorgante**. El
otorgante no está de adorno: un `REVOKE` retira lo que otorgó **quien lo
ejecuta**, o un rol del que sea miembro. Un grant hecho por un tercero
**sobrevive** al `REVOKE`, que sale 0 igual.

Así que la precondición exige poder **actuar como** cada otorgante
(`pg_has_role(current_user, grantor, 'USAGE')`, o ser superusuario). Si aparece
uno que no puede asumir, **aborta antes del primer `REVOKE`** y lo nombra. El
caso real que esto atrapa: el dueño `A` le dio grant option a `B`, y `B` le
concedió a `PUBLIC`; `A` ejecuta el lote de buena fe, y sin este control saldría
0 dejando la columna abierta.

### El lote

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- pg_net · retirar el acceso de PUBLIC a los tres objetos de la extensión.
--
-- ENVIAR Y EJECUTAR COMO UNA SOLA TRANSACCIÓN. No dividir en partes: la
-- postcondición del final sólo protege si puede revertir los REVOKE de arriba.
--
-- Requiere autoridad de propietario (supabase_admin). La precondición aborta
-- si quien ejecuta no la tiene — ver el mensaje que emite.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $precondicion$
DECLARE
  yo        text    := current_user;
  soy_super boolean := coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false);
  privs     text[]  := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
   || CASE WHEN current_setting('server_version_num')::int >= 170000
           THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END;
  esperados text[]  := ARRAY['net._http_response', 'net.http_request_queue', 'net.http_request_queue_id_seq'];
  tablas    text[]  := ARRAY['net._http_response', 'net.http_request_queue'];
  vistos    text[]  := ARRAY[]::text[];
  ausentes  text[];
  faltan    text[]  := ARRAY[]::text[];
  ajenos    text[]  := ARRAY[]::text[];
  gopt      boolean;
  r         record;
  g         record;
BEGIN
  -- ── 1 · Los objetos: que estén los tres, y que sean lo que decimos ───────
  FOR r IN
    SELECT n.nspname || '.' || c.relname                AS objeto,
           c.oid                                        AS oid,
           c.relkind                                    AS relkind,
           pg_get_userbyid(c.relowner)                  AS duenio,
           pg_has_role(yo, c.relowner, 'USAGE')         AS soy_miembro
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname || '.' || c.relname = ANY (esperados)
     ORDER BY 1
  LOOP
    vistos := vistos || r.objeto;

    -- LA FORMA: dos tablas y una secuencia. Si el relkind no es el esperado,
    -- el objeto de producción no es el que este lote cree estar tocando, y el
    -- REVOKE de más abajo estaría escrito para otra cosa.
    IF r.objeto = ANY (tablas) AND r.relkind <> 'r' THEN
      RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: % tendría que ser una tabla (relkind «r») y es «%».',
                      r.objeto, r.relkind;
    END IF;
    IF r.objeto = 'net.http_request_queue_id_seq' AND r.relkind <> 'S' THEN
      RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: % tendría que ser una secuencia (relkind «S») y es «%».',
                      r.objeto, r.relkind;
    END IF;

    -- Grant option: se mide con la función que corresponde al tipo de objeto
    -- —has_sequence_privilege para la secuencia, NUNCA has_table_privilege— y
    -- se informa. NO decide nada: ver el comentario de esta constante.
    gopt := CASE WHEN r.relkind = 'S'
                 THEN (SELECT bool_and(has_sequence_privilege(yo, r.oid, p || ' WITH GRANT OPTION'))
                         FROM unnest(ARRAY['SELECT','USAGE','UPDATE']) p)
                 ELSE (SELECT bool_and(has_table_privilege(yo, r.oid, p || ' WITH GRANT OPTION'))
                         FROM unnest(privs) p)
            END;

    RAISE NOTICE 'OBJETO % (relkind %) · dueño=% · ejecuta=% · miembro=% · superusuario=% · grant option: % (informativo, NO es autoridad)',
      r.objeto, r.relkind, r.duenio, yo, r.soy_miembro, soy_super, gopt;

    IF NOT (soy_super OR r.duenio = yo OR r.soy_miembro) THEN
      faltan := faltan || r.objeto;
    END IF;
  END LOOP;

  -- EXACTAMENTE los tres. Un objeto ausente aborta ANTES de cualquier REVOKE:
  -- un filtro que no empareja se parece demasiado a un permiso que sí está, y
  -- la postcondición daría por cerrada una vía que ni siquiera se miró.
  SELECT array_agg(e ORDER BY e) INTO ausentes
    FROM unnest(esperados) e WHERE NOT (e = ANY (vistos));
  IF ausentes IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: falta(n) % de los % objeto(s) esperados. Encontrados: %. '
                    'Sin los tres no se puede afirmar que la vía quedó cerrada.',
                    array_to_string(ausentes, ', '), array_length(esperados, 1),
                    coalesce(array_to_string(vistos, ', '), '(ninguno)');
  END IF;
  IF array_length(vistos, 1) <> array_length(esperados, 1) THEN
    RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: se esperaban EXACTAMENTE % objetos y se encontraron %: %.',
                    array_length(esperados, 1), array_length(vistos, 1), array_to_string(vistos, ', ');
  END IF;

  -- ── 2 · El inventario COMPLETO de lo que tiene PUBLIC ────────────────────
  --
  -- Las dos capas, porque son dos ACL distintas y la segunda no se ve desde la
  -- primera: `pg_class.relacl` para los tres objetos, y `pg_attribute.attacl`
  -- para TODAS las columnas no eliminadas de las dos tablas. Un
  -- `GRANT SELECT (headers) … TO PUBLIC` no aparece en relacl y alcanza igual.
  --
  -- Y de cada grant se mira EL OTORGANTE, que es lo que decide si el REVOKE va
  -- a servir: PostgreSQL retira lo que otorgó quien ejecuta, o un rol del que
  -- sea miembro. Un grant hecho por un tercero sobrevive al REVOKE, que sale 0
  -- igual. Por eso no basta con mostrarlo: si aparece un otorgante que no se
  -- puede asumir, esto aborta ANTES del primer REVOKE.
  FOR g IN
    SELECT n.nspname || '.' || c.relname                 AS objeto,
           NULL::text                                    AS columna,
           a.privilege_type                              AS priv,
           pg_get_userbyid(a.grantor)                    AS otorgante,
           pg_has_role(yo, a.grantor, 'USAGE')           AS puedo_asumir
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
     WHERE n.nspname || '.' || c.relname = ANY (esperados)
       AND a.grantee = 0            -- 0 es PUBLIC
    UNION ALL
    SELECT n.nspname || '.' || c.relname,
           at.attname,
           a.privilege_type,
           pg_get_userbyid(a.grantor),
           pg_has_role(yo, a.grantor, 'USAGE')
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute at ON at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped
      CROSS JOIN LATERAL aclexplode(at.attacl) AS a
     WHERE n.nspname || '.' || c.relname = ANY (tablas)
       AND a.grantee = 0
     ORDER BY 1, 2 NULLS FIRST, 3
  LOOP
    RAISE NOTICE 'PUBLIC · % · columna=% · privilegio=% · otorgado por=% · ¿puedo actuar como ese otorgante?=%',
      g.objeto, coalesce(g.columna, '(nivel de objeto)'), g.priv, g.otorgante,
      (soy_super OR g.puedo_asumir);

    IF NOT (soy_super OR g.puedo_asumir) THEN
      ajenos := ajenos || format('%s%s → %s (otorgado por %s)',
                                 g.objeto, coalesce('.' || g.columna, ''), g.priv, g.otorgante);
    END IF;
  END LOOP;

  -- ── 3 · Los abortos, juntos y al final ──────────────────────────────────
  --
  -- Después del inventario a propósito: quien opere la base ve de UNA corrida
  -- todo lo que hay que arreglar —qué objetos, qué columnas, qué otorgantes— en
  -- vez de descubrirlo de a uno por intento.
  IF array_length(faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: «%» no tiene autoridad para revocar sobre %. '
                    'No es superusuario, no es el dueño y no hereda su rol. Tener los privilegios '
                    'WITH GRANT OPTION no alcanza: un REVOKE sólo retira lo que otorgó quien lo '
                    'ejecuta. El REVOKE NO fallaría: emitiría un WARNING, saldría 0 y dejaría la '
                    'ACL intacta.',
                    yo, array_to_string(faltan, ', ');
  END IF;

  IF array_length(ajenos, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: «%» no puede actuar como el otorgante de % grant(s) de '
                    'PUBLIC: %. Un REVOKE sólo retira lo que otorgó quien lo ejecuta (o un rol del '
                    'que sea miembro): esos grants sobrevivirían, el REVOKE saldría 0 igual y la '
                    'vía quedaría abierta. Hace falta que lo ejecute el otorgante, o alguien que '
                    'pueda asumirlo.',
                    yo, array_length(ajenos, 1), array_to_string(ajenos, '; ');
  END IF;
END
$precondicion$;

-- ── REVOKE ────────────────────────────────────────────────────────────────
-- ALL PRIVILEGES y no una lista a mano: cubre los ocho privilegios de tabla
-- —SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER y MAINTAIN—
-- y también los que agregue el próximo mayor.
REVOKE ALL PRIVILEGES ON TABLE
  net._http_response,
  net.http_request_queue
FROM PUBLIC;

-- La secuencia de la cola, que es la única que hay: _http_response no tiene
-- secuencia propia.
REVOKE ALL PRIVILEGES ON SEQUENCE net.http_request_queue_id_seq FROM PUBLIC;

-- ── REGRANTS EXPLÍCITOS (aprobados de antemano) ───────────────────────────
-- Vacío: el análisis de impacto todavía no identificó ningún consumidor
-- legítimo que dependa del grant a PUBLIC. Si lo identifica, acá van líneas
-- GRANT concretas, con el rol real, ANTES de enviar el lote. Sin placeholders.
-- (fin de la sección)

DO $postcondicion$
DECLARE
  esperados text[] := ARRAY['net._http_response', 'net.http_request_queue', 'net.http_request_queue_id_seq'];
  tablas    text[] := ARRAY['net._http_response', 'net.http_request_queue'];
  hallados  int;
  cuantos   int;
  restante  text;
BEGIN
  SELECT count(*) INTO hallados
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname || '.' || c.relname = ANY (esperados);
  IF hallados <> array_length(esperados, 1) THEN
    RAISE EXCEPTION 'POSTCONDICIÓN FALLIDA: se esperaban % objetos de pg_net y hay %. '
                    'No se puede afirmar que la vía quedó cerrada sobre un objeto que no está.',
                    array_length(esperados, 1), hallados;
  END IF;

  WITH publico AS (
    -- Capa 1 · pg_class.relacl: los privilegios de nivel de objeto.
    SELECT n.nspname || '.' || c.relname AS objeto,
           NULL::text                    AS columna,
           a.privilege_type              AS priv,
           pg_get_userbyid(a.grantor)    AS otorgante
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) AS a
     WHERE n.nspname || '.' || c.relname = ANY (esperados)
       AND a.grantee = 0            -- 0 es PUBLIC
    UNION ALL
    -- Capa 2 · pg_attribute.attacl: SELECT, INSERT, UPDATE y REFERENCES por
    -- COLUMNA, que no aparecen en relacl y alcanzan igual.
    SELECT n.nspname || '.' || c.relname,
           at.attname,
           a.privilege_type,
           pg_get_userbyid(a.grantor)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute at ON at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped
      CROSS JOIN LATERAL aclexplode(at.attacl) AS a
     WHERE n.nspname || '.' || c.relname = ANY (tablas)
       AND a.grantee = 0
  )
  SELECT count(*),
         string_agg(format('%s%s → %s (otorgado por %s)',
                           objeto, coalesce('.' || columna, ''), priv, otorgante),
                    ', ' ORDER BY objeto, columna NULLS FIRST, priv)
    INTO cuantos, restante
    FROM publico;

  IF cuantos > 0 THEN
    RAISE EXCEPTION 'POSTCONDICIÓN FALLIDA: PUBLIC conserva % privilegio(s) sobre pg_net: %. '
                    'Se revierte la transacción ENTERA —incluidos los REVOKE que sí funcionaron—: '
                    'un REVOKE que no revoca sale 0 y no se distingue de uno que sí.',
                    cuantos, restante;
  END IF;
END
$postcondicion$;

COMMIT;
```

El `USAGE` del esquema **no se toca**: quitarlo rompería `net.http_get()` y
`net.http_post()` para todo el mundo, y no hace falta — sin privilegios sobre
las tablas, el `USAGE` del esquema no alcanza nada. Verificado: aplicando sólo
los `REVOKE` de arriba, la credencial vuelve a pasar el guard.

### Está probado, no supuesto

`--prueba-live` reproduce la forma de producción en un clúster desechable y
ejecuta **el lote completo** en cada escenario. Exige que:

| Escenario | Qué se exige |
| --- | --- |
| El migrador **no es dueño ni miembro** (la forma de producción) | El `REVOKE` suelto **sale 0** y sólo deja un `WARNING`; la **ACL queda intacta**; el auditor sigue rechazando con los mismos privilegios; la precondición **aborta** nombrando dueño y ejecutor. |
| **Falta uno** de los tres objetos | La precondición **aborta aun siendo superusuario**, nombrando cuál falta, y el lote se detiene ahí: **ningún `REVOKE` se ejecuta**. |
| El migrador tiene los ocho privilegios **`WITH GRANT OPTION`**, pero los grants a `PUBLIC` los hizo otro propietario | La precondición lo **rechaza igual**, nombrando al otorgante real; y su `REVOKE` deja la ACL **byte por byte** intacta. |
| Un grant **por columna** a `PUBLIC` otorgado por un **tercero** (`A` da grant option a `B`; `B` concede a `PUBLIC`), ejecutado por el dueño `A` | La precondición **aborta**, identificando **objeto, columna, privilegio y otorgante**; `relacl` **y** `attacl` quedan **byte por byte** iguales. |
| El mismo grant por columna, pero **concedido por el dueño** (contraprueba) | El lote completo **lo elimina**: `attacl` queda vacío, `PUBLIC` no conserva nada, y la **postcondición pasa**. |
| **Propietarios asimétricos**: autoridad sobre las dos tablas, no sobre la secuencia | El lote completo **falla en la precondición**, señalando exactamente la secuencia; las **tres ACL quedan idénticas** — no se aplica ni la mitad que sí podía. |
| La **postcondición falla** (lote sin el `REVOKE` de la secuencia, con autoridad de sobra) | Los `REVOKE` de las tablas **se revierten**: ACL idénticas. Y sin `ON_ERROR_STOP`, `psql` **sale 0** igual — por eso la propuesta lo exige. |
| **Contrapruebas** | Con la autoridad del dueño la precondición **pasa**; con las tres vías cerradas la postcondición **pasa**. Para que «falla siempre» y «detecta lo que hay» no se vean igual desde afuera. |

## Análisis de impacto — qué hay que comprobar antes

1. **Quién lee `net._http_response` hoy.** `pg_net` escribe ahí como su propio
   rol, no como el invocante, así que el `SELECT` de `PUBLIC` no lo necesita la
   extensión: lo necesita quien consulte el resultado de una llamada. Hay que
   buscar en `supabase/functions/**`, en las migraciones y en los cron jobs toda
   referencia a `net._http_response` y ver con qué rol corre cada una.
   *Si alguna corre como `authenticated` o `anon`, retirarle el acceso la rompe*
   — y entonces la sección de regrants del lote es obligatoria, no opcional.
2. **Quién escribe.** `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` desde `PUBLIC` no
   tiene ningún uso legítimo conocido; `pg_net` mantiene sus tablas con su
   propio rol. Confirmarlo antes de revocar.
3. **Quién define triggers o claves foráneas contra esas tablas.** `TRIGGER` y
   `REFERENCES` desde `PUBLIC` tampoco tienen uso legítimo conocido, pero si
   algo los usa, retirarlos lo rompe en silencio: un trigger deja de poder
   crearse recién la próxima vez que se despliegue.
4. **La secuencia.** `net.http_request_queue_id_seq` la usa `pg_net` al encolar
   una petición, con su propio rol. Si algún consumidor legítimo encola desde
   otro rol, necesita `USAGE` explícito sobre ella — comprobarlo antes.
5. **La limpieza periódica.** Si hay un job que purga `net._http_response`,
   comprobar con qué rol corre. `service_role` tiene `BYPASSRLS` pero **no**
   privilegios implícitos sobre tablas: si dependía del grant a `PUBLIC`, hay
   que concederle explícitamente.
6. **Que el `REVOKE` es idempotente y reversible.** Lo es: se revierte con el
   `GRANT` simétrico, y no toca datos.
7. **Que no lo reponga la próxima actualización de `pg_net`.** Un
   `ALTER EXTENSION pg_net UPDATE` puede reejecutar el script de instalación y
   volver a conceder. Hay que dejarlo anotado y, si vuelve, el auditor lo
   detectará: los grants son una dimensión de la huella.
8. **Ventana y observabilidad.** Aplicar fuera del pico de las integraciones y
   mirar los logs de las Edge Functions de pago durante la hora siguiente.

## Qué queda pendiente de decisión del propietario

* **Abrir el caso con Supabase Support.** Es el paso que desbloquea todo lo
  demás: sin la autoridad de `supabase_admin` no hay `REVOKE` que sirva, y una
  migración normal saldría verde sin haber hecho nada.
* **Verificar en *Data API → Exposed schemas* si `net` está expuesto.** Decide si
  la vía por `anon`/HTTP es real o sólo latente, y con eso la urgencia. El riesgo
  por credencial directa a Postgres no depende de esto y ya está confirmado.
* Ejecutar los puntos 1 a 5 del análisis y, con el resultado, decidir si hace
  falta el `GRANT` explícito y a qué rol.
* **Hasta entonces, el modo live queda bloqueado por este motivo**, y es el
  comportamiento correcto: el auditor no se conecta a producción con una
  credencial que alcanza el contenido de las integraciones.
