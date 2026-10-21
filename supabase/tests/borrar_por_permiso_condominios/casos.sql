\set ON_ERROR_STOP on

-- ============================================================================
-- LOS CASOS: quién intenta qué, y qué tiene que dar ANTES y DESPUÉS de
-- 20261104000100. Un resultado es el número de filas afectadas, o 'rechazado'
-- si la RLS levanta 42501.
--
-- La columna `antes` no es decorado: assert.sql la exige igual que `despues`.
-- Si el fixture dejara de reproducir los dos huecos, las pruebas de `despues`
-- podrían estar pasando por no medir nada, y eso tiene que fallar también.
-- ============================================================================

CREATE TABLE public.bpc_casos (
  caso    text PRIMARY KEY,
  quien   text NOT NULL,
  sql     text NOT NULL,
  antes   text NOT NULL,
  despues text NOT NULL
);

-- Quién es quién: medir.sql corre cada caso con el uid de su usuario.
CREATE TABLE public.bpc_usuarios (quien text PRIMARY KEY, uid uuid NOT NULL);
INSERT INTO public.bpc_usuarios VALUES
  ('admin',  'a0a0a0a0-0000-0000-0000-00000000000a'),
  ('borra',  'a0a0a0a0-0000-0000-0000-00000000000b'),
  ('legado', 'a0a0a0a0-0000-0000-0000-00000000000c'),
  ('edita',  'a0a0a0a0-0000-0000-0000-00000000000d'),
  ('visor',  'a0a0a0a0-0000-0000-0000-00000000000e'),
  ('sintab', 'a0a0a0a0-0000-0000-0000-00000000000f'),
  ('ajeno',  'b0b0b0b0-0000-0000-0000-00000000000b'),
  ('super',  'b0b0b0b0-0000-0000-0000-000000000005');

-- ── A · DELETE físico en las cuatro tablas ──────────────────────────────────
-- ANTES: sólo los roles de plataforma (admin de la empresa, super_admin).
--        `borra` y `legado` tienen el permiso que la UI mira y la base los
--        ignoraba: 0 filas, sin error — el hueco 2.
-- DESPUÉS: la regla de `canDelete`. Ver sin `.delete` (visor, edita) no basta,
--        `.delete` sin ver el tab (sintab) tampoco, y el permiso no cruza la
--        empresa (ajeno).
CREATE TEMP TABLE bpc_esperado_borrado (quien text PRIMARY KEY, antes text, despues text);
INSERT INTO bpc_esperado_borrado VALUES
  ('admin',  '1', '1'),
  ('borra',  '0', '1'),
  ('legado', '0', '1'),
  ('edita',  '0', '0'),
  ('visor',  '0', '0'),
  ('sintab', '0', '0'),
  ('ajeno',  '0', '0'),
  ('super',  '1', '1');

-- Cada borrado se mide de DOS formas:
--   · `WHERE id = …`, que es lo que manda la pestaña. Con un WHERE que lee
--     columnas, Postgres exige ADEMÁS la policy de SELECT sobre la fila, y la
--     de estas tablas ya acota empresa y visibilidad del tab.
--   · sin WHERE. Ahí la de SELECT no participa y decide SOLO la de DELETE. Sin
--     esta variante, quitar la empresa o la visibilidad de la policy de DELETE
--     pasaba la suite (lo mostraron los mutantes): la de SELECT tapaba el hueco.
INSERT INTO public.bpc_casos (caso, quien, sql, antes, despues)
SELECT 'A·' || t.tabla || '·' || v.variante || '·' || e.quien,
       e.quien,
       format('DELETE FROM public.%I', t.tabla)
         || CASE v.variante WHEN 'por_id' THEN format(' WHERE id = %L', t.id) ELSE '' END,
       e.antes,
       e.despues
FROM (VALUES
  ('incidentes_seguridad', '1c000000-0000-0000-0000-000000000001'),
  ('asambleas',            '1a000000-0000-0000-0000-000000000001'),
  ('checklist_areas',      '1d000000-0000-0000-0000-000000000001'),
  ('permisos_obra_unidad', '1e000000-0000-0000-0000-000000000001')
) AS t(tabla, id)
CROSS JOIN (VALUES ('por_id'), ('sin_where')) AS v(variante)
CROSS JOIN bpc_esperado_borrado e;

