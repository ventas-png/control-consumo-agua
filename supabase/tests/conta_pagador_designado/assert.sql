-- ============================================================================
-- unidad_designar_pagador · invariantes de una sola sesión
-- (la concurrencia real va en run.sh con sesiones simultáneas)
--
-- Las llamadas corren como usuarios de la aplicación (SET ROLE authenticated +
-- request.jwt.claim.sub). El estado se lee con RESET ROLE, como verdad de
-- referencia independiente de la RLS de quien llama.
-- ============================================================================

-- ── 0 · la función existe con los permisos esperados ────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'unidad_designar_pagador' AND NOT p.prosecdef), 1,
  '0 · la RPC es SECURITY INVOKER: no amplía el acceso de nadie');
SELECT public.chk(
  has_function_privilege('anon', 'public.unidad_designar_pagador(uuid, uuid)', 'EXECUTE')::int, 0,
  '0 · anon no puede ejecutarla');
SELECT public.chk(
  has_function_privilege('authenticated', 'public.unidad_designar_pagador(uuid, uuid)', 'EXECUTE')::int, 1,
  '0 · authenticated sí');

-- ── 1 · sin sesión de usuario ───────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '', false);
SET ROLE authenticated;
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000002')$q$,
  'PAGADOR_NO_AUTENTICADO', '1 · sin usuario autenticado no se cambia nada');
RESET ROLE;

-- ── 2 · cambio válido, como admin de A ──────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.chk_uuid(
  public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000002'),
  'd0000000-0000-0000-0000-000000000002', '2 · designar al arrendatario devuelve su id');
RESET ROLE;
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'),
  'd0000000-0000-0000-0000-000000000002', '2 · la unidad queda con UN pagador: el nuevo');

SET ROLE authenticated;
SELECT public.chk_uuid(
  public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000002'),
  'd0000000-0000-0000-0000-000000000002', '2 · volver a designar al mismo es un no-op');
RESET ROLE;
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'),
  'd0000000-0000-0000-0000-000000000002', '2 · …y el pagador sigue siendo el mismo');

-- ── 3 · validaciones previas: nada cambia si fallan ─────────────────────────
SET ROLE authenticated;
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000004')$q$,
  'PAGADOR_RESIDENTE_DE_OTRA_UNIDAD', '3 · un residente de OTRA unidad se rechaza');
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000003')$q$,
  'PAGADOR_RESIDENTE_INACTIVO', '3 · un residente inactivo se rechaza');
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-0000000000ff')$q$,
  'PAGADOR_RESIDENTE_NO_ENCONTRADO', '3 · un residente inexistente se rechaza');
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000b001', NULL)$q$,
  'PAGADOR_UNIDAD_(NO_ENCONTRADA|AJENA)', '3 · una unidad de la empresa B no se toca desde A');
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador(NULL, NULL)$q$,
  'PAGADOR_UNIDAD_REQUERIDA', '3 · sin unidad no hay cambio');
RESET ROLE;
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'),
  'd0000000-0000-0000-0000-000000000002', '3 · tras cinco rechazos el pagador anterior sigue intacto');

-- ── 4 · fallo INTERMEDIO: el segundo paso revienta después del primero ──────
-- Un trigger de prueba hace fallar SOLO la marca del nuevo pagador, es decir,
-- después de que la función ya quitó la marca al actual. Con dos peticiones,
-- la unidad quedaba sin pagador; con la RPC se revierte todo.
CREATE FUNCTION public.tg_prueba_falla_pagador() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.responsable_pago AND NEW.id = 'd0000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FALLO_SIMULADO_SEGUNDO_PASO';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_prueba_falla_pagador BEFORE UPDATE ON public.unidad_residentes
  FOR EACH ROW EXECUTE FUNCTION public.tg_prueba_falla_pagador();

SET ROLE authenticated;
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000001')$q$,
  'FALLO_SIMULADO_SEGUNDO_PASO', '4 · el segundo paso falla después de quitar la marca anterior');
RESET ROLE;
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'),
  'd0000000-0000-0000-0000-000000000002', '4 · …y el pagador anterior se conserva: nada quedó a medias');
DROP TRIGGER zz_prueba_falla_pagador ON public.unidad_residentes;
DROP FUNCTION public.tg_prueba_falla_pagador();

-- ── 5 · escrituras filtradas por RLS: fallan, no «tienen éxito» con 0 filas ──
-- El lector (viewer con asignación) VE la unidad y sus residentes…
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000f', false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.unidad_residentes WHERE unidad_id = 'f0000000-0000-0000-0000-00000000a001'), 3,
  '5 · el lector ve los residentes de la unidad');
-- …el UPDATE directo que hacía el cliente antes devolvía «éxito» con 0 filas:
SELECT public.chk(
  public.filas_afectadas($q$UPDATE public.unidad_residentes SET responsable_pago = false
    WHERE unidad_id = 'f0000000-0000-0000-0000-00000000a001' AND responsable_pago$q$), 0,
  '5 · el UPDATE directo del lector afecta 0 filas sin error (el defecto que se corrige)');
-- …la RPC, en cambio, lo detecta y aborta:
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000001')$q$,
  'PAGADOR_SIN_PERMISO', '5 · la RPC rechaza la escritura filtrada por RLS');
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', NULL)$q$,
  'PAGADOR_SIN_PERMISO', '5 · también al intentar retirar el pagador');
RESET ROLE;
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'),
  'd0000000-0000-0000-0000-000000000002', '5 · el pagador no cambió');

-- El operador SIN asignación al proyecto ni siquiera ve la unidad.
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000d', false);
SET ROLE authenticated;
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000001')$q$,
  'PAGADOR_(UNIDAD_NO_ENCONTRADA|SIN_PERMISO)', '5 · un operador sin asignación al proyecto no cambia el pagador');
RESET ROLE;

-- El admin de OTRA empresa tampoco.
SELECT set_config('request.jwt.claim.sub', 'b0b0b0b0-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
SELECT public.chk_falla(
  $q$SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000001')$q$,
  'PAGADOR_UNIDAD_(NO_ENCONTRADA|AJENA)', '5 · el admin de B no cambia el pagador de una unidad de A');
RESET ROLE;
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'),
  'd0000000-0000-0000-0000-000000000002', '5 · tras los intentos no autorizados, el pagador sigue igual');

-- ── 6 · retirar y volver a designar; auditoría ──────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.chk_txt(
  coalesce(public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', NULL)::text, 'NULL'),
  'NULL', '6 · retirar el pagador (NULL)');
RESET ROLE;
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'), 'NINGUNO',
  '6 · la unidad queda sin pagador, explícitamente');
SET ROLE authenticated;
SELECT public.unidad_designar_pagador('f0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'),
  'd0000000-0000-0000-0000-000000000001', '6 · se vuelve a designar al propietario (estado de partida de la concurrencia)');
SELECT public.chk(
  (SELECT count(*) FROM public.audit_log WHERE table_name = 'unidad_residentes' AND action = 'UPDATE'
      AND record_id::text LIKE 'd0000000-0000-0000-0000-00000000000_'
      AND (after->>'responsable_pago') IS DISTINCT FROM (before->>'responsable_pago')), 4,
  '6 · cada cambio efectivo de marca queda auditado (los rechazados no dejan rastro)');
