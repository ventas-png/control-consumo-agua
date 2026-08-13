-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · la línea de póliza pertenece al ledger de SU asiento
--
-- Los modales de "Nueva póliza" y "Saldos iniciales" pedían el catálogo sin el
-- ledger activo, así que en la contabilidad de un PROYECTO ofrecían las cuentas
-- de la EMPRESA y armaban el asiento contra ellas. El síntoma visible era el
-- catálogo equivocado; el daño real es que ese borrador SÍ se guardaba: la
-- inserción de conta_asiento_lineas va directo por RLS y nada validaba el
-- ledger. Solo al PUBLICAR saltaba conta_publicar_asiento ("cuenta(s) no
-- válidas … de otra contabilidad"), dejando atrás un borrador cruzado.
--
-- La causa se arregla en la UI (pasar el projectId a useCuentasQuery). Esto es
-- la guarda que faltaba en la BD para que la mezcla no se pueda ni escribir,
-- venga de donde venga:
--
--   · company_id de la línea lo sella el asiento (antes lo mandaba el cliente y
--     nada obligaba a que coincidiera con la cabecera).
--   · cuenta_id debe ser una cuenta de detalle DEL MISMO ledger (empresa o
--     proyecto) que el asiento. Es la MISMA regla que ya aplica al publicar,
--     adelantada al momento de escribir.
--
-- Las rutas automáticas (conta_generar_asiento) ya resolvían sus cuentas contra
-- el ledger antes de insertar, así que la guarda no las cambia; si alguna se
-- desviara, su propio manejador la degrada a WARNING + asiento omitido.
--
-- Impacto en datos productivos: NINGUNO sobre filas existentes (el trigger solo
-- corre en INSERT/UPDATE). Los borradores cruzados que ya existan siguen ahí,
-- sin poder publicarse — se anulan o se borran desde la app. Para encontrarlos:
--   SELECT a.id, a.concepto FROM conta_asientos a
--     JOIN conta_asiento_lineas l ON l.asiento_id = a.id
--     JOIN conta_cuentas c ON c.id = l.cuenta_id
--    WHERE a.estado = 'borrador'
--      AND (c.company_id <> a.company_id OR c.project_id IS DISTINCT FROM a.project_id);
--
-- REVERSIÓN:
--   DROP TRIGGER trg_conta_linea_mismo_ledger ON public.conta_asiento_lineas;
--   DROP FUNCTION public.conta_tg_linea_mismo_ledger();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conta_tg_linea_mismo_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_asiento public.conta_asientos;
  v_cuenta  public.conta_cuentas;
BEGIN
  SELECT * INTO v_asiento FROM public.conta_asientos WHERE id = NEW.asiento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTA_LEDGER: la póliza de la línea no existe.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- La empresa de la línea la manda la cabecera, no el cliente.
  NEW.company_id := v_asiento.company_id;

  SELECT * INTO v_cuenta FROM public.conta_cuentas WHERE id = NEW.cuenta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTA_LEDGER: la cuenta de la línea no existe.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_cuenta.company_id <> v_asiento.company_id
     OR v_cuenta.project_id IS DISTINCT FROM v_asiento.project_id THEN
    RAISE EXCEPTION
      'CONTA_LEDGER: la cuenta % pertenece a otra contabilidad (empresa/proyecto) que la póliza.',
      v_cuenta.codigo
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_linea_mismo_ledger ON public.conta_asiento_lineas;
CREATE TRIGGER trg_conta_linea_mismo_ledger
  BEFORE INSERT OR UPDATE OF asiento_id, cuenta_id, company_id
  ON public.conta_asiento_lineas
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_linea_mismo_ledger();

COMMENT ON FUNCTION public.conta_tg_linea_mismo_ledger() IS
  'Sella company_id de la línea desde su asiento y exige que la cuenta sea del MISMO ledger (empresa/proyecto). Adelanta al momento de escribir la validación que conta_publicar_asiento ya hacía al publicar.';
