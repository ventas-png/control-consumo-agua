\set ON_ERROR_STOP on

-- ============================================================================
-- MATRIZ ANTES / DESPUÉS — nadie legítimo cambia, nadie sin perfil pasa.
--
-- Requiere, en la base CON la migración: fos.resultados (matriz.sql corrida aquí)
-- y fos.antes (la misma matriz corrida en la base SIN la migración, con el mismo
-- padrón). Los resultados están normalizados (uuids y marcas de tiempo nuevas).
-- ============================================================================

-- 0. La matriz cubre el inventario entero, no una muestra. Las únicas funciones que pueden
--    no estar «antes» son las que trajo una migración POSTERIOR a la serie (fos.posteriores:
--    run.sh la llena comparando el inventario antes y después de aplicarlas); la matriz las
--    ejecuta igual y las secciones 2 y 3 las juzgan frente a las sesiones sin perfil.
CREATE TABLE IF NOT EXISTS fos.posteriores (firma text PRIMARY KEY);
DO $$
DECLARE v_antes int; v_desp int; v_inv int; v_post int; v_ajenas int; v_lista text;
BEGIN
  SELECT count(DISTINCT firma) INTO v_antes FROM fos.antes;
  SELECT count(DISTINCT firma) INTO v_desp  FROM fos.resultados;
  SELECT count(*) INTO v_inv FROM fos.inventario();
  SELECT count(*) INTO v_post
    FROM (SELECT DISTINCT firma FROM fos.resultados EXCEPT SELECT firma FROM fos.antes) x;
  SELECT count(*), string_agg(firma, ', ') INTO v_ajenas, v_lista
    FROM (SELECT DISTINCT firma FROM fos.resultados EXCEPT SELECT firma FROM fos.antes EXCEPT SELECT firma FROM fos.posteriores) x;
  IF v_desp < 200 OR v_inv <> v_desp OR v_antes + v_post <> v_desp OR v_ajenas > 0 THEN
    RAISE EXCEPTION 'inventario: % funciones antes, % después (% nuevas de migraciones posteriores), % en el catálogo; nuevas sin justificar: %',
      v_antes, v_desp, v_post, v_inv, COALESCE(v_lista, '—');
  END IF;
  IF v_post = 0 THEN
    RAISE NOTICE '✓ la matriz cubre las % funciones SECURITY DEFINER ejecutables por authenticated, antes y después', v_desp;
  ELSE
    RAISE NOTICE '✓ la matriz cubre las % funciones SECURITY DEFINER ejecutables por authenticated (% nuevas de migraciones posteriores a la serie, ejecutadas y juzgadas igual)', v_desp, v_post;
  END IF;
END $$;

-- 1. Sesiones legítimas y de backend: el MISMO resultado en cada función.
DO $$
DECLARE v_actor text; c record; v_n int; v_dif int;
BEGIN
  FOREACH v_actor IN ARRAY ARRAY['OWN_D', 'ADM_D', 'OPE_D', 'VIS_D', 'SA', 'OWN_C', 'OP_C', 'SERVICIO', 'SISTEMA'] LOOP
    SELECT count(*) INTO v_n FROM fos.antes a JOIN fos.resultados d USING (firma, actor) WHERE a.actor = v_actor;
    IF v_n < 200 THEN RAISE EXCEPTION '% · sólo % celdas comparadas', v_actor, v_n; END IF;
    v_dif := 0;
    FOR c IN
      SELECT a.firma, a.resultado AS antes, d.resultado AS despues
        FROM fos.antes a JOIN fos.resultados d USING (firma, actor)
       WHERE a.actor = v_actor AND a.resultado IS DISTINCT FROM d.resultado
       ORDER BY a.firma
    LOOP
      v_dif := v_dif + 1;
      PERFORM fos.falla(format('%s · %s cambió: antes «%s», después «%s»', v_actor, c.firma, left(c.antes, 80), left(c.despues, 80)));
    END LOOP;
    IF v_dif = 0 THEN
      RAISE NOTICE '✓ % · las % funciones responden igual antes y después', v_actor, v_n;
    END IF;
  END LOOP;
