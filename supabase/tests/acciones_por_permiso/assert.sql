-- ============================================================================
-- INVARIANTES de 20261103000200 · 000300 · 000400 · borrar exige «Eliminar»
-- del tab, editar exige «Editar» y crear exige «Crear»
-- ============================================================================
\set ON_ERROR_STOP on

-- ── 0 · Precondiciones: que ningún caso pase por el motivo equivocado ───────
-- Las filas existen y son de A, y cada persona tiene EXACTAMENTE el permiso
-- que su nombre dice (con un admin colado, BOR probaría la exención).
SELECT bp.chk((SELECT count(*) = 6 FROM (
  SELECT company_id FROM public.incidentes_seguridad WHERE id = bp.id('INC')
  UNION ALL SELECT company_id FROM public.asambleas WHERE id = bp.id('ASA')
  UNION ALL SELECT company_id FROM public.checklist_areas WHERE id = bp.id('CHK')
  UNION ALL SELECT company_id FROM public.permisos_obra_unidad WHERE id = bp.id('POB')
  UNION ALL SELECT company_id FROM public.tickets_mantenimiento WHERE id IN (bp.id('TKT'), bp.id('TKB'))
) f WHERE company_id = bp.id('A')), true, '0 · las seis filas existen y son de la empresa A');

SELECT bp.como('VER');
SELECT bp.chk(public.user_has_permission('condominios.tab.incidentes')
              AND NOT public.condominios_puede_actuar('incidentes', 'delete'), true,
              '0 · VER ve Incidentes y no tiene «Eliminar»');
SELECT bp.como('EDI');
SELECT bp.chk(public.condominios_puede_actuar('incidentes', 'edit')
              AND NOT public.condominios_puede_actuar('incidentes', 'delete'), true,
              '0 · EDI edita Incidentes y no tiene «Eliminar»');
SELECT bp.como('OCU');
SELECT bp.chk(public.user_has_permission('condominios.tab.incidentes.delete')
              AND NOT public.user_has_permission('condominios.tab.incidentes'), true,
              '0 · OCU tiene la clave de «Eliminar» pero no ve el tab');
SELECT bp.como('BOR');
SELECT bp.chk(public.current_user_role() = 'operator'
              AND NOT public.condominios_puede_actuar('incidentes', 'edit'), true,
              '0 · BOR no es un rol exento y no tiene «Editar»');
SELECT bp.como('KAN');
SELECT bp.chk(public.condominios_puede_actuar('kanban_tickets', 'edit')
              AND NOT public.condominios_puede_actuar('mantenimiento', 'edit'), true,
              '0 · KAN edita en el Kanban y no en Mantenimiento');

-- ── A · Quién borra (físico) y quién da de baja (lógico) ────────────────────
SELECT bp.como('VER');  SET ROLE authenticated; SELECT bp.cinco('A · VER (sólo ver)', false);                 RESET ROLE;
SELECT bp.como('EDI');  SET ROLE authenticated; SELECT bp.cinco('A · EDI (editar no es eliminar)', false);    RESET ROLE;
SELECT bp.como('OCU');  SET ROLE authenticated; SELECT bp.cinco('A · OCU (eliminar sin ver el tab)', false);  RESET ROLE;
SELECT bp.como('BORB'); SET ROLE authenticated; SELECT bp.cinco('A · BORB (eliminar, pero de otra empresa)', false); RESET ROLE;
SELECT bp.como('BOR');  SET ROLE authenticated; SELECT bp.cinco('A · BOR (eliminar del tab)', true);          RESET ROLE;
SELECT bp.como('LEG');  SET ROLE authenticated; SELECT bp.cinco('A · LEG (par legado view + delete)', true);  RESET ROLE;
SELECT bp.como('ADM');  SET ROLE authenticated; SELECT bp.cinco('A · ADM (admin de la empresa)', true);       RESET ROLE;
SELECT bp.como('KAN');  SET ROLE authenticated;
SELECT bp.chk(bp.da_de_baja('TKT'), false, 'A · KAN (editar en el Kanban) NO da de baja un ticket');
RESET ROLE;

