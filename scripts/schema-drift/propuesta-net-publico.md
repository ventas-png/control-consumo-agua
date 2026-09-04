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
que nadie le conceda nada. Incluye a `anon` —la clave que viaja en el bundle del
SPA— y a cualquier credencial dedicada que se cree después, como
`drift_readonly`.

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

## La propuesta

Las tres partes van **en una sola transacción**, y en este orden. Sin la
precondición y la postcondición, la parte del medio puede no hacer nada y salir
0.

### 1 · Precondición — ¿quien ejecuta tiene autoridad?

Comprueba las cuatro cosas que deciden si el `REVOKE` va a servir de algo:
**quién ejecuta** (`current_user`), **quién es el dueño**, si hay **membresía**
heredada, y si hay **grant option**. Si ninguna alcanza, aborta antes de tocar
nada — porque el `REVOKE` no lo haría.

```sql
DO $precondicion$
DECLARE
  yo        text    := current_user;
  soy_super boolean := coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false);
  privs     text[]  := ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
   || CASE WHEN current_setting('server_version_num')::int >= 170000
           THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END;
  vistos    int     := 0;
  faltan    text[]  := ARRAY[]::text[];
  r         record;
BEGIN
  FOR r IN
    SELECT n.nspname || '.' || c.relname          AS objeto,
           pg_get_userbyid(c.relowner)            AS duenio,
           pg_has_role(yo, c.relowner, 'USAGE')   AS soy_miembro,
           (SELECT bool_and(has_table_privilege(yo, c.oid, p || ' WITH GRANT OPTION'))
              FROM unnest(privs) p)               AS con_grant_option
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'net'
       AND c.relname IN ('_http_response', 'http_request_queue')
     ORDER BY 1
  LOOP
    vistos := vistos + 1;
    RAISE NOTICE '% · dueño=% · ejecuta=% · miembro=% · grant option=% · superusuario=%',
      r.objeto, r.duenio, yo, r.soy_miembro, r.con_grant_option, soy_super;
    IF NOT (soy_super OR r.duenio = yo OR r.soy_miembro OR r.con_grant_option) THEN
      faltan := faltan || r.objeto;
    END IF;
  END LOOP;

  -- Fail-closed también cuando no se encontró nada: un filtro que no empareja
  -- se parece demasiado a un permiso que sí está.
  IF vistos = 0 THEN
    RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: no se encontró ninguna de las tablas de pg_net. '
                    'Sin objeto que medir no se puede afirmar que la vía quedó cerrada.';
  END IF;

  IF array_length(faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'PRECONDICIÓN FALLIDA: «%» no tiene autoridad para revocar sobre %. '
                    'No es el dueño, no hereda su rol, no tiene grant option y no es superusuario. '
                    'El REVOKE NO fallaría: emitiría un WARNING, saldría 0 y dejaría la ACL intacta.',
                    yo, array_to_string(faltan, ', ');
  END IF;
END
$precondicion$;
```

### 2 · El `REVOKE`

```sql
-- NO APLICAR suelto: va entre la precondición y la postcondición, en la misma
-- transacción, y sólo con la autoridad del propietario (ver arriba).

-- 2a · Quitar el acceso público a las dos tablas de pg_net.
--
--      ALL PRIVILEGES y no una lista a mano: cubre los OCHO —SELECT, INSERT,
--      UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER y MAINTAIN— y tambien los
--      que agregue el proximo mayor. Una lista enumerada se queda vieja, y el
--      privilegio que falte es el que quede abierto.
REVOKE ALL PRIVILEGES ON TABLE
  net._http_response,
  net.http_request_queue
FROM PUBLIC;

-- 2b · Y la secuencia de la cola, que es la unica que hay: _http_response no
--      tiene secuencia propia.
REVOKE ALL PRIVILEGES ON SEQUENCE net.http_request_queue_id_seq FROM PUBLIC;

-- 2c · Devolver a quien SI lo necesita, explicitamente y con el minimo.
--      Medir antes quien usa net.http_get/http_post y con que rol; ver abajo.
--      Sin este paso, cualquier consumidor legitimo que dependiera del grant a
--      PUBLIC deja de funcionar: es la parte que NO se puede saltear.
-- GRANT SELECT ON net._http_response      TO <rol que lee las respuestas>;
-- GRANT SELECT ON net.http_request_queue  TO <rol que inspecciona la cola>;
```

