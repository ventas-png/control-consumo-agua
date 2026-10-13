\set ON_ERROR_STOP on

-- ============================================================================
-- MATRIZ función × actor — el inventario EJECUTADO, no leído.
--
-- Para CADA función SECURITY DEFINER de public ejecutable por `authenticated` (la lista
-- sale de pg_proc en el momento, no de una copia) se llama con argumentos que apuntan a
-- la empresa D (empresa, proyecto, unidad, cliente y un objeto real de cada tipo: asiento,
-- movimiento bancario, orden, factura, proveedor, solicitud de renta, personal) y se anota
-- el resultado por actor. Cada llamada corre en su propia subtransacción y se deshace.
--
-- Resultado normalizado:
--   DENEGADO:<sqlstate>:<mensaje>   la función se negó (42501 o un «no autorizado»)
--   ERROR:<sqlstate>:<mensaje>      falló por otra cosa (validación, datos, …)
--   OK:<filas>:<md5>                devolvió datos (md5 del resultado ordenado)
-- ============================================================================

CREATE TABLE fos.resultados (firma text NOT NULL, actor text NOT NULL, resultado text NOT NULL, PRIMARY KEY (firma, actor));

-- Literal SQL para un argumento, según su nombre y su tipo.
CREATE FUNCTION fos.valor_arg(p_nombre text, p_tipo text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE n text := lower(COALESCE(p_nombre, ''));
BEGIN
  IF p_tipo = 'uuid' THEN
    RETURN quote_literal(COALESCE(CASE
      WHEN n IN ('p_company', 'p_company_id')         THEN fos.id('D')
      WHEN n IN ('p_project', 'p_project_id')         THEN fos.id('D1')
      WHEN n = 'p_unidad_id'                          THEN fos.id('UNI_D1')
      WHEN n = 'p_cliente_id'                         THEN fos.id('CLI_D')
      WHEN n = 'p_asiento_id'                         THEN fos.id('ASI_D')
      WHEN n = 'p_movimiento_id'                      THEN fos.id('MOV_D')
      WHEN n = 'p_factura_id'                         THEN fos.id('FAC_D')
      WHEN n = 'p_orden_id'                           THEN fos.id('OC_D')
      WHEN n IN ('p_proveedor', 'p_proveedor_id')     THEN fos.id('PROV_D')
      WHEN n = 'p_personal_id'                        THEN fos.id('PER_D')
      WHEN n = 'p_solicitud_id'                       THEN fos.id('SOL_D')
      WHEN n = 'target_user_id'                       THEN fos.id('OPE_D')
    END, 'f05fffff-ffff-ffff-ffff-ffffffffffff'::uuid)::text) || '::uuid';
  ELSIF p_tipo = 'uuid[]' THEN
    IF n = 'p_ids' THEN      -- la cuenta contable de la cuenta bancaria de D (determinista)
      RETURN quote_literal((SELECT ARRAY[cb.cuenta_contable_id]::text FROM public.cuentas_bancarias cb WHERE cb.id = fos.id('CTA_BD'))) || '::uuid[]';
    END IF;
    RETURN '''{}''::uuid[]';
  ELSIF p_tipo = 'text' THEN
    RETURN quote_literal(CASE
      WHEN n = 'p_match_tipo'             THEN 'pago'
      WHEN n = 'p_periodo'                THEN to_char(current_date, 'YYYY-MM')
      WHEN n IN ('p_accion', 'p_action')  THEN 'create'
      WHEN n = 'p_email'                  THEN 'x@fos.test'
      WHEN n = 'p_tipo_aprobado'          THEN 'arrendamiento'
      WHEN n = 'p_etapa'                  THEN 'aprobar'
      WHEN n IN ('p_motivo', 'p_justificacion', 'p_comentario', 'p_resolucion')
                                          THEN 'Motivo de la prueba con suficiente detalle'
      ELSE 'x'
    END) || '::text';
  ELSIF p_tipo = 'text[]' THEN RETURN '''{}''::text[]';
  ELSIF p_tipo = 'date' THEN RETURN 'current_date';
  ELSIF p_tipo = 'integer' THEN RETURN CASE WHEN n = 'p_anio' THEN 'extract(year from current_date)::int' ELSE '1' END;
  ELSIF p_tipo = 'numeric' THEN RETURN '1::numeric';
  ELSIF p_tipo = 'boolean' THEN RETURN CASE WHEN n = 'p_dry_run' THEN 'true' ELSE 'false' END;
  ELSIF p_tipo = 'jsonb' THEN RETURN CASE WHEN n IN ('p_consumos', 'p_documentos', 'p_filas', 'p_responsables') THEN '''[]''::jsonb' ELSE '''{}''::jsonb' END;
  ELSIF p_tipo = 'time without time zone' THEN RETURN '''10:00''::time';
  ELSIF p_tipo = 'interval' THEN RETURN '''1 day''::interval';
  END IF;
  RETURN 'NULL::' || p_tipo;
END $$;

-- La llamada completa: SELECT sobre la función como fuente, para que valga igual para escalares, void y SETOF.
-- El texto de cada fila se NORMALIZA antes del md5: uuids y marcas de tiempo nuevas (ids
-- generados, now()) cambian en cada corrida y no son lo que se compara.
CREATE FUNCTION fos.normalizar(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(p,
           '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g'),
           '[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}(:[0-9]{2})?)?', '<ts>', 'g')
$$;

CREATE FUNCTION fos.llamada(p_oid oid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('SELECT count(*)::text || '':'' || md5(COALESCE(string_agg(fos.normalizar(t::text), E''\x1e'' ORDER BY fos.normalizar(t::text)), '''')) FROM %s(%s) AS t',
                p_oid::regproc,
                COALESCE((SELECT string_agg(fos.valor_arg(a.nombre, a.tipo), ', ' ORDER BY a.i)
                            FROM unnest(COALESCE(p.proargnames[1:p.pronargs], array_fill(NULL::text, ARRAY[p.pronargs])),
                                        string_to_array(oidvectortypes(p.proargtypes), ', '))
                                 WITH ORDINALITY AS a(nombre, tipo, i)), ''))
    FROM pg_proc p WHERE p.oid = p_oid
$$;

-- Las funciones del inventario: SECURITY DEFINER, de public, ejecutables por authenticated, no triggers.
CREATE FUNCTION fos.inventario() RETURNS TABLE (oid oid, firma text) LANGUAGE sql STABLE AS $$
  SELECT p.oid, p.oid::regprocedure::text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prokind = 'f'
     AND p.prorettype <> 'trigger'::regtype
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
   ORDER BY 2
$$;

-- Normaliza un error: «denegado» es 42501 o un mensaje de autorización.
CREATE FUNCTION fos.clase_error(p_estado text, p_msg text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_estado = '42501' OR p_msg ~* '(no autorizad|not authori[sz]ed|sin permiso|permission denied|no tienes permiso|acceso denegado|forbidden)'
              THEN 'DENEGADO:' ELSE 'ERROR:' END
         || p_estado || ':' || left(regexp_replace(p_msg, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g'), 160)
$$;

CREATE FUNCTION fos.correr(p_actores text[]) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE f record; a text; v_sql text; v_res text; v_n bigint := 0;
BEGIN
  FOR f IN SELECT * FROM fos.inventario() LOOP
    v_sql := fos.llamada(f.oid);
    FOREACH a IN ARRAY p_actores LOOP
      BEGIN
        PERFORM fos.poner_actor(a);
        EXECUTE v_sql INTO v_res;
        v_res := 'OK:' || v_res;
        RAISE EXCEPTION USING ERRCODE = 'FOS00', MESSAGE = v_res;      -- deshace lo que la función escribió
      EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'FOS00' THEN v_res := SQLERRM; ELSE v_res := fos.clase_error(SQLSTATE, SQLERRM); END IF;
      END;
      INSERT INTO fos.resultados VALUES (f.firma, a, v_res)
        ON CONFLICT (firma, actor) DO UPDATE SET resultado = EXCLUDED.resultado;
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;
