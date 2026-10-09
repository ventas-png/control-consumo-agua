-- ════════════════════════════════════════════════════════════════════════════
-- [RG-4] PROTOTIPO · PENDIENTE DE DECISIÓN DEL DUEÑO (alternativa A: «equivalencia que
--        respeta el separador entre serie y correlativo»).
--
-- DEFECTO. compras_normalizar_numero borra todo lo que no es A-Z0-9, así que dos números
--   válidos y DISTINTOS que concatenan igual («1-23» y «12-3»; «A-12» y «A1-2») se rechazan
--   como duplicado, sin salida alguna (ni siquiera para un administrador).
--
-- QUÉ HACE ESTA ALTERNATIVA. Dos números son «el mismo» (se rechaza el segundo) si tienen la
--   misma clave alfanumérica (la de 0400, la que indexa idx_facturas_prov_numero_norm) Y sus
--   separadores son COMPATIBLES. Perfil de separadores = en qué posiciones de la clave hay un
--   separador entre dos caracteres alfanuméricos («1-23» → {1}; «12-3» → {2}; «FAC-001» →
--   {3}; «FAC001» → {}; « FAC 001 » → {3}: los separadores de los extremos no cuentan ni el
--   tipo de separador: guion, punto, espacio, barra). Compatibles = el perfil de uno está
--   incluido en el del otro (iguales, o uno sin separadores). Se tratan como DISTINTOS solo
--   cuando AMBOS traen separadores y ninguno incluye al otro:
--       «1-23» / «12-3»      → distintos (se registran las dos)     ← el falso positivo del RG-4
--       «A-12» / «A1-2»      → distintos
--       «FAC-001» / «fac-001» / « FAC 001 » / «FAC.001» / «FAC001» → el mismo (se rechaza)
--       «1-23» / «123»       → ambiguo: se sigue rechazando (conservador, igual que 0400)
--   La clave de índice no cambia (no hay REINDEX); el perfil se evalúa solo sobre los pocos
--   candidatos que el índice devuelve.
--
-- NO ES DEFINITIVO. Qué cuenta como «la misma factura» es una decisión de negocio (ver
--   notas del informe: alternativas B —excepción con motivo auditado— y C —avisar sin
--   bloquear—). Este archivo solo prototipa la A. Si el dueño elige otra, se reemplaza por
--   la que corresponda; el trigger conserva el contrato (mismo error, mismo SQLSTATE y
--   nombre de restricción).
--
-- ORDEN DE APLICACIÓN. Aplicar DESPUÉS de la pieza DEP-2 de la migración 20261027000800: redefine la misma función de
--   trigger y CONSERVA su predicado «numero_factura IS NOT NULL» (marcado [DEP-2]). Al unir
--   todo en una migración, la definición de esta función es la de este archivo (la última).
--
-- Idempotente (CREATE OR REPLACE). El trigger no se recrea (no cambia): sin candado de tabla.
-- ════════════════════════════════════════════════════════════════════════════

-- ── [RG-4] Perfil de separadores de un número ───────────────────────────────
-- Posiciones (sobre la clave alfanumérica) donde hay un separador entre dos caracteres
-- alfanuméricos. Los separadores del principio y del final no cuentan.
CREATE OR REPLACE FUNCTION public.compras_numero_separadores(p_numero text)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
  SELECT COALESCE(array_agg(s.pos ORDER BY s.n), ARRAY[]::integer[])
    FROM (
      SELECT t.n,
             (sum(length(t.p)) OVER (ORDER BY t.n))::integer AS pos,
             count(*) OVER ()                                AS total
        FROM regexp_split_to_table(
               regexp_replace(upper(p_numero), '^[^A-Z0-9]+|[^A-Z0-9]+$', '', 'g'),
               '[^A-Z0-9]+') WITH ORDINALITY AS t(p, n)
    ) s
   WHERE s.n < s.total
$$;

COMMENT ON FUNCTION public.compras_numero_separadores(text) IS
  'Posiciones, sobre la clave alfanumérica del número, donde hay un separador entre dos caracteres alfanuméricos («1-23» → {1}; «FAC001» → {}). Los separadores de los extremos no cuentan. Para distinguir «1-23» de «12-3».';

