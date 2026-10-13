-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · ALCANCE DE PROYECTO AL CAPTURAR Y «SIN PROYECTO» SOLO PARA PERSONAS EXENTAS (PROPUESTA, NO ES MIGRACIÓN DEL PR #926)
--
-- ⚠ DIFERIDO (2026-10-12) · LA VERSIÓN 20261027001000 QUEDA RETIRADA: es anterior a 20261028000000/0100 (#927), ya aplicadas en el sandbox. No hay versión
--   reservada; al aprobarse recibe la siguiente versión libre (posterior a la última de la cadena) y antes se adapta run.sh §3 (prefijo 20261027*) y
--   reversion_script.patch (README.md, aviso inicial). Lo que sigue describe cómo se probó el prototipo y queda como histórico.
-- ⚠ ESTE ARCHIVO ESTÁ EN pendientes_decision/: NO se aplica con el PR #926 (tiene diez migraciones, el tope de MAX_APPLY = 10) ni se despliega.
--   Para llevarlo: copiarlo como supabase/migrations/20261027001000_compras_alcance_proyecto_captura.sql en un PR PROPIO, con su push y su corrida de
--   apply-migrations-prod.yml, en este orden de pushes a main (cada uno en SU push, cada uno por debajo del tope de diez):
--       #928 (20261026000600 y 20261026000700, dos archivos) → #926 (20261027000000…0900) → ESTE PR (20261027001000) → #927 (20261028000000).
--   La versión 20261027001000 NO es una preferencia: run.sh §3 aplica primero toda migración posterior a 20261021000000 que no sea 20261027* y DESPUÉS la serie
--   20261027*; con una versión mayor (20261028…, 20261029…) esta se aplica ANTES de la 0900 y muere en su pre-vuelo (COMPRAS_MIGRACION_REQUISITOS; reproducido).
--   Con 20261027001000 el historial de versiones queda monótono y esto no depende de #927 (housekeeping de evidencias que no toca compras): no hay que esperarlo.
--   Decisiones que el dueño tiene que tomar ANTES: README.md §5 (D-1 … D-10). D-8 (la pantalla) es OBLIGATORIA junto con la migración: no desplegar solo el servidor.
--   Probado con PRJ-1.sql; revertido con reversion_alcance_proyecto.sql; su sección de reversión va ENCIMA de la de la 0900 en scripts/reversion-compras-controles.sql
--   (reversion_script.patch). Las adaptaciones de aserciones que necesita la batería existente están en adaptaciones_aserciones.patch; el arreglo de la pantalla, en ui_mensajes.patch.
--
-- QUÉ BRECHA CIERRA (reproducida en una base desechable con la cadena completa del PR #926; matriz completa en impacto.md)
--   Una persona acotada al proyecto A (rol operator, o administrador CON asignaciones), con todas las llaves de compras:
--     a · inserta un BORRADOR en el proyecto B, que NO tiene asignado, por la API, en las cinco tablas
--         (la política INSERT no mira el proyecto y los disparadores de permiso por acción dejan pasar el borrador);
--     b · inserta un documento con project_id = NULL («de la empresa»: lo ve y lo aprueba cualquiera con la llave) en las cinco tablas;
--     c · cambia SU documento de A a NULL (ordenes_compra, facturas_proveedor, contrasenas_pago): ensancha a toda la empresa quién lo
--         ve y quién lo aprueba. can_access_project(NULL) es verdadero, así que el disparador de mover de la 0900 lo deja pasar;
--     e · cambia un documento de NULL a su proyecto A (lo «reclama»). De NULL a B ya muere (la 0900 mira el destino);
--     h · agrega renglones a un borrador de B (orden_compra_lineas, recepcion_lineas, factura_proveedor_lineas,
--         contrasena_pago_facturas): las políticas de las hijas no miran el proyecto de la cabecera.
--   d (de A a B) ya muere hoy por la 0900 y esta propuesta no lo toca.
--
-- QUÉ HACE (aditiva: NO reemplaza ninguna función ni disparador de la 0900; revertir = DROP de lo que añade)
--   PIEZA 1 · UN solo punto de decisión, compras_puede_destinar_proyecto(proyecto): «la persona de la sesión puede dejar un documento
--             en ese proyecto». Con proyecto: tener acceso (asignación, o exención). Sin proyecto (NULL): SOLO ser exento de proyecto
--             (superadministrador, propietario, administrador SIN asignaciones). No existe hoy ninguna llave explícita para «sin
--             proyecto» (consultado en el catálogo de producción, solo lectura): no se inventa ninguna ni se concede nada.
--   PIEZA 2 · trg_zzzcompras_alcance_captura, BEFORE INSERT OR UPDATE OF project_id en las cinco tablas del circuito:
--               · INSERT (también BORRADOR): la persona puede destinar el proyecto del documento (con o sin proyecto, según arriba). Cubre la
--                 API directa, las RPC compras_*_crear (invoker) y cualquier función SECURITY DEFINER.
--               · UPDATE de project_id: mover DESDE o HACIA «sin proyecto» exige exención. Mover entre proyectos lo sigue decidiendo
--                 la 0900 (trg_zzcompras_mover_alcance, que dispara ANTES: el nombre de este lleva tres «z»), con sus mismos mensajes.
--   PIEZA 3 · trg_zzzcompras_alcance_hija, BEFORE INSERT OR UPDATE OF <llave a la cabecera> en las cuatro hijas con cabecera de
--             proyecto: la cabecera tiene que estar al alcance de la persona. Una cabecera sin proyecto (ya existente) no se toca.
--   Todo es «solo para sesiones de usuario», con la MISMA guarda de la 0900 (compras_sesion_usuario()): service_role, migraciones y
--   procesos de sistema (conta.allow_system_write) NO se bloquean, y la acción referencial de eliminar un proyecto (ON DELETE SET NULL)
--   tampoco. No toca RLS, privilegios, datos, la comprobación de las seis acciones (compras_exigir_permiso) ni los mensajes de la 0900.
--
-- ALCANCE DECLARADO (F7): SOLO estas nueve tablas — ordenes_compra, recepciones, facturas_proveedor, ordenes_pago, contrasenas_pago y sus hijas
--   orden_compra_lineas, recepcion_lineas, factura_proveedor_lineas, contrasena_pago_facturas. Las TABLAS VECINAS con project_id NO quedan cubiertas: p. ej. suministros_condominio y
--   proformas_condominio (probado: una persona asignada solo a A inserta en B), obras_mejoras, movimientos_suministro, banco_movimientos, cuentas_bancarias, presupuestos /
--   presupuesto_condominio, gastos_condominio y el resto de las tablas de condominios, cuya política INSERT no mira el proyecto. Cubrirlas pide la misma pieza por tabla (un disparador
--   BEFORE INSERT con compras_puede_destinar_proyecto o el can_access_project en el WITH CHECK de su política, más la decisión de qué hacer con su project_id NULL) y su propia
--   prueba: README.md §6.
--
-- QUÉ NO HACE (decisiones abiertas: README.md §5)
--   · NO cambia los documentos que YA están sin proyecto (en producción: 0 en las siete tablas, medido el 2026-10-10) ni quién puede
--     actuar sobre ellos con las seis llaves: cualquier persona con la llave sigue pudiendo (D-4). Tampoco lee permission_type: una asignación
--     'lectura' captura en su proyecto (en producción las 43 filas son 'total').
--   · NO es «todo UPDATE» (P-PERM-2): editar columnas que no mueven el documento de un proyecto ajeno con una función SECURITY DEFINER
--     o un UPDATE a ciegas sigue pasando; PRJ-1 lo deja documentado con una comprobación (D-6).
--   · NO compara la empresa del documento con la de la sesión al insertar (R1 «empresa», D-5): en la API ya lo hacen la RLS y
--     trg_00_compras_rls_empresa; una función SECURITY DEFINER no. Añadirlo rompe el montaje de UNA aserción existente
--     (conta_reglas_imputacion/assert.sql:490-493, que siembra una factura de la empresa B con la sesión de A) y no se pidió: README.md §5.
--   · NO vuelve «exento» una marca explícita: sigue siendo no tener filas en user_project_assignments. Con la 0600 del PR #928 desde 7bf85221 (solo el PRINCIPAL —propietario
--     o superadministrador— escribe asignaciones) ningún administrador deja exento a otro: solo el principal lo hace (D-9; antes de esa 0600, un administrador acotado que le
--     borraba sus filas a OTRO lo volvía exento). La regla «NULL solo para exentos» es tan firme como esa exención.
--   · NO cambia ON DELETE de project_id: al eliminar un proyecto, sus facturas, contraseñas y órdenes de pago quedan SIN proyecto (SET NULL) —y las ve y actúa todo el que tenga la llave—
--     y sus órdenes de compra se borran (CASCADE) (D-10). Con la 0700 del PR #928 solo el principal elimina proyectos por la API (un administrador obtiene cero filas).
--   · NO endurece el GUC conta.allow_system_write (heredado de la 0900, la guarda común): cualquier sesión authenticated puede fijarlo con SQL directo; no es alcanzable
--     por la API pública hoy, pero es una puerta del diseño de la guarda: hardening APARTE (README.md §6, F6).
--   · NO crea ninguna llave ni concede ninguna. NO cambia los privilegios de anon (que NO tiene SELECT, INSERT ni UPDATE sobre estas nueve tablas en producción).
--
-- DATOS EXISTENTES Y CONFLICTOS
--   No crea ningún índice, restricción ni columna: ningún dato existente puede hacerla fallar ni se reescribe. El pre-vuelo informa
--   cuántos documentos sin proyecto hay por tabla; el post-vuelo comprueba que los conteos no cambiaron.
--
-- BLOQUEOS, TIEMPOS Y RECUPERACIÓN
--   Una transacción con lock_timeout = 10 s y statement_timeout = 120 s. CREATE OR REPLACE TRIGGER (PostgreSQL ≥ 14; producción: 17) toma
--   SHARE ROW EXCLUSIVE sobre cada una de las 9 tablas (medido con pg_locks al final de la transacción: las 9 tablas con ShareRowExclusiveLock; deja leer, bloquea INSERT/UPDATE/DELETE
--   unos milisegundos; los candados se toman en serie y se sueltan juntos al COMMIT, así que una transacción concurrente que toque varias de estas tablas en otro orden podría interbloquearse
--   y PostgreSQL abortaría una de las dos). Aplicar fuera de pagos, aprobaciones y cierres; si falla por lock_timeout, no deja nada y se reintenta. Costo por escritura, medido
--   (mediana de 5 corridas alternadas, 1 000 INSERT cada una): ≈ +0,3 ms por cabecera y +0,4 ms por renglón (impacto.md §7). Idempotente. Reversión: reversion_alcance_proyecto.sql
--   (exacta, sin pérdida de datos) o la sección de 20261027001000 de scripts/reversion-compras-controles.sql (reversion_script.patch), que va ENCIMA de la de la 0900.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- ════════════════════════════════════════════════════════════════════════════
-- PRE-VUELO · requisitos (los deja la 0900) y fotografía de lo que NO debe cambiar
-- ════════════════════════════════════════════════════════════════════════════
DO $prevuelo$
DECLARE
  v_faltan text[] := ARRAY[]::text[];
  v_obj    text;
  v_t      text;
  v_n      bigint;
  v_sin    bigint;
  v_total  text := '';
BEGIN
  FOREACH v_obj IN ARRAY ARRAY[
    'public.compras_sesion_usuario()',
    'public.compras_exigir_permiso(text,text,uuid,uuid)',
    'public.compras_tg_mover_alcance()',
    'public.user_is_project_exempt()',
    'public.can_access_project(uuid)',
    'public.is_super_admin()',
    'public.get_my_company_id()'
  ] LOOP
    IF to_regprocedure(v_obj) IS NULL THEN v_faltan := v_faltan || (v_obj || ' (20261027000900 o anteriores)'); END IF;
  END LOOP;
  FOREACH v_obj IN ARRAY ARRAY[
    'public.ordenes_compra', 'public.recepciones', 'public.facturas_proveedor', 'public.ordenes_pago', 'public.contrasenas_pago',
    'public.orden_compra_lineas', 'public.recepcion_lineas', 'public.factura_proveedor_lineas', 'public.contrasena_pago_facturas',
    'public.projects'
  ] LOOP
    IF to_regclass(v_obj) IS NULL THEN v_faltan := v_faltan || (v_obj || ' (tabla)'); END IF;
  END LOOP;
  -- el disparador de mover de la 0900 tiene que estar en las cinco tablas: esta propuesta dispara DESPUÉS de él
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname = 'trg_zzcompras_mover_alcance'
         AND c.relname IN ('ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago')) <> 5 THEN
    v_faltan := v_faltan || ARRAY['trg_zzcompras_mover_alcance en las cinco tablas (20261027000900)'];
  END IF;
  IF cardinality(v_faltan) > 0 THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_REQUISITOS: el alcance de proyecto al capturar necesita lo que deja 20261027000900 y falta: %. Aplica primero el PR #926 completo. No se cambió nada.',
      array_to_string(v_faltan, ', ') USING ERRCODE = 'undefined_object';
  END IF;

  FOREACH v_t IN ARRAY ARRAY['ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago'] LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE project_id IS NULL) FROM public.%I', v_t) INTO v_n, v_sin;
    RAISE NOTICE 'alcance de proyecto · pre-vuelo: % tiene % documento(s), % sin proyecto (informativo; no se tocan).', v_t, v_n, v_sin;
    v_total := v_total || v_t || '=' || v_n || ',';
  END LOOP;
  PERFORM set_config('compras.m1000_conteos', v_total, true);   -- recordado SOLO dentro de esta transacción, para el post-vuelo
