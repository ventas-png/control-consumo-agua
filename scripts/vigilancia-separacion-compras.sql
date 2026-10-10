-- ════════════════════════════════════════════════════════════════════════════
-- VIGILANCIA DE LA SEPARACIÓN SOLICITANTE/APROBADOR (compras_config.aprobacion_separada)
-- SOLO LECTURA: un único SELECT, sin escribir nada ni crear nada. Se puede correr en el SQL Editor del proyecto (producción incluida)
-- y por un rol que solo tenga SELECT sobre compras_config, compras_config_separacion_bitacora y companies.
--
-- CUÁNDO: DESPUÉS de aplicar 20261027000900 (la bitácora no existe antes). Está pensada para añadirse a
-- scripts/diagnostico-compras-controles.sql como su SEGUNDA consulta («solo tras la 0900»), con el mismo formato de salida
-- (apartado · tabla · id · detalle), o para correrse sola de forma periódica (p. ej. cada semana). Cero filas = nada que revisar.
--
-- POR QUÉ: el interruptor solo cambia por la RPC compras_separacion_configurar (con motivo y rastro de persona), pero un proceso de
-- SISTEMA (service_role, mantenimiento sin sesión de usuario, con conta.allow_system_write) puede cambiar o borrar la fila encendida:
-- queda en la bitácora con origen 'sistema' y actor NULL. Es una decisión del dueño mantenerlo así (ver INFORME); esta consulta es
-- la forma de enterarse. Cuatro apartados:
--   · `separacion_sistema`  cada cambio hecho por el SISTEMA que APAGÓ la separación (una fila de bitácora). Si la empresa ya no existe
--                           es la purga de una empresa (esperada); en cualquier otro caso, preguntar quién fue el proceso.
--   · `separacion_sin_fila` empresas cuya bitácora dice «activa» y que NO tienen fila en compras_config: para el circuito están
--                           APAGADAS (la ausencia no apaga lo establecido SOLO frente a una sesión de usuario). Restablecer con
--                           compras_separacion_configurar(empresa, true, motivo) (devuelve `restablecida: true`, sin cambio nuevo).
--   · `separacion_sin_base` empresas con la fila ENCENDIDA y sin respaldo en la bitácora: o no tienen NINGUNA fila (falta la línea
--                           base: la fila se creó con los triggers deshabilitados o antes de la bitácora) o su última fila la da por
--                           apagada (la fila se encendió por fuera). Ambas cosas hacen que un cambio posterior no se pueda reconstruir.
--   · `separacion_apagada_por_fuera` empresas con la fila APAGADA y la última fila de la bitácora «activa»: la separación se apagó sin
--                           pasar por la RPC ni por los triggers (la 0900 estaba revertida, triggers deshabilitados, carga con
--                           session_replication_role = replica). Para el circuito está apagada. Reaplicar la pieza de la 0900 (su
--                           conciliación anota el cambio como de sistema, lo que lo deja en `separacion_sistema`) o restablecerla
--                           con compras_separacion_configurar(empresa, true, motivo). Es el estado que deja el procedimiento
--                           «revertir la 0900, apagar con UPDATE directo, reaplicar» si la conciliación no existiera.
-- ════════════════════════════════════════════════════════════════════════════
WITH
ultima AS (
  -- el valor ESTABLECIDO por la bitácora: su última fila por empresa (por id, no por fecha: el id sigue el orden del candado)
  SELECT DISTINCT ON (b.company_id) b.company_id, b.id, b.valor_nuevo, b.origen
    FROM public.compras_config_separacion_bitacora b
   ORDER BY b.company_id, b.id DESC
),
hallazgos AS (
  SELECT 'separacion_sistema' AS apartado, 'compras_config_separacion_bitacora' AS tabla, b.id::text AS id,
         format('el SISTEMA (sin la RPC) apagó la separación de la empresa %s el %s UTC; actor: %s%s',
                b.company_id, to_char(b.cambiado_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), COALESCE(b.actor_id::text, 'sin sesión de usuario'),
                CASE WHEN NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = b.company_id)
                     THEN ' (la empresa ya no existe: purga)' ELSE ' (la empresa SIGUE existiendo: confirmar quién fue el proceso)' END) AS detalle
    FROM public.compras_config_separacion_bitacora b
   WHERE b.origen = 'sistema' AND b.valor_nuevo = false
  UNION ALL
  SELECT 'separacion_sin_fila', 'compras_config', u.company_id::text,
         format('la bitácora da la separación por ACTIVA (cambio %s, origen %s) pero la empresa no tiene fila en compras_config: para el circuito está APAGADA; restablecerla con compras_separacion_configurar',
                u.id, u.origen)
    FROM ultima u
   WHERE u.valor_nuevo
     AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = u.company_id)
     AND NOT EXISTS (SELECT 1 FROM public.compras_config g WHERE g.company_id = u.company_id)
  UNION ALL
  SELECT 'separacion_sin_base', 'compras_config', g.company_id::text,
         CASE WHEN u.id IS NULL
              THEN 'la separación está ENCENDIDA y la empresa no tiene NINGUNA fila en la bitácora (falta la línea base): un cambio posterior no se podría reconstruir'
              ELSE format('la separación está ENCENDIDA pero la última fila de la bitácora (%s, origen %s) la da por apagada: se encendió por fuera de la RPC', u.id, u.origen) END
    FROM public.compras_config g
    LEFT JOIN ultima u ON u.company_id = g.company_id
   WHERE g.aprobacion_separada AND (u.id IS NULL OR NOT u.valor_nuevo)
  UNION ALL
  SELECT 'separacion_apagada_por_fuera', 'compras_config', g.company_id::text,
         format('la fila dice APAGADA pero la última fila de la bitácora (%s, origen %s) da la separación por ACTIVA: se apagó sin pasar por la RPC ni por los triggers (reversión de la 0900, triggers deshabilitados o carga con session_replication_role = replica); reaplicar la pieza de la 0900 (la conciliación lo anota) o restablecerla con compras_separacion_configurar',
                u.id, u.origen)
    FROM public.compras_config g
    JOIN ultima u ON u.company_id = g.company_id
   WHERE NOT g.aprobacion_separada AND u.valor_nuevo
)
SELECT apartado, tabla, id, detalle FROM hallazgos ORDER BY apartado, tabla, id;
