-- ============================================================================
-- PADRÓN DE LA SUITE «asambleas_unificacion» (20261106000300)
--
-- Sobre la cadena REAL de migraciones, con la migración aplicada. Las
-- asambleas siguen el ciclo real (se abren, toman padrón, se finalizan).
--
-- Empresa A (condominios_only): condominio PU con P1 (de Ana Ruiz), P2, P3, P4;
-- condominio PX con X1. Empresa B: B1 con UB.
-- Personas de A: ADM_A (admin); ACT_A ve Asambleas y crea Actas (no ve
-- Votaciones); VSA_A sólo ve Asambleas; VAC_A crea Actas pero no ve
-- Asambleas. ADM_B, admin de B. SIN existe sólo en auth.users.
-- Asambleas de PU:
--   A_FIN   finalizada. Asisten P1 (presencial) y P2 (por poder: Juana Pérez);
--           P3 sólo vota; P4 falta. F_SI (simple): P1 y P2 sí, P3 no;
--           F_NO (absoluta): P1 sí, P2 y P3 abstención; F_INFO informativo.
--           Acta en texto: «Resumen del secretario».
--   A_FIN2  finalizada, con su acta formal ya levantada (ACTA_FIN2)
--   A_CUR (en curso), A_PROG (programada), A_CAN (cancelada)
-- X_FIN finalizada en PX; B_FIN finalizada en B1. ACTA_SUELTA: acta de PU sin
-- asamblea.
-- Votaciones de PU (opciones 1 «Sí» / 2 «No»): V_ABIERTA (P1 y P2 sí, P3
-- no), V_EMPATE (P1 sí, P2 no), V_SINQ (mínimo 3 votos; P1 sí), V_SINVOTOS,
-- V_CERRADA (P1 sí, cerrada), V_ANULADA. De B: V_B.
-- ============================================================================
\set ON_ERROR_STOP on

INSERT INTO public.companies (id, nombre, timezone) VALUES
  (au.id('A'), 'Empresa A (unificación)', 'America/Guatemala'),
  (au.id('B'), 'Empresa B (unificación)', 'America/Guatemala');
UPDATE public.subscriptions s
   SET plan_id = (SELECT id FROM public.billing_plans WHERE code = 'condominios_only'), status = 'active'
 WHERE s.company_id IN (au.id('A'), au.id('B'));
INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (au.id('PU'), au.id('A'), 'Condominio PU', 'condominios'),
  (au.id('PX'), au.id('A'), 'Condominio PX', 'condominios'),
  (au.id('B1'), au.id('B'), 'Condominio B1', 'condominios');

INSERT INTO auth.users (id)
SELECT au.id(a) FROM unnest(ARRAY['ADM_A', 'ACT_A', 'VSA_A', 'VAC_A', 'ADM_B', 'SIN']) AS a;
INSERT INTO public.app_users (id, company_id, full_name, role)
SELECT au.id(a), au.id(CASE a WHEN 'ADM_B' THEN 'B' ELSE 'A' END), 'Unificación ' || a,
       CASE WHEN a LIKE 'ADM\__' THEN 'admin' ELSE 'operator' END
FROM unnest(ARRAY['ADM_A', 'ACT_A', 'VSA_A', 'VAC_A', 'ADM_B']) AS a;
INSERT INTO public.roles (id, company_id, name) VALUES
  (au.id('R_ACT'), au.id('A'), 'Asambleas y actas'),
  (au.id('R_VSA'), au.id('A'), 'Ve asambleas'),
  (au.id('R_VAC'), au.id('A'), 'Sólo actas');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (au.id('R_ACT'), 'condominios.tab.asambleas',      'allow'),
  (au.id('R_ACT'), 'condominios.tab.actas',          'allow'),
  (au.id('R_ACT'), 'condominios.tab.actas.create',   'allow'),
  (au.id('R_VSA'), 'condominios.tab.asambleas',      'allow'),
  (au.id('R_VAC'), 'condominios.tab.actas',          'allow'),
  (au.id('R_VAC'), 'condominios.tab.actas.create',   'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (au.id('ACT_A'), au.id('R_ACT')), (au.id('VSA_A'), au.id('R_VSA')), (au.id('VAC_A'), au.id('R_VAC'));

INSERT INTO public.unidades (id, project_id, company_id, nombre, propietario_nombre) VALUES
  (au.id('P1'), au.id('PU'), au.id('A'), 'Casa 1', 'Ana Ruiz'),
  (au.id('P2'), au.id('PU'), au.id('A'), 'Casa 2', NULL),
  (au.id('P3'), au.id('PU'), au.id('A'), 'Casa 3', NULL),
  (au.id('P4'), au.id('PU'), au.id('A'), 'Casa 4', NULL),
  (au.id('X1'), au.id('PX'), au.id('A'), 'Casa X', NULL),
  (au.id('UB'), au.id('B1'), au.id('B'), 'Casa B', NULL);

-- ── Asambleas ───────────────────────────────────────────────────────────────
INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio, lugar, estado, quorum_requerido, modalidad, link_reunion) VALUES
  (au.id('A_FIN'),  au.id('A'), au.id('PU'), 'Ordinaria de octubre', CURRENT_DATE - 3, '18:00', 'Salón', 'en_curso', 50, 'hibrida', 'https://meet.google.com/abc'),
  (au.id('A_FIN2'), au.id('A'), au.id('PU'), 'Ordinaria de septiembre', CURRENT_DATE - 30, '18:00', NULL, 'en_curso', 50, 'presencial', NULL),
  (au.id('A_CUR'),  au.id('A'), au.id('PU'), 'En curso',   CURRENT_DATE,      '18:00', NULL, 'en_curso',   50, 'presencial', NULL),
  (au.id('A_PROG'), au.id('A'), au.id('PU'), 'Programada', CURRENT_DATE + 10, '18:00', NULL, 'programada', 50, 'presencial', NULL),
  (au.id('A_CAN'),  au.id('A'), au.id('PU'), 'Cancelada',  CURRENT_DATE - 5,  '18:00', NULL, 'en_curso',   50, 'presencial', NULL),
  (au.id('X_FIN'),  au.id('A'), au.id('PX'), 'De PX',      CURRENT_DATE - 3,  '18:00', NULL, 'en_curso',   50, 'presencial', NULL),
  (au.id('B_FIN'),  au.id('B'), au.id('B1'), 'De B',       CURRENT_DATE - 3,  '18:00', NULL, 'en_curso',   50, 'presencial', NULL);

