-- ════════════════════════════════════════════════════════════════════════════
-- El `UPDATE` de `registros` seguía siendo una puerta abierta al importe
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ QUEDÓ ABIERTO EN 20260910000200. Aquella migración movió al servidor la
-- CREACIÓN de la lectura: `registrar_lectura` no tiene parámetro donde escribir
-- el importe, y `trg_agua_lectura_autoritativa` recalcula lo que entre por
-- `INSERT` directo. Pero el trigger es BEFORE **INSERT**, y la policy
-- `registros_update` (20260610000808) autoriza por FILA y no mira ni una
-- columna — además sin `WITH CHECK`. Así que lo que no se podía escribir al
-- crear se podía escribir un milisegundo después:
--
--     PATCH /rest/v1/registros?id=eq.<uuid>
--     { "monto_calculado": 0, "consumo": 0, "estado": "pagado",
--       "monto_pagado": 999999, "factura_estado": "pagada" }
--
-- QUÉ SÍ PARABA LA RLS, MEDIDO. Conviene ser exacto, porque es fácil pasarse:
-- la policy no declara `WITH CHECK`, y cuando falta Postgres reutiliza el
-- `USING`; además aplica la policy de SELECT sobre la fila resultante. Entre
-- las dos cosas, `project_id` NO se puede mover a un proyecto que la cuenta no
-- vea —se comprobó ejerciéndolo, y la prueba empezó fallando justamente ahí—.
-- Pero eso es todo lo que paraban: el predicado es por fila y no mira ningún
-- valor. Dentro de lo que la cuenta ya alcanza, la lectura entera se reescribe
-- —contador (a un medidor de otra unidad y otro cliente), consumo, tarifa,
-- importe, secuencia, llave de idempotencia— y el cobro se fabrica entero.
--
-- El agujero está EJERCIDO, no supuesto: `supabase/tests/proteger_update_registros/`
-- desactiva este trigger, hace el PATCH COMO `authenticated` y comprueba que
-- entra; después lo reactiva y comprueba que deja de entrar.
--
-- ── LO QUE HACE ESTA MIGRACIÓN ─────────────────────────────────────────────
--
-- 1. `agua_tg_registros_proteger_update` — BEFORE UPDATE, fail-closed. Parte
--    las columnas en tres y sólo deja pasar lo que corresponde:
--
--    · INMUTABLES — la lectura y su cálculo. No las cambia NADIE por `UPDATE`,
--      ni con la llave de capacidad. Si hay que corregir una lectura, se anula
--      y se vuelve a capturar: eso deja rastro, un `UPDATE` no.
--    · DE COBRO — estado, abonado, fechas y el desglose de la factura. Sólo
--      cambian con la llave de capacidad puesta, que sólo ponen las RPC de
--      abajo. Un `PATCH` genérico ya no puede tocarlas.
--    · LIBRES — notas, foto, gps y el borrado lógico. Siguen siendo un `UPDATE`
--      normal: no fabrican un cobro.
--
-- 2. Las RPC del camino autorizado, una por transición real, con permiso
--    explícito y **auditoría**: `agua_factura_emitir`, `agua_factura_anular`,
--    `agua_factura_registrar_pago`, `agua_registro_marcar_mora` y
--    `agua_registro_cambiar_estado`. Son SECURITY INVOKER —la policy
--    `registros_update` las sigue juzgando— y encima exigen el permiso de
--    cobro, que la policy no pedía.
--
-- 3. `agua_lecturas_inconsistencias` pasa a exigir la MISMA autorización que la
--    rama interna de `registros_select`. Ver la sección 5.
--
-- ── LA LLAVE DE CAPACIDAD ──────────────────────────────────────────────────
-- `agua.cobro_autoritativo` es un GUC de sesión, local a la transacción. Un
-- cliente no puede encenderlo: la Data API sólo expone funciones de `public` y
-- `set_config` vive en `pg_catalog`; sin SQL arbitrario no hay forma de tocar
-- un GUC. Es el mismo mecanismo que `agua.lectura_autoritativa` (20260910000200)
-- y que `conta.allow_system_write` (20260611000100).
--
-- ── LA EXCEPCIÓN DE `service_role`, ENUMERADA ──────────────────────────────
-- El guard se aplica a TODO rol salvo una lista cerrada —`service_role`,
-- `postgres`, `supabase_admin`—, que es lo que lo hace fail-closed: un rol
-- nuevo nace protegido. Lo que queda fuera, y por qué:
--
--   · `timbrar-documento` (edge function): sella el comprobante fiscal.
--   · `purgar-fotos-registros` (edge function) y `purgar_datos_retenidos`:
--     ponen `foto = NULL`, que además es columna LIBRE.
--   · `aplicar_mora_facturas_vencidas` y `run_cierres_ciclo_automaticos`
--     (pg_cron, sin JWT) y `agua_cerrar_ciclo_nucleo`: corren como el dueño.
--   · las migraciones de backfill, que son históricas por definición.
--
-- Ninguna de ésas es el navegador, que es el sujeto del problema. Y lo que
-- escriban lo sigue auditando el reporte de 20260910000300.
--
-- REVERSIÓN
--   DROP TRIGGER  IF EXISTS trg_agua_registros_proteger_update ON public.registros;
--   DROP FUNCTION IF EXISTS public.agua_tg_registros_proteger_update();
--   DROP FUNCTION IF EXISTS public.agua_registro_cambiar_estado(uuid, text);
--   DROP FUNCTION IF EXISTS public.agua_registro_marcar_mora(uuid[]);
--   DROP FUNCTION IF EXISTS public.agua_factura_registrar_pago(uuid, numeric, date);
--   DROP FUNCTION IF EXISTS public.agua_factura_anular(uuid, text);
--   DROP FUNCTION IF EXISTS public.agua_factura_emitir(uuid, integer);
--   DROP FUNCTION IF EXISTS public.agua_cobro_auditar(uuid, text, jsonb);
--   -- y volver a 20260910000300 para agua_lecturas_inconsistencias.
--
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS antes del CREATE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La auditoría del cobro ───────────────────────────────────────────────
-- SECURITY DEFINER porque `security_logs` dejó de aceptar escrituras de
-- `authenticated` en 20260910000001, y con razón: un log en el que cualquiera
-- puede escribir no es un log. Esta función no reabre aquello, porque exige la
-- llave de capacidad — que sólo encienden las RPC de más abajo, dentro de su
-- propia transacción y después de haber comprobado el permiso. Llamarla suelta
-- desde la API no escribe nada.
CREATE OR REPLACE FUNCTION public.agua_cobro_auditar(
  p_registro_id uuid,
  p_evento      text,
  p_detalle     jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(current_setting('agua.cobro_autoritativo', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'agua_cobro_auditar sólo se llama desde una RPC de cobro'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.security_logs (user_id, event_type, details)
  VALUES (
    (SELECT auth.uid()),
    'agua_cobro.' || p_evento,
    COALESCE(p_detalle, '{}'::jsonb) || jsonb_build_object('registro_id', p_registro_id)
  );
END;
$$;

COMMENT ON FUNCTION public.agua_cobro_auditar(uuid, text, jsonb) IS
  'Escribe en security_logs el rastro de una transición de cobro de agua. SECURITY DEFINER porque authenticated ya no escribe en esa tabla (20260910000001); exige la llave de capacidad agua.cobro_autoritativo, así que sólo escribe desde dentro de una RPC de cobro que ya validó el permiso.';

REVOKE EXECUTE ON FUNCTION public.agua_cobro_auditar(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_cobro_auditar(uuid, text, jsonb) TO authenticated;

-- ── 2. El guard de columnas ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agua_tg_registros_proteger_update()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER (el default) Y NO DEFINER, que es como se escribió primero.
-- Dentro de una función DEFINER `current_user` es el DUEÑO, así que la lista de
-- exentos se cumplía SIEMPRE y el guard no paraba nada: la prueba lo cazó en la
-- invariante 2. No necesita privilegios ajenos —sólo mira NEW, OLD y dos GUC—,
-- y como INVOKER `current_user` es el rol real de la petición, que es la única
-- forma de que la allowlist signifique algo. (Que la función esté revocada de
-- `authenticated` no impide que dispare: el privilegio de una función de
-- trigger se comprueba al CREAR el trigger, no al dispararlo.)
SET search_path = ''
AS $$
DECLARE
  v_rol    text;
  v_libre  boolean;
  v_cambio text;
BEGIN
  -- Allowlist cerrada, no denylist: un rol nuevo nace protegido. `postgres` y
  -- `supabase_admin` están dentro porque es como corren el cron y las funciones
  -- SECURITY DEFINER de la plataforma (el cierre de ciclo, la mora), que son
  -- caminos ya autorizados con su propio guard.
  BEGIN
    v_rol := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  EXCEPTION WHEN OTHERS THEN
    v_rol := '';
  END;
  IF v_rol = 'service_role'
     OR current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- ── INMUTABLES: la lectura y su cálculo. Ni con la llave de capacidad. ────
  v_cambio := CASE
    WHEN NEW.contador_id            IS DISTINCT FROM OLD.contador_id            THEN 'contador_id'
    WHEN NEW.project_id             IS DISTINCT FROM OLD.project_id             THEN 'project_id'
    WHEN NEW.cliente_id             IS DISTINCT FROM OLD.cliente_id             THEN 'cliente_id'
    WHEN NEW.cliente_nombre         IS DISTINCT FROM OLD.cliente_nombre         THEN 'cliente_nombre'
    WHEN NEW.fecha                  IS DISTINCT FROM OLD.fecha                  THEN 'fecha'
    WHEN NEW.fecha_lectura_anterior IS DISTINCT FROM OLD.fecha_lectura_anterior THEN 'fecha_lectura_anterior'
    WHEN NEW.dias_servicio          IS DISTINCT FROM OLD.dias_servicio          THEN 'dias_servicio'
    WHEN NEW.lectura_anterior       IS DISTINCT FROM OLD.lectura_anterior       THEN 'lectura_anterior'
    WHEN NEW.lectura_actual         IS DISTINCT FROM OLD.lectura_actual         THEN 'lectura_actual'
    WHEN NEW.consumo                IS DISTINCT FROM OLD.consumo                THEN 'consumo'
    WHEN NEW.tarifa_aplicada        IS DISTINCT FROM OLD.tarifa_aplicada        THEN 'tarifa_aplicada'
    WHEN NEW.tarifa_exceso_aplicada IS DISTINCT FROM OLD.tarifa_exceso_aplicada THEN 'tarifa_exceso_aplicada'
    WHEN NEW.canon_aplicado         IS DISTINCT FROM OLD.canon_aplicado         THEN 'canon_aplicado'
    WHEN NEW.monto_calculado        IS DISTINCT FROM OLD.monto_calculado        THEN 'monto_calculado'
    WHEN NEW.tipo_cobro             IS DISTINCT FROM OLD.tipo_cobro             THEN 'tipo_cobro'
    WHEN NEW.secuencia              IS DISTINCT FROM OLD.secuencia              THEN 'secuencia'
    WHEN NEW.idempotency_key        IS DISTINCT FROM OLD.idempotency_key        THEN 'idempotency_key'
    WHEN NEW.origen                 IS DISTINCT FROM OLD.origen                 THEN 'origen'
    WHEN NEW.es_reset               IS DISTINCT FROM OLD.es_reset               THEN 'es_reset'
    WHEN NEW.lectura_final_retirada IS DISTINCT FROM OLD.lectura_final_retirada THEN 'lectura_final_retirada'
    WHEN NEW.mes                    IS DISTINCT FROM OLD.mes                    THEN 'mes'
    WHEN NEW.created_at             IS DISTINCT FROM OLD.created_at             THEN 'created_at'
    WHEN NEW.creado_por             IS DISTINCT FROM OLD.creado_por             THEN 'creado_por'
    ELSE NULL
  END;

  IF v_cambio IS NOT NULL THEN
    RAISE EXCEPTION
      'la lectura no se edita: "%" es inmutable. Para corregirla, anulá la lectura y volvé a capturarla con registrar_lectura()',
      v_cambio
      USING ERRCODE = '42501';
  END IF;

  -- ── DE COBRO: sólo con la llave de capacidad ─────────────────────────────
  v_libre := COALESCE(current_setting('agua.cobro_autoritativo', true), 'off') = 'on';
  IF NOT v_libre THEN
    v_cambio := CASE
      WHEN NEW.estado            IS DISTINCT FROM OLD.estado            THEN 'estado'
      WHEN NEW.factura_estado    IS DISTINCT FROM OLD.factura_estado    THEN 'factura_estado'
      WHEN NEW.monto_pagado      IS DISTINCT FROM OLD.monto_pagado      THEN 'monto_pagado'
      WHEN NEW.fecha_pago        IS DISTINCT FROM OLD.fecha_pago        THEN 'fecha_pago'
      WHEN NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento THEN 'fecha_vencimiento'
      WHEN NEW.iva_tasa          IS DISTINCT FROM OLD.iva_tasa          THEN 'iva_tasa'
      WHEN NEW.iva_monto         IS DISTINCT FROM OLD.iva_monto         THEN 'iva_monto'
      WHEN NEW.monto_con_iva     IS DISTINCT FROM OLD.monto_con_iva     THEN 'monto_con_iva'
      WHEN NEW.total_a_pagar     IS DISTINCT FROM OLD.total_a_pagar     THEN 'total_a_pagar'
      WHEN NEW.mora_monto        IS DISTINCT FROM OLD.mora_monto        THEN 'mora_monto'
      WHEN NEW.mora_aplicada_at  IS DISTINCT FROM OLD.mora_aplicada_at  THEN 'mora_aplicada_at'
      WHEN NEW.regla_mora_id     IS DISTINCT FROM OLD.regla_mora_id     THEN 'regla_mora_id'
      WHEN NEW.emitida_at        IS DISTINCT FROM OLD.emitida_at        THEN 'emitida_at'
      WHEN NEW.pagada_at         IS DISTINCT FROM OLD.pagada_at         THEN 'pagada_at'
      WHEN NEW.vencida_at        IS DISTINCT FROM OLD.vencida_at        THEN 'vencida_at'
      WHEN NEW.anulada_at        IS DISTINCT FROM OLD.anulada_at        THEN 'anulada_at'
      ELSE NULL
    END;

    IF v_cambio IS NOT NULL THEN
      RAISE EXCEPTION
        'el cobro no se edita por UPDATE: "%" sólo cambia por agua_factura_emitir/anular/registrar_pago, agua_registro_marcar_mora o agua_registro_cambiar_estado',
        v_cambio
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Lo que queda —notas, foto, gps, deleted_at, deleted_by— es un UPDATE normal.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.agua_tg_registros_proteger_update() IS
  'BEFORE UPDATE en registros: las columnas de la LECTURA y su cálculo son inmutables para todo rol de API, y las de COBRO sólo cambian con la llave agua.cobro_autoritativo, que encienden las RPC de cobro tras validar el permiso. Cierra el PATCH genérico que permitía fabricar un recibo (monto 0, estado pagado, abonado inventado) o mover la fila a otro proyecto — registros_update no tiene WITH CHECK. Allowlist de roles exentos (service_role/postgres/supabase_admin): un rol nuevo nace protegido.';

REVOKE EXECUTE ON FUNCTION public.agua_tg_registros_proteger_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_agua_registros_proteger_update ON public.registros;
CREATE TRIGGER trg_agua_registros_proteger_update
  BEFORE UPDATE ON public.registros
  FOR EACH ROW EXECUTE FUNCTION public.agua_tg_registros_proteger_update();

-- ── 3. El guard compartido de las RPC de cobro ──────────────────────────────
-- POR QUÉ ESTAS RPC SON SECURITY DEFINER Y `registrar_lectura` NO.
-- En el INSERT, la policy `registros_insert` contesta EXACTAMENTE la pregunta
-- que hace falta —«¿puede esta cuenta escribir una lectura en este proyecto?»—
-- así que delegar en ella era lo correcto y copiar el guard dentro habría sido
-- una segunda fuente de verdad que un `CREATE OR REPLACE` futuro puede perder.
-- En el UPDATE no: `registros_update` contesta «¿puede tocar esta fila?», que
-- es justamente la pregunta equivocada —no mira ni una columna— y es el agujero
-- que esta migración cierra. Aquí la autorización HAY que enunciarla, y se
-- enuncia una sola vez, en esta función, con el mismo patrón fail-closed que
-- `agua_cerrar_ciclo` (20260717140000), que es la RPC hermana: también emite
-- facturas de agua y también es DEFINER con guard explícito.
--
-- El conjunto autorizado es el MISMO que hoy: la lista de roles de
-- `registros_update` o el permiso de cobro. No se recorta a quién puede
-- facturar —eso sería otra decisión, de operación— se recorta QUÉ puede
-- escribir: ya no un importe inventado, sino la transición que pidió.
CREATE OR REPLACE FUNCTION public.agua_cobro_guard(
  p_registro_id uuid,
  p_permiso     text
)
RETURNS public.registros
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg     public.registros;
  v_company uuid;
BEGIN
  SELECT * INTO v_reg FROM public.registros r
   WHERE r.id = p_registro_id AND r.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registro no encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.company_id INTO v_company
    FROM public.projects p WHERE p.id = v_reg.project_id;

  -- `IS NOT TRUE` y no `NOT (...)`: sin JWT los helpers devuelven NULL y
  -- `NOT NULL` no lanza — fail-closed también sin sesión.
  IF (
    public.is_super_admin()
    OR (
      v_company IS NOT NULL
      AND v_company = public.get_my_company_id()
      AND public.can_access_project(v_reg.project_id)
      AND (
        public.current_user_role() = ANY (ARRAY['admin','company_owner','operator','operador'])
        OR public.user_has_permission(p_permiso)
      )
    )
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'no autorizado sobre el cobro de este registro'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_reg;
END;
$$;

COMMENT ON FUNCTION public.agua_cobro_guard(uuid, text) IS
  'Autorización de una transición de cobro sobre una lectura: super admin, o empresa del proyecto + acceso al proyecto + (rol de staff o el permiso pedido). Devuelve la fila para que la RPC no la vuelva a leer. Fail-closed sin JWT.';

REVOKE EXECUTE ON FUNCTION public.agua_cobro_guard(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 4. Las RPC del camino autorizado ────────────────────────────────────────

-- 4a · EMITIR — pendiente → emitida, con el snapshot de IVA calculado AQUÍ.
-- La aritmética es la MISMA que `agua_cerrar_ciclo_nucleo` (20260717140000) y
-- que `calcularTotalFactura` en TypeScript; lo que cambia es de dónde salen los
-- números: la tasa de IVA la lee de `companies`, los días de la regla de mora
-- activa del proyecto, y el subtotal de la propia fila. Ninguno es parámetro.
CREATE OR REPLACE FUNCTION public.agua_factura_emitir(
  p_registro_id      uuid,
  p_dias_vencimiento integer DEFAULT NULL
)
RETURNS public.registros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg      public.registros;
  v_company  uuid;
  v_estado   text;
  v_iva_tasa numeric;
  v_dias     integer;
  v_base     numeric;
  v_mora     numeric;
  v_iva      numeric;
  v_con_iva  numeric;
  v_now      timestamptz := now();
BEGIN
  v_reg := public.agua_cobro_guard(p_registro_id, 'agua.cobros.change_status');

  -- Máquina de estados: espeja TRANSICIONES_FACTURA de src/lib/business.ts,
  -- incluida la tolerancia a los estados legacy ('pagado' → 'pagada',
  -- 'mora' → 'vencida', desconocido → 'pendiente').
  v_estado := CASE COALESCE(v_reg.factura_estado, v_reg.estado)
                WHEN 'pendiente' THEN 'pendiente' WHEN 'emitida' THEN 'emitida'
                WHEN 'pagada'    THEN 'pagada'    WHEN 'vencida' THEN 'vencida'
                WHEN 'anulada'   THEN 'anulada'   WHEN 'pagado'  THEN 'pagada'
                WHEN 'mora'      THEN 'vencida'   ELSE 'pendiente'
              END;
  IF v_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'transición inválida: no se puede "emitir" una factura en estado "%"', v_estado
      USING ERRCODE = '22023';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = v_reg.project_id;

  SELECT rmc.dias_vencimiento INTO v_dias
    FROM public.reglas_mora_config rmc
   WHERE rmc.project_id = v_reg.project_id AND rmc.activa = true
   ORDER BY rmc.created_at DESC LIMIT 1;
  v_dias := COALESCE(p_dias_vencimiento, v_dias, 30);
  IF v_dias < 0 OR v_dias > 3650 THEN
    RAISE EXCEPTION 'días de vencimiento fuera de rango' USING ERRCODE = '22023';
  END IF;

  SELECT c.iva_tasa_default INTO v_iva_tasa FROM public.companies c WHERE c.id = v_company;
  v_iva_tasa := CASE WHEN v_iva_tasa IS NULL THEN 0.12
                     WHEN v_iva_tasa < 0     THEN 0
                     WHEN v_iva_tasa > 1     THEN 1
                     ELSE v_iva_tasa END;

  v_base    := CASE WHEN COALESCE(v_reg.monto_calculado, 0) > 0
                    THEN round(v_reg.monto_calculado::numeric, 2) ELSE 0 END;
  v_mora    := CASE WHEN COALESCE(v_reg.mora_monto, 0) > 0
                    THEN round(v_reg.mora_monto::numeric, 2) ELSE 0 END;
  v_iva     := round(v_base * v_iva_tasa, 2);
  v_con_iva := round(v_base + v_iva, 2);

  PERFORM set_config('agua.cobro_autoritativo', 'on', true);
  UPDATE public.registros r
     SET factura_estado    = 'emitida',
         emitida_at        = v_now,
         fecha_vencimiento = (v_now + make_interval(days => v_dias))::date,
         iva_tasa          = v_iva_tasa,
         iva_monto         = v_iva,
         monto_con_iva     = v_con_iva,
         total_a_pagar     = round(v_con_iva + v_mora, 2)
   WHERE r.id = p_registro_id
   RETURNING * INTO v_reg;

  PERFORM public.agua_cobro_auditar(p_registro_id, 'emitir', jsonb_build_object(
    'total_a_pagar', v_reg.total_a_pagar, 'iva_tasa', v_iva_tasa,
    'dias_vencimiento', v_dias, 'project_id', v_reg.project_id));
  PERFORM set_config('agua.cobro_autoritativo', 'off', true);

  RETURN v_reg;
END;
$$;

COMMENT ON FUNCTION public.agua_factura_emitir(uuid, integer) IS
  'Emite la factura de una lectura (pendiente → emitida) calculando el snapshot de IVA, el total y el vencimiento EN EL SERVIDOR: la tasa sale de companies, los días de la regla de mora activa y el subtotal de la propia fila. Exige el permiso agua.cobros.change_status y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_factura_emitir(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_factura_emitir(uuid, integer) TO authenticated;

-- 4b · ANULAR — pendiente|emitida|vencida → anulada (terminal).
CREATE OR REPLACE FUNCTION public.agua_factura_anular(
  p_registro_id uuid,
  p_motivo      text DEFAULT NULL
)
RETURNS public.registros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg    public.registros;
  v_estado text;
BEGIN
  v_reg := public.agua_cobro_guard(p_registro_id, 'agua.cobros.change_status');

  v_estado := CASE COALESCE(v_reg.factura_estado, v_reg.estado)
                WHEN 'pendiente' THEN 'pendiente' WHEN 'emitida' THEN 'emitida'
                WHEN 'pagada'    THEN 'pagada'    WHEN 'vencida' THEN 'vencida'
                WHEN 'anulada'   THEN 'anulada'   WHEN 'pagado'  THEN 'pagada'
                WHEN 'mora'      THEN 'vencida'   ELSE 'pendiente'
              END;
  IF v_estado NOT IN ('pendiente', 'emitida', 'vencida') THEN
    RAISE EXCEPTION 'transición inválida: no se puede "anular" una factura en estado "%"', v_estado
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('agua.cobro_autoritativo', 'on', true);
  UPDATE public.registros r
     SET factura_estado = 'anulada', anulada_at = now()
   WHERE r.id = p_registro_id
   RETURNING * INTO v_reg;

  PERFORM public.agua_cobro_auditar(p_registro_id, 'anular', jsonb_build_object(
    'estado_previo', v_estado, 'motivo', NULLIF(btrim(COALESCE(p_motivo, '')), ''),
    'project_id', v_reg.project_id));
  PERFORM set_config('agua.cobro_autoritativo', 'off', true);

  RETURN v_reg;
END;
$$;

COMMENT ON FUNCTION public.agua_factura_anular(uuid, text) IS
  'Anula la factura de una lectura (pendiente|emitida|vencida → anulada). Exige agua.cobros.change_status y deja rastro en security_logs con el estado previo y el motivo.';

REVOKE EXECUTE ON FUNCTION public.agua_factura_anular(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_factura_anular(uuid, text) TO authenticated;

-- 4c · REGISTRAR PAGO — el abonado sube; el estado lo deduce el servidor.
-- `p_monto` es el ÚNICO número que entra, y entra porque nadie más lo sabe. El
-- abonado resultante, si liquida, la fecha de pago y la transición de la
-- factura los calcula esta función. Un `PATCH` ya no puede poner
-- `monto_pagado: 999999, estado: 'pagado'` sin que exista un pago.
CREATE OR REPLACE FUNCTION public.agua_factura_registrar_pago(
  p_registro_id uuid,
  p_monto       numeric,
  p_fecha_pago  date DEFAULT NULL
)
RETURNS public.registros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg      public.registros;
  v_estado   text;
  v_total    numeric;
  v_previo   numeric;
  v_nuevo    numeric;
  v_completo boolean;
  v_tz       text;
  v_fecha    date;
  v_company  uuid;
BEGIN
  v_reg := public.agua_cobro_guard(p_registro_id, 'agua.cobros.create');

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'el pago debe ser un monto mayor que cero' USING ERRCODE = '22023';
  END IF;

  v_estado := CASE COALESCE(v_reg.factura_estado, v_reg.estado)
                WHEN 'pendiente' THEN 'pendiente' WHEN 'emitida' THEN 'emitida'
                WHEN 'pagada'    THEN 'pagada'    WHEN 'vencida' THEN 'vencida'
                WHEN 'anulada'   THEN 'anulada'   WHEN 'pagado'  THEN 'pagada'
                WHEN 'mora'      THEN 'vencida'   ELSE 'pendiente'
              END;
  IF v_estado IN ('pagada', 'anulada') THEN
    RAISE EXCEPTION 'transición inválida: no se puede "pagar" una factura en estado "%"', v_estado
      USING ERRCODE = '22023';
  END IF;

  -- El saldo se mide contra el TOTAL de la factura (IVA + mora incluidos); si
  -- todavía no se emitió, contra el subtotal. Misma regla que CobrosSection.
  v_total  := COALESCE(v_reg.total_a_pagar, v_reg.monto_calculado, 0);
  v_previo := GREATEST(COALESCE(v_reg.monto_pagado, 0), 0);
  v_nuevo  := v_previo + p_monto;

  -- Un abono no puede pasarse del saldo: media centésima de tolerancia por el
  -- redondeo, y nada más. Cobrar de más no es un abono, es un descuadre.
  IF v_total > 0 AND v_nuevo > v_total + 0.005 THEN
    RAISE EXCEPTION 'el pago (%) excede el saldo pendiente (%)',
      round(p_monto, 2), round(GREATEST(v_total - v_previo, 0), 2)
      USING ERRCODE = '22023';
  END IF;

  v_completo := v_total > 0 AND (v_total - v_nuevo) <= 0.005;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = v_reg.project_id;
  SELECT COALESCE(c.timezone, 'America/Guatemala') INTO v_tz
    FROM public.companies c WHERE c.id = v_company;
  v_tz := COALESCE(v_tz, 'America/Guatemala');
  BEGIN
    v_fecha := COALESCE(p_fecha_pago, (now() AT TIME ZONE v_tz)::date);
  EXCEPTION WHEN OTHERS THEN
    v_fecha := COALESCE(p_fecha_pago, (now() AT TIME ZONE 'America/Guatemala')::date);
  END;

  PERFORM set_config('agua.cobro_autoritativo', 'on', true);
  UPDATE public.registros r
     SET monto_pagado   = round(v_nuevo, 2),
         estado         = CASE WHEN v_completo THEN 'pagado' ELSE 'pendiente' END,
         fecha_pago     = CASE WHEN v_completo THEN v_fecha ELSE NULL END,
         -- La factura sólo transiciona si el pago liquida Y estaba emitida o
         -- vencida: un abono parcial la deja donde estaba.
         factura_estado = CASE WHEN v_completo AND v_estado IN ('emitida','vencida')
                               THEN 'pagada' ELSE r.factura_estado END,
         pagada_at      = CASE WHEN v_completo AND v_estado IN ('emitida','vencida')
                               THEN now() ELSE r.pagada_at END
   WHERE r.id = p_registro_id
   RETURNING * INTO v_reg;

  PERFORM public.agua_cobro_auditar(p_registro_id, 'registrar_pago', jsonb_build_object(
    'monto', round(p_monto, 2), 'abonado_previo', round(v_previo, 2),
    'abonado', v_reg.monto_pagado, 'total', round(v_total, 2),
    'liquida', v_completo, 'project_id', v_reg.project_id));
  PERFORM set_config('agua.cobro_autoritativo', 'off', true);

  RETURN v_reg;
END;
$$;

COMMENT ON FUNCTION public.agua_factura_registrar_pago(uuid, numeric, date) IS
  'Registra un pago/abono sobre una lectura. El único dato de entrada es el monto; el abonado resultante, si liquida, la fecha de pago (zona del tenant) y la transición de la factura los decide el servidor. Rechaza montos <= 0 y los que exceden el saldo. Exige agua.cobros.create y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_factura_registrar_pago(uuid, numeric, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_factura_registrar_pago(uuid, numeric, date) TO authenticated;

-- 4d · MARCAR MORA — el seguimiento del cobrador, en lote.
CREATE OR REPLACE FUNCTION public.agua_registro_marcar_mora(p_registro_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id  uuid;
  v_reg public.registros;
  v_n   integer := 0;
BEGIN
  IF p_registro_ids IS NULL OR array_length(p_registro_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  IF array_length(p_registro_ids, 1) > 1000 THEN
    RAISE EXCEPTION 'demasiados registros en un solo lote (máximo 1000)' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY p_registro_ids LOOP
    -- El guard corre POR FILA: un lote no es una excusa para saltarse el
    -- alcance de una de ellas.
    v_reg := public.agua_cobro_guard(v_id, 'agua.cobros.change_status');
    IF v_reg.estado IS DISTINCT FROM 'mora' THEN
      PERFORM set_config('agua.cobro_autoritativo', 'on', true);
      UPDATE public.registros r SET estado = 'mora' WHERE r.id = v_id;
      PERFORM public.agua_cobro_auditar(v_id, 'marcar_mora', jsonb_build_object(
        'estado_previo', v_reg.estado, 'project_id', v_reg.project_id));
      PERFORM set_config('agua.cobro_autoritativo', 'off', true);
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.agua_registro_marcar_mora(uuid[]) IS
  'Marca lecturas como en mora para el seguimiento de cobranza. El guard de alcance corre POR FILA. Exige agua.cobros.change_status y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_registro_marcar_mora(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_registro_marcar_mora(uuid[]) TO authenticated;

-- 4e · CAMBIAR ESTADO a mano — y NO a 'pagado'.
-- El modal de Historial permitía poner 'pagado' con un `UPDATE` de una columna:
-- un recibo cobrado sin que existiera un pago, sin monto, sin fecha y sin
-- rastro. Es exactamente el hallazgo `pagada_sin_pago` del reporte de
-- 20260910000300, y la vía por la que se fabricaba. Marcar pagado pasa a ser
-- competencia exclusiva de `agua_factura_registrar_pago`, que exige un monto.
CREATE OR REPLACE FUNCTION public.agua_registro_cambiar_estado(
  p_registro_id uuid,
  p_estado      text
)
RETURNS public.registros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg public.registros;
BEGIN
  v_reg := public.agua_cobro_guard(p_registro_id, 'agua.lecturas.change_status');

  IF p_estado = 'pagado' THEN
    RAISE EXCEPTION 'marcar una lectura como pagada exige registrar el pago: usá agua_factura_registrar_pago()'
      USING ERRCODE = '42501';
  END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('pendiente', 'mora') THEN
    RAISE EXCEPTION 'estado inválido: sólo "pendiente" o "mora"' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('agua.cobro_autoritativo', 'on', true);
  UPDATE public.registros r SET estado = p_estado WHERE r.id = p_registro_id
   RETURNING * INTO v_reg;
  PERFORM public.agua_cobro_auditar(p_registro_id, 'cambiar_estado', jsonb_build_object(
    'estado', p_estado, 'project_id', v_reg.project_id));
  PERFORM set_config('agua.cobro_autoritativo', 'off', true);

  RETURN v_reg;
END;
$$;

COMMENT ON FUNCTION public.agua_registro_cambiar_estado(uuid, text) IS
  'Cambia a mano el estado de seguimiento de una lectura, SOLO entre "pendiente" y "mora". "pagado" se rechaza a propósito: un recibo se marca cobrado registrando el pago, no editando una columna. Exige agua.lecturas.change_status y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_registro_cambiar_estado(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_registro_cambiar_estado(uuid, text) TO authenticated;

-- ── 5. El reporte dejaba ver el proyecto entero a quien no puede leerlo ─────
-- `agua_lecturas_inconsistencias` es SECURITY DEFINER y autorizaba con
-- `company_id` + `can_access_project`, que no es la pregunta correcta: ninguno
-- de los dos mira si la cuenta tiene permiso de LECTURA sobre agua, y
-- `can_access_project` dice que sí a cualquier usuario de la empresa sin
-- proyectos asignados. Resultado: el informe completo del proyecto —consumos,
-- importes, nombres de cliente y quién debe— para cuentas que no pueden ver ni
-- una fila de `registros`.
--
-- Se re-declara con la MISMA autorización que la rama interna de
-- `registros_select`. Se re-declara aquí y no se toca 20260910000300 porque
-- aquella migración ya está aplicada: el historial es append-only.
CREATE OR REPLACE FUNCTION public.agua_lecturas_inconsistencias(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  registro_id     uuid,
  project_id      uuid,
  contador_id     uuid,
  numero_serie    text,
  cliente_nombre  text,
  fecha           timestamptz,
  hallazgo        text,
  severidad       text,
  detalle         jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH alcance AS (
    -- AUTORIZACIÓN EQUIVALENTE A LA RAMA INTERNA DE `registros_select`.
    --
    -- La versión de 20260910000300 preguntaba sólo «¿misma empresa?» y
    -- «¿can_access_project?», y eso NO es lo que decide quién puede leer una
    -- lectura. `can_access_project` devuelve true por `user_is_project_exempt()`
    -- —un usuario de la empresa SIN proyectos asignados—, así que cualquier
    -- cuenta del tenant sin un solo permiso de agua recibía el reporte ENTERO
    -- del proyecto: consumos, importes, clientes y quién debe. Un residente
    -- incluido. La función es SECURITY DEFINER, así que la RLS de `registros`
    -- no estaba ahí para pararlo.
    --
    -- Ahora se exige lo MISMO que la rama interna de `registros_select`
    -- (20260815000000): uno de los permisos de lectura de agua, empresa
    -- resuelta, proyecto de esa empresa y acceso al proyecto. Y el rol
    -- `cliente` queda fuera explícitamente: el portal del residente ve SUS
    -- filas por las dos ramas de esa policy, no el agregado del condominio.
    --
    -- Sigue siendo SECURITY DEFINER —no INVOKER— porque el reporte cruza
    -- `contadores`, `tarifas` y `companies` para recalcular: con los privilegios
    -- del invocante, a una cuenta con `agua.cobros.view` y sin acceso a
    -- `contadores` el informe le saldría a medias y en silencio, que en un
    -- artefacto de auditoría es peor que no salir.
    --
    -- Se FILTRA en vez de lanzar 42501 (patrón de agua_anomalias_consumo): un
    -- reporte vacío es más útil que uno que revienta.
    SELECT p.id
      FROM public.projects p
     WHERE (p_project_id IS NULL OR p.id = p_project_id)
       AND (
         public.is_super_admin()
         OR (
           public.current_user_role() IS DISTINCT FROM 'cliente'
           AND (SELECT public.get_my_company_id()) IS NOT NULL
           AND p.company_id = (SELECT public.get_my_company_id())
           AND (
             (SELECT public.user_has_permission('agua.tabla.view'))
             OR (SELECT public.user_has_permission('agua.lecturas.view'))
             OR (SELECT public.user_has_permission('agua.dashboard.view'))
             OR (SELECT public.user_has_permission('agua.cobros.view'))
             OR (SELECT public.user_has_permission('agua.mapa.view'))
           )
           AND public.can_access_project(p.id)
         )
       )
  ),
  vivas AS (
    SELECT r.id, r.project_id, r.contador_id, r.cliente_nombre, r.fecha,
           r.created_at, r.lectura_anterior, r.lectura_actual, r.consumo,
           r.tarifa_aplicada, r.tarifa_exceso_aplicada, r.canon_aplicado,
           r.monto_calculado, r.estado, r.monto_pagado, r.fecha_pago,
           r.es_reset, r.lectura_final_retirada, r.origen, r.secuencia,
           c.numero_serie,
           c.project_id AS contador_project_id,
           c.cantidad_derecho_servicio_m3,
           t.precio_m3       AS tarifa_hoy_precio,
           t.precio_m3_exceso AS tarifa_hoy_exceso,
           t.canon_fijo      AS tarifa_hoy_canon,
           t.consumo_minimo  AS tarifa_hoy_minimo,
           CASE WHEN jsonb_typeof(t.tramos) = 'array' THEN t.tramos ELSE NULL END AS tarifa_hoy_tramos,
           -- El MISMO orden total que usa agua_lectura_contexto: el reporte
           -- audita contra la regla nueva, no contra otra distinta.
           LAG(r.lectura_actual) OVER w AS prev_lectura,
           LAG(r.fecha)          OVER w AS prev_fecha,
           -- La fecha más alta que YA existía cuando esta fila se capturó. Es
           -- lo que detecta la retroactiva de verdad: no «viene antes en la
           -- serie» (eso es toda fila menos la última), sino «se escribió
           -- después de otra que ya cubría una fecha posterior».
           MAX(r.fecha) OVER (
             PARTITION BY r.contador_id ORDER BY r.created_at NULLS FIRST, r.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ) AS fecha_tope_al_capturar,
           (r.fecha AT TIME ZONE COALESCE(co.timezone, 'America/Guatemala'))::date AS dia_local,
           COUNT(*) OVER (
             PARTITION BY r.contador_id,
             (r.fecha AT TIME ZONE COALESCE(co.timezone, 'America/Guatemala'))::date
           ) AS lecturas_ese_dia
      FROM public.registros r
      JOIN alcance a          ON a.id = r.project_id
      LEFT JOIN public.contadores c ON c.id = r.contador_id
      LEFT JOIN public.projects  pr ON pr.id = r.project_id
      LEFT JOIN public.companies co ON co.id = pr.company_id
      LEFT JOIN public.tarifas   t  ON t.id = c.tarifa_id
     WHERE r.deleted_at IS NULL
    -- El MISMO orden total que usa agua_lectura_contexto, en ascendente.
    WINDOW w AS (PARTITION BY r.contador_id
                 ORDER BY COALESCE(r.secuencia, 0), r.fecha, r.created_at NULLS FIRST, r.id)
  ),
  recalculo AS (
    SELECT v.*, k.total AS monto_hoy, k.tipo_cobro AS tipo_cobro_hoy
      FROM vivas v
      LEFT JOIN LATERAL public.agua_costo_tarifa(
        v.consumo, v.tarifa_hoy_precio, v.tarifa_hoy_exceso, v.tarifa_hoy_canon,
        v.tarifa_hoy_minimo, v.tarifa_hoy_tramos, v.cantidad_derecho_servicio_m3
      ) k ON v.consumo IS NOT NULL AND v.consumo >= 0
  ),
  hallazgos AS (
    -- 1 · La cadena está rota: `lectura_anterior` no es la lectura vigente que
    --     la precede. Es la huella directa del desempate al azar y de la lista
    --     recortada en memoria.
    SELECT r.id AS registro_id, r.project_id, r.contador_id, r.numero_serie,
           r.cliente_nombre, r.fecha,
           'cadena_rota'::text AS hallazgo, 'alta'::text AS severidad,
           jsonb_build_object('lectura_anterior_guardada', r.lectura_anterior,
                              'lectura_anterior_real', r.prev_lectura) AS detalle
      FROM recalculo r
     WHERE r.prev_lectura IS NOT NULL
       AND r.lectura_anterior IS DISTINCT FROM r.prev_lectura

    UNION ALL
    -- 2 · El consumo no es la resta de sus propias lecturas (y no está marcado
    --     como reset, donde por definición no lo es).
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'consumo_incoherente', 'alta',
           jsonb_build_object('consumo_guardado', r.consumo,
                              'consumo_esperado', r.lectura_actual - r.lectura_anterior)
      FROM recalculo r
     WHERE r.es_reset IS NOT TRUE
       AND r.lectura_actual IS NOT NULL AND r.lectura_anterior IS NOT NULL
       AND r.consumo IS DISTINCT FROM (r.lectura_actual - r.lectura_anterior)

    UNION ALL
    -- 3 · Consumo positivo cobrado en cero. No hace falta saber la tarifa de
    --     entonces para afirmar que un recibo así está mal.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'monto_cero_con_consumo', 'alta',
           jsonb_build_object('consumo', r.consumo, 'tarifa_aplicada', r.tarifa_aplicada,
                              'canon_aplicado', r.canon_aplicado)
      FROM recalculo r
     WHERE COALESCE(r.consumo, 0) > 0
       AND COALESCE(r.monto_calculado, 0) = 0
       AND COALESCE(r.tarifa_aplicada, 0) > 0

    UNION ALL
    -- 4 · La lectura vive en un proyecto distinto al de su contador: la fila
    --     está contabilizada en el condominio equivocado.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'cruce_proyecto', 'alta',
           jsonb_build_object('project_id_registro', r.project_id,
                              'project_id_contador', r.contador_project_id)
      FROM recalculo r
     WHERE r.contador_project_id IS NOT NULL
       AND r.contador_project_id IS DISTINCT FROM r.project_id

    UNION ALL
    -- 5 · Nació cobrada. El selector «Estado Pago» de la captura permitía
    --     marcar 'pagado' al guardar, sin pago, sin fecha y sin rastro.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'pagada_sin_pago', 'alta',
           jsonb_build_object('estado', r.estado, 'monto_calculado', r.monto_calculado)
      FROM recalculo r
     WHERE r.estado = 'pagado'
       AND COALESCE(r.monto_pagado, 0) = 0
       AND r.fecha_pago IS NULL

    UNION ALL
    -- 6 · Varias lecturas vivas del mismo contador y día. Ahora es legal y se
    --     encadenan; en el histórico son justo las filas donde el desempate
    --     decidió el importe.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'varias_el_mismo_dia', 'media',
           jsonb_build_object('dia', r.dia_local, 'lecturas_ese_dia', r.lecturas_ese_dia)
      FROM recalculo r
     WHERE r.lecturas_ese_dia > 1

    UNION ALL
    -- 7 · Se capturó con fecha anterior a una lectura que ya existía: la regla
    --     nueva la rechazaría.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'retroactiva', 'media',
           jsonb_build_object('fecha', r.fecha, 'fecha_ya_cubierta', r.fecha_tope_al_capturar)
      FROM recalculo r
     WHERE r.fecha_tope_al_capturar IS NOT NULL
       AND r.fecha < r.fecha_tope_al_capturar

    UNION ALL
    -- 8 · Sin contador: no hay base contra la cual encadenar ni auditar. Son
    --     las filas del formulario de administrador, donde el operador tecleaba
    --     `lectura_anterior` y el canon a mano.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'sin_contador', 'media',
           jsonb_build_object('lectura_anterior', r.lectura_anterior,
                              'lectura_actual', r.lectura_actual)
      FROM recalculo r
     WHERE r.contador_id IS NULL

    UNION ALL
    -- 9 · El importe guardado tiene más de dos decimales: viene de un flotante
    --     de JavaScript sin redondear al contrato.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'monto_sin_redondear', 'media',
           jsonb_build_object('monto_calculado', r.monto_calculado)
      FROM recalculo r
     WHERE r.monto_calculado IS NOT NULL
       AND r.monto_calculado IS DISTINCT FROM round(r.monto_calculado, 2)

    UNION ALL
    -- 10 · Difiere de lo que daría la tarifa de HOY. Informativa a propósito:
    --      la tarifa pudo cambiar legítimamente después de emitir el recibo.
    SELECT r.id, r.project_id, r.contador_id, r.numero_serie, r.cliente_nombre, r.fecha,
           'difiere_de_tarifa_actual', 'informativa',
           jsonb_build_object('monto_guardado', r.monto_calculado,
                              'monto_con_tarifa_de_hoy', r.monto_hoy,
                              'tipo_cobro_guardado', r.tipo_cobro_hoy)
      FROM recalculo r
     WHERE r.monto_hoy IS NOT NULL
       AND r.monto_calculado IS NOT NULL
       AND abs(r.monto_calculado - r.monto_hoy) > 0.01
  )
  SELECT * FROM hallazgos
   ORDER BY CASE severidad WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
            fecha DESC NULLS LAST, registro_id
$$;

COMMENT ON FUNCTION public.agua_lecturas_inconsistencias(uuid) IS
  'Reporte de SÓLO LECTURA de lecturas de agua históricas cuyo dato es internamente contradictorio (cadena rota, consumo que no es la resta de sus lecturas, importe cero con consumo, cruce de proyecto, recibo nacido pagado) o sospechoso (varias el mismo día, retroactiva, sin contador, importe sin redondear). NO corrige nada: la corrección es una decisión humana con su propio PR. Autorización equivalente a la rama interna de registros_select: uno de los permisos de lectura de agua (tabla/lecturas/dashboard/cobros/mapa), empresa del caller, acceso al proyecto, y el rol cliente excluido — el portal del residente ve sus filas, no el agregado del condominio.';

REVOKE EXECUTE ON FUNCTION public.agua_lecturas_inconsistencias(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_lecturas_inconsistencias(uuid) TO authenticated;
