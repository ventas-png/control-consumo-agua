-- ════════════════════════════════════════════════════════════════════════════
-- DEP-2 · La búsqueda de números de factura equivalentes debe resolverse por el
--         índice que 20261027000400 creó para ella (idx_facturas_prov_numero_norm).
--
-- CAUSA RAÍZ. El índice es parcial (WHERE numero_factura IS NOT NULL AND estado <>
--   'anulada'); la consulta del trigger compras_tg_factura_numero_equivalente no incluye
--   «numero_factura IS NOT NULL» y compras_normalizar_numero no es STRICT, así que el
--   planificador no puede probar que el predicado del índice se cumple y NUNCA lo usa:
--   cada alta recorre las facturas del proveedor (Seq Scan / Index Scan de proveedor +
--   filtro). Con 20 000 facturas de un proveedor: ~60 ms por alta (100 altas ≈ 6 s).
--
-- COMPORTAMIENTO ESPERADO. Con 20 000 facturas de un mismo proveedor:
--   a) la consulta que ejecuta el trigger (extraída de su cuerpo vigente) usa el índice
--      idx_facturas_prov_numero_norm, con plan específico y con plan genérico;
--   b) 100 altas de factura no tardan más de 1 s (con el defecto: ~6 s);
--   c) esas altas SÍ leen el índice (idx_scan crece);
--   d) el control sigue funcionando igual: el equivalente se rechaza, lo distinto, lo
--      anulado y el otro proveedor pasan; y el índice sigue siendo el mismo (parcial, válido).
--
-- Se ejecuta con:  psql -X -v ON_ERROR_STOP=1 -d <BD> -f DEP-2.sql   (como superusuario, sobre
-- una copia de hall_tpl). Toda su escritura va dentro de BEGIN … ROLLBACK: no deja residuo.
-- IDs propios: fa9NNNNN-0000-0000-0000-0000000000XX.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set PB  '''fa900000-0000-0000-0000-0000000000b1'''
\set PB2 '''fa900000-0000-0000-0000-0000000000b2'''

-- Contador de lecturas del índice ANTES de empezar (las estadísticas de índice no se revierten).
SELECT pg_stat_clear_snapshot();
SELECT COALESCE(idx_scan, 0) AS idx_antes FROM pg_stat_user_indexes WHERE indexrelname = 'idx_facturas_prov_numero_norm' \gset

BEGIN;

-- Ayuda: el plan de la consulta del trigger, EXTRAÍDA de su cuerpo vigente (no copiada aquí:
-- si alguien la cambia, la prueba mira la nueva). 'custom' = valores literales; 'generic' =
-- plan genérico con parámetros (lo que plpgsql usa a partir de la 6.ª ejecución).
CREATE FUNCTION public.hx9_plan_trigger(p_modo text, p_company uuid, p_prov uuid, p_nuevo text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_src  text;
  v_m    text[];
  v_q    text;
  v_plan text;
  v_norm text := public.compras_normalizar_numero(p_nuevo);
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.compras_tg_factura_numero_equivalente'::regproc;
  v_m := regexp_match(v_src, '(?s)(SELECT\s.*?)\s+INTO\s+v_dup\s(.*?LIMIT\s+1)');
  IF v_m IS NULL THEN
    RAISE EXCEPTION '[DEP-2] no se pudo extraer la consulta del trigger de su cuerpo (cambió su forma): ajusta esta ayuda';
  END IF;
  v_q := v_m[1] || ' ' || v_m[2];
  IF p_modo = 'custom' THEN
    v_q := replace(v_q, 'NEW.company_id',     quote_literal(p_company) || '::uuid');
    v_q := replace(v_q, 'NEW.proveedor_id',   quote_literal(p_prov)    || '::uuid');
    v_q := replace(v_q, 'NEW.id',              quote_literal(gen_random_uuid()) || '::uuid');
    v_q := replace(v_q, 'NEW.numero_factura',  quote_literal(p_nuevo));
    v_q := replace(v_q, 'v_norm',              quote_literal(v_norm));
    EXECUTE 'EXPLAIN (FORMAT JSON) ' || v_q INTO v_plan;
  ELSE
    v_q := replace(v_q, 'NEW.company_id',     '$1');
    v_q := replace(v_q, 'NEW.proveedor_id',   '$2');
    v_q := replace(v_q, 'NEW.id',              '$3');
    v_q := replace(v_q, 'NEW.numero_factura',  '$4');
    v_q := replace(v_q, 'v_norm',              '$5');
    EXECUTE 'PREPARE hx9_q(uuid, uuid, uuid, text, text) AS ' || v_q;
    SET LOCAL plan_cache_mode = force_generic_plan;
    EXECUTE format('EXPLAIN (FORMAT JSON) EXECUTE hx9_q(%L, %L, %L, %L, %L)',
                   p_company, p_prov, gen_random_uuid(), p_nuevo, v_norm) INTO v_plan;
    DEALLOCATE hx9_q;
    RESET plan_cache_mode;
  END IF;
  RETURN v_plan;
END;
$$;

-- ── Montaje: un proveedor con 20 000 facturas históricas (sin disparar triggers: es carga masiva) ──
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  (:PB,  :C::uuid, 'Proveedor grande DEP-2',  '9900001-1', 'GT', 'empresa'),
  (:PB2, :C::uuid, 'Proveedor chico DEP-2',   '9900002-2', 'GT', 'empresa');
SET LOCAL session_replication_role = replica;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado)
SELECT ('fa9' || lpad(to_hex(g), 5, '0') || '-0000-0000-0000-0000000000b1')::uuid,
       :C::uuid, :C1::uuid, :PB::uuid,
       'H-' || lpad(g::text, 7, '0'), 'histórica', 10 + (g % 100),
       CASE WHEN g % 50 = 0 THEN 'anulada' ELSE 'aprobada' END
  FROM generate_series(1, 20000) g;