El `USAGE` del esquema **no se toca**: quitarlo rompería `net.http_get()` y
`net.http_post()` para todo el mundo, y no hace falta — sin privilegios sobre
las tablas, el `USAGE` del esquema no alcanza nada. Verificado: aplicando sólo
los `REVOKE` de arriba, la credencial vuelve a pasar el guard.

### 3 · Postcondición fail-closed — ¿quedó algo?

Se lee del ACL, que es donde está la verdad y no depende del rol que pregunta.
Si sobrevive **un solo** privilegio de `PUBLIC` sobre cualquiera de los tres
objetos, lanza una excepción y **la transacción entera se revierte**.

Es la única defensa contra el éxito silencioso: sin esto, un `REVOKE` que no
revocó nada es indistinguible de uno que revocó todo.

```sql
DO $postcondicion$
DECLARE
  restante text;
BEGIN
  SELECT string_agg(format('%s.%s → %s', n.nspname, c.relname, a.privilege_type), ', '
                    ORDER BY n.nspname, c.relname, a.privilege_type)
    INTO restante
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) AS a
   WHERE n.nspname = 'net'
     AND c.relname IN ('_http_response', 'http_request_queue', 'http_request_queue_id_seq')
     AND a.grantee = 0;   -- 0 es PUBLIC

  IF restante IS NOT NULL THEN
    RAISE EXCEPTION 'POSTCONDICIÓN FALLIDA: PUBLIC conserva privilegios sobre pg_net: %. '
                    'Se revierte la transacción entera: un REVOKE que no revoca sale 0 y no '
                    'se distingue de uno que sí.', restante;
  END IF;
END
$postcondicion$;
```

### Está probado, no supuesto

`--prueba-live` reproduce la forma de producción en un clúster desechable —los
tres objetos de `net` en manos de otro rol— y ejecuta el `REVOKE` como un rol
equivalente a `postgres`: con `LOGIN`, sin superusuario, sin membresía y sin
grant option. Exige que:

* el `REVOKE` **salga 0** y sólo deje un `WARNING` — el éxito silencioso, tal cual;
* la **ACL quede intacta**, y el auditor siga rechazando con los mismos privilegios;
* la **precondición aborte**, nombrando al dueño real y al que ejecuta;
* la **postcondición falle**, enumerando qué privilegio sobrevivió en qué objeto;
* y, como contraprueba, que con la autoridad del dueño la precondición **pase**,
  y que con las tres vías cerradas la postcondición **pase** — para que «falla
  siempre» y «detecta lo que hay» no se vean igual desde afuera.

## Análisis de impacto — qué hay que comprobar antes

1. **Quién lee `net._http_response` hoy.** `pg_net` escribe ahí como su propio
   rol, no como el invocante, así que el `SELECT` de `PUBLIC` no lo necesita la
   extensión: lo necesita quien consulte el resultado de una llamada. Hay que
   buscar en `supabase/functions/**`, en las migraciones y en los cron jobs toda
   referencia a `net._http_response` y ver con qué rol corre cada una.
   *Si alguna corre como `authenticated` o `anon`, retirarle el acceso la rompe*
   — y entonces el `GRANT` explícito del paso 2c es obligatorio, no opcional.
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
* Ejecutar los puntos 1 a 5 del análisis y, con el resultado, decidir si hace
  falta el `GRANT` explícito y a qué rol.
* **Hasta entonces, el modo live queda bloqueado por este motivo**, y es el
  comportamiento correcto: el auditor no se conecta a producción con una
  credencial que alcanza el contenido de las integraciones.
