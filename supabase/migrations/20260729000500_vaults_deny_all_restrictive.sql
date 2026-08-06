-- ════════════════════════════════════════════════════════════════════════════
-- Vaults de secretos: deny-all PERMISSIVE → RESTRICTIVE
-- (auditoría 2026-07-28, Bloque A · PR-10).
--
-- POR QUÉ
-- `company_payment_secrets` (20260409000004:5), `payfac_secrets`
-- (20260604233000:173) y `fiscal_pac_secrets` (20260604230000:218) se protegen
-- con una policy deny-all declarada PERMISSIVE (el modo por defecto):
--
--   CREATE POLICY "Deny access to all" ON public.<vault>
--     USING (false) WITH CHECK (false);
--
-- Hoy eso deniega todo, así que el efecto es el correcto. El problema es lo que
-- pasa MAÑANA: las policies permisivas se combinan con OR. El día que alguien
-- añada a una de estas tablas una policy permisiva cualquiera —por ejemplo un
-- SELECT para que el superadmin vea el estado de la integración— esa policy
-- pasará POR ENCIMA de la deny-all, porque `false OR <lo nuevo>` es `<lo nuevo>`.
-- La deny-all no es una barrera: es un sumando neutro.
--
-- Las RESTRICTIVE, en cambio, se combinan con AND. Una deny-all RESTRICTIVE
-- (`false AND cualquier_cosa`) no se puede sortear añadiendo policies: hay que
-- borrarla explícitamente, y eso sí se ve en un diff.
--
-- `company_whatsapp_configs` (20260716000000:75) ya lo hace bien, con
-- `AS RESTRICTIVE FOR ALL`. Esta migración alinea a las otras tres con ese
-- patrón.
--
-- SIN CAMBIO DE COMPORTAMIENTO HOY: las tres tablas siguen siendo deny-all para
-- `anon` y `authenticated`, y las edge functions las siguen leyendo con
-- service_role (que ignora RLS). Lo único que cambia es que ahora la protección
-- resiste una adición futura.
--
-- La permisividad de una policy no se puede ALTERar: hay que dropear y recrear.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_payment_secrets', 'payfac_secrets', 'fiscal_pac_secrets']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Deny access to all" ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY "Deny access to all" ON public.%I
        AS RESTRICTIVE FOR ALL
        USING (false)
        WITH CHECK (false)
    $p$, t);
    EXECUTE format($c$
      COMMENT ON POLICY "Deny access to all" ON public.%I IS
        'Deny-all RESTRICTIVE: solo service_role (que ignora RLS) accede, desde edge functions. RESTRICTIVE y no PERMISSIVE a propósito — las permisivas se combinan con OR, así que una policy futura pasaría por encima de la deny; las restrictivas se combinan con AND. Auditoría 2026-07-28, Bloque A · PR-10.'
    $c$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- get_my_company_id(): añadir LIMIT 1, como ya tiene get_my_cliente_id().
--
-- `SELECT company_id FROM app_users WHERE id = auth.uid()` sin LIMIT falla con
-- "more than one row returned by a subquery" si hubiera filas duplicadas para
-- un mismo auth.uid(). Falla cerrado (la policy revienta, no deja pasar), así
-- que no es un agujero — pero es una inconsistencia con su función hermana
-- (20260330000001:7) y convierte un dato corrupto en un error opaco en toda
-- policy que la use. Se preserva SECURITY DEFINER y el search_path fijo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1
$$;
