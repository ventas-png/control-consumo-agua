-- ════════════════════════════════════════════════════════════════════════════
-- Delta sobre supabase/tests/registrar_lectura/fixture.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Reusa el padrón de agua de aquel fixture —dos empresas, tres proyectos, las
-- tarifas y los siete contadores— y añade sólo lo que el `UPDATE` necesita y
-- aquél no tenía: la policy real de UPDATE, la configuración de facturación
-- (IVA del tenant, regla de mora del proyecto), el destino de la auditoría y
-- las cuentas que ejercen el cobro y el reporte.
--
-- No se toca el fixture compartido: lo consume el otro harness y su padrón es
-- la única fuente de verdad de los dos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── La policy REAL de UPDATE (20260610000808), tal cual ─────────────────────
-- Se copia con su defecto incluido —autoriza por FILA, no mira ni una columna,
-- y NO tiene WITH CHECK— porque es justamente lo que la prueba tiene que
-- ejercer: sin el trigger, esta policy deja reescribir el importe.
CREATE POLICY registros_update ON public.registros
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
               WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id)
    OR (
      project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT public.get_my_company_id()))
      AND (
        public.current_user_role() = ANY (ARRAY['admin','company_owner','operator','operador'])
        OR (SELECT public.user_has_permission('agua.lecturas.edit'))
      )
    )
  );

-- ── `creado_por` con la semántica de PRODUCCIÓN ─────────────────────────────
-- El fixture compartido lo RE-SELLA en cada UPDATE; el `sellar_actor` real
-- (20260731000000) lo restaura al valor viejo, que es lo que hace la columna
-- inmutable. La prueba del guard necesita la semántica real.
CREATE OR REPLACE FUNCTION public.sellar_actor_test() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN NEW.creado_por := auth.uid(); END IF;
  ELSIF NEW.creado_por IS DISTINCT FROM OLD.creado_por THEN
    NEW.creado_por := OLD.creado_por;
  END IF;
  RETURN NEW;
END; $$;

-- ── Configuración de facturación que lee `agua_factura_emitir` ──────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS iva_tasa_default numeric;
UPDATE public.companies SET iva_tasa_default = 0.12
 WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000a';

CREATE TABLE public.reglas_mora_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id),
  activa           boolean NOT NULL DEFAULT true,
  dias_vencimiento integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.reglas_mora_config (project_id, activa, dias_vencimiento) VALUES
  ('11111111-0000-0000-0000-000000000001', true, 15);

-- ── El destino de la auditoría (20260317000001), con el grant de hoy ────────
-- `authenticated` NO escribe aquí: se lo revocó 20260910000001. Que la
-- auditoría del cobro llegue igual es una de las invariantes.
CREATE TABLE public.security_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  event_type  text NOT NULL,
  details     jsonb,
  ip_address  text,
  user_agent  text,
  "timestamp" timestamptz DEFAULT now()
);

-- ── Las cuentas que faltan ──────────────────────────────────────────────────
-- RESI · residente del condominio: rol `cliente`, ASIGNADO al proyecto y con un
-- permiso de lectura de agua. Es el peor caso para el reporte: bajo la
-- autorización vieja pasaba las dos puertas (empresa + can_access_project) y
-- recibía el informe entero del condominio.
INSERT INTO auth.users (id) VALUES
  ('e0000000-0000-0000-0000-00000000000c');
INSERT INTO public.app_users (id, company_id, role) VALUES
  ('e0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000a', 'cliente');
INSERT INTO public.user_project_assignments (user_id, project_id) VALUES
  ('e0000000-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-000000000001');
INSERT INTO public.test_permisos (user_id, permiso) VALUES
  ('e0000000-0000-0000-0000-00000000000c', 'agua.cobros.view'),
  -- Lucía pasa a ser además la cobradora del condominio: captura y cobra.
  ('e0000000-0000-0000-0000-000000000001', 'agua.cobros.change_status'),
  ('e0000000-0000-0000-0000-000000000001', 'agua.cobros.create'),
  ('e0000000-0000-0000-0000-000000000001', 'agua.lecturas.change_status'),
  -- Y `edit`, que es lo que hoy habilita el PATCH genérico sobre la fila: sin
  -- él la demostración del agujero no se puede ejercer.
  ('e0000000-0000-0000-0000-000000000001', 'agua.lecturas.edit');

