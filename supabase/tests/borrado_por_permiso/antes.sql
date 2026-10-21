-- ============================================================================
-- CONTROL PREVIO: el estado de ANTES de 20261103000200, sobre el mismo padrón.
--
-- Si estos dos huecos no se reproducen, el padrón no prueba lo que dice: la
-- suite de después pasaría igual sin la migración.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT bp.como('VER'); SET ROLE authenticated;
SELECT bp.chk(bp.da_de_baja('TKT'), true,
  'antes · VER (sólo ver) SÍ daba de baja un ticket: la policy de UPDATE sólo pedía visibilidad');
RESET ROLE;

SELECT bp.como('BOR'); SET ROLE authenticated;
SELECT bp.chk(bp.borra('incidentes_seguridad', 'INC'), false,
  'antes · BOR (con «Eliminar») NO borraba un incidente: el DELETE era sólo de admin');
RESET ROLE;