END
$prevuelo$;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 1 · el punto de decisión: ¿puede la persona de la sesión dejar un documento en ESE proyecto?
-- ════════════════════════════════════════════════════════════════════════════
-- Con proyecto: tener acceso a él (asignación o exención: can_access_project). Sin proyecto (NULL): SOLO ser exento de proyecto.
-- Es la única regla nueva; si el dueño decide otra (p. ej. una llave explícita para «sin proyecto», D-1), se cambia aquí y en ningún otro lugar.
CREATE OR REPLACE FUNCTION public.compras_puede_destinar_proyecto(p_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p_project_id IS NULL
              THEN COALESCE(public.user_is_project_exempt(), false)
              ELSE COALESCE(public.can_access_project(p_project_id), false)
         END
$function$;

COMMENT ON FUNCTION public.compras_puede_destinar_proyecto(uuid) IS
  'Interna de los triggers de compras: ¿la persona de la sesión puede dejar un documento en ese proyecto? Con proyecto, si tiene acceso (can_access_project); sin proyecto (NULL), solo si es exenta de proyecto (superadministrador, propietario, administrador sin asignaciones). NULL-segura.';

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 2 · captura (INSERT, también en borrador) y traslado desde o hacia «sin proyecto» (UPDATE OF project_id)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compras_tg_alcance_captura()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Misma guarda que la 0900: service_role, migraciones y procesos de sistema no son una sesión de usuario.
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.compras_puede_destinar_proyecto(NEW.project_id) THEN
      IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: un documento de compras sin proyecto (la contabilidad de la Empresa) solo lo crea una persona exenta de proyecto; si no lo eres, tu perfil necesita estar asignado al proyecto del documento: elige uno de los tuyos.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: para crear un documento de compras tu perfil necesita estar asignado al proyecto del documento.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE OF project_id. «OF» dispara también cuando la columna está en el SET con el mismo valor: eso no mueve nada.
  IF NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
    RETURN NEW;
  END IF;
  -- Acción referencial de eliminar un proyecto (FK ON DELETE SET NULL): el proyecto ya no existe, no es una edición de nadie
  -- (misma salida que la 0900 y que RG-3 / DEP-5 en 20261027000800).
  IF OLD.project_id IS NOT NULL AND NEW.project_id IS NULL
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RETURN NEW;
  END IF;
  -- Desde o hacia «sin proyecto»: solo una persona exenta de proyecto. Entre proyectos decide la 0900 (dispara antes).
  IF NEW.project_id IS NULL AND NOT COALESCE(public.user_is_project_exempt(), false) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: dejar un documento de compras sin proyecto (la contabilidad de la Empresa) solo lo hace una persona exenta de proyecto; si no lo eres, tu perfil necesita estar asignado al proyecto del documento y el documento se queda en él.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.project_id IS NULL AND NOT COALESCE(public.user_is_project_exempt(), false) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: ponerle proyecto a un documento de compras que no lo tiene solo lo hace una persona exenta de proyecto; si no lo eres, el documento se queda sin proyecto (tu perfil necesita estar asignado al proyecto para capturar en él).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.compras_tg_alcance_captura() IS
  'Disparador BEFORE INSERT OR UPDATE OF project_id de ordenes_compra, recepciones, facturas_proveedor, ordenes_pago y contrasenas_pago: solo para sesiones de usuario, un documento nace (también en borrador) en un proyecto que la persona puede destinar (compras_puede_destinar_proyecto: sin proyecto solo si es exenta), y pasar de o a «sin proyecto» exige exención. Entre proyectos decide trg_zzcompras_mover_alcance (20261027000900). Se salta la acción referencial de eliminar un proyecto.';

CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_captura BEFORE INSERT OR UPDATE OF project_id ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_captura();
CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_captura BEFORE INSERT OR UPDATE OF project_id ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_captura();
CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_captura BEFORE INSERT OR UPDATE OF project_id ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_captura();
CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_captura BEFORE INSERT OR UPDATE OF project_id ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_captura();
CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_captura BEFORE INSERT OR UPDATE OF project_id ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_captura();

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 3 · las hijas con cabecera de proyecto: la cabecera tiene que estar al alcance de la persona
-- ════════════════════════════════════════════════════════════════════════════
-- Las políticas de las hijas piden empresa y rol/llave, pero no el proyecto de la cabecera: una persona asignada solo a A agregaba
-- renglones a un borrador de B si conocía su id. Una cabecera sin proyecto (ya existente) no se toca (D-4). Si la cabecera no existe
-- se deja a la llave foránea. UPDATE: solo si cambia la llave a la cabecera (mover un renglón de un documento a otro).
CREATE OR REPLACE FUNCTION public.compras_tg_alcance_hija()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids       uuid[];
  v_proyectos uuid[];
  v_p         uuid;
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  -- Cabecera nueva y, si el renglón cambia de documento, también la de origen.
  IF TG_TABLE_NAME = 'orden_compra_lineas' THEN
    IF TG_OP = 'UPDATE' AND NEW.orden_compra_id IS NOT DISTINCT FROM OLD.orden_compra_id THEN RETURN NEW; END IF;
    v_ids := ARRAY[NEW.orden_compra_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.orden_compra_id END];
    v_proyectos := ARRAY(SELECT o.project_id FROM public.ordenes_compra o WHERE o.id = ANY (v_ids));
  ELSIF TG_TABLE_NAME = 'recepcion_lineas' THEN
    IF TG_OP = 'UPDATE' AND NEW.recepcion_id IS NOT DISTINCT FROM OLD.recepcion_id THEN RETURN NEW; END IF;
    v_ids := ARRAY[NEW.recepcion_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.recepcion_id END];
    v_proyectos := ARRAY(SELECT r.project_id FROM public.recepciones r WHERE r.id = ANY (v_ids));
  ELSIF TG_TABLE_NAME = 'factura_proveedor_lineas' THEN
    IF TG_OP = 'UPDATE' AND NEW.factura_id IS NOT DISTINCT FROM OLD.factura_id THEN RETURN NEW; END IF;
    v_ids := ARRAY[NEW.factura_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.factura_id END];
    v_proyectos := ARRAY(SELECT f.project_id FROM public.facturas_proveedor f WHERE f.id = ANY (v_ids));
  ELSE   -- contrasena_pago_facturas
    IF TG_OP = 'UPDATE' AND NEW.contrasena_id IS NOT DISTINCT FROM OLD.contrasena_id THEN RETURN NEW; END IF;
    v_ids := ARRAY[NEW.contrasena_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.contrasena_id END];
    v_proyectos := ARRAY(SELECT c.project_id FROM public.contrasenas_pago c WHERE c.id = ANY (v_ids));
  END IF;

  -- Sin cabecera (arreglo vacío) no hay nada que comprobar: lo rechaza la llave foránea.
  FOREACH v_p IN ARRAY v_proyectos LOOP
    IF NOT COALESCE(public.can_access_project(v_p), false) THEN
      RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: para agregar o mover renglones de un documento de compras tu perfil necesita estar asignado al proyecto del documento.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.compras_tg_alcance_hija() IS
  'Disparador BEFORE INSERT OR UPDATE OF <llave a la cabecera> de orden_compra_lineas, recepcion_lineas, factura_proveedor_lineas y contrasena_pago_facturas: solo para sesiones de usuario, la cabecera (y la de origen si el renglón cambia de documento) tiene que estar al alcance de la persona (can_access_project; una cabecera sin proyecto no se toca). Sin cabecera, lo rechaza la llave foránea.';

CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_hija BEFORE INSERT OR UPDATE OF orden_compra_id ON public.orden_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_hija();
CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_hija BEFORE INSERT OR UPDATE OF recepcion_id ON public.recepcion_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_hija();
CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_hija BEFORE INSERT OR UPDATE OF factura_id ON public.factura_proveedor_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_hija();
CREATE OR REPLACE TRIGGER trg_zzzcompras_alcance_hija BEFORE INSERT OR UPDATE OF contrasena_id ON public.contrasena_pago_facturas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_alcance_hija();

-- ── Permisos de ejecución: solo los invocan los disparadores ────────────────
REVOKE ALL ON FUNCTION public.compras_puede_destinar_proyecto(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_alcance_captura()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_alcance_hija()             FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- POST-VUELO · lo que se añadió está, y NADA de los datos cambió
-- ════════════════════════════════════════════════════════════════════════════
DO $postvuelo$
DECLARE
  v_t      text;
  v_n      bigint;
  v_antes  text := current_setting('compras.m1000_conteos', true);
  v_ahora  text := '';
BEGIN
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname = 'trg_zzzcompras_alcance_captura'
         AND c.relname IN ('ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago')) <> 5
     OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname = 'trg_zzzcompras_alcance_hija'
            AND c.relname IN ('orden_compra_lineas', 'recepcion_lineas', 'factura_proveedor_lineas', 'contrasena_pago_facturas')) <> 4
     OR to_regprocedure('public.compras_puede_destinar_proyecto(uuid)') IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: faltan disparadores o funciones del alcance de proyecto; se revierte toda la transacción.'
      USING ERRCODE = 'internal_error';
  END IF;
  FOREACH v_t IN ARRAY ARRAY['ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
    v_ahora := v_ahora || v_t || '=' || v_n || ',';
  END LOOP;
  IF v_antes IS DISTINCT FROM v_ahora THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: cambió el número de documentos (antes %, ahora %); se revierte toda la transacción.', v_antes, v_ahora
      USING ERRCODE = 'internal_error';
  END IF;
  RAISE NOTICE 'alcance de proyecto · post-vuelo: 5 + 4 disparadores y 3 funciones; conteos de documentos intactos (%).', v_ahora;
END
$postvuelo$;

COMMIT;
