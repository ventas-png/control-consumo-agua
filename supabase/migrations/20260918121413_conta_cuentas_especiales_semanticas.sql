-- ════════════════════════════════════════════════════════════════════════════
-- CUENTAS ESPECIALES DEL SISTEMA · resolución SEMÁNTICA, sin códigos fijos
--
-- POR QUÉ
-- El módulo contable ya resuelve por evento (`conta_mapeo_cuentas` +
-- `conta_cuenta_para`) todo lo que contabiliza el generador de asientos. Pero
-- cuatro procesos de EJECUCIÓN seguían buscando la cuenta por su CÓDIGO
-- literal del catálogo sembrado:
--
--   · conta_cierre_anual(int, uuid)          → codigo = '3201'
--   · conta_revaluar_fx(date, boolean, uuid) → codigo = '3301'
--   · compras_tg_recepcion_registrar()       → codigo = '1401' / '1409' / '5107'
--   · (UI) AperturaSaldosModal               → codigo = '3101'
--
-- Mientras eso siga así, el catálogo NO es del cliente: un catálogo vacío, uno
-- básico o uno puramente numérico con otra jerarquía deja esos procesos sin
-- cuenta, y el error que da no habla de configuración sino de un código que el
-- cliente nunca eligió. Esta migración corta esa dependencia: los procesos
-- resuelven por SIGNIFICADO, contra el mapeo del ledger activo.
--
-- QUÉ TRAE
--   1. `conta_eventos_especiales()` — catálogo declarado de las cuentas
--      especiales del sistema (evento, etiqueta, para qué se usa, si bloquea).
--   2. `conta_cuenta_especial(company, project, evento)` — resolución ESTRICTA:
--      el mapeo del ledger EXACTO (company_id + project_id NULL o exacto), y la
--      cuenta tiene que estar activa, ser de detalle y pertenecer a ESE mismo
--      ledger. Cualquier otra cosa → NULL. Nunca hay fallback por código ni
--      préstamo de la cuenta de otra contabilidad.
--   3. `conta_exigir_cuenta_especial(...)` — la misma resolución, pero en vez
--      de NULL levanta `CONTA_CONFIG_INCOMPLETA: Configuración contable
--      incompleta — …`, el mensaje que la UI muestra tal cual.
--   4. `conta_cuentas_especiales_estado(project)` — lo que lee la sección
--      "Cuentas especiales del sistema" de Configuración: qué está mapeado, qué
--      falta y por qué (sin mapeo / inactiva / agrupadora / de otro ledger).
--   5. `conta_seed_mapeos_especiales(company, project)` — siembra SOLO las
--      filas de mapeo de las tres cuentas especiales nuevas, y solo cuando la
--      cuenta ya existe en el catálogo del ledger. NO crea, NO borra y NO
--      reinicia ninguna cuenta: `conta_seed_catalogo` queda intacta.
--   6. Los cuatro procesos, reescritos para resolver por evento.
--
-- COMPORTAMIENTO ANTE MAPEO AUSENTE (deliberado, por proceso)
--   · Cierre anual y revaluación FX son acciones EXPLÍCITAS del usuario: ya
--     levantaban excepción cuando faltaba la cuenta. Siguen levantándola, con
--     el mensaje de configuración incompleta en lugar del código.
--   · La recepción de compras corre dentro de un trigger sobre una operación de
--     negocio: ahí NO se bloquea nada. Sin mapeo, el alta del activo queda sin
--     cuenta contable (las columnas ya son nullable) y la recepción se registra
--     igual — exactamente el comportamiento no bloqueante que ya tenía cuando
--     el código no existía en el catálogo.
--
-- LO QUE ESTA MIGRACIÓN NO HACE
-- No toca el seed de cuentas, no convierte códigos existentes, no borra ni
-- reinicia catálogos, no cambia la profundidad máxima y no altera la RLS de
-- ninguna tabla. Los códigos del seed siguen ahí: como DATO INICIAL, que es lo
-- único que siempre debieron ser.
--
-- Idempotente. Append-only: reemplaza funciones desde aquí, sin editar las
-- migraciones históricas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Catálogo declarado de cuentas especiales ─────────────────────────────
-- En una función y no en una tabla a propósito: es una constante del SISTEMA
-- (qué cuentas necesita el motor contable para funcionar), no configuración del
-- tenant. Lo configurable es a QUÉ cuenta apunta cada una — y eso vive en
-- conta_mapeo_cuentas, donde la RLS ya hace su trabajo.
--
-- `bloqueante` dice qué pasa cuando falta: true = el proceso se detiene con
-- "Configuración contable incompleta" (son acciones explícitas del usuario);
-- false = el proceso sigue sin contabilizar esa parte (son triggers colgados de
-- una operación de negocio que no se puede tumbar).
CREATE OR REPLACE FUNCTION public.conta_eventos_especiales()
RETURNS TABLE (evento text, etiqueta text, proceso text, bloqueante boolean)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT * FROM (VALUES
    ('resultados_acumulados',  'Resultados acumulados',    'Apertura de saldos (ajuste de la diferencia)', false),
    ('resultado_ejercicio',    'Resultado del ejercicio',  'Cierre anual',                                 true),
    ('diferencial_cambiario',  'Diferencial cambiario',    'Revaluación cambiaria',                        true),
    ('cxp_proveedores',        'Proveedores por pagar',    'Cuentas por pagar',                            false),
    ('compras_por_facturar',   'Bienes y servicios por facturar', 'Recepción de compras (puente GR/IR)',   false),
    ('iva_credito',            'IVA crédito fiscal',       'IVA acreditable de compras',                   false),
    ('iva_por_pagar',          'IVA por pagar',            'IVA trasladado de cobros',                     false),
    ('inventario',             'Inventario de insumos',    'Recepción a bodega',                           false),
    ('activo_fijo',            'Activo fijo',              'Alta de activos por recepción',                false),
    ('depreciacion_acumulada', 'Depreciación acumulada',   'Alta de activos por recepción',                false),
    ('gasto_depreciacion',     'Gasto por depreciación',   'Alta de activos por recepción',                false)
  ) AS t(evento, etiqueta, proceso, bloqueante)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_eventos_especiales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_eventos_especiales() TO authenticated;

