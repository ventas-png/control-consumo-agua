\set ON_ERROR_STOP on

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261104090000 tras la primera pasada.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_esperado jsonb := '{
    "A": {"total": 280.00,  "credito": 0},
    "B": {"total": 92.00,   "credito": -20.00},
    "C": {"total": 164.61,  "credito": -8.00},
    "D": {"total": 169.65,  "credito": -8.00},
    "E": {"total": 112.00,  "credito": 0},
    "F": {"total": 1500.00, "credito": 0},
    "G": {"total": 0,       "credito": 0},
    "H": {"total": -40.00,  "credito": -50.00},
    "I": {"total": 0.30,    "credito": 0},
    "J": {"total": 104.00,  "credito": -8.00}
  }';
  r record;
BEGIN
  FOR r IN SELECT numero_factura AS caso, monto_total, monto_credito_exportacion FROM public.facturas_energia ORDER BY 1 LOOP
    IF r.monto_total <> (v_esperado->r.caso->>'total')::numeric THEN
      RAISE EXCEPTION '1 · caso %: total % (esperado %)', r.caso, r.monto_total, v_esperado->r.caso->>'total';
    END IF;
    IF r.monto_credito_exportacion <> (v_esperado->r.caso->>'credito')::numeric THEN
      RAISE EXCEPTION '1 · caso %: crédito % (esperado %)', r.caso, r.monto_credito_exportacion, v_esperado->r.caso->>'credito';
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 1  cada factura quedó con el total de su desglose y el crédito en negativo';
END;
$$;

DO $$
DECLARE v_n bigint;
BEGIN
  -- Fuera de monto_total y del signo del crédito, nada cambia: ni los montos
  -- del desglose ni los kWh ni updated_at.
  SELECT count(*) INTO v_n
    FROM public.facturas_energia f
    JOIN sandbox.antes a USING (id)
   WHERE (f.monto_energia, f.monto_potencia, f.monto_cargo_fijo, f.monto_alumbrado, f.monto_iva,
          f.monto_otros, abs(f.monto_credito_exportacion), f.kwh_consumidos, f.estado, f.updated_at)
         IS DISTINCT FROM
         (a.monto_energia, a.monto_potencia, a.monto_cargo_fijo, a.monto_alumbrado, a.monto_iva,
          a.monto_otros, abs(a.monto_credito_exportacion), a.kwh_consumidos, a.estado, a.updated_at);
  IF v_n > 0 THEN RAISE EXCEPTION '2 · % factura(s) cambiaron algo más que el total o el signo del crédito', v_n; END IF;
  RAISE NOTICE 'OK 2  el desglose, los kWh y updated_at quedaron como estaban';
END;
$$;

DO $$
DECLARE
  v_casos text;
  v_mal bigint;
BEGIN
  -- Una constancia por factura corregida, y solo por ellas.
  SELECT string_agg(f.numero_factura, ',' ORDER BY f.numero_factura) INTO v_casos
    FROM public.audit_log l
    JOIN public.facturas_energia f ON f.id = l.record_id
   WHERE l.table_name = 'facturas_energia'
     AND l.after->>'correccion' = '20261104090000_facturas_energia_total_del_desglose';
  IF v_casos IS DISTINCT FROM 'A,B,C,D,H,I' THEN
    RAISE EXCEPTION '3 · constancias para %, esperadas para A,B,C,D,H,I', v_casos;
  END IF;

  -- La constancia dice exactamente qué había y qué quedó, de qué empresa y
  -- proyecto, y que la escribió el sistema.
  SELECT count(*) INTO v_mal
    FROM public.audit_log l
    JOIN public.facturas_energia f ON f.id = l.record_id
    JOIN sandbox.antes a ON a.id = l.record_id
   WHERE l.table_name = 'facturas_energia'
     AND (l.action <> 'UPDATE' OR l.actor_id IS NOT NULL
          OR l.company_id <> f.company_id OR l.project_id <> f.project_id
          OR (l.before->>'monto_total')::numeric <> a.monto_total
          OR (l.before->>'monto_credito_exportacion')::numeric <> a.monto_credito_exportacion
          OR (l.after->>'monto_total')::numeric <> f.monto_total
          OR (l.after->>'monto_credito_exportacion')::numeric <> f.monto_credito_exportacion);
  IF v_mal > 0 THEN RAISE EXCEPTION '3 · % constancia(s) no reflejan el antes/después real', v_mal; END IF;
  RAISE NOTICE 'OK 3  una constancia en audit_log por factura corregida, con antes, después y empresa';
END;
$$;