END $$;

-- 2. Ninguna sesión de la API sin perfil pasa una guarda que al forastero le cierra.
--    Para CADA función en la que OP_C (operador de OTRA empresa) es denegado, SINAPP
--    y ANON también lo son. CLI también, salvo en las del portal del residente
--    (portal_*): ahí el cliente es el destinatario legítimo y el forastero no.
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT o.firma, x.actor, x.resultado
      FROM fos.resultados o JOIN fos.resultados x ON x.firma = o.firma AND x.actor IN ('SINAPP', 'ANON', 'CLI')
     WHERE o.actor = 'OP_C' AND o.resultado LIKE 'DENEGADO:%'
  LOOP
    v_n := v_n + 1;
    IF r.resultado NOT LIKE 'DENEGADO:%' AND NOT (r.actor = 'CLI' AND r.firma LIKE 'portal\_%') THEN
      PERFORM fos.falla(format('%s · %s no es denegado como el forastero: «%s»', r.actor, r.firma, left(r.resultado, 80)));
    END IF;
  END LOOP;
  RAISE NOTICE '✓ % celdas (función × sesión sin perfil) donde el forastero es denegado: ninguna sesión sin perfil pasa', v_n;
END $$;

-- 3. Y donde el forastero recibe datos o un booleano, la sesión sin perfil no
--    recibe MÁS: el mismo resultado, uno vacío/false/NULL o una denegación. Quedan
--    fuera las funciones que responden por la PROPIA sesión (mis datos, mi rol, mi
--    empresa) y las del portal para el cliente.
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT o.firma, x.actor, o.resultado AS fuera, x.resultado
      FROM fos.resultados o JOIN fos.resultados x ON x.firma = o.firma AND x.actor IN ('SINAPP', 'CLI')
     WHERE o.actor = 'OP_C' AND o.resultado LIKE 'OK:%'
       AND o.firma !~ '^(get_my_|export_my_data|current_user_role|mis_|portal_)'
       AND NOT (x.actor = 'CLI' AND o.firma = 'is_user_cliente_with_id(uuid)')
  LOOP
    v_n := v_n + 1;
    IF r.resultado IS DISTINCT FROM r.fuera
       AND r.resultado NOT LIKE 'DENEGADO:%'
       AND r.resultado NOT IN ('OK:0:d41d8cd98f00b204e9800998ecf8427e',     -- conjunto vacío
                               'OK:1:d41d8cd98f00b204e9800998ecf8427e',     -- NULL
                               'OK:1:68934a3e9455fa72420237eb05902327') THEN -- false
      PERFORM fos.falla(format('%s · %s recibe «%s» y el forastero «%s»', r.actor, r.firma, left(r.resultado, 60), left(r.fuera, 60)));
    END IF;
  END LOOP;
  RAISE NOTICE '✓ % celdas donde el forastero recibe datos: la sesión sin perfil recibe lo mismo o menos', v_n;
END $$;

-- 4. El cliente sólo cambia donde había fuga: en las demás funciones responde
--    igual que antes, o pasa de una denegación a otra.
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN
    SELECT a.firma, a.resultado AS antes, d.resultado AS despues
      FROM fos.antes a JOIN fos.resultados d USING (firma, actor)
     WHERE a.actor = 'CLI' AND a.resultado IS DISTINCT FROM d.resultado
       AND NOT EXISTS (SELECT 1 FROM fos.fugas f WHERE f.firma = a.firma AND f.actor = 'CLI')
  LOOP
    v_n := v_n + 1;
    IF NOT (r.antes LIKE 'DENEGADO:%' AND r.despues LIKE 'DENEGADO:%') THEN
      PERFORM fos.falla(format('CLI · %s cambió fuera de las fugas: antes «%s», después «%s»', r.firma, left(r.antes, 70), left(r.despues, 70)));
    END IF;
  END LOOP;
  RAISE NOTICE '✓ CLI · fuera de sus % fugas, sólo cambia el texto de % denegaciones (denegado antes y después)',
    (SELECT count(*) FROM fos.fugas WHERE actor = 'CLI'), v_n;
END $$;