-- ── B · Tickets: editar exige «Editar» (en Mantenimiento o en el Kanban) ────
-- La baja la gobierna «Eliminar» (sección A); restaurar deja el ticket VIVO,
-- así que exige las dos.
SELECT bp.como('VER'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_ticket('TKT'), false, 'B · VER (sólo ver) NO edita un ticket vivo');
SELECT bp.chk(bp.restaura('TKB'),     false, 'B · VER no restaura un ticket dado de baja');
SELECT bp.chk(bp.edita_ticket('TKB'), false, 'B · …ni edita uno dado de baja');
RESET ROLE;
SELECT bp.como('EDI'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_ticket('TKT'), true,  'B · EDI edita un ticket vivo');
SELECT bp.chk(bp.restaura('TKB'),     false, 'B · EDI no restaura un ticket dado de baja (restaurar deshace un borrado)');
RESET ROLE;
SELECT bp.como('KAN'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_ticket('TKT'), true,  'B · KAN edita un ticket vivo desde el Kanban');
RESET ROLE;
SELECT bp.como('BOR'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_ticket('TKT'), false, 'B · BOR (sólo eliminar) NO edita un ticket vivo');
SELECT bp.chk(bp.restaura('TKB'),     false, 'B · BOR no restaura: el ticket quedaría vivo, y eso es editar');
RESET ROLE;
SELECT bp.como('OCU'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_ticket('TKT'), false, 'B · OCU (editar sin ver el tab) NO edita un ticket');
RESET ROLE;
SELECT bp.como('LEG'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_ticket('TKT'), true,  'B · LEG (par legado) edita un ticket vivo');
SELECT bp.chk(bp.restaura('TKB'),     true,  'B · LEG (par legado con editar y eliminar) restaura un ticket');
RESET ROLE;
SELECT bp.como('ADM'); SET ROLE authenticated;
SELECT bp.chk(bp.restaura('TKB'),     true,  'B · ADM restaura un ticket');
RESET ROLE;
SELECT bp.como('BORB'); SET ROLE authenticated;
SELECT bp.chk(bp.restaura('TKB'),     false, 'B · BORB no restaura un ticket de otra empresa');
RESET ROLE;

-- ── C · Sin WHERE, sólo la policy de DELETE separa a las empresas ───────────
SELECT bp.como('BORB'); SET ROLE authenticated;
SELECT bp.chk(bp.borra_sin_filtro('incidentes_seguridad') = 0, true, 'C · BORB, con DELETE sin filtro, no se lleva incidentes de A');
SELECT bp.chk(bp.borra_sin_filtro('asambleas') = 0,            true, 'C · …ni asambleas');
SELECT bp.chk(bp.borra_sin_filtro('checklist_areas') = 0,      true, 'C · …ni checklists');
SELECT bp.chk(bp.borra_sin_filtro('permisos_obra_unidad') = 0, true, 'C · …ni permisos de obra');
RESET ROLE;

-- ── D · Editar en las otras cuatro tablas exige «Editar» del tab ───────────
SELECT bp.como('VER'); SET ROLE authenticated; SELECT bp.cuatro_ediciones('D · VER (sólo ver)', false);              RESET ROLE;
SELECT bp.como('BOR'); SET ROLE authenticated; SELECT bp.cuatro_ediciones('D · BOR (eliminar no es editar)', false); RESET ROLE;
SELECT bp.como('OCU'); SET ROLE authenticated; SELECT bp.cuatro_ediciones('D · OCU (editar sin ver el tab)', false); RESET ROLE;
SELECT bp.como('EDI'); SET ROLE authenticated; SELECT bp.cuatro_ediciones('D · EDI (editar del tab)', true);         RESET ROLE;
SELECT bp.como('LEG'); SET ROLE authenticated; SELECT bp.cuatro_ediciones('D · LEG (par legado view + edit)', true); RESET ROLE;
SELECT bp.como('ADM'); SET ROLE authenticated; SELECT bp.cuatro_ediciones('D · ADM (admin de la empresa)', true);    RESET ROLE;

