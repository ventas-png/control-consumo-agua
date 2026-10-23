-- ============================================================================
-- PADRÓN DE LA SUITE «asambleas_escrutinio» (20261106000200)
--
-- Se carga sobre la cadena REAL de migraciones, con la migración aplicada. Las
-- asambleas siguen el ciclo real: se abren (y toman su padrón) y se finalizan
-- con los triggers de verdad.
--
-- Empresa A (condominios_only):
--   PU  por unidad (sin configurar): P1…P4 activas, P5 dada de baja.
--   PA  por alícuota: L1 40 % (100 m²), L2 35 % (100 m²), L3 sin alícuota con
--       50 m² (→ 50/250 = 20 %), L4 sin alícuota ni m² (→ 0), L5 dada de baja.
--   PZ  por alícuota, sin alícuota ni m² en ninguna unidad (Z1, Z2).
-- Asambleas de PU:
--   U_PROG  programada, con PU_PROG_P.
--   U_CUR   abierta con un UPDATE (el camino de la pantalla), quórum 50. Antes
--           de abrir, P5 votó en contra de UC_SIMPLE (no está en el padrón).
--           Asisten P1 (presencial) y P2 (por poder); P3 sólo vota; P4 falta.
--             UC_SIMPLE    simple:            P1 sí, P2 no, P3 sí
--             UC_ABS       absoluta:          P1 sí, P2 abst., P3 abst.
--             UC_CAL       calificada 75 %:   P1, P2, P3 sí  (3/4: en el borde)
--             UC_CAL80     calificada 80 %:   P1, P2, P3 sí
--             UC_SINVOTOS  simple, sin votos
--             UC_INFO      informativo
--   U_SINQ  en curso, quórum 80: asisten P1, que vota US_P a favor, y P2,
--           que no vota.
--   U_FIN   finalizada: asiste P1 (registró REG); P1 y P2 votan UF_P a favor
--           → 2/4 presentes = 50 %, justo el requerido.
--   U_CAN   cancelada estando en curso, con la asistencia de P1.
-- De PA: A_CUR, insertada en curso (el otro camino): asiste L1; A_SIMPLE con
-- L1 en contra (40), L3 a favor (20), L4 a favor (0).
-- De PZ: Z_PROG, programada (abrirla debe fallar).
-- Empresa B (condominios_only): B_CUR en curso con UB1, y ADM_B.
-- Empresa C (agua_only, sin la feature): C_CUR en curso con UC1, y ADM_C.
-- Personas de A: ADM_A (admin, exento), EDT_A (ve y edita Asambleas), VER_A
-- (sólo ve), NOP_A (nada). REG y SIN existen sólo en auth.users.
-- ============================================================================
\set ON_ERROR_STOP on

-- ── Empresas, proyectos, personas ───────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  (ae.id('A'), 'Empresa A (escrutinio)'),
  (ae.id('B'), 'Empresa B (escrutinio)'),
  (ae.id('C'), 'Empresa C (escrutinio, agua)');
UPDATE public.subscriptions s
   SET plan_id = (SELECT id FROM public.billing_plans WHERE code = v.plan), status = 'active'
  FROM (VALUES (ae.id('A'), 'condominios_only'), (ae.id('B'), 'condominios_only'), (ae.id('C'), 'agua_only')) AS v(company_id, plan)
 WHERE s.company_id = v.company_id;

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (ae.id('PU'), ae.id('A'), 'Condominio PU (por unidad)',     'condominios'),
  (ae.id('PA'), ae.id('A'), 'Condominio PA (por alícuota)',   'condominios'),
  (ae.id('PZ'), ae.id('A'), 'Condominio PZ (alícuota vacía)', 'condominios'),
  (ae.id('B1'), ae.id('B'), 'Condominio B1',                  'condominios'),
  (ae.id('C1'), ae.id('C'), 'Condominio C1',                  'condominios');

INSERT INTO auth.users (id)
SELECT ae.id(a) FROM unnest(ARRAY['ADM_A', 'EDT_A', 'VER_A', 'NOP_A', 'ADM_B', 'ADM_C', 'REG', 'SIN']) AS a;
INSERT INTO public.app_users (id, company_id, full_name, role)
SELECT ae.id(a), ae.id(CASE a WHEN 'ADM_B' THEN 'B' WHEN 'ADM_C' THEN 'C' ELSE 'A' END), 'Escrutinio ' || a,
       CASE WHEN a LIKE 'ADM\__' THEN 'admin' ELSE 'operator' END
FROM unnest(ARRAY['ADM_A', 'EDT_A', 'VER_A', 'NOP_A', 'ADM_B', 'ADM_C']) AS a;

