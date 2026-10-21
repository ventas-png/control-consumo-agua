-- ============================================================================
-- INVARIANTES de 20261103000200 · borrar exige la acción «Eliminar» del tab
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
SELECT bp.chk(public.current_user_role() = 'operator', true, '0 · BOR no es un rol exento');

-- ── A · Quién borra (físico) y quién da de baja (lógico) ────────────────────
SELECT bp.como('VER');  SET ROLE authenticated; SELECT bp.cinco('A · VER (sólo ver)', false);                 RESET ROLE;
SELECT bp.como('EDI');  SET ROLE authenticated; SELECT bp.cinco('A · EDI (editar no es eliminar)', false);    RESET ROLE;
SELECT bp.como('OCU');  SET ROLE authenticated; SELECT bp.cinco('A · OCU (eliminar sin ver el tab)', false);  RESET ROLE;
SELECT bp.como('BORB'); SET ROLE authenticated; SELECT bp.cinco('A · BORB (eliminar, pero de otra empresa)', false); RESET ROLE;
SELECT bp.como('BOR');  SET ROLE authenticated; SELECT bp.cinco('A · BOR (eliminar del tab)', true);          RESET ROLE;
SELECT bp.como('LEG');  SET ROLE authenticated; SELECT bp.cinco('A · LEG (par legado view + delete)', true);  RESET ROLE;
SELECT bp.como('ADM');  SET ROLE authenticated; SELECT bp.cinco('A · ADM (admin de la empresa)', true);       RESET ROLE;

-- ── B · La baja lógica no estorba a la edición ni se deshace sin permiso ────
SELECT bp.como('VER'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_ticket('TKT'), true,  'B · VER sigue editando un ticket vivo (la policy restrictiva no lo toca)');
SELECT bp.chk(bp.restaura('TKB'),     false, 'B · VER no restaura un ticket dado de baja');
SELECT bp.chk(bp.edita_ticket('TKB'), false, 'B · …ni edita uno dado de baja');
RESET ROLE;
SELECT bp.como('EDI'); SET ROLE authenticated;
SELECT bp.chk(bp.edita_ticket('TKT'), true,  'B · EDI edita un ticket vivo');
SELECT bp.chk(bp.restaura('TKB'),     false, 'B · EDI no restaura un ticket dado de baja');
RESET ROLE;
SELECT bp.como('BOR'); SET ROLE authenticated;
SELECT bp.chk(bp.restaura('TKB'),     true,  'B · BOR restaura un ticket dado de baja');
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

-- ── D · El borrado físico de tickets sigue siendo sólo de admin ─────────────
SELECT bp.como('BOR'); SET ROLE authenticated;
SELECT bp.chk(bp.borra('tickets_mantenimiento', 'TKT'), false, 'D · BOR no borra FÍSICAMENTE un ticket (se da de baja)');
RESET ROLE;
SELECT bp.como('ADM'); SET ROLE authenticated;
SELECT bp.chk(bp.borra('tickets_mantenimiento', 'TKT'), true,  'D · ADM sí, como antes');
RESET ROLE;