-- Sin WHERE ni lectura, sólo la policy de UPDATE separa a las empresas (USING)
-- e impide que una fila se mude a otra (WITH CHECK).
SELECT bp.como('BORB'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_sin_filtro('incidentes_seguridad') = 0, true, 'D · BORB, con UPDATE sin filtro, no toca incidentes de A');
SELECT bp.chk(bp.edita_sin_filtro('asambleas') = 0,            true, 'D · …ni asambleas');
SELECT bp.chk(bp.edita_sin_filtro('checklist_areas') = 0,      true, 'D · …ni checklists');
SELECT bp.chk(bp.edita_sin_filtro('permisos_obra_unidad') = 0, true, 'D · …ni permisos de obra');
RESET ROLE;
SELECT bp.como('EDI'); SET ROLE authenticated;
SELECT bp.chk(bp.muda_a_b('incidentes_seguridad'), false, 'D · EDI no muda un incidente a la empresa B');
SELECT bp.chk(bp.muda_a_b('asambleas'),            false, 'D · …ni una asamblea');
SELECT bp.chk(bp.muda_a_b('checklist_areas'),      false, 'D · …ni un checklist');
SELECT bp.chk(bp.muda_a_b('permisos_obra_unidad'), false, 'D · …ni un permiso de obra');
RESET ROLE;

-- ── E · Crear exige «Crear» del tab; el residente reporta en sus unidades ───
SELECT bp.como('VER'); SET ROLE authenticated; SELECT bp.cinco_altas('E · VER (sólo ver)', false);                  RESET ROLE;
SELECT bp.como('EDI'); SET ROLE authenticated; SELECT bp.cinco_altas('E · EDI (editar no es crear)', false);       RESET ROLE;
SELECT bp.como('BOR'); SET ROLE authenticated; SELECT bp.cinco_altas('E · BOR (eliminar no es crear)', false);     RESET ROLE;
SELECT bp.como('OCU'); SET ROLE authenticated; SELECT bp.cinco_altas('E · OCU (crear sin ver el tab)', false);     RESET ROLE;
SELECT bp.como('CRE'); SET ROLE authenticated; SELECT bp.cinco_altas('E · CRE (crear del tab)', true);             RESET ROLE;
SELECT bp.como('CRE'); SET ROLE authenticated; SELECT bp.cinco_altas('E · CRE, en la empresa B', false, 'B');      RESET ROLE;
SELECT bp.como('LEG'); SET ROLE authenticated; SELECT bp.cinco_altas('E · LEG (par legado view + create)', true);  RESET ROLE;
SELECT bp.como('ADM'); SET ROLE authenticated; SELECT bp.cinco_altas('E · ADM (admin de la empresa)', true);       RESET ROLE;
SELECT bp.como('KAN'); SET ROLE authenticated;
SELECT bp.chk(bp.crea('tickets_mantenimiento'), false, 'E · KAN (editar en el Kanban) NO crea tickets');
RESET ROLE;
SELECT bp.como('RES'); SET ROLE authenticated;
SELECT bp.chk(bp.crea('tickets_mantenimiento', 'A', 'U1'), true,  'E · RES (residente) SÍ reporta un ticket de SU unidad desde el portal');
SELECT bp.chk(bp.crea('tickets_mantenimiento', 'A', 'U2'), false, 'E · RES NO reporta un ticket de una unidad ajena');
SELECT bp.chk(bp.crea('tickets_mantenimiento'),            false, 'E · RES NO crea un ticket sin unidad (eso es del staff)');
SELECT bp.chk(bp.crea('incidentes_seguridad'),             false, 'E · RES NO registra un incidente');
RESET ROLE;

-- ── F · El borrado físico de tickets sigue siendo sólo de admin ─────────────
SELECT bp.como('BOR'); SET ROLE authenticated;
SELECT bp.chk(bp.borra('tickets_mantenimiento', 'TKT'), false, 'F · BOR no borra FÍSICAMENTE un ticket (se da de baja)');
RESET ROLE;
SELECT bp.como('ADM'); SET ROLE authenticated;
SELECT bp.chk(bp.borra('tickets_mantenimiento', 'TKT'), true,  'F · ADM sí, como antes');
RESET ROLE;