INSERT INTO public.roles (id, company_id, name) VALUES
  (ae.id('R_EDT'), ae.id('A'), 'Conduce asambleas'),
  (ae.id('R_VER'), ae.id('A'), 'Ve asambleas');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (ae.id('R_EDT'), 'condominios.tab.asambleas',      'allow'),
  (ae.id('R_EDT'), 'condominios.tab.asambleas.edit', 'allow'),
  (ae.id('R_VER'), 'condominios.tab.asambleas',      'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (ae.id('EDT_A'), ae.id('R_EDT')),
  (ae.id('VER_A'), ae.id('R_VER'));

-- ── Base de votación de cada condominio ─────────────────────────────────────
INSERT INTO public.configuracion_condominio (company_id, project_id, clave, valor, tipo) VALUES
  (ae.id('A'), ae.id('PA'), 'asambleas_base_votacion', 'alicuota', 'texto'),
  (ae.id('A'), ae.id('PZ'), 'asambleas_base_votacion', 'alicuota', 'texto');

-- ── Unidades ────────────────────────────────────────────────────────────────
INSERT INTO public.unidades (id, project_id, company_id, nombre, activo, alicuota_pct, area_m2) VALUES
  (ae.id('P1'), ae.id('PU'), ae.id('A'), 'Casa 1',    true,  NULL, NULL),
  (ae.id('P2'), ae.id('PU'), ae.id('A'), 'Casa 2',    true,  NULL, NULL),
  (ae.id('P3'), ae.id('PU'), ae.id('A'), 'Casa 3',    true,  NULL, NULL),
  (ae.id('P4'), ae.id('PU'), ae.id('A'), 'Casa 4',    true,  NULL, NULL),
  (ae.id('P5'), ae.id('PU'), ae.id('A'), 'Casa 5',    false, NULL, NULL),
  (ae.id('L1'), ae.id('PA'), ae.id('A'), 'Local 1',   true,  40,   100),
  (ae.id('L2'), ae.id('PA'), ae.id('A'), 'Local 2',   true,  35,   100),
  (ae.id('L3'), ae.id('PA'), ae.id('A'), 'Local 3',   true,  NULL, 50),
  (ae.id('L4'), ae.id('PA'), ae.id('A'), 'Local 4',   true,  NULL, NULL),
  (ae.id('L5'), ae.id('PA'), ae.id('A'), 'Local 5',   false, 5,    40),
  (ae.id('Z1'), ae.id('PZ'), ae.id('A'), 'Bodega 1',  true,  NULL, NULL),
  (ae.id('Z2'), ae.id('PZ'), ae.id('A'), 'Bodega 2',  true,  NULL, NULL),
  (ae.id('UB1'), ae.id('B1'), ae.id('B'), 'Casa B1',  true,  NULL, NULL),
  (ae.id('UC1'), ae.id('C1'), ae.id('C'), 'Casa C1',  true,  NULL, NULL);

-- ── Asambleas de PU ─────────────────────────────────────────────────────────
INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio, estado, quorum_requerido) VALUES
  (ae.id('U_PROG'), ae.id('A'), ae.id('PU'), 'Programada',        CURRENT_DATE + 30, '18:00', 'programada', 50),
  (ae.id('U_CUR'),  ae.id('A'), ae.id('PU'), 'En curso',          CURRENT_DATE,      '18:00', 'programada', 50),
  (ae.id('U_SINQ'), ae.id('A'), ae.id('PU'), 'Sin quórum',        CURRENT_DATE,      '19:00', 'en_curso',   80),
  (ae.id('U_FIN'),  ae.id('A'), ae.id('PU'), 'Finalizada',        CURRENT_DATE - 60, '18:00', 'en_curso',   50),
  (ae.id('U_CAN'),  ae.id('A'), ae.id('PU'), 'Cancelada',         CURRENT_DATE - 30, '18:00', 'en_curso',   50);

INSERT INTO public.puntos_asamblea (id, asamblea_id, orden, titulo, tipo, mayoria, mayoria_pct) VALUES
  (ae.id('PU_PROG_P'),   ae.id('U_PROG'), 1, 'Reglamento',          'votacion',    'simple',     NULL),
  (ae.id('UC_SIMPLE'),   ae.id('U_CUR'),  1, 'Presupuesto',         'votacion',    'simple',     NULL),
  (ae.id('UC_ABS'),      ae.id('U_CUR'),  2, 'Cuota extraordinaria','votacion',    'absoluta',   NULL),
  (ae.id('UC_CAL'),      ae.id('U_CUR'),  3, 'Reforma de estatutos','votacion',    'calificada', 75),
  (ae.id('UC_CAL80'),    ae.id('U_CUR'),  4, 'Venta de área común', 'votacion',    'calificada', 80),
  (ae.id('UC_SINVOTOS'), ae.id('U_CUR'),  5, 'Jardinería',          'votacion',    'simple',     NULL),
  (ae.id('UC_INFO'),     ae.id('U_CUR'),  6, 'Informe del tesorero','informativo', 'simple',     NULL),
  (ae.id('US_P'),        ae.id('U_SINQ'), 1, 'Portón',              'votacion',    'simple',     NULL),
  (ae.id('UF_P'),        ae.id('U_FIN'),  1, 'Pintura',             'votacion',    'simple',     NULL);

