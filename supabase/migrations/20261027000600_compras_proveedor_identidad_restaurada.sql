-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · PROVEEDOR: SE RESTAURA LA GUARDA DE IDENTIDAD ORIGINAL (decisión previa)
-- (corrige 20261027000400, que la había ampliado con una regla de NOMBRE)
--
-- POR QUÉ
--   20261027000400 añadió a `proveedores_tg_identidad()` una regla: el alta o la edición de
--   un proveedor SIN identificación fiscal y SIN código propio se rechaza si otro proveedor
--   de la empresa tiene el mismo nombre normalizado (la misma regla que ya aplica la carga
--   masiva). Al correr la batería existente, `proveedores_pr_a/assert_identidad.sql §4`
--   (PR A) fija lo CONTRARIO como decisión de diseño: «Nombres que se PARECEN no se unen ni
--   se rechazan por parecerse» — «Limpieza Total», «LIMPIEZA TOTAL» y «Limpieza Total,
--   S.A.» conviven, y los duplicados se LISTAN (`proveedores_duplicados_fiscales()`), no se
--   bloquean. Es una decisión de negocio ya tomada y probada; este PR no la revierte por su
--   cuenta. Queda como PREGUNTA en docs/COMPRAS_CONTROLES_SERVIDOR.md (§5, pregunta 8).
--
-- QUÉ HACE
--   Vuelve a dejar `proveedores_tg_identidad()` EXACTAMENTE como la definió
--   20261020000000 (solo identificación fiscal + país). Sobre una base que nunca aplicó
--   20261027000400 (producción) no cambia nada: el cuerpo es idéntico al vigente. Sobre una
--   que sí la aplicó (el sandbox de validación) quita la regla de nombre. No hay datos que
--   tocar: la regla solo bloqueaba escrituras nuevas.
--
--   Se hace con una migración NUEVA (y no editando 20261027000400) porque esa ya está
--   aplicada en el sandbox y puede estarlo en una rama de previsualización.
--
-- CÓMO REVERTIR
--   Volver a aplicar la función de 20261027000400 (solo si el negocio decide rechazar el
--   alta con un nombre equivalente sin identificación fiscal).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.proveedores_tg_identidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm     text;
  v_norm_old text;
  v_dup      record;
BEGIN
  NEW.pais   := NULLIF(upper(btrim(NEW.pais)), '');
  NEW.codigo := NULLIF(btrim(NEW.codigo), '');

  IF TG_OP = 'INSERT' AND NEW.codigo IS NULL THEN
    NEW.codigo := public.proveedor_siguiente_codigo(NEW.company_id);
  END IF;

  -- La columna generada todavía no existe en un BEFORE: se calcula la misma
  -- expresión.
  v_norm := public.proveedor_normalizar_identificacion(
    COALESCE(NULLIF(btrim(NEW.nit), ''), NULLIF(btrim(NEW.rfc), '')));

  IF TG_OP = 'UPDATE' THEN
    v_norm_old := public.proveedor_normalizar_identificacion(
      COALESCE(NULLIF(btrim(OLD.nit), ''), NULLIF(btrim(OLD.rfc), '')));
  END IF;

  -- Solo cuando la IDENTIDAD cambia (o nace). Editar el teléfono de un
  -- proveedor que ya está duplicado de antes no puede quedar bloqueado: esos
  -- casos se resuelven con proveedores_duplicados_fiscales(), no aquí.
  IF v_norm IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR v_norm IS DISTINCT FROM v_norm_old
          OR NEW.pais IS DISTINCT FROM OLD.pais) THEN

    -- Candado consultivo: dos altas simultáneas del mismo NIT se serializan y
    -- la segunda ve a la primera.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('proveedor-identidad:' || NEW.company_id::text || ':' || v_norm, 0));

    SELECT p.id, p.nombre, p.codigo INTO v_dup
      FROM public.proveedores p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND p.identificacion_norm = v_norm
       AND (p.pais IS NULL OR NEW.pais IS NULL OR p.pais = NEW.pais)
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PROVEEDOR_DUPLICADO: la identificación fiscal ya pertenece a "%" (código %). Usa ese proveedor o corrige la identificación.',
        v_dup.nombre, COALESCE(v_dup.codigo, 's/código')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proveedores_tg_identidad() FROM PUBLIC, anon, authenticated;
