-- ════════════════════════════════════════════════════════════════════════════
-- Tres agujeros que dejó 20260910235732
-- ════════════════════════════════════════════════════════════════════════════
-- Aquella migración cerró el `PATCH` genérico sobre `registros`. La revisión
-- encontró que lo cerró con tres defectos, y los tres son de fondo:
--
-- 1. LA EXENCIÓN DE `postgres` ERA UNA PUERTA, NO UNA EXCEPCIÓN. El guard
--    eximía a `current_user IN ('service_role','postgres','supabase_admin')`.
--    Pero una función SECURITY DEFINER se ejecuta como SU PROPIETARIO, y en
--    este esquema el propietario es `postgres`: cualquier función DEFINER
--    —incluida una que `authenticated` pueda invocar— pasaba el guard sin
--    llave. La lista pretendía nombrar al cron y a la plataforma y en realidad
--    nombraba «cualquier cosa que corra como el dueño», que es casi todo.
--
--    Se va. En su lugar, los DOS caminos de sistema que de verdad escriben
--    columnas de cobro reciben la llave POR FUNCIÓN, con `ALTER FUNCTION …
--    SET`: la capacidad vive mientras esa función corre y no un microsegundo
--    más. Es más estrecho que la exención que sustituye, y está enumerado.
--
-- 2. EL PAGO NO SE SERIALIZABA. `agua_factura_registrar_pago` leía
--    `monto_pagado` y escribía después sin bloquear la fila: dos abonos
--    simultáneos leían el mismo previo y el segundo pisaba al primero — un
--    pago cobrado al cliente y perdido en la factura. Ahora toda transición
--    financiera relee la fila con `FOR UPDATE`, así que emitir, anular, pagar,
--    mora y cambio de estado se serializan por registro. La prueba lo ejerce
--    con DOS conexiones.
--
-- 3. `p_dias_vencimiento` ERA UN PARÁMETRO DE COBRO. Volvía a poner en el
--    cliente una decisión que mueve dinero: el vencimiento decide cuándo
--    aplica la mora. Se elimina de la firma pública; el plazo sale de
--    `reglas_mora_config` o del valor seguro del servidor (30). Si la
--    operación necesita una excepción manual, es otra RPC, con su permiso, su
--    motivo obligatorio y su auditoría — no un argumento más de la emisión.
--
-- ── INVENTARIO DE ESCRITORES DE `public.registros` ─────────────────────────
-- Levantado para esta migración; lo que no está aquí, no escribe.
--
--   COLUMNAS DE COBRO (necesitan llave, o son la excepción `service_role`)
--     · agua_factura_emitir / _anular / _registrar_pago,
--       agua_registro_marcar_mora / _cambiar_estado ....... la encienden ellas
--     · agua_cerrar_ciclo_nucleo (20260717140000) ......... ALTER … SET, abajo
--       (cubre a sus dos llamadores: agua_cerrar_ciclo, con guard de permiso
--        propio, y run_cierres_ciclo_automaticos, del cron)
--     · aplicar_mora_facturas_vencidas (20260604170000) ... por la envoltura
--       agua_mora_cron_aplicar, que es la que lleva la llave y a la que apunta
--       el job (la función real tiene drift declarado: ver sección 2)
--     · edge `confirm-charge` ...... vía agua_registro_acreditar_pago_externo
--       (sección 8): `service_role` es la ÚNICA excepción de rol que queda, y
--       está justificada (una confirmación servidor a servidor no tiene
--       usuario que auditar), limitada (una función, un GRANT, y comprueba
--       además el rol efectivo) y probada (invariantes 31-33)
--
--   COLUMNAS LIBRES (no necesitan nada: `foto` no fabrica un cobro)
--     · purgar_datos_retenidos (20260731000200) ....... `foto = NULL`
--     · purga de fotos (20260723000000) ............... `foto = NULL`
--     · edge `purgar-fotos-registros` ................. `foto = NULL`
--
--   SÓLO LEEN (no escriben `registros`)
--     · edge `timbrar-documento` (escribe `documentos_fiscales`)
--     · edge `create-charge`, `create-payment-intent`
--     · edge `process-scheduled-reports`
--     · trigger `trg_conta_registros` (AFTER UPDATE → asientos contables)
--
--   BACKFILLS HISTÓRICOS (20260407000002, 20260516000005, 20260717080000,
--     20260717100000, 20260816000000) corren ANTES que el guard en el orden de
--     migraciones, así que un entorno nuevo los aplica sin tropezar.
--
-- ── LA CORRECCIÓN DE UNA LECTURA, CUANDO HAGA FALTA ────────────────────────
-- Quitada la exención de `postgres`, las columnas INMUTABLES no las puede
-- tocar ya nadie por `UPDATE` — tampoco una migración de datos futura. Para
-- que eso no deje al equipo sin salida, existe una segunda llave explícita,
-- `agua.lectura_correccion_autorizada`, que un `SET LOCAL` de una migración
-- revisada puede encender. No la enciende ninguna función de la aplicación, un
-- cliente no puede ponerla (los GUC no se tocan desde la Data API) y es
-- greppable: si aparece en un diff, es una corrección de histórico y se mira
-- como tal.
--
-- REVERSIÓN
--   ALTER FUNCTION public.agua_cerrar_ciclo_nucleo(uuid, text, boolean) RESET "agua.cobro_autoritativo";
--   DROP FUNCTION IF EXISTS public.agua_mora_cron_aplicar();  -- y reprogramar el
--   -- job a SELECT public.aplicar_mora_facturas_vencidas();
--   DROP FUNCTION IF EXISTS public.agua_factura_emitir(uuid);
--   DROP FUNCTION IF EXISTS public.agua_registro_acreditar_pago_externo(uuid, numeric, text);
--   -- y volver a 20260910235732 para el resto.
--
-- Idempotente: CREATE OR REPLACE, DROP … IF EXISTS y ALTER … SET repetible.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. El guard, sin la puerta de `postgres` ────────────────────────────────
CREATE OR REPLACE FUNCTION public.agua_tg_registros_proteger_update()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER (el default): dentro de una DEFINER `current_user` es el
-- dueño, y entonces ninguna comprobación sobre el rol significa nada.
SET search_path = ''
AS $$
DECLARE
  v_rol       text;
  v_cobro     boolean;
  v_correccion boolean;
  v_cambio    text;