INSERT INTO public.puntos_asamblea (id, asamblea_id, orden, titulo, descripcion, tipo, mayoria) VALUES
  (au.id('F_SI'),   au.id('A_FIN'), 1, 'Presupuesto 2027',     'Aprobar el presupuesto', 'votacion',    'simple'),
  (au.id('F_NO'),   au.id('A_FIN'), 2, 'Cuota extraordinaria', NULL,                     'votacion',    'absoluta'),
  (au.id('F_INFO'), au.id('A_FIN'), 3, 'Informe del tesorero', NULL,                     'informativo', 'simple');
INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad, apoderado_nombre, poder_documento) VALUES
  (au.id('A_FIN'), au.id('P1'), 'presencial', NULL, NULL),
  (au.id('A_FIN'), au.id('P2'), 'poder', 'Juana Pérez', au.id('PU')::text || '/asambleas/poderes/carta.pdf');
INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto)
SELECT au.id(v.punto), au.id(v.unidad), v.voto
FROM (VALUES ('F_SI', 'P1', 'a_favor'), ('F_SI', 'P2', 'a_favor'), ('F_SI', 'P3', 'en_contra'),
             ('F_NO', 'P1', 'a_favor'), ('F_NO', 'P2', 'abstencion'), ('F_NO', 'P3', 'abstencion')) AS v(punto, unidad, voto);

UPDATE public.asambleas SET estado = 'finalizada', acta = 'Resumen del secretario'
 WHERE id IN (au.id('A_FIN'), au.id('A_FIN2'), au.id('X_FIN'), au.id('B_FIN'));
UPDATE public.asambleas SET estado = 'cancelada' WHERE id = au.id('A_CAN');

-- ── Actas ───────────────────────────────────────────────────────────────────
INSERT INTO public.actas_reunion (id, company_id, project_id, asamblea_id, titulo, tipo, fecha) VALUES
  (au.id('ACTA_SUELTA'), au.id('A'), au.id('PU'), NULL,             'Junta de agosto',             'junta',     CURRENT_DATE - 60),
  (au.id('ACTA_FIN2'),   au.id('A'), au.id('PU'), au.id('A_FIN2'),  'Acta — Ordinaria de septiembre', 'ordinaria', CURRENT_DATE - 30);

-- ── Votaciones ──────────────────────────────────────────────────────────────
INSERT INTO public.votaciones (id, company_id, project_id, titulo, opciones, quorum_requerido)
SELECT au.id(v.alias), au.id(v.empresa), au.id(v.proyecto), v.titulo,
       '[{"id": "1", "texto": "Sí"}, {"id": "2", "texto": "No"}]'::jsonb, v.quorum
FROM (VALUES ('V_ABIERTA', 'A', 'PU', 'Pintar de verde', NULL::int), ('V_EMPATE', 'A', 'PU', 'Cambiar el portón', NULL),
             ('V_SINQ', 'A', 'PU', 'Abrir la piscina', 3), ('V_SINVOTOS', 'A', 'PU', 'Nueva jardinería', NULL),
             ('V_CERRADA', 'A', 'PU', 'Horario de gimnasio', NULL), ('V_ANULADA', 'A', 'PU', 'Repetida', NULL),
             ('V_B', 'B', 'B1', 'Consulta de B', NULL)) AS v(alias, empresa, proyecto, titulo, quorum);
INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id)
SELECT au.id('A'), au.id(v.votacion), au.id(v.unidad), v.opcion
FROM (VALUES ('V_ABIERTA', 'P1', '1'), ('V_ABIERTA', 'P2', '1'), ('V_ABIERTA', 'P3', '2'),
             ('V_EMPATE', 'P1', '1'), ('V_EMPATE', 'P2', '2'),
             ('V_SINQ', 'P1', '1'),
             ('V_CERRADA', 'P1', '1')) AS v(votacion, unidad, opcion);
UPDATE public.votaciones SET estado = 'cerrada' WHERE id = au.id('V_CERRADA');
UPDATE public.votaciones SET estado = 'anulada' WHERE id = au.id('V_ANULADA');

DELETE FROM public.audit_log WHERE table_name = 'votos_asamblea';