COMMENT ON FUNCTION public.conta_eventos_especiales() IS
  'Cuentas especiales que el motor contable necesita resolver por significado. Constante del sistema; a qué cuenta apunta cada una lo decide conta_mapeo_cuentas por ledger.';

-- ── 2. Resolución estricta al ledger ────────────────────────────────────────
-- Las tres condiciones que hacen SEGURA a una cuenta especial, juntas y en un
-- solo lugar:
--   · el mapeo es del ledger EXACTO — company_id y project_id IS NOT DISTINCT
--     FROM (NULL = empresa, uuid = ese proyecto). Nunca el de otra contabilidad.
--   · la cuenta también es de ESE ledger (defensa en profundidad: el trigger
--     conta_tg_mapeo_mismo_ledger ya lo impide al escribir, pero una fila
--     anterior a ese trigger podría no cumplirlo).
--   · la cuenta está activa y es de DETALLE: contra una agrupadora no se
--     asienta, y una inactiva no debe recibir movimientos nuevos.
-- Sin fallback por código: es justamente lo que esta migración viene a quitar.
CREATE OR REPLACE FUNCTION public.conta_cuenta_especial(
  p_company_id uuid, p_project_id uuid, p_evento text
)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id
  FROM public.conta_mapeo_cuentas m
  JOIN public.conta_cuentas c ON c.id = m.cuenta_id
  WHERE m.company_id = p_company_id
    AND m.project_id IS NOT DISTINCT FROM p_project_id
    AND m.evento = p_evento
    AND c.company_id = p_company_id
    AND c.project_id IS NOT DISTINCT FROM p_project_id
    AND c.es_detalle
    AND c.activa
  LIMIT 1
$$;

