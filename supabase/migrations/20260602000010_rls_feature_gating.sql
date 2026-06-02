-- ============================================================================
-- RLS server-side feature gating (plat:P36c)
-- ============================================================================
-- Refuerza el gating de plat:P36: aunque el frontend ya bloquea con
-- FeatureGate, un cliente malicioso podria intentar bypassear la UI y hacer
-- queries directos via supabase-js. Las policies RESTRICTIVE garantizan
-- que el servidor rechaza INSERTs a tablas premium si el plan no incluye
-- la feature.
--
-- **Policy type**: RESTRICTIVE (vs PERMISSIVE default). Las RESTRICTIVE se
-- AND'an con las permissivas existentes — no remueven permisos, los reducen.
-- Asi mantenemos las policies existentes (SELECT por company_id, etc) y
-- agregamos el filtro de feature como capa adicional.
--
-- **Que se gate**:
-- - INSERT solamente. SELECT/UPDATE/DELETE quedan como estan.
-- - Razon: si un tenant baja de plan, debe poder seguir LEYENDO los datos
--   premium que ya tiene (legal/cumplimiento) y BORRARLOS (limpieza),
--   pero no puede CREAR nuevos.
--
-- **Tablas y features**:
-- - asambleas_digital → asambleas_digitales
-- - puntos_asamblea  → asambleas_digitales (puntos de votacion)
-- - votos_asamblea   → asambleas_digitales (votos individuales)
-- - cobranza_judicial → cobranza_judicial
-- - automatizaciones_cond → automation (enterprise reservado)
--
-- **Bypass intencional**: service_role siempre puede INSERT. Esto permite
-- que el backend (edge functions, webhooks de Stripe) escriba sin
-- restricciones, ej. para insertar datos de seed o migracion.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- asambleas_digital — feature 'asambleas_digitales'
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "asambleas_digital_feature_gate" ON public.asambleas_digital;
CREATE POLICY "asambleas_digital_feature_gate"
  ON public.asambleas_digital
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.company_has_feature(company_id, 'asambleas_digitales'));

COMMENT ON POLICY "asambleas_digital_feature_gate" ON public.asambleas_digital IS
  'plat:P36c — bloquea INSERT si el plan no incluye asambleas_digitales. RESTRICTIVE, se AND con company_id check existente.';

-- ────────────────────────────────────────────────────────────────────────────
-- puntos_asamblea — feature 'asambleas_digitales'
-- ────────────────────────────────────────────────────────────────────────────
-- puntos_asamblea no tiene company_id directo, se enlaza via asamblea_id.
-- Resolvemos haciendo JOIN inline en la policy.
DROP POLICY IF EXISTS "puntos_asamblea_feature_gate" ON public.puntos_asamblea;
CREATE POLICY "puntos_asamblea_feature_gate"
  ON public.puntos_asamblea
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.company_has_feature(
      (SELECT company_id FROM public.asambleas_digital WHERE id = asamblea_id),
      'asambleas_digitales'
    )
  );

COMMENT ON POLICY "puntos_asamblea_feature_gate" ON public.puntos_asamblea IS
  'plat:P36c — bloquea INSERT si el plan no incluye asambleas_digitales. Resuelve company via JOIN a asambleas_digital.';

-- ────────────────────────────────────────────────────────────────────────────
-- votos_asamblea — feature 'asambleas_digitales'
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "votos_asamblea_feature_gate" ON public.votos_asamblea;
CREATE POLICY "votos_asamblea_feature_gate"
  ON public.votos_asamblea
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.company_has_feature(
      (SELECT company_id FROM public.asambleas_digital
        WHERE id = (SELECT asamblea_id FROM public.puntos_asamblea WHERE id = punto_id)),
      'asambleas_digitales'
    )
  );

COMMENT ON POLICY "votos_asamblea_feature_gate" ON public.votos_asamblea IS
  'plat:P36c — bloquea INSERT si el plan no incluye asambleas_digitales. Resuelve company via JOIN votos→puntos→asambleas.';

-- ────────────────────────────────────────────────────────────────────────────
-- cobranza_judicial — feature 'cobranza_judicial'
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cobranza_judicial_feature_gate" ON public.cobranza_judicial;
CREATE POLICY "cobranza_judicial_feature_gate"
  ON public.cobranza_judicial
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.company_has_feature(company_id, 'cobranza_judicial'));

COMMENT ON POLICY "cobranza_judicial_feature_gate" ON public.cobranza_judicial IS
  'plat:P36c — bloquea INSERT si el plan no incluye cobranza_judicial.';

-- ────────────────────────────────────────────────────────────────────────────
-- automatizaciones_cond — feature 'automation' (enterprise)
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "automatizaciones_cond_feature_gate" ON public.automatizaciones_cond;
CREATE POLICY "automatizaciones_cond_feature_gate"
  ON public.automatizaciones_cond
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.company_has_feature(company_id, 'automation'));

COMMENT ON POLICY "automatizaciones_cond_feature_gate" ON public.automatizaciones_cond IS
  'plat:P36c — bloquea INSERT si el plan no incluye automation (Enterprise reservado).';
