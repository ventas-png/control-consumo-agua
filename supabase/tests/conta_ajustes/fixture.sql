-- Datos del bloque 3 (20261011000000), sobre el padrón de
-- conta_auxiliares_tipo_cargo, el fixture de conta_contabilizacion_cargos y el
-- de conta_saldos_favor (run.sh los aplica antes). Todo lleva prefijo SINT.
--
-- Usuarios de la empresa A además de los del padrón:
--   OWN  company_owner (única autoaprobación posible, E1)
--   APR  aprobador por RBAC (platform.contabilidad.approve), sin rol legacy
--   Residentes del portal: RUNO (cliente Uno) y RDOS (cliente Dos).

\set ON_ERROR_STOP on

INSERT INTO auth.users (id) VALUES
  ('a0a0a0a0-0000-0000-0000-0000000000f0'),
  ('a0a0a0a0-0000-0000-0000-0000000000f1'),
  ('a0a0a0a0-0000-0000-0000-0000000000e1'),
  ('a0a0a0a0-0000-0000-0000-0000000000e2');

INSERT INTO public.app_users (id, company_id, full_name, role, cliente_id) VALUES
  ('a0a0a0a0-0000-0000-0000-0000000000f0', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT Dueño A',      'company_owner', NULL),
  ('a0a0a0a0-0000-0000-0000-0000000000f1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT Aprobador A',  'operator',      NULL),
  ('a0a0a0a0-0000-0000-0000-0000000000e1', NULL, 'SINT Residente Uno', 'cliente', 'e0000000-0000-0000-0000-00000000a001'),
  ('a0a0a0a0-0000-0000-0000-0000000000e2', NULL, 'SINT Residente Dos', 'cliente', 'e0000000-0000-0000-0000-00000000a002');

INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  ('a0a0a0a0-0000-0000-0000-0000000000f0', 'a1a1a1a1-0000-0000-0000-000000000001', 'total'),
  ('a0a0a0a0-0000-0000-0000-0000000000f1', 'a1a1a1a1-0000-0000-0000-000000000001', 'total');

INSERT INTO public.roles (id, company_id, name) VALUES
  ('9a000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT Aprobador contable');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('9a000000-0000-0000-0000-0000000000f1', 'platform.contabilidad.view',    'allow'),
  ('9a000000-0000-0000-0000-0000000000f1', 'platform.contabilidad.approve', 'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0a0a0a0-0000-0000-0000-0000000000f1', '9a000000-0000-0000-0000-0000000000f1');
-- El contador del padrón (crea/edita contabilidad) SOLICITA pero no aprueba.

-- Cuentas: anticipos (pasivo) y el método de la pasarela.
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'anticipo_clientes',       '11000000-0000-0000-0000-00000000a1a1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'metodo_tarjeta',          '11000000-0000-0000-0000-00000000a109'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'metodo_otro',             '11000000-0000-0000-0000-00000000a109');

-- ── Cargos del bloque 3 (Uno, U1, ledger A1, julio-septiembre) ─────────────
INSERT INTO public.cargos_adicionales_unidad
  (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  -- J1: se anula por el flujo (con asiento).
  ('ad000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT J1 anular', 'reparacion', 40, '2026-09-02', 'pendiente'),
  -- J2: cambia de importe entre la solicitud y la aprobación.
  ('ad000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT J2 cambia', 'reparacion', 45, '2026-09-02', 'pendiente'),
  -- J3: con un cobro vivo: la anulación falla y no deja nada.
  ('ad000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT J3 con cobro', 'reparacion', 50, '2026-09-02', 'pendiente'),
  -- J5: el período de hoy cerrado → fallida; reabierto → reintento.
  ('ad000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT J5 periodo', 'reparacion', 25, '2026-09-02', 'pendiente'),
  -- J6: autoaprobación del dueño.
  ('ad000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT J6 dueño', 'reparacion', 15, '2026-09-02', 'pendiente'),
  -- P1, P2: pago en línea por la pasarela.
  ('ad000000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT P1 en línea', 'reparacion', 60, '2026-09-02', 'pendiente'),
  ('ad000000-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT P2 reembolso', 'reparacion', 35, '2026-09-02', 'pendiente'),
  -- P3: aprobación tardía (falla y después se aprueba). P4: destino de la
  -- aplicación del saldo que deja el cobro en línea de la cuota QP.
  ('ad000000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT P3 tardío', 'reparacion', 10, '2026-09-02', 'pendiente'),
  ('ad000000-0000-0000-0000-000000000014', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT P4 destino', 'reparacion', 10, '2026-09-02', 'pendiente'),
  -- R1: destino de la aplicación que pide el residente.
  ('ad000000-0000-0000-0000-000000000021', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT R1 portal', 'reparacion', 30, '2026-09-02', 'pendiente'),
  -- C1..C3: concurrencia (run.sh).
  ('ad000000-0000-0000-0000-000000000031', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT C1 doble aprobación', 'reparacion', 20, '2026-09-02', 'pendiente'),
  ('ad000000-0000-0000-0000-000000000032', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT C2 aprobación vs cobro', 'reparacion', 20, '2026-09-02', 'pendiente'),
  ('ad000000-0000-0000-0000-000000000033', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT C3 dos avisos', 'reparacion', 20, '2026-09-02', 'pendiente'),
  ('ad000000-0000-0000-0000-000000000034', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT C4 cobro vs aprobación', 'reparacion', 20, '2026-09-02', 'pendiente'),
  -- JB: la otra empresa.
  ('ad000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000b001', 'SINT JB empresa B', 'reparacion', 70, '2026-09-02', 'pendiente');

-- J4: SIN asiento (tipo sin configurar al emitirse): su anulación deja
-- evidencia y el estado de cuenta la ubica al corte.
DELETE FROM public.conta_config_tipo_cargo
 WHERE project_id = 'a1a1a1a1-0000-0000-0000-000000000001' AND tipo_cargo = 'adicional_otro';
INSERT INTO public.cargos_adicionales_unidad
  (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ad000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT J4 sin asiento', 'otro', 12, '2026-09-01', 'pendiente');

-- J7: anulado ANTES de 20261011000000 (sin evidencia, sin asiento): sigue en
-- la limitación anulacion_sin_fecha.
INSERT INTO public.cargos_adicionales_unidad
  (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ad000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT J7 heredado', 'otro', 9, '2026-09-01', 'pendiente');
ALTER TABLE public.cargos_adicionales_unidad DISABLE TRIGGER trg_cargo_solo_por_solicitud;
UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = 'ad000000-0000-0000-0000-000000000007';
ALTER TABLE public.cargos_adicionales_unidad ENABLE TRIGGER trg_cargo_solo_por_solicitud;

-- Cuota por tipo de Uno pagada por la pasarela con EXCEDENTE (queda saldo a
-- favor, que después se aplica y bloquea el rechazo del reembolso).
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('ad500000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'SINT QP', 50, '2026-09', 'pendiente', 'mantenimiento');

-- ── Solicitudes de cobro de la pasarela (las crearía create-charge) ────────
INSERT INTO public.payment_requests (id, cliente_id, cargo_adicional_id, company_id, monto, provider, estado, provider_ref, ambiente) VALUES
  ('ad900000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-00000000a001', 'ad000000-0000-0000-0000-000000000011', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 60, 'qpaypro', 'pending', 'qp-p1', 'prod'),
  ('ad900000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-00000000a001', 'ad000000-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 35, 'qpaypro', 'pending', 'qp-p2', 'prod'),
  ('ad900000-0000-0000-0000-000000000013', 'e0000000-0000-0000-0000-00000000a001', 'ad000000-0000-0000-0000-000000000033', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 20, 'qpaypro', 'pending', 'qp-c3', 'prod'),
  -- tardía: falla y después el proveedor la aprueba
  ('ad900000-0000-0000-0000-000000000014', 'e0000000-0000-0000-0000-00000000a001', 'ad000000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 10, 'qpaypro', 'pending', 'qp-tarde', 'prod');
INSERT INTO public.payment_requests (id, cliente_id, cuota_id, company_id, monto, provider, estado, provider_ref, ambiente) VALUES
  -- cuota de 50 pagada con 80: 30 de saldo a favor
  ('ad900000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-00000000a001', 'ad500000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 80, 'qpaypro', 'pending', 'qp-qp', 'prod');

-- ── Ayudas de lectura ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aj_sol(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.estado || '/' || s.intentos_ejecucion || '/' || s.autoaprobada
    FROM public.conta_ajustes_solicitudes s WHERE s.id = p_id
$$;
CREATE OR REPLACE FUNCTION public.aj_eventos(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(string_agg(e.accion, ',' ORDER BY e.ocurrido_at, e.id), '')
    FROM public.conta_ajustes_eventos e WHERE e.solicitud_id = p_id
$$;
CREATE OR REPLACE FUNCTION public.aj_cargo(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ca.estado || '/' ||
         (SELECT count(*) FROM public.conta_asientos a
           WHERE a.origen = 'automatico' AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = ca.id
             AND a.origen_evento = 'cargo_adicional_emitido' AND a.estado = 'publicado' AND a.anulado_por_id IS NULL)
         || '/' || (SELECT count(*) FROM public.conta_cargo_anulaciones an WHERE an.cargo_id = ca.id)
    FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_id
$$;
CREATE OR REPLACE FUNCTION public.aj_pr(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pr.estado || '/' || (SELECT count(*) FROM public.pagos p WHERE p.payment_request_id = pr.id)
         || '/' || COALESCE((SELECT p.estado FROM public.pagos p WHERE p.payment_request_id = pr.id), '-')
    FROM public.payment_requests pr WHERE pr.id = p_id
$$;
CREATE OR REPLACE FUNCTION public.aj_incidencias(p_pr uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(string_agg(i.tipo || ':' || i.estado, ',' ORDER BY i.creada_at, i.id), '')
    FROM public.conta_incidencias_conciliacion i WHERE i.payment_request_id = p_pr
$$;
-- Aviso del proveedor, como lo manda el edge (service_role).
CREATE OR REPLACE FUNCTION public.aj_aviso(p_pr uuid, p_estado text, p_origen text, p_clave text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims text := current_setting('request.jwt.claims', true);
  v_r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_r := public.pasarela_registrar_estado(p_pr, p_estado, p_origen, p_clave, NULL, NULL, NULL);
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  RETURN v_r;
END;
$$;
-- Solicitar como la sesión, aprobar como p_aprobador; devuelve el estado final.
CREATE OR REPLACE FUNCTION public.aj_aprobar_como(p_aprobador uuid, p_sol uuid, p_confirmar boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_yo text := current_setting('request.jwt.claim.sub', true);
  v_r  record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_aprobador::text, false);
  BEGIN
    SELECT * INTO v_r FROM public.conta_ajuste_aprobar(p_sol, NULL, p_confirmar);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.sub', v_yo, false);
    RAISE;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_yo, false);
  RETURN v_r.estado || CASE WHEN v_r.repetida THEN '/repetida' ELSE '' END
         || CASE WHEN v_r.error_ejecucion IS NOT NULL THEN '/' || split_part(v_r.error_ejecucion, ':', 1) ELSE '' END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aj_sol(uuid), public.aj_eventos(uuid), public.aj_cargo(uuid), public.aj_pr(uuid),
  public.aj_incidencias(uuid), public.aj_aviso(uuid, text, text, text), public.aj_aprobar_como(uuid, uuid, boolean)
  TO authenticated;
