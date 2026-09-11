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