-- ── [RG-4] ¿Pueden ser la misma factura? ────────────────────────────────────
-- Misma clave alfanumérica Y separadores compatibles (el perfil de uno incluido en el del otro).
CREATE OR REPLACE FUNCTION public.compras_numeros_equivalentes(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
  SELECT public.compras_normalizar_numero(p_a) = public.compras_normalizar_numero(p_b)
     AND (   public.compras_numero_separadores(p_a) <@ public.compras_numero_separadores(p_b)
          OR public.compras_numero_separadores(p_b) <@ public.compras_numero_separadores(p_a))
$$;

COMMENT ON FUNCTION public.compras_numeros_equivalentes(text, text) IS
  'Dos números de factura que pueden ser la misma: igual clave alfanumérica y separadores compatibles (uno incluido en el otro). «1-23» y «12-3» NO lo son; «FAC-001» y «FAC001» sí.';

-- Solo las usa el trigger (SECURITY DEFINER): no se exponen a los roles de la API.
REVOKE ALL ON FUNCTION public.compras_numero_separadores(text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_numeros_equivalentes(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compras_numero_separadores(text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.compras_numeros_equivalentes(text, text) TO service_role;

-- ── Trigger: cuerpo vigente (0400 + [DEP-2]) + el criterio de separadores [RG-4] ──
CREATE OR REPLACE FUNCTION public.compras_tg_factura_numero_equivalente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_norm text := public.compras_normalizar_numero(NEW.numero_factura);
  v_dup  record;
BEGIN
  IF v_norm IS NULL OR NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.numero_factura IS NOT DISTINCT FROM OLD.numero_factura
     AND NEW.proveedor_id   =  OLD.proveedor_id THEN
    RETURN NEW;
  END IF;

  -- Dos altas simultáneas del mismo número se serializan: la segunda ve a la primera.
  -- (La clave del candado sigue siendo la alfanumérica: «FAC-001» y «FAC001» se serializan;
  --  «1-23» y «12-3» también, sin consecuencia: la segunda ve a la primera y la deja pasar.)
  PERFORM pg_advisory_xact_lock(
    hashtextextended('factura-numero:' || NEW.company_id::text || ':' || NEW.proveedor_id::text || ':' || v_norm, 0));

  SELECT f.numero_factura, f.estado, f.fecha_emision, f.monto_total INTO v_dup
    FROM public.facturas_proveedor f
   WHERE f.company_id   = NEW.company_id
     AND f.proveedor_id = NEW.proveedor_id
     AND f.id          <> NEW.id
     AND f.estado      <> 'anulada'
     AND f.numero_factura IS NOT NULL            -- [DEP-2] hace demostrable el predicado del índice parcial
     -- El número IDÉNTICO lo rechaza el índice único `uq_facturas_prov_numero` con su error
     -- de siempre; aquí solo el mismo número escrito de otra forma.
     AND f.numero_factura IS DISTINCT FROM NEW.numero_factura
     AND public.compras_normalizar_numero(f.numero_factura) = v_norm      -- candidatos por el índice
     AND public.compras_numeros_equivalentes(f.numero_factura, NEW.numero_factura)   -- [RG-4] separadores compatibles
   LIMIT 1;

  IF FOUND THEN
    -- Mismo SQLSTATE y mismo nombre de restricción que el índice único exacto: la RPC
    -- `compras_factura_crear` ya traduce ese error y el cliente ya lo muestra.
    RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («%», % por %, %). Si es la misma, no la registres otra vez. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo (p. ej. «A-123»).',  -- [RG-4] sugerencia
      v_dup.numero_factura, to_char(v_dup.fecha_emision, 'DD/MM/YYYY'), v_dup.monto_total, v_dup.estado
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_facturas_prov_numero';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_factura_numero_equivalente() IS
  'Rechaza una factura cuyo número, ignorando mayúsculas, espacios y puntuación, ya existe (no anulada) para el mismo proveedor, salvo que ambos traigan separadores en posiciones distintas («1-23» ≠ «12-3»). Solo al nacer o al cambiar número/proveedor. Se resuelve por idx_facturas_prov_numero_norm.';

REVOKE ALL ON FUNCTION public.compras_tg_factura_numero_equivalente() FROM PUBLIC, anon, authenticated;