-- Helper INTERNO de los procesos contables (que ya corren con el company_id del
-- documento que procesan). Sin grant a `authenticated`: expuesto al cliente
-- sería un SECURITY DEFINER que acepta un p_company_id cualquiera y responde
-- sin mirar quién pregunta — el hallazgo (b) de scripts/migrations-guard.mjs.
-- La UI lee el estado por conta_cuentas_especiales_estado(), que sí se ancla a
-- get_my_company_id().
REVOKE EXECUTE ON FUNCTION public.conta_cuenta_especial(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_cuenta_especial(uuid, uuid, text) IS
  'Cuenta especial del ledger (company_id + project_id NULL para empresa o exacto para proyecto): activa, de detalle y del MISMO ledger, o NULL. Sin fallback por código.';

CREATE OR REPLACE FUNCTION public.conta_exigir_cuenta_especial(
  p_company_id uuid, p_project_id uuid, p_evento text
)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuenta   uuid;
  v_etiqueta text;
BEGIN
  v_cuenta := public.conta_cuenta_especial(p_company_id, p_project_id, p_evento);
  IF v_cuenta IS NOT NULL THEN
    RETURN v_cuenta;
  END IF;

  SELECT e.etiqueta INTO v_etiqueta
  FROM public.conta_eventos_especiales() e WHERE e.evento = p_evento;

  -- Un solo mensaje, con el prefijo estable que la UI reconoce. Dice qué falta
  -- y dónde se arregla — nunca un código de catálogo, que es precisamente lo
  -- que el cliente puede no tener.
  RAISE EXCEPTION
    'CONTA_CONFIG_INCOMPLETA: Configuración contable incompleta — falta la cuenta "%" de esta contabilidad. Asígnala en Contabilidad › Configuración › Cuentas especiales del sistema.',
    COALESCE(v_etiqueta, p_evento)
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_exigir_cuenta_especial(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── 3. Estado para Configuración ────────────────────────────────────────────
-- Una sola RPC para pintar la sección: por cada cuenta especial, si está
-- resuelta y, si no, POR QUÉ. Distinguir el motivo importa — "sin mapeo" se
-- arregla eligiendo una cuenta; "inactiva" o "agrupadora" se arreglan en el
-- catálogo, y mostrar sólo "falta" mandaría al usuario al lugar equivocado.
CREATE OR REPLACE FUNCTION public.conta_cuentas_especiales_estado(p_project_id uuid)
RETURNS TABLE (
  evento      text,
  etiqueta    text,
  proceso     text,
  bloqueante  boolean,
  cuenta_id   uuid,
  codigo      text,
  nombre      text,
  estado      text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
BEGIN
  -- Anclada al tenant de quien pregunta: el ledger es (empresa, proyecto) y la
  -- empresa NO se acepta por parámetro. Así esta RPC no puede usarse para
  -- inspeccionar la contabilidad de otra empresa.
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.evento,
    e.etiqueta,
    e.proceso,
    e.bloqueante,
    -- Sólo se devuelve el id cuando la cuenta es USABLE: una fila con id pero
    -- estado 'inactiva' invitaría a la UI a tratarla como resuelta.
    CASE WHEN c.id IS NOT NULL AND c.es_detalle AND c.activa
              AND c.project_id IS NOT DISTINCT FROM p_project_id
         THEN c.id END,
    c.codigo,
    c.nombre,
    CASE
      WHEN m.cuenta_id IS NULL                                     THEN 'sin_mapeo'
      WHEN c.id IS NULL                                            THEN 'sin_mapeo'
      WHEN c.company_id <> v_company
        OR c.project_id IS DISTINCT FROM p_project_id              THEN 'otro_ledger'
      WHEN NOT c.activa                                            THEN 'inactiva'
      WHEN NOT c.es_detalle                                        THEN 'agrupadora'
      ELSE 'ok'
    END
  FROM public.conta_eventos_especiales() e
  LEFT JOIN public.conta_mapeo_cuentas m
    ON m.company_id = v_company
   AND m.project_id IS NOT DISTINCT FROM p_project_id
   AND m.evento = e.evento
  LEFT JOIN public.conta_cuentas c ON c.id = m.cuenta_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuentas_especiales_estado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cuentas_especiales_estado(uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_cuentas_especiales_estado(uuid) IS
  'Estado de las cuentas especiales del ledger activo (empresa con NULL, o el proyecto): ok / sin_mapeo / inactiva / agrupadora / otro_ledger. Anclada a get_my_company_id().';

-- ── 4. El mapeo sólo apunta a cuentas ASENTABLES ────────────────────────────
-- El trigger ya exigía "mismo ledger"; se le suman detalle y activa, que son
-- las otras dos condiciones que hacen seleccionable a una cuenta. Es un BEFORE
-- sobre INSERT/UPDATE: no toca ni una fila existente — sólo impide que se
-- escriba un mapeo que después no resolvería.
CREATE OR REPLACE FUNCTION public.conta_tg_mapeo_mismo_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cta record;
BEGIN
  SELECT c.company_id, c.project_id, c.es_detalle, c.activa INTO v_cta
  FROM public.conta_cuentas c WHERE c.id = NEW.cuenta_id;

  IF v_cta IS NULL
     OR v_cta.company_id <> NEW.company_id
     OR v_cta.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'MAPEO_LEDGER: la cuenta no pertenece a la contabilidad (empresa/proyecto) del mapeo.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_cta.es_detalle THEN
    RAISE EXCEPTION 'MAPEO_LEDGER: la cuenta es agrupadora; el mapeo exige una cuenta de detalle.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_cta.activa THEN
    RAISE EXCEPTION 'MAPEO_LEDGER: la cuenta está inactiva; el mapeo exige una cuenta activa.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_mapeo_mismo_ledger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conta_mapeo_mismo_ledger ON public.conta_mapeo_cuentas;
CREATE TRIGGER trg_conta_mapeo_mismo_ledger
  BEFORE INSERT OR UPDATE ON public.conta_mapeo_cuentas
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_mapeo_mismo_ledger();

-- ── 5. Mapeos de las tres cuentas especiales nuevas ─────────────────────────
-- SOLO filas de mapeo, y sólo si la cuenta YA existe en el catálogo del ledger.
-- No se crea ni se modifica ninguna cuenta: `conta_seed_catalogo` (el seed del
-- catálogo) no se toca aquí a propósito.
--
-- Por qué hace falta: hasta ahora estas tres cuentas se resolvían por código,
-- así que nunca hubo fila de mapeo para ellas. Sin este relleno, el mismo
-- cierre anual que hoy funciona pasaría a fallar por "configuración
-- incompleta" en todos los ledgers existentes — una regresión, no una
-- migración. Los códigos se usan aquí como lo que son: el DATO INICIAL con el
-- que ese ledger fue sembrado.
CREATE OR REPLACE FUNCTION public.conta_seed_mapeos_especiales(
  p_company_id uuid, p_project_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m        record;
  v_cuenta uuid;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('resultados_acumulados', '3101'),
      ('resultado_ejercicio',   '3201'),
      ('diferencial_cambiario', '3301')
    ) AS t(evento, codigo)
  LOOP
    SELECT id INTO v_cuenta FROM public.conta_cuentas
    WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id
      AND codigo = m.codigo AND es_detalle AND activa;

    IF v_cuenta IS NOT NULL THEN
      INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
      VALUES (p_company_id, p_project_id, m.evento, v_cuenta)
      ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), evento)
      DO NOTHING;   -- un mapeo que el cliente ya eligió MANDA sobre el default
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_seed_mapeos_especiales(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Empresa y proyecto nuevos: el mapeo especial acompaña al catálogo sembrado.
-- Se engancha en los triggers de seed (no dentro de conta_seed_catalogo) para
-- no reescribir el cuerpo de aquella función y arrastrar el riesgo de perder en
-- silencio arreglos posteriores — el hallazgo (b) de migrations-guard.
CREATE OR REPLACE FUNCTION public.conta_seed_on_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.conta_seed_catalogo(NEW.id, NULL);
    PERFORM public.conta_seed_mapeos_especiales(NEW.id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_seed_on_company(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.conta_seed_on_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.conta_seed_catalogo(NEW.company_id, NEW.id);
    PERFORM public.conta_seed_mapeos_especiales(NEW.company_id, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_seed_on_project(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Relleno de los ledgers ya existentes (empresa y cada proyecto). Aditivo:
-- ON CONFLICT DO NOTHING respeta cualquier mapeo que el cliente ya tuviera.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id AS company_id, NULL::uuid AS project_id FROM public.companies
           UNION ALL
           SELECT company_id, id FROM public.projects
  LOOP
    BEGIN
      PERFORM public.conta_seed_mapeos_especiales(r.company_id, r.project_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill mapeos especiales (empresa %, proyecto %): %',
        r.company_id, r.project_id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── 6. Cierre anual: el resultado del ejercicio se resuelve por evento ──────
-- Copia fiel de la versión vigente (20260612010000) con UN cambio: el lookup
-- `codigo = '3201'` pasa a ser `conta_exigir_cuenta_especial(...,
-- 'resultado_ejercicio')`. Autorización, candado de ejercicio, alcance del
-- ledger, folio y REVOKE/GRANT quedan idénticos.
CREATE OR REPLACE FUNCTION public.conta_cierre_anual(p_anio int, p_project_id uuid)
RETURNS public.conta_asientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_company   uuid;
  v_cta3201   uuid;
  v_neto      numeric(14,2) := 0;
  v_asiento   public.conta_asientos;
  v_orden     int := 0;
  r           record;
BEGIN
  v_company := public.get_my_company_id();
  IF NOT (
    public.is_super_admin()
    OR (v_company IS NOT NULL
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio >= extract(year FROM CURRENT_DATE) THEN
    RAISE EXCEPTION 'Solo se cierran ejercicios terminados (año < %).', extract(year FROM CURRENT_DATE)
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.conta_cierres_anuales
    WHERE company_id = v_company AND anio = p_anio
      AND project_id IS NOT DISTINCT FROM p_project_id
  ) THEN
    RAISE EXCEPTION 'El ejercicio % de esta contabilidad ya está cerrado.', p_anio USING ERRCODE = 'check_violation';
  END IF;

  -- Cuenta especial del LEDGER, no un código del catálogo: si falta el mapeo
  -- (o apunta a una cuenta inactiva, agrupadora o de otra contabilidad), esto
  -- levanta CONTA_CONFIG_INCOMPLETA y el cierre no se hace a medias.
  v_cta3201 := public.conta_exigir_cuenta_especial(v_company, p_project_id, 'resultado_ejercicio');

  PERFORM set_config('conta.allow_system_write', 'on', true);

  INSERT INTO public.conta_asientos (
    company_id, project_id, fecha, tipo, concepto, estado, origen, moneda_base, created_by
  )
  VALUES (
    v_company, p_project_id, make_date(p_anio, 12, 31), 'cierre',
    'Cierre del ejercicio ' || p_anio, 'borrador', 'manual',
    public.conta_moneda_base(v_company, p_project_id), auth.uid()
  )
  RETURNING * INTO v_asiento;

  -- Salda cada cuenta de resultados DEL LEDGER con movimiento neto en el año.
  FOR r IN
    SELECT c.id AS cuenta_id, c.tipo,
           SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
                    ELSE l.debe - l.haber END)::numeric(14,2) AS neto
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
    WHERE l.company_id = v_company
      AND a.estado = 'publicado'
      AND a.periodo BETWEEN p_anio::text || '-01' AND p_anio::text || '-12'
      AND a.project_id IS NOT DISTINCT FROM p_project_id
      AND c.tipo IN ('ingreso','gasto')
    GROUP BY c.id, c.tipo
    HAVING SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
                    ELSE l.debe - l.haber END) <> 0
  LOOP
    v_orden := v_orden + 1;
    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber
    )
    VALUES (
      v_asiento.id, v_company, r.cuenta_id, v_orden, 'Cierre ' || p_anio,
      CASE WHEN (r.tipo = 'ingreso') = (r.neto > 0) THEN abs(r.neto) ELSE 0 END,
      CASE WHEN (r.tipo = 'ingreso') = (r.neto > 0) THEN 0 ELSE abs(r.neto) END
    );
    v_neto := v_neto + CASE WHEN r.tipo = 'ingreso' THEN r.neto ELSE -r.neto END;
  END LOOP;

  IF v_orden = 0 THEN
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RAISE EXCEPTION 'El ejercicio % de esta contabilidad no tiene movimientos de resultados que cerrar.', p_anio
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_neto <> 0 THEN
    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber
    )
    VALUES (
      v_asiento.id, v_company, v_cta3201, v_orden + 1,
      CASE WHEN v_neto > 0 THEN 'Utilidad del ejercicio ' ELSE 'Pérdida del ejercicio ' END || p_anio,
      CASE WHEN v_neto < 0 THEN abs(v_neto) ELSE 0 END,
      CASE WHEN v_neto > 0 THEN v_neto ELSE 0 END
    );
  END IF;

  UPDATE public.conta_asientos
  SET estado = 'publicado',
      numero = public.conta_siguiente_folio(v_company, p_project_id),
      total_debe  = (SELECT COALESCE(SUM(debe), 0)  FROM public.conta_asiento_lineas WHERE asiento_id = v_asiento.id),
      total_haber = (SELECT COALESCE(SUM(haber), 0) FROM public.conta_asiento_lineas WHERE asiento_id = v_asiento.id),
      publicado_at = now(),
      updated_at = now()
  WHERE id = v_asiento.id
  RETURNING * INTO v_asiento;

  INSERT INTO public.conta_cierres_anuales (company_id, project_id, anio, asiento_id, cerrado_por)
  VALUES (v_company, p_project_id, p_anio, v_asiento.id, auth.uid());

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_asiento;
END;
$$;

-- ACL sin cambios respecto de 20260612010000 (CREATE OR REPLACE conserva los
-- grants, pero se reafirman para que la migración sea legible por sí sola).
REVOKE EXECUTE ON FUNCTION public.conta_cierre_anual(int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cierre_anual(int, uuid) TO authenticated;

-- ── 7. Revaluación FX: el diferencial cambiario se resuelve por evento ──────
-- Copia fiel de la versión vigente (20260612010100) con UN cambio: el lookup
-- `codigo = '3301'` pasa a ser semántico. Se conserva que sólo se exija al
-- APLICAR: la previsualización sigue funcionando sin mapeo, que es lo que hace
-- falta para diagnosticar antes de configurar.
CREATE OR REPLACE FUNCTION public.conta_revaluar_fx(
  p_fecha      date,
  p_aplicar    boolean,
  p_project_id uuid
)
RETURNS TABLE (
  cuenta_id       uuid,
  codigo          text,
  nombre          text,
  moneda          text,
  saldo_origen    numeric(14,2),
  tasa            numeric(12,6),
  saldo_libro     numeric(14,2),
  saldo_revaluado numeric(14,2),
  ajuste          numeric(14,2),
  resultado       text,
  asiento_id      uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company  uuid;
  v_base     text;
  v_3301     uuid;
  v_cta      record;
  v_moneda   text;
  v_tasa     numeric(12,6);
  v_origen   numeric(14,2);
  v_libro    numeric(14,2);
  v_reval    numeric(14,2);
  v_ajuste   numeric(14,2);
  v_lineas   jsonb;
  v_asiento  uuid;
BEGIN
  v_company := public.get_my_company_id();

  IF NOT (
    public.is_super_admin()
    OR (v_company IS NOT NULL
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  IF p_fecha > CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de revaluación no puede ser futura.' USING ERRCODE = 'check_violation';
  END IF;

  -- Moneda base y 3301 DEL LEDGER.
  v_base := public.conta_moneda_base(v_company, p_project_id);

  -- Cuenta especial del LEDGER. Sólo se EXIGE al aplicar: previsualizar no
  -- escribe nada y es justo lo que se mira antes de configurar el mapeo.
  IF p_aplicar THEN
    v_3301 := public.conta_exigir_cuenta_especial(v_company, p_project_id, 'diferencial_cambiario');
  ELSE
    v_3301 := public.conta_cuenta_especial(v_company, p_project_id, 'diferencial_cambiario');
  END IF;

  FOR v_cta IN
    SELECT c.id, c.codigo AS cod, c.nombre AS nom, c.moneda AS mon, c.naturaleza
    FROM public.conta_cuentas c
    WHERE c.company_id = v_company
      AND c.project_id IS NOT DISTINCT FROM p_project_id
      AND c.es_detalle AND c.activa
      AND c.moneda IS NOT NULL
    ORDER BY c.codigo
  LOOP
    v_moneda := public.conta_normalizar_moneda(v_cta.mon);
    IF v_moneda IS NULL OR v_moneda = v_base THEN
      CONTINUE; -- cuenta en la moneda base del ledger: nada que revaluar
    END IF;

    -- Saldos al corte (asientos publicados DEL LEDGER), con el signo de la
    -- naturaleza. El saldo origen suma solo líneas con monto_origen.
    SELECT
      COALESCE(SUM(CASE WHEN v_cta.naturaleza = 'deudora' THEN l.debe - l.haber
                        ELSE l.haber - l.debe END), 0),
      COALESCE(SUM(CASE WHEN l.monto_origen IS NULL THEN 0
                        WHEN (l.debe > 0) = (v_cta.naturaleza = 'deudora') THEN l.monto_origen
                        ELSE -l.monto_origen END), 0)
    INTO v_libro, v_origen
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE l.cuenta_id = v_cta.id
      AND a.estado = 'publicado'
      AND a.fecha <= p_fecha;

    -- Tasa de la moneda de la cuenta hacia la base DEL LEDGER (cruzada).
    v_tasa := public.conta_tasa_entre(v_company, v_moneda, v_base, p_fecha);

    cuenta_id    := v_cta.id;
    codigo       := v_cta.cod;
    nombre       := v_cta.nom;
    moneda       := v_moneda;
    saldo_origen := v_origen;
    saldo_libro  := v_libro;
    asiento_id   := NULL;

    IF v_tasa IS NULL THEN
      tasa := NULL; saldo_revaluado := NULL; ajuste := NULL;
      resultado := 'sin_tasa';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_reval  := round(v_origen * v_tasa, 2);
    v_ajuste := v_reval - v_libro;

    tasa := v_tasa;
    saldo_revaluado := v_reval;
    ajuste := v_ajuste;

    IF v_ajuste = 0 THEN
      resultado := 'sin_cambio';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF NOT p_aplicar THEN
      resultado := 'previsualizacion';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF (v_ajuste > 0) = (v_cta.naturaleza = 'deudora') THEN
      v_lineas := jsonb_build_array(
        jsonb_build_object('cuenta_id', v_cta.id, 'debe',  abs(v_ajuste),
                           'descripcion', 'Revaluación ' || v_moneda || ' @ ' || v_tasa),
        jsonb_build_object('cuenta_id', v_3301,  'haber', abs(v_ajuste),
                           'descripcion', 'Diferencial cambiario ' || v_cta.cod)
      );
    ELSE
      v_lineas := jsonb_build_array(
        jsonb_build_object('cuenta_id', v_cta.id, 'haber', abs(v_ajuste),
                           'descripcion', 'Revaluación ' || v_moneda || ' @ ' || v_tasa),
        jsonb_build_object('cuenta_id', v_3301,  'debe',  abs(v_ajuste),
                           'descripcion', 'Diferencial cambiario ' || v_cta.cod)
      );
    END IF;

    v_asiento := public.conta_generar_asiento(
      v_company,
      p_project_id,
      'conta_revaluacion_fx',
      v_cta.id,
      'fx_' || to_char(p_fecha, 'YYYY-MM-DD'),
      p_fecha,
      'Revaluación FX ' || v_cta.cod || ' ' || v_cta.nom || ' (' || v_moneda || ' @ ' || v_tasa || ')',
      'diario',
      v_base,
      v_lineas
    );

    asiento_id := v_asiento;
    resultado  := CASE WHEN v_asiento IS NULL THEN 'ya_revaluado' ELSE 'ajustado' END;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_revaluar_fx(date, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_revaluar_fx(date, boolean, uuid) TO authenticated;

-- ── 8. Recepción de compras: las cuentas del activo, por evento ─────────────
-- Copia fiel de la versión vigente (20260821000200) con UN cambio: los tres
-- lookups por código ('1401' activo, '1409' depreciación acumulada, '5107'
-- gasto por depreciación) pasan a los eventos que el seed de compras ya venía
-- creando (`activo_fijo`, `depreciacion_acumulada`, `gasto_depreciacion`).
--
-- NO BLOQUEANTE, a propósito: esto es un trigger sobre una recepción de
-- mercadería. Sin mapeo, el activo se da de alta con las columnas contables en
-- NULL (ya son nullable) y la recepción se registra igual — el mismo
-- comportamiento que tenía antes cuando el código no estaba en el catálogo. Un
-- hueco de configuración contable no puede impedir recibir mercadería.
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_registrar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_oc       record;
  v_l        record;
  v_tol      numeric;
  v_moneda   text;
  v_lineas   jsonb;
  v_total    numeric(14,2);
  v_prov     text;
  v_pend     int;
  v_recib    int;
  v_codigo   text;
  v_cta_af   uuid;
  v_cta_dep  uuid;
  v_cta_gdep uuid;
  -- Mismo cuidado que en suministros_tg_stock: se restaura el valor previo del
  -- GUC en vez de forzar 'off', para no apagárselo a un trigger de afuera.
  v_prev     text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  -- ─ Registrar ─────────────────────────────────────────────────────────────
  IF NEW.estado = 'registrada' AND OLD.estado = 'borrador' THEN
    SELECT * INTO v_oc FROM public.ordenes_compra WHERE id = NEW.orden_compra_id;
    IF v_oc.estado NOT IN ('aprobada','emitida','recibida_parcial') THEN
      RAISE EXCEPTION 'COMPRAS_OC_NO_RECIBIBLE: la orden % está en estado "%" y no admite recepciones.',
        COALESCE(v_oc.numero, v_oc.concepto), v_oc.estado USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.recepcion_lineas WHERE recepcion_id = NEW.id) THEN
      RAISE EXCEPTION 'COMPRAS_RECEPCION_VACIA: no se registra una recepción sin líneas.'
        USING ERRCODE = 'check_violation';
    END IF;

    v_tol := public.compras_tolerancia(NEW.company_id, 'cantidad');

    PERFORM set_config('conta.allow_system_write', 'on', true);

    FOR v_l IN
      SELECT rl.id AS rl_id, rl.cantidad, rl.costo_unitario, rl.total,
             ocl.id AS ocl_id, ocl.descripcion, ocl.destino_tipo, ocl.suministro_id,
             ocl.cuenta_id, ocl.categoria, ocl.cantidad AS pedida, ocl.cantidad_recibida,
             ocl.unidad
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id
      ORDER BY ocl.linea
    LOOP
      -- Recibir de más es un error de captura o una entrega fuera de contrato:
      -- se corta aquí, no en la factura, que es donde ya sería tarde.
      IF v_l.cantidad_recibida + v_l.cantidad > v_l.pedida * (1 + v_tol / 100) THEN
        RAISE EXCEPTION 'COMPRAS_SOBRE_RECEPCION: "%" — pedido %, ya recibido %, ahora %. Tolerancia: % por ciento.',
          v_l.descripcion, v_l.pedida, v_l.cantidad_recibida, v_l.cantidad, v_tol
          USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.orden_compra_lineas
         SET cantidad_recibida = cantidad_recibida + v_l.cantidad, updated_at = now()
       WHERE id = v_l.ocl_id;

      -- Inventario: una entrada al kardex; el trigger de stock hace el resto.
      IF v_l.destino_tipo = 'inventario' AND v_l.suministro_id IS NOT NULL THEN
        INSERT INTO public.movimientos_suministro
          (company_id, suministro_id, tipo, cantidad, motivo, fecha, costo_unitario, origen_tabla, origen_id)
        VALUES (NEW.company_id, v_l.suministro_id, 'entrada', v_l.cantidad,
                'Recepción ' || COALESCE(NEW.numero, '') || ' — OC ' || COALESCE(v_oc.numero, ''),
                NEW.fecha, v_l.costo_unitario, 'recepcion_lineas', v_l.rl_id);
      END IF;

      -- Activo fijo: una fila por unidad recibida, porque un activo se
      -- etiqueta, se ubica y se depreciará de a uno.
      IF v_l.destino_tipo = 'activo_fijo' THEN
        -- Cuentas especiales del LEDGER, por significado. NULL si el ledger no
        -- las tiene mapeadas: el activo nace sin cuenta contable y la
        -- recepción NO se detiene.
        v_cta_af   := public.conta_cuenta_especial(NEW.company_id, NEW.project_id, 'activo_fijo');
        v_cta_dep  := public.conta_cuenta_especial(NEW.company_id, NEW.project_id, 'depreciacion_acumulada');
        v_cta_gdep := public.conta_cuenta_especial(NEW.company_id, NEW.project_id, 'gasto_depreciacion');

        FOR v_recib IN 1..GREATEST(1, floor(v_l.cantidad)::int) LOOP
          v_codigo := 'AF-' || lpad(
            public.compras_siguiente_correlativo(NEW.company_id, NEW.project_id, 'activo_fijo')::text, 6, '0');
          INSERT INTO public.activos_fijos
            (company_id, project_id, codigo, nombre, fecha_alta, costo,
             cuenta_activo_id, cuenta_dep_acum_id, cuenta_gasto_dep_id,
             proveedor_id, recepcion_linea_id, notas)
          VALUES (NEW.company_id, NEW.project_id, v_codigo, v_l.descripcion, NEW.fecha,
                  v_l.costo_unitario, COALESCE(v_l.cuenta_id, v_cta_af), v_cta_dep, v_cta_gdep,
                  v_oc.proveedor_id, v_l.rl_id,
                  'Alta automática por recepción ' || COALESCE(NEW.numero, NEW.id::text));
        END LOOP;
      END IF;
    END LOOP;

    -- ─ Estado de la orden ──────────────────────────────────────────────────
    SELECT COUNT(*) INTO v_pend FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida < cantidad;
    UPDATE public.ordenes_compra
       SET estado = CASE WHEN v_pend = 0 THEN 'recibida' ELSE 'recibida_parcial' END,
           updated_at = now()
     WHERE id = NEW.orden_compra_id;

    -- ─ Asiento GR/IR ───────────────────────────────────────────────────────
    -- Dr por destino (cuenta de la línea si la trae; si no, el mapeo del
    -- evento) contra Cr `compras_por_facturar`. Agrupado por cuenta para no
    -- escribir diez líneas de la misma cuenta.
    WITH destinos AS (
      SELECT ocl.cuenta_id,
             CASE ocl.destino_tipo
               WHEN 'inventario'  THEN 'inventario'
               WHEN 'activo_fijo' THEN 'activo_fijo'
               ELSE CASE WHEN COALESCE(ocl.categoria, 'otros') IN
                          ('mantenimiento','servicios','administrativo','seguridad','limpieza','obras')
                         THEN 'gasto_' || ocl.categoria ELSE 'gasto_otros' END
             END AS evento,
             rl.total
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id
    ), agrupado AS (
      SELECT cuenta_id, evento, SUM(total) AS monto FROM destinos GROUP BY cuenta_id, evento
    )
    SELECT jsonb_agg(CASE WHEN cuenta_id IS NOT NULL
                          THEN jsonb_build_object('cuenta_id', cuenta_id, 'debe', monto)
                          ELSE jsonb_build_object('evento', evento, 'debe', monto) END),
           SUM(monto)
      INTO v_lineas, v_total
      FROM agrupado;

    IF COALESCE(v_total, 0) > 0 THEN
      SELECT nombre INTO v_prov FROM public.proveedores WHERE id = v_oc.proveedor_id;
      v_moneda := COALESCE(v_oc.moneda, public.conta_moneda_base(NEW.company_id, NEW.project_id));

      PERFORM public.conta_generar_asiento(
        NEW.company_id, NEW.project_id, 'recepciones', NEW.id, 'recepcion_registrada',
        NEW.fecha,
        'Recepción ' || COALESCE(NEW.numero, '') || ' — OC ' || COALESCE(v_oc.numero, v_oc.concepto)
          || COALESCE(' — ' || v_prov, ''),
        'diario', v_moneda,
        v_lineas || jsonb_build_array(
          jsonb_build_object('evento', 'compras_por_facturar', 'haber', v_total,
                             'descripcion', 'Pendiente de facturación'))
      );
    END IF;

    PERFORM set_config('conta.allow_system_write', v_prev, true);
    RETURN NEW;
  END IF;

  -- ─ Anular ────────────────────────────────────────────────────────────────
  IF NEW.estado = 'anulada' AND OLD.estado = 'registrada' THEN
    PERFORM set_config('conta.allow_system_write', 'on', true);

    FOR v_l IN
      SELECT rl.id AS rl_id, rl.cantidad, rl.costo_unitario,
             ocl.id AS ocl_id, ocl.destino_tipo, ocl.suministro_id, ocl.cantidad_facturada
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id
    LOOP
      -- Lo ya facturado no se puede "des-recibir": primero se anula la factura.
      IF v_l.cantidad_facturada > 0 THEN
        RAISE EXCEPTION 'COMPRAS_RECEPCION_FACTURADA: la línea ya tiene % facturada; anula primero la factura.',
          v_l.cantidad_facturada USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.orden_compra_lineas
         SET cantidad_recibida = GREATEST(0, cantidad_recibida - v_l.cantidad), updated_at = now()
       WHERE id = v_l.ocl_id;

      -- El kardex no se reescribe: se compensa con una salida, que es lo que
      -- de verdad pasó (entró y volvió a salir).
      IF v_l.destino_tipo = 'inventario' AND v_l.suministro_id IS NOT NULL THEN
        INSERT INTO public.movimientos_suministro
          (company_id, suministro_id, tipo, cantidad, motivo, fecha, costo_unitario, origen_tabla, origen_id)
        VALUES (NEW.company_id, v_l.suministro_id, 'salida', v_l.cantidad,
                'Anulación de recepción ' || COALESCE(NEW.numero, ''), CURRENT_DATE,
                v_l.costo_unitario, 'recepcion_lineas_anulada', v_l.rl_id);
      END IF;

      -- Los activos no se borran: se dan de baja con su motivo.
      UPDATE public.activos_fijos
         SET estado = 'dado_de_baja',
             motivo_baja = 'Recepción anulada',
             updated_at = now()
       WHERE recepcion_linea_id = v_l.rl_id AND estado <> 'dado_de_baja';
    END LOOP;

    SELECT COUNT(*) INTO v_recib FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida > 0;
    SELECT COUNT(*) INTO v_pend FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida < cantidad;
    -- Sin nada recibido, la orden vuelve a donde estaba ANTES de la entrega:
    -- 'emitida' si llegó a enviarse al proveedor, 'aprobada' si no. Forzar
    -- siempre 'emitida' inventaría un envío que quizá nunca ocurrió.
    UPDATE public.ordenes_compra
       SET estado = CASE WHEN v_recib = 0 THEN
                           CASE WHEN emitida_at IS NOT NULL THEN 'emitida' ELSE 'aprobada' END
                         WHEN v_pend = 0 THEN 'recibida'
                         ELSE 'recibida_parcial' END,
           updated_at = now()
     WHERE id = NEW.orden_compra_id;

    PERFORM public.conta_reversar_automatico(NEW.company_id, 'recepciones', NEW.id,
      'recepcion_registrada', 'Recepción anulada');

    PERFORM set_config('conta.allow_system_write', v_prev, true);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_registrar() FROM PUBLIC, anon, authenticated;
