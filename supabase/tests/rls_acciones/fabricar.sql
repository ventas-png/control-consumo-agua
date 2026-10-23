-- ============================================================================
-- FÁBRICA DE FILAS para el arnés «rls_acciones».
--
-- El arnés prueba crear, editar y borrar en DECENAS de tablas. Escribir a mano
-- un padrón válido para cada una no escala y, peor, se desfasa en silencio
-- cuando una tabla gana una columna obligatoria. Esto lo deriva del CATÁLOGO:
--
--   · columnas NOT NULL sin default (y company_id / project_id / unidad_id,
--     aunque admitan NULL: sin ellas ninguna policy por empresa pasa);
--   · FK de una columna → el padre se FABRICA también (recursivo, profundidad
--     acotada), salvo los padres del padrón: empresa, proyecto, unidad,
--     usuario, cliente. Se reutiliza, salvo cuando la columna integra una
--     clave ÚNICA de la fila que se prueba (un voto por votación y unidad):
--     entonces cada alta lleva su padre propio, o chocaría con la anterior;
--   · CHECK de enumeración sobre la columna (= ANY (ARRAY[...]) / IN (...))
--     → el primer literal permitido;
--   · el resto, por tipo.
--
-- Lo que NO hace: adivinar reglas de negocio de triggers. Si la fila fabricada
-- no entra ni siquiera como superusuario, el arnés NO prueba esa tabla con
-- filas y lo dice (la cubren las comprobaciones de forma de las policies).
--
-- Se carga sobre la cadena REAL de migraciones. Vive en el esquema «ra».
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA ra;
GRANT USAGE ON SCHEMA ra TO PUBLIC;

-- Padrón: alias → id (empresa A/B, proyecto A1/B1, unidad, usuarios, cliente).
CREATE TABLE ra.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON ra.ids TO PUBLIC;
CREATE FUNCTION ra.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM ra.ids WHERE alias = p_alias $$;

-- Recetas del mapa (`receta` de cada tabla): valor SQL para una columna, cuando
-- una regla de negocio no la cumple con el valor por tipo (CHECK hora_fin >
-- hora_inicio; un trigger que exige un proveedor del catálogo en una columna
-- opcional). Una columna con receta se incluye siempre. Se EVALÚA al fabricar
-- —como el admin de la empresa, igual que los padres— y la sentencia lleva el
-- resultado como literal: así puede fabricar un padre (ra.padre) que la
-- persona de la prueba no podría.
-- `variante`: la receta de una rama del mapa (`ramas`); sus columnas mandan
-- sobre las de la tabla, y sólo en la fila de esa rama (no en sus padres).
CREATE TABLE ra.recetas (tabla regclass, variante text NOT NULL DEFAULT '', col text, valor text NOT NULL, PRIMARY KEY (tabla, variante, col));

-- Padres ya fabricados, por tabla y empresa: una FK los reutiliza.
CREATE TABLE ra.padres (tabla regclass, empresa uuid, fila jsonb NOT NULL, PRIMARY KEY (tabla, empresa));