SET LOCAL session_replication_role = origin;
ANALYZE public.facturas_proveedor;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = :PB::uuid), 20000,
  '[DEP-2·montaje] el proveedor tiene 20 000 facturas históricas');

-- ── a) La consulta del trigger usa el índice (plan específico y plan genérico) ──────────────────
CREATE TEMP TABLE hx9_planes AS
SELECT public.hx9_plan_trigger('custom',  :C::uuid, :PB::uuid, 'NUEVA-1') AS especifico,
       public.hx9_plan_trigger('generic', :C::uuid, :PB::uuid, 'NUEVA-1') AS generico;

SELECT public.chk_bool(position('idx_facturas_prov_numero_norm' in especifico) > 0, true,
  '[DEP-2a] la consulta del trigger (plan específico) usa idx_facturas_prov_numero_norm') FROM hx9_planes;
SELECT public.chk_bool(position('Seq Scan' in especifico) = 0 AND position('idx_facturas_prov_proveedor' in especifico) = 0, true,
  '[DEP-2a] …y no recorre las facturas del proveedor (ni Seq Scan ni idx_facturas_prov_proveedor)') FROM hx9_planes;
SELECT public.chk_bool(position('idx_facturas_prov_numero_norm' in generico) > 0, true,
  '[DEP-2a] la consulta del trigger (plan genérico) usa idx_facturas_prov_numero_norm') FROM hx9_planes;
SELECT public.chk_bool(position('Seq Scan' in generico) = 0 AND position('idx_facturas_prov_proveedor' in generico) = 0, true,
  '[DEP-2a] …el plan genérico tampoco recorre las facturas del proveedor') FROM hx9_planes;

-- ── b) 100 altas de factura, por los triggers reales, en menos de 1 s ───────────────────────────
DO $$
DECLARE
  t0 timestamptz := clock_timestamp();
  v_ms numeric;
BEGIN
  FOR i IN 1..100 LOOP
    INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (('fa9' || lpad(to_hex(100000 + i), 5, '0') || '-0000-0000-0000-0000000000b1')::uuid,
            'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
            'fa900000-0000-0000-0000-0000000000b1', 'NUEVA-' || i, 'alta nueva', 10);
  END LOOP;
  v_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  PERFORM set_config('hx9.ms', v_ms::text, true);
  RAISE NOTICE '  · 100 altas con 20 000 facturas del proveedor: % ms (% ms por alta)', v_ms, round(v_ms / 100, 2);
END $$;
SELECT public.chk_bool(current_setting('hx9.ms')::numeric < 1000, true,
  '[DEP-2b] 100 altas de factura con 20 000 del mismo proveedor tardan menos de 1 s (con el defecto: ≈ 6 s)');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = :PB::uuid AND numero_factura LIKE 'NUEVA-%'), 100,
  '[DEP-2b] las 100 altas quedaron registradas');