-- ── B · Borrado lógico de tickets (lo que hace softDelete()) ────────────────
-- ANTES: cualquiera que VEA el tab marca `deleted_at` — el hueco 1.
-- DESPUÉS: hace falta `.delete`; sin él la RLS rechaza con 42501 (WITH CHECK),
--        no con un 0. sintab/ajeno no llegan ni a ver la fila: 0.
INSERT INTO public.bpc_casos (caso, quien, sql, antes, despues)
SELECT 'B·borrar_ticket·' || e.quien,
       e.quien,
       format($s$UPDATE public.tickets_mantenimiento
                    SET deleted_at = now(), deleted_by = %L
                  WHERE id = '1f000000-0000-0000-0000-000000000001' AND deleted_at IS NULL$s$, u.uid),
       e.antes,
       e.despues
FROM (VALUES
  ('admin',  '1', '1'),
  ('borra',  '1', '1'),
  ('legado', '1', '1'),
  ('edita',  '1', 'rechazado'),
  ('visor',  '1', 'rechazado'),
  ('sintab', '0', '0'),
  ('ajeno',  '0', '0'),
  ('super',  '1', '1')
) AS e(quien, antes, despues)
JOIN public.bpc_usuarios u USING (quien);

-- ── C · Restaurar un ticket borrado (lo que hace la Papelera) ───────────────
-- Deshacer un borrado es decidir sobre el borrado: mismo permiso. La fila de
-- ANTES está borrada, así que es el USING el que decide: 0 filas, no error.
INSERT INTO public.bpc_casos (caso, quien, sql, antes, despues)
SELECT 'C·restaurar_ticket·' || e.quien,
       e.quien,
       $s$UPDATE public.tickets_mantenimiento
             SET deleted_at = NULL, deleted_by = NULL
           WHERE id = '1f000000-0000-0000-0000-000000000002'$s$,
       e.antes,
       e.despues
FROM (VALUES
  ('admin',  '1', '1'),
  ('borra',  '1', '1'),
  ('legado', '1', '1'),
  ('edita',  '1', '0'),
  ('visor',  '1', '0'),
  ('sintab', '0', '0'),
  ('ajeno',  '0', '0'),
  ('super',  '1', '1')
) AS e(quien, antes, despues);

-- ── D · Lo que NO tiene que cambiar ─────────────────────────────────────────
-- Editar un ticket VIVO sigue como estaba: la migración no puede cerrar de más.
-- Tocar uno YA BORRADO sí pasa a pedir `.delete` (si no, editarlo bastaría para
-- tener control sobre lo borrado). Y el DELETE físico de tickets no cambia:
-- sigue siendo de admin, la pestaña no lo usa.
INSERT INTO public.bpc_casos (caso, quien, sql, antes, despues) VALUES
  ('D·editar_ticket_vivo·edita', 'edita',
   $s$UPDATE public.tickets_mantenimiento SET estado = 'en_proceso'
       WHERE id = '1f000000-0000-0000-0000-000000000001'$s$, '1', '1'),
  ('D·editar_ticket_vivo·borra', 'borra',
   $s$UPDATE public.tickets_mantenimiento SET estado = 'en_proceso'
       WHERE id = '1f000000-0000-0000-0000-000000000001'$s$, '1', '1'),
  ('D·editar_ticket_vivo·ajeno', 'ajeno',
   $s$UPDATE public.tickets_mantenimiento SET estado = 'en_proceso'
       WHERE id = '1f000000-0000-0000-0000-000000000001'$s$, '0', '0'),
  ('D·editar_ticket_borrado·edita', 'edita',
   $s$UPDATE public.tickets_mantenimiento SET notas_cierre = 'SINT-BPC'
       WHERE id = '1f000000-0000-0000-0000-000000000002'$s$, '1', '0'),
  ('D·editar_ticket_borrado·borra', 'borra',
   $s$UPDATE public.tickets_mantenimiento SET notas_cierre = 'SINT-BPC'
       WHERE id = '1f000000-0000-0000-0000-000000000002'$s$, '1', '1'),
  ('D·delete_fisico_ticket·borra', 'borra',
   $s$DELETE FROM public.tickets_mantenimiento
       WHERE id = '1f000000-0000-0000-0000-000000000001'$s$, '0', '0'),
  ('D·delete_fisico_ticket·admin', 'admin',
   $s$DELETE FROM public.tickets_mantenimiento
       WHERE id = '1f000000-0000-0000-0000-000000000001'$s$, '1', '1');

