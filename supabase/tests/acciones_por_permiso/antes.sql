-- ============================================================================
-- CONTROL PREVIO: el estado de ANTES de 20261103000200, 000300 y 000400,
-- sobre el mismo padrón.
--
-- Si estos huecos no se reproducen, el padrón no prueba lo que dice: la suite
-- de después pasaría igual sin las migraciones.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT bp.como('VER'); SET ROLE authenticated;
SELECT bp.chk(bp.da_de_baja('TKT'), true,
  'antes · VER (sólo ver) SÍ daba de baja un ticket: la policy de UPDATE sólo pedía visibilidad');
SELECT bp.chk(bp.edita_ticket('TKT'), true,
  'antes · VER (sólo ver) SÍ editaba un ticket');
SELECT bp.chk(bp.edita('incidentes_seguridad', 'INC'), true,
  'antes · VER (sólo ver) SÍ editaba un incidente');
SELECT bp.chk(bp.crea('incidentes_seguridad'), true,
  'antes · VER (sólo ver) SÍ registraba un incidente');
RESET ROLE;

SELECT bp.como('BOR'); SET ROLE authenticated;
SELECT bp.chk(bp.borra('incidentes_seguridad', 'INC'), false,
  'antes · BOR (con «Eliminar») NO borraba un incidente: el DELETE era sólo de admin');
RESET ROLE;
