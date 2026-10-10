\set ON_ERROR_STOP on
-- ============================================================================
-- SEP-0 · Padrón y ayudas de las pruebas de la separación solicitante/aprobador (SEP-1, SEP-2, SEP-3, SEP-conc).
-- No comprueba nada: crea (de forma idempotente) las personas y las ayudas que usan las demás. SEP-1/2/3 lo incluyen con \ir.
--
-- Personas propias (prefijo 5e90…; las de la plantilla —UA/UB admin de C, UC contador, UN/UO sin permiso contable, UD admin de D— se usan tal cual):
--   SE  operador de C, rol «SEP Editor»: Contabilidad ver/crear/EDITAR/ELIMINAR/autorizar/cambiar estado + la pestaña de órdenes y su «Autorizar».
--       Es la persona tipo UQ del brief (la que puede editar y borrar la configuración y además solicitar y aprobar órdenes).
--   SS  super administrador (de C)
--   SP  propietario (company_owner) de C
--   SX  operador de C con un rol llamado «admin» PERTENECIENTE A D, con todas las llaves: el nombre de un rol no es un cargo.
-- ============================================================================
-- Ayudas (SECURITY INVOKER: se ejecutan con la sesión que las llama).

-- Ejecuta p_sql COMO SISTEMA —superusuario, sin sesión de usuario— y devuelve la sesión a la persona y al rol que tenía.
-- (Mismo cuerpo que la ayuda propuesta para fixture.sql.) Sembrar el interruptor en una prueba es una carga de sistema, no un acto del
-- usuario que quedó puesto en la sesión (RESET ROLE no borra request.jwt.claim.sub).
CREATE OR REPLACE FUNCTION public.como_sistema(p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_rol text := current_setting('role', true);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RESET ROLE;
  EXECUTE p_sql;
  IF COALESCE(v_rol, 'none') <> 'none' THEN
    EXECUTE format('SET ROLE %I', v_rol);
  END IF;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
END;
$$;

-- Deja la configuración de la empresa como se pide: NULL = sin fila. Es una carga de SISTEMA (queda en la bitácora como tal).
CREATE OR REPLACE FUNCTION public.sep_preparar(p_empresa uuid, p_activa boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.como_sistema(format('DELETE FROM public.compras_config WHERE company_id = %L', p_empresa));
  IF p_activa IS NOT NULL THEN
    PERFORM public.como_sistema(format('INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (%L, %L)', p_empresa, p_activa));
  END IF;
END;
$$;

-- Borra la fila SIN pasar por los triggers (carga manual / restauración parcial / session_replication_role = replica): la bitácora no se entera.
CREATE OR REPLACE FUNCTION public.sep_borrar_sin_rastro(p_empresa uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.como_sistema(format('SET LOCAL session_replication_role = replica; DELETE FROM public.compras_config WHERE company_id = %L; SET LOCAL session_replication_role = origin', p_empresa));
END;
$$;

-- Filas que afecta una sentencia (con la sesión que llama: así se ve lo que RLS filtra).
CREATE OR REPLACE FUNCTION public.sep_filas(p_sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Lo que lee el circuito: 'true' / 'false' / 'SIN FILA'.
CREATE OR REPLACE FUNCTION public.sep_valor(p_empresa uuid)
RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE((SELECT c.aprobacion_separada::text FROM public.compras_config c WHERE c.company_id = p_empresa), 'SIN FILA')
$$;

-- Filas de bitácora de una empresa (se llama como superusuario: la bitácora no se lee con la API sin ser administrador).
CREATE OR REPLACE FUNCTION public.sep_nbit(p_empresa uuid)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = $1' INTO n USING p_empresa;
  RETURN n;
END;
$$;

-- La cadena de una empresa es coherente: el «anterior» de cada fila es el «nuevo» de la anterior (la primera puede no tener antecedente).
CREATE OR REPLACE FUNCTION public.sep_cadena_rota(p_empresa uuid)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (SELECT valor_anterior, lag(valor_nuevo) OVER (ORDER BY id) AS previo, row_number() OVER (ORDER BY id) AS pos
                                   FROM public.compras_config_separacion_bitacora WHERE company_id = $1) t
            WHERE pos > 1 AND valor_anterior IS DISTINCT FROM previo' INTO n USING p_empresa;
  RETURN n;
END;
$$;

-- ── Personas ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id) VALUES
  ('5e900000-0000-0000-0000-0000000000e1'), ('5e900000-0000-0000-0000-0000000000a1'),
  ('5e900000-0000-0000-0000-0000000000a2'), ('5e900000-0000-0000-0000-0000000000a3')
ON CONFLICT DO NOTHING;
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('5e900000-0000-0000-0000-0000000000e1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'SEP Editor (edita y borra la configuración, solicita y aprueba)', 'operator'),
  ('5e900000-0000-0000-0000-0000000000a1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'SEP Super administrador',                                     'super_admin'),
  ('5e900000-0000-0000-0000-0000000000a2', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'SEP Operador con un rol «admin» de OTRA empresa',              'operator'),
  ('5e900000-0000-0000-0000-0000000000a3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'SEP Propietario de C',                                        'company_owner')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT u, p, 'total'
  FROM unnest(ARRAY['5e900000-0000-0000-0000-0000000000e1', '5e900000-0000-0000-0000-0000000000a2']::uuid[]) u,
       unnest(ARRAY['c1c1c1c1-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000001']::uuid[]) p
 WHERE NOT EXISTS (SELECT 1 FROM public.user_project_assignments x WHERE x.user_id = u AND x.project_id = p);
INSERT INTO public.roles (id, company_id, name) VALUES
  ('5e900000-0000-0000-0000-0000000000b1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'SEP Editor'),
  ('5e900000-0000-0000-0000-0000000000b2', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin')
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT r, k, 'allow'
  FROM unnest(ARRAY['5e900000-0000-0000-0000-0000000000b1', '5e900000-0000-0000-0000-0000000000b2']::uuid[]) r,
       unnest(ARRAY['platform.contabilidad.view', 'platform.contabilidad.create', 'platform.contabilidad.edit', 'platform.contabilidad.delete',
                    'platform.contabilidad.approve', 'platform.contabilidad.change_status',
                    'condominios.tab.ordenes_compra', 'condominios.tab.ordenes_compra.approve']) k
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('5e900000-0000-0000-0000-0000000000e1', '5e900000-0000-0000-0000-0000000000b1'),
  ('5e900000-0000-0000-0000-0000000000a2', '5e900000-0000-0000-0000-0000000000b2')
ON CONFLICT DO NOTHING;