-- Antes de abrir U_CUR (sin padrón) vota P5, que está dada de baja.
INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES (ae.id('UC_SIMPLE'), ae.id('P5'), 'en_contra');
UPDATE public.asambleas SET estado = 'en_curso' WHERE id = ae.id('U_CUR');

INSERT INTO public.asistencia_asamblea (id, asamblea_id, unidad_id, modalidad, apoderado_nombre, poder_documento, registrado_por) VALUES
  (ae.id('S_UC_P1'),  ae.id('U_CUR'), ae.id('P1'), 'presencial', NULL, NULL, NULL),
  (ae.id('S_UC_P2'),  ae.id('U_CUR'), ae.id('P2'), 'poder', 'Juana Pérez', ae.id('PU')::text || '/asambleas/poderes/carta-p2.pdf', NULL),
  (ae.id('S_UF_P1'),  ae.id('U_FIN'), ae.id('P1'), 'presencial', NULL, NULL, ae.id('REG')),
  (ae.id('S_CAN_P1'), ae.id('U_CAN'), ae.id('P1'), 'virtual',    NULL, NULL, NULL);
INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES
  (ae.id('U_SINQ'), ae.id('P1'), 'presencial'),
  (ae.id('U_SINQ'), ae.id('P2'), 'virtual');

INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto)
SELECT ae.id(v.punto), ae.id(v.unidad), v.voto
FROM (VALUES
  ('UC_SIMPLE', 'P1', 'a_favor'), ('UC_SIMPLE', 'P2', 'en_contra'), ('UC_SIMPLE', 'P3', 'a_favor'),
  ('UC_ABS',    'P1', 'a_favor'), ('UC_ABS',    'P2', 'abstencion'), ('UC_ABS',   'P3', 'abstencion'),
  ('UC_CAL',    'P1', 'a_favor'), ('UC_CAL',    'P2', 'a_favor'),    ('UC_CAL',   'P3', 'a_favor'),
  ('UC_CAL80',  'P1', 'a_favor'), ('UC_CAL80',  'P2', 'a_favor'),    ('UC_CAL80', 'P3', 'a_favor'),
  ('US_P',      'P1', 'a_favor'),
  ('UF_P',      'P1', 'a_favor'), ('UF_P',      'P2', 'a_favor')
) AS v(punto, unidad, voto);

UPDATE public.asambleas SET estado = 'finalizada', acta = 'Acta firmada' WHERE id = ae.id('U_FIN');
UPDATE public.asambleas SET estado = 'cancelada' WHERE id = ae.id('U_CAN');

-- ── PA, PZ, B, C ────────────────────────────────────────────────────────────
INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio, estado, quorum_requerido) VALUES
  (ae.id('A_CUR'),  ae.id('A'), ae.id('PA'), 'En curso por alícuota',  CURRENT_DATE,      '18:00', 'en_curso',   50),
  (ae.id('Z_PROG'), ae.id('A'), ae.id('PZ'), 'Programada sin alícuota', CURRENT_DATE + 7, '18:00', 'programada', 50),
  (ae.id('B_CUR'),  ae.id('B'), ae.id('B1'), 'En curso de B',          CURRENT_DATE,      '18:00', 'en_curso',   50),
  (ae.id('C_CUR'),  ae.id('C'), ae.id('C1'), 'En curso de C',          CURRENT_DATE,      '18:00', 'en_curso',   50);
INSERT INTO public.puntos_asamblea (id, asamblea_id, orden, titulo, tipo) VALUES
  (ae.id('A_SIMPLE'), ae.id('A_CUR'), 1, 'Ampliar estacionamiento', 'votacion');
INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES (ae.id('A_CUR'), ae.id('L1'), 'presencial');
INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES
  (ae.id('A_SIMPLE'), ae.id('L1'), 'en_contra'),
  (ae.id('A_SIMPLE'), ae.id('L3'), 'a_favor'),
  (ae.id('A_SIMPLE'), ae.id('L4'), 'a_favor');

-- El historial de votos (20261106000100) no cuenta aquí.
DELETE FROM public.audit_log WHERE table_name = 'votos_asamblea';
