\set ON_ERROR_STOP on
-- Invariantes de 20261221000000. Corre DOS veces: con `rp.fase = antes` (control
-- negativo: los huecos existen) y con `rp.fase = despues`.
-- Padrón: el de fail_open_sin_perfil (empresa D: OWN_D propietario, ADM_D admin,
-- OPE_D operador de D1, VIS_D visor de D1; OP_C operador de OTRA empresa) más lo
-- que añade run.sh: LEC_D (operador asignado a RUTA_D1/RUTA_D1C, sin permisos),
-- LEC2_D (agua.lecturas.create + agua.rutas.view), el rol R_OPE de OPE_D (cada
-- caso le pone sus claves) y R_OPC de OP_C (todo agua.rutas.* en su empresa C).

-- Ejecuta `p_sql` como `p_actor` y devuelve las filas tocadas, o el SQLSTATE si
-- falla. Con p_deshacer (por defecto) el efecto se revierte: cada sonda parte del
-- mismo estado.
CREATE OR REPLACE FUNCTION fos.filas(p_actor text, p_sql text, p_deshacer boolean DEFAULT true)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; n int;
BEGIN
  PERFORM fos.poner_actor(p_actor);
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF p_deshacer THEN RAISE EXCEPTION USING ERRCODE = 'RP000', MESSAGE = n::text; END IF;
    v := n::text;
  EXCEPTION WHEN OTHERS THEN
    v := CASE WHEN SQLSTATE = 'RP000' THEN SQLERRM ELSE SQLSTATE END;
  END;
  PERFORM fos.poner_actor('SISTEMA');
  RETURN v;
END $$;

-- Reescribe las claves del rol de prueba de un actor.
CREATE OR REPLACE FUNCTION fos.dar(p_rol text, p_claves text[]) RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.role_permissions WHERE role_id = fos.id(p_rol);
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT fos.id(p_rol), k, 'allow' FROM unnest(p_claves) AS k;
$$;