-- Pide que las estadísticas de esta sesión se vuelquen al terminar la transacción (para c).
SELECT pg_stat_force_next_flush();

-- ── d) El control sigue funcionando a esta escala (usuario administrador, como PostgREST) ──────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','fa900000-0000-0000-0000-0000000000b1','h 0000007','misma',10) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[DEP-2d] «h 0000007» equivale a «H-0000007» (histórica): se rechaza, con 20 000 facturas');
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','fa900000-0000-0000-0000-0000000000b1','H-0000007','misma',10) $$,
  'uq_facturas_prov_numero', '[DEP-2d] el número idéntico lo sigue rechazando el índice único de siempre');
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','fa900000-0000-0000-0000-0000000000b1','nueva 1','misma que NUEVA-1',10) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[DEP-2d] «nueva 1» equivale a «NUEVA-1» (alta de esta misma prueba)');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa9f0001-0000-0000-0000-0000000000c1', :C::uuid, :C1::uuid, :PB::uuid, 'H-9999999', 'número jamás usado', 10);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa9f0001-0000-0000-0000-0000000000c2', :C::uuid, :C1::uuid, :PB::uuid, 'h 0000050', 'equivale a una ANULADA: se puede reutilizar', 10);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa9f0001-0000-0000-0000-0000000000c3', :C::uuid, :C1::uuid, :PB2::uuid, 'h 0000007', 'otro proveedor: mismo número, no choca', 10);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa9f0001-0000-0000-0000-0000000000c4', :C::uuid, :C1::uuid, :PB::uuid, NULL, 'sin número: no se compara', 10);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
VALUES ('fa9f0001-0000-0000-0000-0000000000c5', :C::uuid, :C1::uuid, :PB::uuid, NULL, 'otra sin número', 10);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = 'h0000008' WHERE id = 'fa9f0001-0000-0000-0000-0000000000c1' $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[DEP-2d] cambiar el número de una factura a uno equivalente también se rechaza');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fa9f0001-%'), 5,
  '[DEP-2d] los casos legítimos (nuevo, equivalente de una anulada, otro proveedor, sin número ×2) se registraron');

-- ── e) El índice sigue siendo el mismo (no se "arregló" quitándolo ni cambiando su predicado) ───
SELECT public.chk_bool(
  (SELECT i.indisvalid AND i.indisready
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'idx_facturas_prov_numero_norm'), true,
  '[DEP-2e] idx_facturas_prov_numero_norm existe y es válido');
SELECT public.chk_bool(
  (SELECT pg_get_indexdef(c.oid) LIKE '%compras_normalizar_numero(numero_factura)%'
      AND pg_get_indexdef(c.oid) LIKE '%numero_factura IS NOT NULL%'
      AND pg_get_indexdef(c.oid) LIKE '%estado <> ''anulada''%'
     FROM pg_class c WHERE c.relname = 'idx_facturas_prov_numero_norm'), true,
  '[DEP-2e] …y conserva su expresión y su predicado parcial');

ROLLBACK;

-- ── c) Esas altas LEYERON el índice (las estadísticas de índice sobreviven al ROLLBACK) ─────────
SELECT pg_stat_clear_snapshot();
SELECT public.chk_bool(
  (SELECT COALESCE(idx_scan, 0) FROM pg_stat_user_indexes WHERE indexrelname = 'idx_facturas_prov_numero_norm') - :idx_antes >= 100,
  true,
  '[DEP-2c] las altas de factura leyeron idx_facturas_prov_numero_norm (idx_scan creció en ≥ 100)');
-- El montaje se revirtió entero. Se cuentan los ids con la FORMA EXACTA de esta prueba (fa9 + 5 hex + '-0000-0000-0000-0000000000' + 2 hex):
-- el filtro anterior, LIKE 'fa9%', también contaba cualquier factura de otra suite con id aleatorio (gen_random_uuid(), versión 4) que
-- empezara por «fa9» (1 de cada 4096) y ponía roja la prueba sin que ella dejara nada. Un id v4 nunca tiene «0000» en el 3.er grupo, así que
-- no coincide con esta forma; cualquier residuo de ESTA prueba (b1, b2, c1…c5…) sí.
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fa9_____-0000-0000-0000-0000000000__'), 0,
  '[DEP-2·limpieza] la prueba no deja residuo');
