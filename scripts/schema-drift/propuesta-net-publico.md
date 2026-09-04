# Propuesta — retirar el acceso público a `net._http_response` y `net.http_request_queue`

> **NO APLICADA. Esto es una propuesta, no una migración.** No hay ningún archivo
> en `supabase/migrations/**` que la implemente, y no debe crearse desde este PR:
> el auditor de drift no toca producción. Va aparte, con su propio análisis de
> impacto revisado por quien opera la base.

## Lo medido

Consulta de solo lectura al catálogo real de producción:

* el esquema **`net` concede `USAGE` a `PUBLIC`**;
* **`net._http_response`** y **`net.http_request_queue`** conceden a `PUBLIC`
  `SELECT`, `INSERT`, `UPDATE`, `DELETE` y `TRUNCATE`.

`net` es el esquema de la extensión **`pg_net`**, que instala Supabase para que
la base pueda hacer peticiones HTTP salientes (webhooks, llamadas a pasarelas de
pago, notificaciones). Los grants son de esa instalación gestionada: **ninguna
migración de este repositorio los declara**, y la reconstrucción local no los
reproduce.

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
borra el rastro.

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

```sql
-- NO APLICAR sin el análisis de impacto de más abajo.

-- 1 · Quitar el acceso público a las dos tablas de pg_net.
--
--     ALL PRIVILEGES y no la lista de cinco: además de SELECT, INSERT, UPDATE,
--     DELETE y TRUNCATE hay que retirar REFERENCES y TRIGGER —y MAINTAIN, que
--     existe desde Postgres 17 y producción va por 17—. TRIGGER es el peor de
--     los tres: deja instalar código que corre con las escrituras de pg_net.
--     Enumerarlos a mano es una lista que se queda vieja en el próximo mayor.
REVOKE ALL PRIVILEGES ON TABLE
  net._http_response,
  net.http_request_queue
FROM PUBLIC;

-- 2 · Y la secuencia de la cola, que es la única que hay: `_http_response` no
--     tiene secuencia propia.
REVOKE ALL PRIVILEGES ON SEQUENCE net.http_request_queue_id_seq FROM PUBLIC;

-- 3 · Devolver a quien SÍ lo necesita, explícitamente y con el mínimo.
--     Medir antes quién usa net.http_get/http_post y con qué rol; ver abajo.
--     Sin este paso, cualquier consumidor legítimo que dependiera del grant a
--     PUBLIC deja de funcionar: es la parte que NO se puede saltear.
-- GRANT SELECT ON net._http_response      TO <rol que lee las respuestas>;
-- GRANT SELECT ON net.http_request_queue  TO <rol que inspecciona la cola>;
```

El `USAGE` del esquema **no se toca**: quitarlo rompería `net.http_get()` y
`net.http_post()` para todo el mundo, y no hace falta — sin privilegios sobre
las tablas, el `USAGE` del esquema no alcanza nada. Verificado: aplicando sólo
los `REVOKE` de arriba, la credencial vuelve a pasar el guard.

## Análisis de impacto — qué hay que comprobar antes

1. **Quién lee `net._http_response` hoy.** `pg_net` escribe ahí como su propio
   rol, no como el invocante, así que el `SELECT` de `PUBLIC` no lo necesita la
   extensión: lo necesita quien consulte el resultado de una llamada. Hay que
   buscar en `supabase/functions/**`, en las migraciones y en los cron jobs toda
   referencia a `net._http_response` y ver con qué rol corre cada una.
   *Si alguna corre como `authenticated` o `anon`, retirarle el acceso la rompe*
   — y entonces el `GRANT` explícito del paso 3 es obligatorio, no opcional.
2. **Quién escribe.** `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` desde `PUBLIC` no
   tiene ningún uso legítimo conocido; `pg_net` mantiene sus tablas con su
   propio rol. Confirmarlo antes de revocar.
3. **La secuencia.** `net.http_request_queue_id_seq` la usa `pg_net` al encolar
   una petición, con su propio rol. Si algún consumidor legítimo encola desde
   otro rol, necesita `USAGE` explícito sobre ella — comprobarlo antes.
4. **La limpieza periódica.** Si hay un job que purga `net._http_response`,
   comprobar con qué rol corre. `service_role` tiene `BYPASSRLS` pero **no**
   privilegios implícitos sobre tablas: si dependía del grant a `PUBLIC`, hay
   que concederle explícitamente.
5. **Que el `REVOKE` es idempotente y reversible.** Lo es: se revierte con el
   `GRANT` simétrico, y no toca datos.
6. **Que no lo reponga la próxima actualización de `pg_net`.** Un
   `ALTER EXTENSION pg_net UPDATE` puede reejecutar el script de instalación y
   volver a conceder. Hay que dejarlo anotado y, si vuelve, el auditor lo
   detectará: los grants son una dimensión de la huella.
7. **Ventana y observabilidad.** Aplicar fuera del pico de las integraciones y
   mirar los logs de las Edge Functions de pago durante la hora siguiente.

## Qué queda pendiente de decisión del propietario

* Ejecutar los puntos 1 a 4 del análisis y, con el resultado, decidir si hace
  falta el `GRANT` explícito y a qué rol.
* Abrir la migración en su propio PR, con la evidencia de esas mediciones.
* **Hasta entonces, el modo live queda bloqueado por este motivo**, y es el
  comportamiento correcto: el auditor no se conecta a producción con una
  credencial que alcanza el contenido de las integraciones.