BEGIN
  -- LA ÚNICA EXENCIÓN POR ROL: `service_role`. Ya no están `postgres` ni
  -- `supabase_admin`, porque toda función SECURITY DEFINER corre como el dueño
  -- y los llevaba puestos de regalo. Lo que el cron y el cierre de ciclo
  -- necesitan lo reciben por función (`ALTER FUNCTION … SET`, sección 2), que
  -- es la capacidad acotada a esa llamada.
  --
  -- Qué justifica la que queda: `confirm-charge` (la confirmación del
  -- proveedor de pago, servidor a servidor, sin usuario que auditar), el
  -- sembrado de E2E y los backfills operativos. Ninguno es el navegador, que
  -- es el sujeto del problema.
  BEGIN
    v_rol := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  EXCEPTION WHEN OTHERS THEN
    v_rol := '';
  END;
  IF v_rol = 'service_role' OR current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_cobro      := COALESCE(current_setting('agua.cobro_autoritativo', true), 'off') = 'on';
  v_correccion := COALESCE(current_setting('agua.lectura_correccion_autorizada', true), 'off') = 'on';

  -- ── INMUTABLES: la lectura y su cálculo ──────────────────────────────────
  IF NOT v_correccion THEN
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
  END IF;

  -- ── DE COBRO: sólo con la llave de capacidad ─────────────────────────────
  IF NOT v_cobro THEN
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

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.agua_tg_registros_proteger_update() IS
  'BEFORE UPDATE en registros. Las columnas de la LECTURA son inmutables salvo con agua.lectura_correccion_autorizada (una migración revisada, nunca la aplicación); las de COBRO sólo cambian con agua.cobro_autoritativo, que encienden las RPC de cobro y —por ALTER FUNCTION … SET— los dos caminos de sistema enumerados. La ÚNICA exención por rol es service_role: postgres y supabase_admin se quitaron en 20260911031701 porque toda función SECURITY DEFINER corre como el dueño y los llevaba puestos.';

REVOKE EXECUTE ON FUNCTION public.agua_tg_registros_proteger_update() FROM PUBLIC, anon, authenticated;