CREATE OR REPLACE FUNCTION fos.espera(p_actor text, p_sql text, p_esperado text, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v text := fos.filas(p_actor, p_sql);
BEGIN
  IF v IS DISTINCT FROM p_esperado THEN
    RAISE EXCEPTION '[%] % — esperado «%», recibido «%»', current_setting('rp.fase'), p_msg, p_esperado, v;
  END IF;
END $$;

DO $$
DECLARE
  fase text := current_setting('rp.fase');
  ins_d1  text := format('INSERT INTO public.rutas (nombre, project_id) VALUES (%L, %L)', 'Nueva D1', fos.id('D1'));
  ins_d2  text := format('INSERT INTO public.rutas (nombre, project_id) VALUES (%L, %L)', 'Nueva D2', fos.id('D2'));
  ins_en_d text := format('INSERT INTO public.rutas (nombre, company_id, project_id) VALUES (%L, %L, %L)', 'Intrusa', fos.id('D'), fos.id('D1'));
  ren_d1  text := format('UPDATE public.rutas SET nombre = %L WHERE id = %L', 'Renombrada', fos.id('RUTA_D1'));
  ren_d2  text := format('UPDATE public.rutas SET nombre = %L WHERE id = %L', 'Renombrada', fos.id('RUTA_D2'));
  ren_c1  text := format('UPDATE public.rutas SET nombre = %L WHERE id = %L', 'Renombrada', fos.id('RUTA_C1'));
  asig_d1 text := format('UPDATE public.rutas SET asignado_a = %L WHERE id = %L', fos.id('LEC2_D'), fos.id('RUTA_D1'));
  mov_d1  text := format('UPDATE public.rutas SET project_id = %L WHERE id = %L', fos.id('D2'), fos.id('RUTA_D1'));
  comp_d1 text := format('UPDATE public.rutas SET completada = true WHERE id = %L', fos.id('RUTA_D1'));
  comp_ren text := format('UPDATE public.rutas SET completada = true, nombre = %L WHERE id = %L', 'Otra', fos.id('RUTA_D1'));
  reabrir text := format('UPDATE public.rutas SET completada = false WHERE id = %L', fos.id('RUTA_D1C'));
  del_d1  text := format('DELETE FROM public.rutas WHERE id = %L', fos.id('RUTA_D1'));
  del_d2  text := format('DELETE FROM public.rutas WHERE id = %L', fos.id('RUTA_D2'));
  v text;
BEGIN
  -- ── Lo que vale ANTES y DESPUÉS ──────────────────────────────────────────
  -- Quien ejecuta la ruta la cierra (LecturasSection → markRutaCompletada).
  PERFORM fos.espera('LEC_D', comp_d1, '1', 'el lector asignado completa su ruta');
  PERFORM fos.espera('OWN_D', ins_d1,  '1', 'el propietario crea');
  PERFORM fos.espera('ADM_D', ren_d1,  '1', 'el admin edita');
  PERFORM fos.espera('ADM_D', del_d2,  '1', 'el admin borra');
  PERFORM fos.espera('SA',    ren_c1,  '1', 'el superadmin edita en cualquier empresa');
  PERFORM fos.espera('OP_C',  ren_d1,  '0', 'el forastero no toca rutas de otra empresa');
  PERFORM fos.espera('OP_C',  del_d1,  '0', 'el forastero no borra rutas de otra empresa');
  PERFORM fos.espera('OP_C',  ins_en_d, '42501', 'el forastero no crea rutas en otra empresa');
  PERFORM fos.espera('SISTEMA',  ren_d1, '1', 'una escritura de sistema (sin JWT) pasa');
  PERFORM fos.espera('SERVICIO', ren_d1, '1', 'service_role (route-reminders) pasa');
  RAISE NOTICE '✓ [%] lector asignado, propietario, admin, superadmin y sistema; el forastero fuera', fase;

  IF fase = 'antes' THEN
    -- ── CONTROL NEGATIVO: los huecos que cierra la migración ──────────────
    PERFORM fos.dar('R_OPE', ARRAY['agua.rutas.view']);
    PERFORM fos.espera('VIS_D', ins_d1, '1', 'CONTROL: antes, un visor crea rutas');
    PERFORM fos.espera('OPE_D', ren_d1, '1', 'CONTROL: antes, quien sólo ve rutas las reescribe');
    PERFORM fos.espera('LEC_D', ren_d1, '1', 'CONTROL: antes, el lector asignado reescribe su ruta');
    PERFORM fos.dar('R_OPE', ARRAY['agua.rutas.view', 'agua.rutas.delete']);
    PERFORM fos.espera('OPE_D', del_d1, '0', 'CONTROL: antes, «Eliminar» por RBAC no borra (0 filas, sin error)');
    PERFORM fos.dar('R_OPE', ARRAY[]::text[]);
    RAISE NOTICE '✓ [antes] CONTROL NEGATIVO: visor crea, «ver» reescribe, «Eliminar» por RBAC no borra';
    RETURN;
  END IF;

  -- ── DESPUÉS ──────────────────────────────────────────────────────────────
  -- Sin ningún permiso de rutas: nada.
  PERFORM fos.espera('VIS_D', ins_d1, '42501', 'un visor no crea rutas');
  PERFORM fos.espera('VIS_D', ren_d1, '0',     'un visor no edita rutas');
  PERFORM fos.espera('VIS_D', del_d1, '0',     'un visor no borra rutas');
  RAISE NOTICE '✓ [despues] el visor sin permisos no crea, edita ni borra';

  -- Sólo «ver».
  PERFORM fos.dar('R_OPE', ARRAY['agua.rutas.view']);
  PERFORM fos.espera('OPE_D', ins_d1,  '42501', 'con sólo «ver» no crea');
  PERFORM fos.espera('OPE_D', ren_d1,  '0',     'con sólo «ver» no edita');
  PERFORM fos.espera('OPE_D', comp_d1, '0',     'con sólo «ver» (ni asignado ni lector) no completa');
  PERFORM fos.espera('OPE_D', del_d1,  '0',     'con sólo «ver» no borra');
  RAISE NOTICE '✓ [despues] con sólo «ver» no escribe nada';

  -- «Crear»: en su proyecto sí, en uno ajeno no.
  PERFORM fos.dar('R_OPE', ARRAY['agua.rutas.view', 'agua.rutas.create']);
  PERFORM fos.espera('OPE_D', ins_d1, '1',     '«Crear» crea en su proyecto');
  PERFORM fos.espera('OPE_D', ins_d2, '42501', '«Crear» no crea en un proyecto sin acceso');
  PERFORM fos.espera('OPE_D', ren_d1, '0',     '«Crear» no edita');
  PERFORM fos.espera('OPE_D', del_d1, '0',     '«Crear» no borra');
  RAISE NOTICE '✓ [despues] «Crear» crea sólo en sus proyectos, y no edita ni borra';

  -- «Editar»: cualquier columna, sin sacar la ruta de sus proyectos.
  PERFORM fos.dar('R_OPE', ARRAY['agua.rutas.view', 'agua.rutas.edit']);
  PERFORM fos.espera('OPE_D', ren_d1,  '1',     '«Editar» renombra');
  PERFORM fos.espera('OPE_D', asig_d1, '1',     '«Editar» reasigna el operador');
  PERFORM fos.espera('OPE_D', comp_d1, '1',     '«Editar» completa');
  PERFORM fos.espera('OPE_D', ren_d2,  '0',     '«Editar» no toca rutas de un proyecto sin acceso');
  PERFORM fos.espera('OPE_D', mov_d1,  '42501', '«Editar» no mueve una ruta a un proyecto sin acceso');
  PERFORM fos.espera('OPE_D', ins_d1,  '42501', '«Editar» no crea');
  PERFORM fos.espera('OPE_D', del_d1,  '0',     '«Editar» no borra');
  RAISE NOTICE '✓ [despues] «Editar» edita en sus proyectos, y no crea ni borra';

  -- «Eliminar» por RBAC (rol de plataforma operator): ahora sí borra.
  PERFORM fos.dar('R_OPE', ARRAY['agua.rutas.view', 'agua.rutas.delete']);
  PERFORM fos.espera('OPE_D', del_d1, '1', '«Eliminar» por RBAC borra (antes: 0 filas)');
  PERFORM fos.espera('OPE_D', del_d2, '0', '«Eliminar» no borra en un proyecto sin acceso');
  PERFORM fos.espera('OPE_D', ren_d1, '0', '«Eliminar» no edita');
  RAISE NOTICE '✓ [despues] «Eliminar» por RBAC borra en sus proyectos, y no edita';
  PERFORM fos.dar('R_OPE', ARRAY[]::text[]);

  -- Quien ejecuta la ruta: sólo completar.
  PERFORM fos.espera('LEC_D', ren_d1,   '42501', 'el lector asignado no renombra su ruta');
  PERFORM fos.espera('LEC_D', comp_ren, '42501', 'el lector asignado no cuela otro cambio al completar');
  PERFORM fos.espera('LEC_D', reabrir,  '42501', 'el lector asignado no reabre una ruta completada');
  PERFORM fos.espera('LEC_D', ins_d1,   '42501', 'el lector asignado no crea');
  PERFORM fos.espera('LEC_D', del_d1,   '0',     'el lector asignado no borra');
  PERFORM fos.espera('LEC2_D', comp_d1, '1',     'quien registra lecturas en el proyecto completa la ruta');
  PERFORM fos.espera('LEC2_D', ren_d1,  '42501', 'quien registra lecturas no renombra la ruta');
  PERFORM fos.espera('LEC2_D', del_d1,  '0',     'quien registra lecturas no borra la ruta');
  RAISE NOTICE '✓ [despues] quien ejecuta la ruta (asignado o con agua.lecturas.create) sólo la completa';

  -- El cierre deja su sello, como antes.
  v := fos.filas('LEC_D', comp_d1, false);
  IF v <> '1' THEN RAISE EXCEPTION '[despues] el lector asignado debía completar (dio %)', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rutas WHERE id = fos.id('RUTA_D1')
                   AND completada AND completada_por = fos.id('LEC_D') AND nombre = 'Ruta D1') THEN
    RAISE EXCEPTION '[despues] al completar, completada_por debía quedar en el lector y el resto intacto';
  END IF;
  UPDATE public.rutas SET completada = false, completada_por = NULL WHERE id = fos.id('RUTA_D1');
  RAISE NOTICE '✓ [despues] completar sella completada_por con el lector y no toca nada más';

  -- El forastero con TODO agua.rutas.* en su empresa sigue fuera de D.
  PERFORM fos.espera('OP_C', comp_d1, '0', 'el forastero con todos los permisos en C no completa rutas de D');
  RAISE NOTICE '✓ [despues] los permisos valen sólo dentro de la propia empresa';
END $$;