-- BETO ya existe en el fixture compartido: asignado al proyecto Uno y con
-- `agua.lecturas.create` como ÚNICO permiso. Es la cuenta de campo que no
-- puede leer ni una fila de `registros` — y a la que el reporte le enseñaba
-- el condominio completo.

-- ── Los dos caminos de sistema que reciben la llave POR FUNCIÓN ─────────────
-- 20260911031701 hace `ALTER FUNCTION … SET "agua.cobro_autoritativo" = 'on'`
-- sobre `agua_cerrar_ciclo_nucleo` y `aplicar_mora_facturas_vencidas`. Aquí se
-- crean con la MISMA firma y la misma forma de escritura que las reales
-- (SECURITY DEFINER, propietario `postgres`, UPDATE de columnas de cobro) para
-- que ese ALTER tenga a quién aplicarse y, sobre todo, para poder COMPROBAR que
-- la capacidad por función funciona: sin el ALTER, una DEFINER idéntica se
-- estrella contra el guard.
--
-- No replican la lógica de negocio —eso lo cubre su propio dominio—: replican
-- la ESCRITURA, que es lo que el guard juzga.
CREATE OR REPLACE FUNCTION public.agua_cerrar_ciclo_nucleo(
  p_project_id uuid,
  p_periodo    text,
  p_notificar  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.registros r
     SET factura_estado = 'emitida',
         emitida_at     = now(),
         total_a_pagar  = round(COALESCE(r.monto_calculado, 0), 2)
   WHERE r.project_id = p_project_id
     AND r.deleted_at IS NULL
     AND COALESCE(r.factura_estado, 'pendiente') = 'pendiente';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('emitidas', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.agua_cerrar_ciclo_nucleo(uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.aplicar_mora_facturas_vencidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.registros r
     SET mora_monto       = 25.00,
         mora_aplicada_at = now()
   WHERE r.deleted_at IS NULL
     AND r.factura_estado IN ('emitida', 'vencida');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_facturas_vencidas() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.aplicar_mora_facturas_vencidas() TO service_role;

-- ── La función DEFINER hostil: el caso que la exención vieja dejaba pasar ───
-- Propietario `postgres`, ejecutable por `authenticated`, y sin llave. Con la
-- exención de `current_user IN ('postgres', …)` esto entraba: cualquier DEFINER
-- del esquema era una puerta. Es la prueba negativa que exige la invariante 23.
CREATE OR REPLACE FUNCTION public.test_definer_falsifica_cobro(p_registro_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.registros
     SET monto_calculado = 0, estado = 'pagado', monto_pagado = 999999
   WHERE id = p_registro_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.test_definer_falsifica_cobro(uuid) TO authenticated;

-- La misma, pero sobre una columna INMUTABLE: ni con la llave de cobro.
CREATE OR REPLACE FUNCTION public.test_definer_falsifica_lectura(p_registro_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('agua.cobro_autoritativo', 'on', true);
  UPDATE public.registros SET consumo = 0 WHERE id = p_registro_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.test_definer_falsifica_lectura(uuid) TO authenticated;

-- Y una tercera: la función DEFINER que intenta colarse por la RPC del
-- proveedor de pago. Corre como el dueño, así que tiene EXECUTE implícito
-- sobre TODO — el GRANT no la para. Lo que la para es el chequeo de rol
-- efectivo de dentro. Sin él, `authenticated` acreditaría pagos inventados.
CREATE OR REPLACE FUNCTION public.test_definer_acredita_pago(p_registro_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.agua_registro_acreditar_pago_externo(p_registro_id, 999999, 'inventado');
END;
$$;
GRANT EXECUTE ON FUNCTION public.test_definer_acredita_pago(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- El padrón del payfac: solicitudes de cobro, pagos y cuotas
-- ════════════════════════════════════════════════════════════════════════════
-- Formas reducidas pero FIELES a las reales (20260317000000/000001 +
-- 20260420000001 y sus ALTER posteriores): sólo las columnas que
-- `conciliar_pago_externo` lee o escribe, con sus CHECK. `pagos` se crea SIN
-- `payment_request_id` a propósito: esa columna la agrega la migración, y así
-- el harness ejerce también el `ALTER TABLE` que la introduce.
CREATE TABLE public.payment_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id            uuid NOT NULL,
  registro_id           uuid REFERENCES public.registros(id) ON DELETE CASCADE,
  cuota_id              uuid,
  company_id            uuid NOT NULL,
  monto                 numeric NOT NULL,
  provider              text NOT NULL,
  estado                text DEFAULT 'pending',
  provider_ref          text,
  stripe_payment_intent text UNIQUE,
  paypal_order_id       text UNIQUE,
  ambiente              text NOT NULL DEFAULT 'sandbox',
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT payment_requests_provider_check
    CHECK (provider IN ('stripe', 'paypal', 'manual', 'sandbox', 'qpaypro', 'visanet')),
  CONSTRAINT payment_requests_estado_check
    CHECK (estado IN ('pending', 'succeeded', 'failed', 'pending_verification'))
);

CREATE TABLE public.cuotas_condominio (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  monto           numeric(12,2) NOT NULL,
  total_a_pagar   numeric(12,2),
  periodo         text NOT NULL DEFAULT '2026-09',
  estado          text NOT NULL DEFAULT 'pendiente',
  cuota_estado    text DEFAULT 'pendiente',
  pagada_at       timestamptz,
  fecha_pago      date,
  metodo_pago     text,
  referencia_pago text,
  pago_id         uuid,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pagos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id         uuid REFERENCES public.registros(id) ON DELETE SET NULL,
  cuota_id            uuid REFERENCES public.cuotas_condominio(id) ON DELETE SET NULL,
  cliente_id          uuid NOT NULL,
  project_id          uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  monto               numeric(10,2) NOT NULL,
  metodo              text NOT NULL,
  estado              text NOT NULL DEFAULT 'pendiente',
  verification_status text DEFAULT 'pendiente',
  tipo_aplicacion     text DEFAULT 'pago_total',
  referencia          text,
  deleted_at          timestamptz,
  created_at          timestamptz DEFAULT now(),
  CONSTRAINT pagos_estado_check
    CHECK (estado IN ('pendiente', 'verificado', 'rechazado', 'aplicado')),
  CONSTRAINT pagos_metodo_check
    CHECK (metodo IN ('efectivo', 'transferencia', 'deposito', 'tarjeta_credito',
                      'tarjeta_debito', 'cheque', 'convenio_pago', 'paypal', 'otro',
                      'sandbox')),
  CONSTRAINT pagos_tipo_aplicacion_check
    CHECK (tipo_aplicacion IN ('pago_total', 'abono', 'convenio'))
);

ALTER TABLE public.cuotas_condominio
  ADD CONSTRAINT cuotas_condominio_pago_id_fkey
  FOREIGN KEY (pago_id) REFERENCES public.pagos(id) ON DELETE SET NULL;

-- El fallo PROVOCADO de la invariante 35. Es la única forma honesta de romper
-- la conciliación DESPUÉS del INSERT del pago y ANTES de la acreditación: el
-- `UPDATE` del recibo es lo primero que ocurre tras insertar. Apagado salvo
-- que la prueba encienda el GUC.
CREATE OR REPLACE FUNCTION public.test_tg_registros_romper_acreditacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('test.romper_acreditacion', true), 'off') = 'on' THEN
    RAISE EXCEPTION 'fallo provocado entre el INSERT del pago y la acreditación'
      USING ERRCODE = '22000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ztest_tg_registros_romper ON public.registros;
CREATE TRIGGER ztest_tg_registros_romper
  BEFORE UPDATE ON public.registros
  FOR EACH ROW EXECUTE FUNCTION public.test_tg_registros_romper_acreditacion();

-- Y la puerta de atrás para la RPC de conciliación: una DEFINER que
-- `authenticated` puede invocar. El GRANT no la para (corre como el dueño);
-- la para el chequeo de rol efectivo.
CREATE OR REPLACE FUNCTION public.test_definer_concilia(p_pr_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.conciliar_pago_externo(p_pr_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.test_definer_concilia(uuid) TO authenticated;

-- Emula lo que hace Supabase cuando la petición llega con la clave de
-- service_role: PostgREST pone el claim del JWT antes de ejecutar. Hace falta
-- porque la segunda conexión de la prueba de concurrencia entra por dblink,
-- donde no hay JWT que poner. Revocada de anon y authenticated para que no sea
-- una puerta de atrás dentro del propio harness.
CREATE OR REPLACE FUNCTION public.test_conciliar_como_payfac(p_pr_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  RETURN public.conciliar_pago_externo(p_pr_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.test_conciliar_como_payfac(uuid)
  FROM PUBLIC, anon, authenticated;