-- ── 2. La capacidad, por función y no por rol ───────────────────────────────
-- `SET` sobre una función fija el GUC mientras esa función corre —y mientras
-- corre lo que ella llame— y lo restaura al salir: es exactamente «esta función
-- puede tocar el cobro», sin darle la capacidad a nada más. Las dos vías están
-- fuera del alcance de la API (`agua_cerrar_ciclo_nucleo` revocada de todos los
-- roles; `aplicar_mora_facturas_vencidas` sólo para `service_role`), así que
-- nadie las usa de trampolín.
--
-- El núcleo, y no sus llamadores: el `UPDATE` vive ahí, y así quedan cubiertos
-- de una vez `agua_cerrar_ciclo` (guard de permiso propio) y
-- `run_cierres_ciclo_automaticos` (cron).
ALTER FUNCTION public.agua_cerrar_ciclo_nucleo(uuid, text, boolean)
  SET "agua.cobro_autoritativo" = 'on';

-- La mora del cron NO se toca con `ALTER FUNCTION`, y la razón es de higiene,
-- no de gusto: `aplicar_mora_facturas_vencidas` es una de las funciones que se
-- editaron A MANO en producción (drift declarado en `drift-conocido.json`,
-- inventario en #826). Ponerle `proconfig` desde aquí dejaría a producción, a
-- main y a este PR diciendo tres cosas distintas del mismo objeto, que es
-- exactamente lo que el auditor de tres vías cierra en falso a propósito —y
-- tendría razón: nadie puede decidir desde el repositorio si eso arregla o
-- empeora el drift.
--
-- Así que la llave se le da DESDE FUERA, con una envoltura nueva que sí es del
-- repositorio. `SET` sobre ella cubre la llamada anidada, que es lo único que
-- hacía falta; el cuerpo con drift se queda intacto y el auditor lo ve como lo
-- que es: un objeto nuevo. Cuando #826 reconcilie la función, esto se puede
-- colapsar en un `ALTER FUNCTION` y quitar la envoltura.
CREATE OR REPLACE FUNCTION public.agua_mora_cron_aplicar()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET "agua.cobro_autoritativo" = 'on'
AS $$
BEGIN
  PERFORM public.aplicar_mora_facturas_vencidas();
END;
$$;

COMMENT ON FUNCTION public.agua_mora_cron_aplicar() IS
  'Envoltura del job de mora de agua: lo único que agrega es la llave agua.cobro_autoritativo, que cubre la llamada anidada a aplicar_mora_facturas_vencidas. Existe como envoltura —y no como un ALTER FUNCTION sobre la función real— porque esa función tiene drift declarado contra producción y ponerle proconfig desde el repositorio dejaría el auditor de tres vías en ambiguo.';

REVOKE EXECUTE ON FUNCTION public.agua_mora_cron_aplicar() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.agua_mora_cron_aplicar() TO service_role;

-- Y el job apunta a la envoltura. Mismo horario, mismo patrón defensivo de
-- `unschedule` que 20260604170000.
-- Condicionado a que pg_cron exista: el harness de pruebas levanta un Postgres
-- pelado y no tiene la extensión. En producción sí está (20260604170000 la
-- crea) y entonces el job se reprograma.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
       FROM cron.job
      WHERE jobname = 'aplicar_mora_facturas_vencidas_daily';
    PERFORM cron.schedule(
      'aplicar_mora_facturas_vencidas_daily',
      '30 3 * * *',
      'SELECT public.agua_mora_cron_aplicar();');
  END IF;
END
$cron$;

-- ── 3. El bloqueo por registro ──────────────────────────────────────────────
-- Toda transición financiera relee la fila con `FOR UPDATE` DESPUÉS de
-- autorizar y ANTES de calcular. Sin esto, `agua_factura_registrar_pago` leía
-- `monto_pagado`, calculaba el saldo y escribía: dos abonos simultáneos leían
-- el mismo previo y el segundo pisaba al primero — dinero cobrado al cliente y
-- perdido en la factura. Con el bloqueo, el segundo espera, relee el abonado
-- que dejó el primero y suma sobre él.
--
-- Separado del guard porque aquél es STABLE (autoriza, no muta) y un
-- `FOR UPDATE` dentro de una función STABLE es una contradicción que Postgres
-- no siempre castiga pero que nadie debería escribir.
CREATE OR REPLACE FUNCTION public.agua_cobro_bloquear(p_registro_id uuid)
RETURNS public.registros
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg public.registros;
BEGIN
  SELECT * INTO v_reg FROM public.registros r
   WHERE r.id = p_registro_id AND r.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registro no encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_reg;
END;
$$;

COMMENT ON FUNCTION public.agua_cobro_bloquear(uuid) IS
  'Relee una lectura con FOR UPDATE y la devuelve. Es lo que serializa las transiciones financieras por registro: emitir, anular, pagar, mora y cambio de estado la llaman tras autorizar y antes de calcular, así que dos operaciones sobre la misma factura se ponen en fila en vez de pisarse.';

REVOKE EXECUTE ON FUNCTION public.agua_cobro_bloquear(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. EMITIR — sin `p_dias_vencimiento` ────────────────────────────────────
-- El plazo de vencimiento decide cuándo aplica la mora: es una decisión de
-- cobro, y volvía a estar en manos del cliente como un argumento más. Sale de
-- la firma. Ahora el plazo es el de la regla de mora ACTIVA del proyecto, o 30.
--
-- Se hace `DROP` de la firma vieja, no `CREATE OR REPLACE`: cambiar los
-- argumentos crea una sobrecarga, y dejar viva la de dos parámetros sería dejar
-- abierta exactamente la puerta que se está cerrando.
DROP FUNCTION IF EXISTS public.agua_factura_emitir(uuid, integer);

CREATE OR REPLACE FUNCTION public.agua_factura_emitir(p_registro_id uuid)
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
  PERFORM public.agua_cobro_guard(p_registro_id, 'agua.cobros.change_status');
  -- Autorizar primero, bloquear después: el estado que se valida abajo tiene
  -- que ser el que siga vigente en el momento del UPDATE.
  v_reg := public.agua_cobro_bloquear(p_registro_id);

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
  -- La regla del proyecto, o el valor seguro del servidor. Ya no hay tercer
  -- origen: el cliente no tiene dónde poner un plazo.
  v_dias := COALESCE(v_dias, 30);
  IF v_dias < 0 OR v_dias > 3650 THEN
    v_dias := 30;
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

COMMENT ON FUNCTION public.agua_factura_emitir(uuid) IS
  'Emite la factura de una lectura (pendiente → emitida). TODO lo que decide el importe y el plazo lo calcula el servidor: la tasa de IVA de companies, los días de vencimiento de la regla de mora activa del proyecto (o 30) y el subtotal de la propia fila. El único argumento es el registro. Serializa por fila con FOR UPDATE. Exige agua.cobros.change_status y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_factura_emitir(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_factura_emitir(uuid) TO authenticated;

-- ── 5. ANULAR — con bloqueo ─────────────────────────────────────────────────
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
  PERFORM public.agua_cobro_guard(p_registro_id, 'agua.cobros.change_status');
  v_reg := public.agua_cobro_bloquear(p_registro_id);

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
  -- Con abonos encima, anular borraría el rastro de un dinero que entró. Es la
  -- carrera pagar/anular vista desde el otro lado: el bloqueo hace que una de
  -- las dos llegue primero, y si llegó el pago, la anulación ya no procede.
  IF COALESCE(v_reg.monto_pagado, 0) > 0 THEN
    RAISE EXCEPTION 'la factura tiene % abonado: anularla requiere revertir el pago primero',
      round(v_reg.monto_pagado, 2) USING ERRCODE = '22023';
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
  'Anula la factura de una lectura (pendiente|emitida|vencida → anulada), serializando por fila con FOR UPDATE. Rechaza anular una factura con abonos: eso borraría el rastro de un dinero que entró. Exige agua.cobros.change_status y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_factura_anular(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_factura_anular(uuid, text) TO authenticated;

-- ── 6. REGISTRAR PAGO — el bloqueo es el punto ──────────────────────────────
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
  PERFORM public.agua_cobro_guard(p_registro_id, 'agua.cobros.create');

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'el pago debe ser un monto mayor que cero' USING ERRCODE = '22023';
  END IF;

  -- EL BLOQUEO, Y DESPUÉS LA LECTURA DEL ABONADO. Este orden es el arreglo:
  -- la versión anterior leía `monto_pagado` sin bloquear, así que dos abonos
  -- simultáneos partían del mismo previo y el segundo pisaba al primero.
  v_reg := public.agua_cobro_bloquear(p_registro_id);

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

  v_total  := COALESCE(v_reg.total_a_pagar, v_reg.monto_calculado, 0);
  v_previo := GREATEST(COALESCE(v_reg.monto_pagado, 0), 0);
  v_nuevo  := v_previo + p_monto;

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
         -- Un abono parcial no devuelve a 'pendiente' una factura marcada en
         -- mora: pagar a medias no es ponerse al día (carrera pagar/mora).
         estado         = CASE WHEN v_completo THEN 'pagado'
                               WHEN r.estado = 'mora' THEN 'mora'
                               ELSE 'pendiente' END,
         fecha_pago     = CASE WHEN v_completo THEN v_fecha ELSE NULL END,
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
  'Registra un pago/abono sobre una lectura. El único dato de entrada es el monto; el abonado, la fecha (zona del tenant) y la transición los decide el servidor. SERIALIZA por fila con FOR UPDATE antes de leer el abonado: sin eso dos abonos simultáneos partían del mismo previo y uno se perdía. Exige agua.cobros.create y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_factura_registrar_pago(uuid, numeric, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_factura_registrar_pago(uuid, numeric, date) TO authenticated;

-- ── 7. MORA y CAMBIO DE ESTADO — con bloqueo ────────────────────────────────
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
    PERFORM public.agua_cobro_guard(v_id, 'agua.cobros.change_status');
    v_reg := public.agua_cobro_bloquear(v_id);

    -- Lo que ya se cobró o se anuló no entra en mora. Es la carrera pagar/mora
    -- resuelta del lado de la mora: con el bloqueo, si el pago llegó primero
    -- esta fila se salta en vez de marcar como morosa una factura pagada.
    CONTINUE WHEN v_reg.estado = 'pagado'
              OR COALESCE(v_reg.factura_estado, '') IN ('pagada', 'anulada');

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
  'Marca lecturas como en mora. El guard de alcance y el bloqueo FOR UPDATE corren POR FILA, y se saltan las ya pagadas o anuladas: marcar morosa una factura cobrada es el resultado de la carrera pagar/mora, no un estado válido. Exige agua.cobros.change_status y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_registro_marcar_mora(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_registro_marcar_mora(uuid[]) TO authenticated;

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
  PERFORM public.agua_cobro_guard(p_registro_id, 'agua.lecturas.change_status');

  IF p_estado = 'pagado' THEN
    RAISE EXCEPTION 'marcar una lectura como pagada exige registrar el pago: usá agua_factura_registrar_pago()'
      USING ERRCODE = '42501';
  END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('pendiente', 'mora') THEN
    RAISE EXCEPTION 'estado inválido: sólo "pendiente" o "mora"' USING ERRCODE = '22023';
  END IF;

  v_reg := public.agua_cobro_bloquear(p_registro_id);

  -- Ni por esta puerta se le quita el cobrado a una factura pagada.
  IF v_reg.estado = 'pagado' OR COALESCE(v_reg.factura_estado, '') = 'pagada' THEN
    RAISE EXCEPTION 'la factura está pagada: su estado no se cambia a mano' USING ERRCODE = '22023';
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
  'Cambia a mano el estado de seguimiento de una lectura, SOLO entre "pendiente" y "mora", y sólo si no está pagada. "pagado" se rechaza a propósito: un recibo se marca cobrado registrando el pago. Serializa por fila con FOR UPDATE. Exige agua.lecturas.change_status y deja rastro en security_logs.';

REVOKE EXECUTE ON FUNCTION public.agua_registro_cambiar_estado(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_registro_cambiar_estado(uuid, text) TO authenticated;

-- ── 8. EL PAGO DEL PROVEEDOR — la última excepción de service_role ──────────
-- El inventario de arriba dejó una sola escritura de columnas de cobro fuera
-- de las RPC: la edge `confirm-charge`, que concilia lo que el payfac ya
-- cobró. Es legítima —no hay usuario que auditar en una confirmación servidor
-- a servidor— pero tenía EXACTAMENTE el defecto que esta migración arregla:
-- leía `monto_pagado` en JavaScript y lo reescribía sumado, sin bloquear. Dos
-- `payment_requests` del mismo recibo confirmados a la vez (el retorno del
-- portal y el cron de reconciliación son dos) perdían un abono.
--
-- Así que la excepción se queda, pero deja de ser un `UPDATE` genérico: pasa
-- por aquí, que bloquea la fila igual que el camino manual. Y se estrecha por
-- partida doble — sólo `service_role` tiene EXECUTE, y además se comprueba el
-- rol efectivo, para que una función DEFINER del esquema (que corre como el
-- dueño y por tanto tiene EXECUTE implícito) no la alcance.
--
-- NO rechaza el sobrepago, y es a propósito: el dinero ya salió de la tarjeta.
-- Rechazarlo aquí dejaría al cliente cobrado y al recibo sin acreditar. Lo
-- que sí hace es registrarlo tal cual y dejar el rastro en security_logs.
CREATE OR REPLACE FUNCTION public.agua_registro_acreditar_pago_externo(
  p_registro_id uuid,
  p_monto       numeric,
  p_referencia  text DEFAULT NULL
)
RETURNS public.registros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg      public.registros;
  v_rol      text;
  v_total    numeric;
  v_previo   numeric;
  v_nuevo    numeric;
  v_completo boolean;
  v_factura  text;
  v_cierra   boolean;
  v_tz       text;
  v_company  uuid;
BEGIN
  v_rol := COALESCE(
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role', '');
  IF v_rol <> 'service_role' AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'agua_registro_acreditar_pago_externo es del proveedor de pago, no de un usuario'
      USING ERRCODE = '42501';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'el pago debe ser un monto mayor que cero' USING ERRCODE = '22023';
  END IF;

  v_reg := public.agua_cobro_bloquear(p_registro_id);

  v_total  := COALESCE(v_reg.total_a_pagar, v_reg.monto_calculado, 0);
  v_previo := GREATEST(COALESCE(v_reg.monto_pagado, 0), 0);
  v_nuevo  := round(v_previo + p_monto, 2);
  v_completo := v_total > 0 AND (v_total - v_nuevo) <= 0.005;

  -- Espeja `facturaTransicionaAPagada` de _shared/payments/reconcile.ts.
  v_factura := COALESCE(v_reg.factura_estado, '');
  v_cierra  := v_completo AND v_factura IN ('emitida', 'vencida', 'mora');

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = v_reg.project_id;
  SELECT COALESCE(c.timezone, 'America/Guatemala') INTO v_tz
    FROM public.companies c WHERE c.id = v_company;
  v_tz := COALESCE(v_tz, 'America/Guatemala');

  PERFORM set_config('agua.cobro_autoritativo', 'on', true);
  UPDATE public.registros r
     SET monto_pagado   = v_nuevo,
         estado         = CASE WHEN v_completo THEN 'pagado'
                               WHEN r.estado = 'mora' THEN 'mora'
                               ELSE 'pendiente' END,
         fecha_pago     = CASE WHEN v_completo
                               THEN (now() AT TIME ZONE v_tz)::date ELSE NULL END,
         factura_estado = CASE WHEN v_cierra THEN 'pagada' ELSE r.factura_estado END,
         pagada_at      = CASE WHEN v_cierra THEN now() ELSE r.pagada_at END
   WHERE r.id = p_registro_id
   RETURNING * INTO v_reg;

  PERFORM public.agua_cobro_auditar(p_registro_id, 'acreditar_pago_externo', jsonb_build_object(
    'monto', round(p_monto, 2), 'abonado_previo', round(v_previo, 2),
    'abonado', v_reg.monto_pagado, 'total', round(v_total, 2),
    'liquida', v_completo, 'referencia', p_referencia,
    'project_id', v_reg.project_id));
  PERFORM set_config('agua.cobro_autoritativo', 'off', true);

  RETURN v_reg;
END;
$$;

COMMENT ON FUNCTION public.agua_registro_acreditar_pago_externo(uuid, numeric, text) IS
  'Acredita en una lectura un pago que el proveedor (payfac) YA cobró: es el único camino de escritura de columnas de cobro que no tiene usuario detrás, y por eso lo usa sólo service_role. Bloquea la fila con FOR UPDATE antes de leer el abonado, así que dos confirmaciones simultáneas del mismo recibo no se pisan. No rechaza el sobrepago —el dinero ya salió de la tarjeta— pero lo deja auditado.';

REVOKE EXECUTE ON FUNCTION public.agua_registro_acreditar_pago_externo(uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.agua_registro_acreditar_pago_externo(uuid, numeric, text)
  TO service_role;