-- Primer literal de un CHECK de enumeración que mencione SOLO a la columna.
CREATE FUNCTION ra.literal_check(p_tabla regclass, p_col text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_def text;
  v_m   text[];
BEGIN
  FOR v_def IN
    SELECT pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    WHERE c.conrelid = p_tabla AND c.contype = 'c'
      AND array_length(c.conkey, 1) = 1
      AND c.conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = p_tabla AND attname = p_col)
  LOOP
    v_m := regexp_match(v_def, 'ARRAY\[''((?:[^'']|'''')*)''');
    IF v_m IS NOT NULL THEN RETURN quote_literal(replace(v_m[1], '''''', '''')); END IF;
    v_m := regexp_match(v_def, '= ''((?:[^'']|'''')*)''');
    IF v_m IS NOT NULL THEN RETURN quote_literal(replace(v_m[1], '''''', '''')); END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ¿Tiene la columna algún CHECK propio? (para no usar un número al azar)
CREATE FUNCTION ra.tiene_check(p_tabla regclass, p_col text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = p_tabla AND c.contype = 'c'
      AND (SELECT attnum FROM pg_attribute WHERE attrelid = p_tabla AND attname = p_col) = ANY (c.conkey))
$$;

CREATE FUNCTION ra.valor_por_tipo(p_tabla regclass, p_col text, p_tipo oid) RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_t   pg_type%ROWTYPE;
  v_lit text := ra.literal_check(p_tabla, p_col);
BEGIN
  SELECT * INTO v_t FROM pg_type WHERE oid = p_tipo;
  IF v_lit IS NOT NULL THEN RETURN v_lit || '::' || format_type(p_tipo, NULL); END IF;
  IF v_t.typtype = 'e' THEN
    RETURN quote_literal((SELECT enumlabel FROM pg_enum WHERE enumtypid = p_tipo ORDER BY enumsortorder LIMIT 1)) || '::' || format_type(p_tipo, NULL);
  END IF;
  IF v_t.typtype = 'd' THEN
    RETURN ra.valor_por_tipo(p_tabla, p_col, v_t.typbasetype);
  END IF;
  IF v_t.typcategory = 'A' THEN RETURN '''{}''::' || format_type(p_tipo, NULL); END IF;
  RETURN CASE
    WHEN v_t.typname IN ('text', 'varchar', 'bpchar', 'citext') THEN
      quote_literal('rla-' || substr(md5(random()::text), 1, 8))
    WHEN v_t.typname IN ('int2', 'int4', 'int8') THEN
      CASE WHEN ra.tiene_check(p_tabla, p_col) THEN '1' ELSE ((random() * 1000000)::int + 1)::text END
    WHEN v_t.typname IN ('numeric', 'float4', 'float8', 'money') THEN '1'
    WHEN v_t.typname = 'bool' THEN 'false'
    WHEN v_t.typname = 'date' THEN 'CURRENT_DATE'
    WHEN v_t.typname IN ('timestamptz', 'timestamp') THEN 'now()'
    WHEN v_t.typname IN ('time', 'timetz') THEN '''08:00'''
    WHEN v_t.typname = 'interval' THEN '''1 hour'''
    WHEN v_t.typname = 'uuid' THEN 'gen_random_uuid()'
    WHEN v_t.typname IN ('jsonb', 'json') THEN '''{}''::' || v_t.typname
    WHEN v_t.typname = 'inet' THEN '''127.0.0.1'''
    ELSE NULL
  END;
END;
$$;

-- Padres del padrón por tabla referenciada (no se fabrican).
CREATE FUNCTION ra.padre_del_padron(p_ref regclass, p_empresa uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE p_ref::text
    WHEN 'companies'       THEN p_empresa
    WHEN 'projects'        THEN ra.id(CASE WHEN p_empresa = ra.id('B') THEN 'B1' ELSE 'A1' END)
    WHEN 'unidades'        THEN ra.id(CASE WHEN p_empresa = ra.id('B') THEN 'UB' ELSE 'UA' END)
    WHEN 'app_users'       THEN ra.id(CASE WHEN p_empresa = ra.id('B') THEN 'ADMB' ELSE 'ADM' END)
    WHEN 'auth.users'      THEN ra.id(CASE WHEN p_empresa = ra.id('B') THEN 'ADMB' ELSE 'ADM' END)
    WHEN 'clientes'        THEN ra.id('CLI')
    ELSE NULL
  END
$$;

-- La sentencia INSERT de una fila válida de `p_tabla` en la empresa dada (la
-- de la rama `p_variante`, si se pide). Crea (y deja confirmados) los padres
-- que haga falta. NULL si no sabe.
CREATE FUNCTION ra.sql_alta(p_tabla regclass, p_empresa uuid, p_prof int DEFAULT 0, p_variante text DEFAULT '')
RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_col   record;
  v_cols  text[] := '{}';
  v_vals  text[] := '{}';
  v_val   text;
  v_ref   regclass;
  v_refc  text;
  v_padre jsonb;
BEGIN
  IF p_prof > 4 THEN RETURN NULL; END IF;
  FOR v_col IN
    SELECT a.attname, a.atttypid, a.attnotnull, a.attidentity, a.attgenerated,
           (d.adbin IS NOT NULL) AS tiene_default
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = p_tabla AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  LOOP
    CONTINUE WHEN v_col.attidentity <> '' OR v_col.attgenerated <> '';
    v_val := (SELECT valor FROM ra.recetas WHERE tabla = p_tabla AND col = v_col.attname AND variante IN ('', p_variante)
              ORDER BY variante DESC LIMIT 1);
    CONTINUE WHEN v_val IS NULL AND NOT (
      (v_col.attnotnull AND NOT v_col.tiene_default)
      OR v_col.attname IN ('company_id', 'project_id', 'unidad_id'));
    IF v_val IS NOT NULL THEN
      EXECUTE format('SELECT (%s)::text', v_val) INTO v_val;
      v_val := quote_nullable(v_val) || '::' || format_type(v_col.atttypid, NULL);
    END IF;

    -- FK de una sola columna
    SELECT c.confrelid::regclass, (SELECT attname FROM pg_attribute WHERE attrelid = c.confrelid AND attnum = c.confkey[1])
      INTO v_ref, v_refc
    FROM pg_constraint c
    WHERE c.conrelid = p_tabla AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
      AND c.conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = p_tabla AND attname = v_col.attname)
    LIMIT 1;

    IF v_val IS NOT NULL THEN
      NULL;   -- receta del mapa
    ELSIF v_col.attname = 'company_id' THEN
      v_val := quote_literal(p_empresa) || '::uuid';
    ELSIF v_ref IS NOT NULL THEN
      IF ra.padre_del_padron(v_ref, p_empresa) IS NOT NULL THEN
        v_val := quote_literal(ra.padre_del_padron(v_ref, p_empresa)) || '::uuid';
      ELSE
        v_padre := ra.padre(v_ref, p_empresa, p_prof + 1, p_prof = 0 AND EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = p_tabla AND i.indisunique AND NOT i.indisprimary
            AND (SELECT attnum FROM pg_attribute WHERE attrelid = p_tabla AND attname = v_col.attname) = ANY (i.indkey)));
        IF v_padre IS NULL THEN RETURN NULL; END IF;
        v_val := quote_literal(v_padre ->> v_refc) || '::' || format_type(v_col.atttypid, NULL);
      END IF;
    ELSIF v_col.attname = 'project_id' THEN
      v_val := quote_literal(ra.padre_del_padron('projects', p_empresa)) || '::uuid';
    ELSIF v_col.attname = 'unidad_id' THEN
      v_val := quote_literal(ra.padre_del_padron('unidades', p_empresa)) || '::uuid';
    ELSE
      v_val := ra.valor_por_tipo(p_tabla, v_col.attname, v_col.atttypid);
    END IF;

    IF v_val IS NULL THEN
      CONTINUE WHEN NOT v_col.attnotnull;   -- opcional sin valor: se omite
      RETURN NULL;
    END IF;
    v_cols := v_cols || quote_ident(v_col.attname);
    v_vals := v_vals || v_val;
  END LOOP;
  RETURN format('INSERT INTO %s (%s) VALUES (%s)', p_tabla, array_to_string(v_cols, ', '), array_to_string(v_vals, ', '));
END;
$$;

-- Un padre de `p_ref` en la empresa: el ya fabricado, o uno nuevo (confirmado).
-- `p_propio`: siempre uno nuevo, que no se guarda para reutilizar.
CREATE FUNCTION ra.padre(p_ref regclass, p_empresa uuid, p_prof int, p_propio boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_sql  text;
  v_fila jsonb;
BEGIN
  IF NOT p_propio THEN
    SELECT fila INTO v_fila FROM ra.padres WHERE tabla = p_ref AND empresa = p_empresa;
    IF v_fila IS NOT NULL THEN RETURN v_fila; END IF;
  END IF;
  v_sql := ra.sql_alta(p_ref, p_empresa, p_prof);
  IF v_sql IS NULL THEN RETURN NULL; END IF;
  BEGIN
    EXECUTE v_sql || ' RETURNING to_jsonb(' || p_ref::text || '.*)' INTO v_fila;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF NOT p_propio THEN INSERT INTO ra.padres VALUES (p_ref, p_empresa, v_fila); END IF;
  RETURN v_fila;
END;
$$;

-- Las columnas de la clave primaria, como `col = valor AND …` para una fila.
CREATE FUNCTION ra.donde(p_tabla regclass, p_fila jsonb) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(format('%I = %L::%s', a.attname, p_fila ->> a.attname, format_type(a.atttypid, NULL)), ' AND ')
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
  WHERE i.indrelid = p_tabla AND i.indisprimary
$$;

-- Una columna «inocua» para el UPDATE de prueba: SET col = col.
CREATE FUNCTION ra.columna_editable(p_tabla regclass) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT a.attname
  FROM pg_attribute a
  WHERE a.attrelid = p_tabla AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attidentity = '' AND a.attgenerated = ''
    AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = p_tabla AND i.indisprimary AND a.attnum = ANY (i.indkey))
  ORDER BY (a.attname IN ('created_at', 'updated_at')) DESC, a.attnum
  LIMIT 1
$$;

-- ¿Afecta la sentencia a alguna fila, ejecutada con la identidad y el rol de la
-- sesión? Se DESHACE siempre. 42501 (WITH CHECK / RLS) → 'rls'; 0 filas → 'rls';
-- ≥1 fila → 'ok'; cualquier otro error → 'error:<sqlstate> <mensaje>'.
CREATE FUNCTION ra.intento(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'RA000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'RA000' THEN RETURN CASE WHEN n > 0 THEN 'ok' ELSE 'rls' END;
    WHEN insufficient_privilege THEN RETURN 'rls';
    WHEN OTHERS THEN RETURN 'error:' || SQLSTATE || ' ' || left(SQLERRM, 160);
  END;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ra TO PUBLIC;
GRANT SELECT ON ra.padres TO PUBLIC;
