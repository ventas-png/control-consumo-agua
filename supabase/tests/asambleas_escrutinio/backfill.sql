-- ============================================================================
-- LAS ASAMBLEAS QUE YA EXISTÍAN: fixture_antes.sql con 20261106000200 encima.
--
-- La que estaba en curso toma base y padrón al migrar, y al finalizar tiene
-- escrutinio (sin el voto de la unidad dada de baja). La que ya estaba
-- finalizada queda como estaba: sin padrón ni escrutinio.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT ae.chk((SELECT base_votacion FROM public.asambleas WHERE id = ae.id('X_CUR')), 'unidad',
  'backfill · la asamblea en curso toma la base del condominio (por unidad, sin configurar)');
SELECT ae.chk((SELECT string_agg(i.alias || '=' || pa.peso, ' ' ORDER BY i.alias)
                 FROM public.padron_asamblea pa JOIN ae.ids i ON i.id = pa.unidad_id
                WHERE pa.asamblea_id = ae.id('X_CUR')), 'P1=1.0000 P2=1.0000 P3=1.0000 P4=1.0000',
  'backfill · y su padrón: las cuatro unidades activas, sin la dada de baja');
SELECT ae.chk((SELECT coalesce(base_votacion, 'NULL') || ' ' || coalesce(escrutinio::text, 'NULL') FROM public.asambleas WHERE id = ae.id('X_FIN')), 'NULL NULL',
  'backfill · la finalizada de antes queda sin base ni escrutinio');
SELECT ae.chk((SELECT count(*)::text FROM public.padron_asamblea WHERE asamblea_id = ae.id('X_FIN')), '0',
  'backfill · ni padrón');
SELECT ae.chk((SELECT string_agg(DISTINCT mayoria, ',') FROM public.puntos_asamblea), 'simple',
  'backfill · los puntos que ya existían quedan con mayoría simple');

SELECT ae.como('ADM_A'); SET ROLE authenticated;
SELECT ae.chk(ae.cerrar('X_CUR') #>> '{escrutinio,presentes,unidades}', '1',
  'backfill · al finalizarla, presente sólo P1: el voto de la unidad dada de baja no la hace presente');
SELECT ae.chk(ae.punto(ae.cerrar('X_CUR') -> 'escrutinio', 'XC_P') #>> '{en_contra,unidades}', '0',
  'backfill · y su voto en contra no cuenta');
SELECT ae.chk(ae.cerrar('X_CUR') #>> '{resultados,XC_P}', 'Aprobado',
  'backfill · el punto queda «Aprobado» (25 % presente ≥ 20 % requerido; 1 a favor, 0 en contra)');
RESET ROLE;
