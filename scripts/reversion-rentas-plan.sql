-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación de 20261126000000_rentas_tercer_modulo_del_plan
--
-- NO es una migración: se ejecuta a mano, por bloques, sólo si hace falta.
-- Regla general: preferir AVANZAR con una migración nueva.
--   A · inventario (solo lectura)
--   B · dejar de mover el plan con los interruptores (reversible)
--   C · devolver una empresa a su plan anterior
--   D · reversión del cobro de propiedades independientes
-- ════════════════════════════════════════════════════════════════════════════

-- ── A · Inventario (solo lectura) ───────────────────────────────────────────
-- Empresas cuyo plan NO coincide con sus módulos (no las cambia nada hasta que
-- alguien toque sus interruptores) y las que usan un plan con Rentas.
SELECT c.id, c.nombre, c.servicio_agua, c.servicio_condominios, c.servicio_rentas,
       bp.code AS plan, public.plan_code_por_modulos(c.servicio_agua, c.servicio_condominios, c.servicio_rentas) AS plan_por_modulos,
       s.status, (s.stripe_subscription_id IS NOT NULL) AS en_stripe
  FROM public.companies c
  LEFT JOIN public.subscriptions s ON s.company_id = c.id AND s.status IN ('trialing', 'active', 'past_due', 'incomplete')
  LEFT JOIN public.billing_plans bp ON bp.id = s.plan_id
 ORDER BY c.nombre;

-- Cambios de plan hechos por los interruptores quedan en la auditoría de
-- subscriptions (trigger audit_subscriptions).

-- ── B · Los interruptores dejan de mover el plan ────────────────────────────
-- ALTER TABLE public.companies DISABLE TRIGGER trg_companies_modulos_plan;
-- Para reanudar: ALTER TABLE public.companies ENABLE TRIGGER trg_companies_modulos_plan;

-- ── C · Devolver una empresa a un plan concreto ─────────────────────────────
-- Sólo si la suscripción NO vive en Stripe (en_stripe = false en A).
-- UPDATE public.subscriptions s SET plan_id = (SELECT id FROM public.billing_plans WHERE code = '<plan>')
--  WHERE s.company_id = '<empresa>' AND s.status IN ('trialing', 'active', 'past_due', 'incomplete')
--    AND s.stripe_subscription_id IS NULL;

-- ── D · Dejar de cobrar y topar las propiedades independientes ──────────────
-- Devuelve 0 siempre: el total, el uso y el tope vuelven a contar sólo unidades.
-- (Las vistas del panel se alinean en el siguiente refresco si además se apaga
-- Rentas en la empresa; para quitarlo de las vistas hace falta una migración.)
-- CREATE OR REPLACE FUNCTION public.rentas_propiedades_independientes(p_company_id uuid)
-- RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT 0 $$;
-- DROP TRIGGER IF EXISTS trg_rentas_propiedades_tope ON public.rentas_propiedades;

-- Los planes nuevos no se borran mientras alguna suscripción los use:
-- UPDATE public.billing_plans SET is_active = false
--  WHERE code IN ('rentas_only', 'agua_rentas', 'condominios_rentas', 'suite')
--    AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.plan_id = billing_plans.id);
