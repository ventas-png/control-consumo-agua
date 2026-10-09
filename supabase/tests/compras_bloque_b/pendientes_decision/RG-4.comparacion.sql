-- RG-4 · MATRIZ DE COMPARACIÓN de alternativas. Se corre sobre cada base (una por alternativa) y mide,
-- con el trigger REAL de esa base, qué pares de números se bloquean y cuáles pasan.
--   psql -X -At -v ON_ERROR_STOP=1 -v modo=sin -d <BD> -f RG-4_comparacion.sql
--   modo=sin  → el segundo alta NO lleva justificación (lo que ve quien solo registra)
--   modo=con  → lleva justificación («es otra factura, serie distinta») y la sesión es la del administrador UA
--               (solo tiene sentido en las alternativas con columna numero_equivalente_justificacion)
-- Cada par se prueba en una subtransacción que se deshace: no deja residuo.
\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub', 'c0c0c0c0-0000-0000-0000-00000000000a', false);

CREATE FUNCTION pg_temp.probar(p_n1 text, p_n2 text, p_con boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r text;
  v_marca uuid;
  v_aud   uuid;
  v_id1 uuid := 'fa9fa001-0000-0000-0000-0000000000f1';
  v_id2 uuid := 'fa9fa002-0000-0000-0000-0000000000f1';
  v_tiene_just boolean := EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_schema='public' AND table_name='facturas_proveedor' AND column_name='numero_equivalente_justificacion');
  v_tiene_de   boolean := EXISTS (SELECT 1 FROM information_schema.columns
                                   WHERE table_schema='public' AND table_name='facturas_proveedor' AND column_name='numero_equivalente_de');
BEGIN
  BEGIN
    INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (v_id1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', p_n1, 'matriz', 10);
    BEGIN
      IF p_con AND v_tiene_just THEN
        EXECUTE 'INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, numero_equivalente_justificacion)
                 VALUES ($1, ''cccccccc-cccc-cccc-cccc-cccccccccccc'', ''c1c1c1c1-0000-0000-0000-000000000001'', ''e3000000-0000-0000-0000-000000000001'', $2, ''matriz'', 10, ''es otra factura: serie distinta'')'
          USING v_id2, p_n2;
      ELSE
        INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
        VALUES (v_id2, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', p_n2, 'matriz', 10);
      END IF;
      IF v_tiene_de THEN
        EXECUTE 'SELECT numero_equivalente_de FROM public.facturas_proveedor WHERE id = $1' INTO v_marca USING v_id2;
      END IF;
      r := CASE WHEN v_marca IS NOT NULL THEN 'PASA·marcada' ELSE 'PASA' END;
    EXCEPTION WHEN OTHERS THEN
      r := CASE WHEN SQLERRM LIKE 'COMPRAS_FACTURA_NUMERO_DUPLICADO%' THEN 'BLOQUEA' ELSE 'ERROR ' || left(SQLERRM, 50) END;
    END;
    RAISE EXCEPTION 'deshacer' USING ERRCODE = 'XX999';
  EXCEPTION WHEN SQLSTATE 'XX999' THEN NULL;
  END;
  RETURN r;
END $$;

CREATE TEMP TABLE casos (id text, cat text, n1 text, n2 text, nota text);
INSERT INTO casos VALUES
 ('D01','dup','FAC-001','fac-001','mayúsculas'),
 ('D02','dup','FAC-001',' FAC 001 ','espacios'),
 ('D03','dup','FAC-001','FAC001','sin separador'),
 ('D04','dup','FAC-001','FAC.001','punto'),
 ('D05','dup','FAC-001','FAC/001','barra'),
 ('D06','dup','FAC-001','FAC_001','guion bajo'),
 ('D07','dup','001-0000123','0010000123','sin separador, largo'),
 ('D08','dup','A-12','A12','sin separador, corto'),
 ('D09','dup','F-1234','f 1234','mayúsc.+espacio'),
 ('D10','dup','FAC-001',E'FAC–001','raya larga (pegado de PDF)'),
 ('L01','distinta','1-23','12-3','hallazgo'),
 ('L02','distinta','A-12','A1-2','hallazgo'),
 ('L03','distinta','001-1234','0011-234','serie de 3 vs 4'),
 ('L04','distinta','B-100','B1-00','serie B vs B1'),
 ('L05','distinta','2-345','23-45','serie 2 vs 23'),
 ('M01','ambiguo','1-23','123','con separador vs sin'),
 ('M02','ambiguo','A-12','A-1-2','un separador de más'),
 ('M03','ambiguo','1-2-3','12-3','dos separadores vs uno'),
 ('M04','ambiguo','FAC-001','FA-C001','separador corrido (probable error de captura)'),
 ('M05','ambiguo','1.234','12.34','miles distintos');

\if :{?modo}
\else
\set modo sin
\endif
SELECT format('%-4s %-9s %-13s %-13s %-14s %s', id, cat, '«' || n1 || '»', '«' || n2 || '»',
              pg_temp.probar(n1, n2, :'modo' = 'con'), nota)
  FROM casos ORDER BY id;
SELECT format('RESUMEN dup_bloqueados=%s/10 distintas_pasan=%s/5 ambiguos_bloqueados=%s/5',
   count(*) FILTER (WHERE cat='dup'      AND r = 'BLOQUEA'),
   count(*) FILTER (WHERE cat='distinta' AND r LIKE 'PASA%'),
   count(*) FILTER (WHERE cat='ambiguo'  AND r = 'BLOQUEA'))
  FROM (SELECT cat, pg_temp.probar(n1, n2, :'modo' = 'con') AS r FROM casos) z;
