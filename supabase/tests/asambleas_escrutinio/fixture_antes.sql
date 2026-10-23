-- ============================================================================
-- PADRÓN DE ANTES de 20261106000200 (sin sus columnas ni tablas).
--
-- Empresa A (condominios_only), proyecto PU con P1…P4 activas y P5 inactiva.
--   X_CUR  en curso, quórum requerido 20, puntos XC_P (P1 a favor, P5 en
--          contra) y XC_P2 (sin votos)
--   X_FIN  finalizada, punto XF_P (P1 a favor)
-- Sirve dos veces: antes.sql reproduce los huecos, y con la migración
-- aplicada encima, backfill.sql prueba lo que pasa con las asambleas que ya
-- existían.
-- ============================================================================
\set ON_ERROR_STOP on

INSERT INTO public.companies (id, nombre) VALUES (ae.id('A'), 'Empresa A (escrutinio, antes)');
UPDATE public.subscriptions s
   SET plan_id = (SELECT id FROM public.billing_plans WHERE code = 'condominios_only'), status = 'active'
 WHERE s.company_id = ae.id('A');
INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES (ae.id('PU'), ae.id('A'), 'Condominio PU', 'condominios');

INSERT INTO auth.users (id) VALUES (ae.id('ADM_A'));
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (ae.id('ADM_A'), ae.id('A'), 'Escrutinio ADM_A', 'admin');

INSERT INTO public.unidades (id, project_id, company_id, nombre, activo)
SELECT ae.id(u), ae.id('PU'), ae.id('A'), 'Unidad ' || u, u <> 'P5'
FROM unnest(ARRAY['P1', 'P2', 'P3', 'P4', 'P5']) AS u;

INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio, estado, quorum_requerido) VALUES
  (ae.id('X_CUR'), ae.id('A'), ae.id('PU'), 'En curso desde antes',   CURRENT_DATE,      '18:00', 'en_curso', 20),
  (ae.id('X_FIN'), ae.id('A'), ae.id('PU'), 'Finalizada desde antes', CURRENT_DATE - 30, '18:00', 'en_curso', 50);
INSERT INTO public.puntos_asamblea (id, asamblea_id, orden, titulo, tipo) VALUES
  (ae.id('XC_P'),  ae.id('X_CUR'), 1, 'Presupuesto', 'votacion'),
  (ae.id('XC_P2'), ae.id('X_CUR'), 2, 'Jardinería',  'votacion'),
  (ae.id('XF_P'),  ae.id('X_FIN'), 1, 'Pintura',     'votacion');
INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES
  (ae.id('XC_P'), ae.id('P1'), 'a_favor'),
  (ae.id('XC_P'), ae.id('P5'), 'en_contra'),
  (ae.id('XF_P'), ae.id('P1'), 'a_favor');
UPDATE public.asambleas SET estado = 'finalizada' WHERE id = ae.id('X_FIN');
