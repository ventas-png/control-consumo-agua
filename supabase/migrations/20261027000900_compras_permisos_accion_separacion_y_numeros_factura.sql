-- BORRADOR DE CABECERA (se reemplaza al integrar las piezas finales)
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- ════════════════════════════════════════════════════════════════════════════
-- PRE-VUELO · requisitos y fotografía de lo que la migración NO debe cambiar
-- ════════════════════════════════════════════════════════════════════════════
-- Si falta algo de 0000…0800 la migración se detiene AQUÍ con un mensaje claro y sin haber cambiado nada (todo va en una
-- transacción). Lo demás es informativo: cuenta lo que ya existe y la migración deja intacto (pares de números de factura
-- equivalentes, empresas con la separación encendida, llaves ya concedidas) y lo recuerda para el post-vuelo, que comprueba que
-- NADA de eso cambió. Esta migración no crea ningún índice único ni restricción nueva sobre datos existentes, así que ningún dato
-- puede hacerla fallar.
DO $prevuelo$
DECLARE
  v_faltan   text[] := ARRAY[]::text[];
  v_obj      text;
  v_pares    bigint;
  v_encend   bigint;
  v_grants   bigint;
  v_filas    bigint;
BEGIN
  FOREACH v_obj IN ARRAY ARRAY[
    'public.compras_exigir_accion(text,text)',
    'public.compras_sesion_usuario()',
    'public.compras_tg_permiso_orden()',
    'public.compras_tg_permiso_recepcion()',
    'public.compras_tg_permiso_factura()',
    'public.compras_tg_permiso_orden_pago()',
    'public.compras_tg_permiso_contrasena()',
    'public.compras_tg_permiso_orden_separada()',
    'public.compras_tg_oc_ciclo()',
    'public.compras_oc_excepcion_contrato(uuid,text,text)',
    'public.compras_normalizar_numero(text)',
    'public.compras_tg_factura_numero_equivalente()',
    'public.compras_puede_ver_documento(uuid,uuid)',
    'public.compras_factura_crear(uuid,uuid,jsonb,jsonb)',
    'public.user_has_permission(text)',
    'public.can_access_project(uuid)',
    'public.is_super_admin()',
    'public.current_user_role()',
    'public.get_my_company_id()'
  ] LOOP
    IF to_regprocedure(v_obj) IS NULL THEN v_faltan := v_faltan || (v_obj || ' (20261027000800 o anteriores)'); END IF;
  END LOOP;
  FOREACH v_obj IN ARRAY ARRAY[
    'public.ordenes_compra', 'public.recepciones', 'public.facturas_proveedor', 'public.ordenes_pago', 'public.contrasenas_pago',
    'public.compras_config', 'public.permissions', 'public.role_permissions', 'public.app_users', 'public.user_project_assignments'
  ] LOOP
    IF to_regclass(v_obj) IS NULL THEN v_faltan := v_faltan || (v_obj || ' (tabla)'); END IF;
  END LOOP;
  IF cardinality(v_faltan) > 0 THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_REQUISITOS: 20261027000900 necesita lo que dejan 20261027000000…0800 y falta: %. Aplica primero esas migraciones, en orden. No se cambió nada.',
      array_to_string(v_faltan, ', ') USING ERRCODE = 'undefined_object';
  END IF;

  -- Números de factura: pares de facturas vivas del mismo proveedor con la misma clave alfanumérica (los que la regla nueva
  -- trata como duplicado probable o como distintos legítimos). Informativo: NO se renumera, elimina ni fusiona nada.
  SELECT count(*) INTO v_pares
    FROM public.facturas_proveedor a
    JOIN public.facturas_proveedor b
      ON b.company_id = a.company_id AND b.proveedor_id = a.proveedor_id AND b.id > a.id
     AND public.compras_normalizar_numero(b.numero_factura) = public.compras_normalizar_numero(a.numero_factura)
   WHERE a.estado <> 'anulada' AND b.estado <> 'anulada' AND public.compras_normalizar_numero(a.numero_factura) IS NOT NULL;
  RAISE NOTICE '20261027000900 · pre-vuelo: % par(es) de facturas vivas del mismo proveedor con la misma clave de número (informativo; los datos no se tocan: scripts/diagnostico-numeros-factura.sql los clasifica).', v_pares;

  SELECT count(*) INTO v_encend FROM public.compras_config WHERE aprobacion_separada;
  RAISE NOTICE '20261027000900 · pre-vuelo: % empresa(s) con la separación solicitante/aprobador encendida (la migración las deja como están y siembra su línea base en la bitácora).', v_encend;

  SELECT count(*) INTO v_grants FROM public.role_permissions
   WHERE permission_key IN ('platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
                            'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar',
                            'platform.contabilidad.compras.pago_anular');
  SELECT count(*) INTO v_filas FROM public.user_project_assignments;
  -- recordado SOLO dentro de esta transacción (set_config(…, true)) para el post-vuelo
  PERFORM set_config('compras.m0900_encendidas', v_encend::text, true);
  PERFORM set_config('compras.m0900_grants', v_grants::text, true);
  PERFORM set_config('compras.m0900_asignaciones', v_filas::text, true);
END
$prevuelo$;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 1 · PERMISOS INDEPENDIENTES POR ACCIÓN
-- (fragmento: permisos/pieza.sql)
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA · PERMISOS INDEPENDIENTES POR ACCIÓN DEL CIRCUITO DE COMPRAS Y PAGOS
-- (fragmento IDEMPOTENTE para la migración 20261027000900; sin BEGIN/COMMIT)
--
-- QUÉ CORRIGE
--   Hoy seis decisiones distintas cuelgan de DOS permisos genéricos de Contabilidad:
--     · `platform.contabilidad.approve`        (Autorizar / Denegar): aprobar la orden de compra, aprobar la
--                                               factura de proveedor y aprobar la orden de pago;
--     · `platform.contabilidad.change_status`  (Cambiar estado): registrar la recepción, pagar y anular el pago.
--   Quien tiene uno de los dos recibe, de golpe, TODAS las decisiones de su grupo: la persona que aprueba la
--   factura aprueba también la orden de pago y la orden de compra; la que registra recepciones también paga.
--   Esta pieza da a CADA una de las seis acciones su propio permiso, en el SERVIDOR (no solo en la pantalla),
--   tanto para las RPC como para las escrituras directas por la API.
--
--     Acción (transición)                               Permiso exigido
--     ────────────────────────────────────────────────  ──────────────────────────────────────────────────────
--     Orden de compra  borrador → aprobada, aprobada →  condominios.tab.ordenes_compra.approve   (YA EXISTÍA:
--                      borrador (devolver) y nacer      «Autorizar / Denegar — Órdenes compra»; es específico
--                      «aprobada» o «emitida»           de la orden, no se crea otro)
--     Recepción        borrador → registrada            platform.contabilidad.compras.recepcion_registrar
--     Factura          registrada → aprobada            platform.contabilidad.compras.factura_aprobar
--     Orden de pago    borrador → aprobada              platform.contabilidad.compras.orden_pago_aprobar
--     Orden de pago    aprobada → pagada                platform.contabilidad.compras.pago_ejecutar
--     Orden de pago    cualquier estado → anulada       platform.contabilidad.compras.pago_anular
--
--   NO cambia de PERMISO (siguen con `platform.contabilidad.change_status`): emitir, cancelar y cerrar la orden de
--   compra (y nacer «emitida», que además exige la llave de la orden); anular una recepción, una factura o una
--   contraseña. Esas cinco SÍ pasan ahora por la misma comprobación común de ALCANCE que las seis (empresa y
--   proyecto del documento; ver «ALCANCE» abajo), con el mismo texto de permiso que ya tenían. Capturar
--   (crear/editar) sigue siendo `create`/`edit`, que la RLS ya exigía y NO se toca. Los estados «solo sistema», los
--   estados iniciales, los sellos del aprobador y la separación solicitante/aprobador quedan exactamente como estaban.
--
--   Cada acción pasa por UNA comprobación común, `compras_exigir_permiso`, que verifica en este orden y solo para
--   sesiones de usuario (sin `auth.uid()` o con `conta.allow_system_write` no se aplica):
--     (1) empresa: salvo el superadministrador, el documento es de la empresa de la sesión (COMPRAS_ALCANCE_EMPRESA);
--         NULL-segura: una sesión SIN empresa (app_users.company_id NULL) tampoco pasa, aunque sea administrador;
--     (2) permiso: `user_has_permission(llave)`, que respeta el efecto «denegar» del rol, el vencimiento del rol
--         (`user_roles.expires_at`) y deja pasar a administrador, propietario y superadministrador
--         (COMPRAS_PERMISO_ACCION);
--     (3) proyecto: `can_access_project(proyecto del documento)` (COMPRAS_ALCANCE_PROYECTO). Todos son
--         ERRCODE insufficient_privilege (42501).
--   En un UPDATE se comprueba el documento TAL COMO ESTÁ (OLD) y, si ese mismo UPDATE cambia su empresa o su
--   proyecto, también como QUEDARÍA (NEW); en un INSERT, NEW. El texto de «falta el permiso» cita la ETIQUETA del
--   catálogo: para el genérico es el de siempre, «Cambiar estado — Contabilidad».
--
-- POR QUÉ EL ALCANCE VA AQUÍ Y NO EN LA RLS
--   Las políticas UPDATE/INSERT de ordenes_compra, recepciones, facturas_proveedor y ordenes_pago piden
--   `platform.contabilidad.edit`/`create` y la empresa, pero NO `can_access_project` (solo el SELECT lo trae).
--   Un UPDATE que no lee columnas de la fila (sin WHERE, o `WHERE true`) o una RPC SECURITY DEFINER (la RLS no
--   rige para el dueño) alcanza filas de OTRO proyecto de la empresa; con la RLS sola, quien tenía la llave la
--   ejercía sobre proyectos que no tiene asignados. Un UPDATE que sí lee columnas (`WHERE id = …`) ya no ve la
--   fila ajena (la política SELECT se suma) y afecta 0 filas: eso es correcto y la pantalla debe tratarlo como
--   «no se hizo nada» (`runAfectando`/`SinFilasAfectadasError`), nunca como éxito.
--   Un administrador CON asignaciones de proyecto no es exento (`user_is_project_exempt`): solo actúa en los suyos.
--
-- MOVER EL DOCUMENTO NO ES UN ATAJO (disparador `trg_zzcompras_mover_alcance`, en las cinco tablas)
--   La comprobación de proyecto de arriba solo corre cuando cambia el ESTADO. Una orden en borrador y una factura
--   de gasto directo (sin orden) pueden cambiar de `project_id`, y la RLS de UPDATE no mira el proyecto: quien
--   alcanzaba un documento «a ciegas» (UPDATE sin columnas en el WHERE, o una RPC definer) lo movía a SU proyecto y
--   después lo aprobaba de forma legítima. El disparador, SOLO para sesiones de usuario, exige para cambiar
--   `project_id` o `company_id` de un documento de compras: que sea de la empresa de la sesión (origen y destino;
--   el superadministrador, cualquiera), que la persona tenga acceso al proyecto en que está HOY y, si cambia de
--   proyecto, al de destino. Es deliberadamente ESTRECHO: no mira las ediciones que dejan el documento donde está
--   (eso sería «todo UPDATE» y cambiaría el comportamiento de ediciones que hoy pasan; queda como decisión
--   pendiente en el informe). Se salta la acción referencial de eliminar un proyecto (ON DELETE SET NULL de
--   `project_id`: el proyecto ya no existe y no es una edición de nadie) y los procesos de sistema. Su nombre lo
--   hace disparar DESPUÉS de los de permiso, sellos y alcance de referencias (orden alfabético), así quien no
--   tiene la llave recibe el error del permiso aunque tampoco tenga el proyecto.
--
-- QUÉ NO HACE
--   · NO concede NINGUNA llave nueva a NINGÚN rol, ni a las plantillas de sistema (tampoco a «Administrador
--     General»): ni siquiera a quien hoy tiene `approve` o `change_status`. Las asignaciones se proponen aparte
--     (propuesta_asignaciones.sql, SIN ejecutar, con cada concesión comentada y a confirmar por una persona).
--   · NO exige personas distintas en pasos distintos: separar los permisos NO es separar a las personas.
--   · NO toca la RLS, los grants ni ningún dato de usuarios, roles, asignaciones o documentos. Los disparadores de
--     permiso existentes no se recrean (solo cambian los cuerpos de cinco funciones); se añade UN disparador por tabla.
--
-- EFECTO EXPLÍCITO DE REUTILIZAR LA LLAVE DE LA PESTAÑA DE ÓRDENES DE COMPRA
--   Aprobar una orden de compra ya NO se decide con `platform.contabilidad.approve` sino con
--   `condominios.tab.ordenes_compra.approve`. Quien tiene esa llave de pestaña + `edit` y NO tiene
--   `platform.contabilidad.approve` pasa de «no podía aprobar en el servidor» a «puede» (la pantalla ya se lo
--   mostraba): el servidor se AMPLÍA para esa combinación; quien solo tenía `platform.contabilidad.approve`
--   deja de poder aprobar órdenes. Con la matriz de producción del 2026-10-09 solo cambia la plantilla de
--   sistema «Administrador General» (0 usuarios): ningún usuario real gana (ver INFORME.md §12.4).
--
-- OTROS CAMINOS QUE TRANSICIONAN ESTOS ESTADOS (revisado en la copia de hall_b0800)
--   Ninguna RPC, función ni disparador de sistema escribe estos estados con una sesión de usuario SIN pasar por
--   los cuatro disparadores de permiso: (i) las únicas escrituras de estado que hacen funciones son disparadores
--   AFTER de sistema, que corren con `conta.allow_system_write` en 'on' y mueven estados DERIVADOS: sobre
--   ordenes_compra (recibida, recibida_parcial, facturada, cerrada…, desde la recepción y la factura) y sobre
--   facturas_proveedor (pagada, pagada_parcial y lo pagado, desde la orden de pago, cuyo cambio SÍ pasa por el
--   permiso); (ii) `compras_orden_crear`, `compras_recepcion_crear` y `compras_factura_crear` solo insertan en el
--   estado inicial (constante en el cuerpo); (iii) ningún disparador BEFORE reescribe NEW.estado (los disparadores
--   `UPDATE OF estado` no se saltan); (iv) no hay vistas ni reglas sobre las cuatro tablas. Queda como límite
--   documentado que el GUC `conta.allow_system_write` lo puede poner una sesión con SQL arbitrario (no la API
--   REST, que no lo expone).
--
-- IMPACTO ANTES DE DESPLEGAR
--   EFECTO TRANSITORIO (aceptado): quien hoy actúa con `approve`/`change_status` genéricos PIERDE las cinco
--   llaves nuevas hasta que se le asignen (la orden de compra la conserva quien ya tenga la llave de la pestaña,
--   `condominios.tab.ordenes_compra.approve`; quien solo tenía `platform.contabilidad.approve` deja de aprobar
--   órdenes). Administradores, propietarios y superadministradores no cambian. Antes de fusionar, correr
--   matriz_antes_despues.sql (solo lectura) en producción: lista, por rol y por usuario, qué acciones tenían y
--   cuáles tendrán. En producción hoy: Alexander Monterroso (Finanzas / Contador) y Marco Santos Godoy (admin con 3
--   proyectos). Ninguna asignación de proyecto se modifica ni se amplía. El alcance de empresa y proyecto que
--   ahora también rige emitir/cancelar/cerrar y anular recepción, factura y contraseña no quita nada a quien
--   actúa sobre documentos de sus proyectos (los demás ni los ve).
--
-- CÓMO REVERTIR (sin pérdida de datos de documentos; ver reversion_pieza.sql)
--   Quitar el disparador trg_zzcompras_mover_alcance de las cinco tablas y su función; restaurar las cinco funciones
--   compras_tg_permiso_orden / _recepcion / _factura / _contrasena / _orden_pago a sus cuerpos de 20261027000700
--   (orden) y 20261027000300 (las otras cuatro), y DROP FUNCTION compras_exigir_permiso(text, text, uuid, uuid).
--   Las llaves de `permissions` pueden quedarse (inofensivas sin disparador que las use). BORRARLAS elimina en
--   cascada las filas de role_permissions que se hayan concedido: no se borran salvo que se pida.
-- ════════════════════════════════════════════════════════════════════════════

-- ── (a) Catálogo: cinco llaves nuevas ───────────────────────────────────────
-- Etiqueta «Compras y pagos — <acción>»: el editor de roles quita el prefijo hasta el primer « — » y muestra la
-- acción; por eso no lleva otro « — » dentro. Como el último segmento de la llave (recepcion_registrar, …) no es
-- view/create/edit/change_status/approve/delete, cada una forma su PROPIA fila con una casilla en «Ver».
INSERT INTO public.permissions (key, category, label, description) VALUES
  ('platform.contabilidad.compras.recepcion_registrar', 'platform_contabilidad',
   'Compras y pagos — Registrar una recepción',
   'Registrar una recepción de compra (pasa de borrador a registrada): mueve existencias y contabiliza lo recibido. Capturar la recepción sigue siendo «Crear — Contabilidad»; anularla, «Cambiar estado — Contabilidad».'),
  ('platform.contabilidad.compras.factura_aprobar', 'platform_contabilidad',
   'Compras y pagos — Aprobar una factura de proveedor',
   'Aprobar una factura de proveedor (pasa de registrada a aprobada): la cuadra contra la orden y la recepción y la contabiliza. Capturarla sigue siendo «Crear — Contabilidad»; anularla, «Cambiar estado — Contabilidad».'),
  ('platform.contabilidad.compras.orden_pago_aprobar', 'platform_contabilidad',
   'Compras y pagos — Aprobar una orden de pago',
   'Aprobar una orden de pago (pasa de borrador a aprobada) y reservar lo que se va a pagar de la factura. Solicitarla sigue siendo «Crear — Contabilidad». Pagarla y anularla son permisos aparte.'),
  ('platform.contabilidad.compras.pago_ejecutar', 'platform_contabilidad',
   'Compras y pagos — Ejecutar un pago',
   'Marcar pagada una orden de pago aprobada: contabiliza el egreso y deja lo pagado de la factura. Aprobar la orden de pago y anular el pago son permisos aparte.'),
  ('platform.contabilidad.compras.pago_anular', 'platform_contabilidad',
   'Compras y pagos — Anular un pago',
   'Anular una orden de pago en cualquier estado, también una ya pagada (devuelve a la factura lo pagado y reversa el egreso). Aprobar y ejecutar el pago son permisos aparte.')
ON CONFLICT (key) DO NOTHING;

-- Si una llave ya existía con otra categoría, la fila no se toca (DO NOTHING) pero el editor de roles la mostraría
-- en el grupo equivocado: se avisa para que una persona lo revise; no se corrige sola.
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT p.key, p.category
      FROM public.permissions p
     WHERE p.key IN ('platform.contabilidad.compras.recepcion_registrar',
                     'platform.contabilidad.compras.factura_aprobar',
                     'platform.contabilidad.compras.orden_pago_aprobar',
                     'platform.contabilidad.compras.pago_ejecutar',
                     'platform.contabilidad.compras.pago_anular')
       AND p.category <> 'platform_contabilidad'
  LOOP
    RAISE WARNING 'La llave % ya existía en la categoría «%» (se esperaba platform_contabilidad); no se modificó.', v.key, v.category;
  END LOOP;
END $$;

-- ── (b) Comprobación común de la acción ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_exigir_permiso(
  p_clave text, p_paso text, p_company_id uuid, p_project_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_etiqueta text;
BEGIN
  -- Sin usuario (servicio, mantenimiento) o con el permiso de sistema (un trigger que mueve un estado
  -- derivado): no es una decisión de una persona.
  IF NOT public.compras_sesion_usuario() THEN
    RETURN;
  END IF;

  -- (1) Empresa: el superadministrador actúa en cualquiera; los demás solo en la de su sesión. NULL-segura:
  -- si la sesión no tiene empresa (get_my_company_id() NULL) o el documento no la tiene, la comparación da NULL y
  -- `NOT NULL` no entraría al IF; se trata como «no es de mi empresa» (COALESCE).
  IF NOT (COALESCE(public.is_super_admin(), false)
          OR COALESCE(p_company_id = public.get_my_company_id(), false)) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_EMPRESA: para % el documento tiene que ser de la empresa de tu sesión.', p_paso
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (2) Permiso propio de la acción. user_has_permission respeta «denegar», el vencimiento del rol y deja pasar
  -- a administrador, propietario y superadministrador.
  IF NOT public.user_has_permission(p_clave) THEN
    SELECT p.label INTO v_etiqueta FROM public.permissions p WHERE p.key = p_clave;
    RAISE EXCEPTION 'COMPRAS_PERMISO_ACCION: para % tu perfil necesita el permiso «%».', p_paso, COALESCE(v_etiqueta, p_clave)
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (3) Proyecto: la RLS de escritura no lo pide (solo la de lectura), así que se verifica aquí. Un documento sin
  -- proyecto es de la empresa; un exento (superadministrador, propietario, administrador SIN asignaciones) pasa.
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: para % tu perfil necesita estar asignado al proyecto del documento.', p_paso
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.compras_exigir_permiso(text, text, uuid, uuid) IS
  'Interna de los triggers de compras: exige a una sesión de usuario que el documento sea de su empresa (salvo superadministrador; NULL-segura), el permiso PROPIO de la acción (llave exacta, respeta denegar y vencimiento) y acceso a su proyecto. Sin usuario o con el permiso de sistema no se aplica.';

-- ── (c) Disparadores de permiso: solo cambian los bloques de las acciones ───
-- Partiendo de las definiciones VIGENTES en hall_b0800 (pg_get_functiondef; las de 0300/0700 ya no son las vigentes
-- de las demás piezas). Los disparadores no cambian. Todas las transiciones con permiso pasan por
-- compras_exigir_permiso; las que no son de las seis acciones conservan `platform.contabilidad.change_status`.

-- Orden de compra: aprobar / devolver / nacer aprobada o emitida → `condominios.tab.ordenes_compra.approve`.
-- Emitir, cancelar y cerrar siguen con `platform.contabilidad.change_status` (ahora con empresa y proyecto).
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_orden()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_clave text;
  v_paso  text;
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado = 'borrador' THEN
      RETURN NEW;
    ELSIF NEW.estado = 'aprobada' THEN
      PERFORM public.compras_exigir_permiso('condominios.tab.ordenes_compra.approve', 'crear una orden de compra ya aprobada', NEW.company_id, NEW.project_id);
    ELSIF NEW.estado = 'emitida' THEN
      PERFORM public.compras_exigir_permiso('condominios.tab.ordenes_compra.approve', 'crear una orden de compra ya aprobada', NEW.company_id, NEW.project_id);
      PERFORM public.compras_exigir_permiso('platform.contabilidad.change_status', 'crear una orden de compra ya emitida', NEW.company_id, NEW.project_id);
    ELSE
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una orden de compra nace en borrador (o, con permiso, aprobada o emitida); no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.aprobada_por := auth.uid();     -- quién aprueba lo dice el servidor
    NEW.aprobada_at  := now();
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'borrador' AND NEW.estado = 'aprobada' THEN
    v_clave := 'condominios.tab.ordenes_compra.approve';  v_paso := 'aprobar una orden de compra';
  ELSIF OLD.estado = 'aprobada' AND NEW.estado = 'borrador' THEN
    v_clave := 'condominios.tab.ordenes_compra.approve';  v_paso := 'devolver a borrador una orden aprobada';
  ELSIF NEW.estado = 'emitida' THEN
    v_clave := 'platform.contabilidad.change_status';     v_paso := 'emitir una orden de compra al proveedor';
  ELSIF NEW.estado = 'cancelada' THEN
    v_clave := 'platform.contabilidad.change_status';     v_paso := 'cancelar una orden de compra';
  ELSIF NEW.estado = 'cerrada' THEN
    v_clave := 'platform.contabilidad.change_status';     v_paso := 'cerrar una orden de compra';
  ELSE
    RETURN NEW;
  END IF;
  PERFORM public.compras_exigir_permiso(v_clave, v_paso, OLD.company_id, OLD.project_id);
  IF (NEW.company_id, NEW.project_id) IS DISTINCT FROM (OLD.company_id, OLD.project_id) THEN
    PERFORM public.compras_exigir_permiso(v_clave, v_paso, NEW.company_id, NEW.project_id);
  END IF;
  IF OLD.estado = 'borrador' AND NEW.estado = 'aprobada' THEN
    NEW.aprobada_por := auth.uid();     -- quién aprueba lo dice el servidor
    NEW.aprobada_at  := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- Recepción: borrador → registrada → `…compras.recepcion_registrar`. Anular sigue con `change_status` (con alcance).
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_recepcion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_clave text;
  v_paso  text;
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una recepción nace en borrador y se registra después (eso mueve existencias y contabiliza); no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'registrada' THEN
    v_clave := 'platform.contabilidad.compras.recepcion_registrar';  v_paso := 'registrar una recepción (mueve existencias y contabiliza)';
  ELSIF NEW.estado = 'anulada' THEN
    v_clave := 'platform.contabilidad.change_status';                v_paso := 'anular una recepción';
  ELSE
    RETURN NEW;
  END IF;
  PERFORM public.compras_exigir_permiso(v_clave, v_paso, OLD.company_id, OLD.project_id);
  IF (NEW.company_id, NEW.project_id) IS DISTINCT FROM (OLD.company_id, OLD.project_id) THEN
    PERFORM public.compras_exigir_permiso(v_clave, v_paso, NEW.company_id, NEW.project_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Factura: registrada → aprobada → `…compras.factura_aprobar`. Anular sigue con `change_status` (con alcance).
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_factura()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_clave text;
  v_paso  text;
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'registrada' OR NEW.monto_pagado <> 0 THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una factura nace «registrada» y sin pagos; se aprueba (se cuadra y se contabiliza) y se paga después. No se crea ya «%» con % pagado.', NEW.estado, NEW.monto_pagado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Pagada / pagada parcial y el monto pagado los deja el trigger de pago.
  IF (NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado IN ('pagada', 'pagada_parcial'))
     OR NEW.monto_pagado IS DISTINCT FROM OLD.monto_pagado THEN
    RAISE EXCEPTION 'COMPRAS_ESTADO_SOLO_SISTEMA: lo pagado de una factura y su estado «pagada» los deja una orden de pago al pagarse; no se escriben a mano.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'aprobada' THEN
    v_clave := 'platform.contabilidad.compras.factura_aprobar';  v_paso := 'aprobar (contabilizar) una factura de proveedor';
  ELSIF NEW.estado = 'anulada' THEN
    v_clave := 'platform.contabilidad.change_status';            v_paso := 'anular una factura de proveedor';
  ELSE
    RETURN NEW;
  END IF;
  PERFORM public.compras_exigir_permiso(v_clave, v_paso, OLD.company_id, OLD.project_id);
  IF (NEW.company_id, NEW.project_id) IS DISTINCT FROM (OLD.company_id, OLD.project_id) THEN
    PERFORM public.compras_exigir_permiso(v_clave, v_paso, NEW.company_id, NEW.project_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Orden de pago: aprobar, pagar y anular, cada una con su llave.
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_orden_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_clave text;
  v_paso  text;
BEGIN
  IF NOT public.compras_sesion_usuario() OR TG_OP = 'INSERT'
     OR NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'aprobada' THEN
    v_clave := 'platform.contabilidad.compras.orden_pago_aprobar';
    v_paso  := 'aprobar una orden de pago';
  ELSIF NEW.estado = 'pagada' THEN
    v_clave := 'platform.contabilidad.compras.pago_ejecutar';
    v_paso  := 'marcar pagada una orden de pago (contabiliza el pago)';
  ELSIF NEW.estado = 'anulada' THEN
    v_clave := 'platform.contabilidad.compras.pago_anular';
    v_paso  := 'anular una orden de pago';
  ELSE
    RETURN NEW;
  END IF;
  PERFORM public.compras_exigir_permiso(v_clave, v_paso, OLD.company_id, OLD.project_id);
  IF (NEW.company_id, NEW.project_id) IS DISTINCT FROM (OLD.company_id, OLD.project_id) THEN
    PERFORM public.compras_exigir_permiso(v_clave, v_paso, NEW.company_id, NEW.project_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Contraseña de pago: anular sigue con `change_status` (con alcance). Que quede «pagada» solo lo hace el sistema.
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_contrasena()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'emitida' THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una contraseña de pago nace «emitida»; se paga con su orden de pago y se anula con motivo. No se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'pagada' THEN
    RAISE EXCEPTION 'COMPRAS_ESTADO_SOLO_SISTEMA: una contraseña queda «pagada» cuando se paga la orden de pago que la liquida; no se marca a mano.'
      USING ERRCODE = 'check_violation';
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_permiso('platform.contabilidad.change_status', 'anular una contraseña de pago', OLD.company_id, OLD.project_id);
    IF (NEW.company_id, NEW.project_id) IS DISTINCT FROM (OLD.company_id, OLD.project_id) THEN
      PERFORM public.compras_exigir_permiso('platform.contabilidad.change_status', 'anular una contraseña de pago', NEW.company_id, NEW.project_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── (d) Mover un documento de empresa o de proyecto: alcance en origen y destino ─────────────────────────────
-- BEFORE UPDATE OF project_id, company_id en las cinco tablas. Nombre `trg_zzcompras_mover_alcance`: dispara después de
-- los de permiso (`trg_compras_permiso_*`), sellos (`trg_compras_00_sellos_*`) y alcance de referencias
-- (`trg_compras_alcance_*`, 20261027000800, que NO se tocan ni se reemplazan). Ver «MOVER EL DOCUMENTO NO ES UN ATAJO».
CREATE OR REPLACE FUNCTION public.compras_tg_mover_alcance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;
  -- `UPDATE OF` dispara también cuando la columna está en el SET con el mismo valor: eso no mueve nada.
  IF NEW.project_id IS NOT DISTINCT FROM OLD.project_id
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
    RETURN NEW;
  END IF;
  -- Acción referencial de eliminar un proyecto (FK ON DELETE SET NULL de project_id): el proyecto ya no existe,
  -- no es una edición de nadie (misma salida que RG-3 / DEP-5 en 20261027000800).
  IF OLD.project_id IS NOT NULL AND NEW.project_id IS NULL
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RETURN NEW;
  END IF;

  -- Empresa: de origen y de destino, la de la sesión (el superadministrador, cualquiera). NULL-segura.
  IF NOT (COALESCE(public.is_super_admin(), false)
          OR (COALESCE(OLD.company_id = public.get_my_company_id(), false)
              AND COALESCE(NEW.company_id = public.get_my_company_id(), false))) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_EMPRESA: para mover un documento de compras el documento tiene que ser de la empresa de tu sesión, y seguir en ella.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Proyecto de origen y, si cambia, de destino. Sin proyecto = de la empresa (can_access_project(NULL) es true).
  IF NOT public.can_access_project(OLD.project_id) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: para mover un documento de compras tu perfil necesita estar asignado al proyecto en que está hoy.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id AND NOT public.can_access_project(NEW.project_id) THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_PROYECTO: para mover un documento de compras tu perfil necesita estar asignado al proyecto de destino.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.compras_tg_mover_alcance() IS
  'Disparador BEFORE UPDATE OF project_id, company_id de ordenes_compra, recepciones, facturas_proveedor, ordenes_pago y contrasenas_pago: solo para sesiones de usuario, mover un documento exige empresa de la sesión (origen y destino) y acceso al proyecto de origen y al de destino. No mira las ediciones que no lo mueven. Se salta la acción referencial de eliminar un proyecto.';

DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.ordenes_compra;
CREATE TRIGGER trg_zzcompras_mover_alcance BEFORE UPDATE OF project_id, company_id ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_mover_alcance();
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.recepciones;
CREATE TRIGGER trg_zzcompras_mover_alcance BEFORE UPDATE OF project_id, company_id ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_mover_alcance();
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.facturas_proveedor;
CREATE TRIGGER trg_zzcompras_mover_alcance BEFORE UPDATE OF project_id, company_id ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_mover_alcance();
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.ordenes_pago;
CREATE TRIGGER trg_zzcompras_mover_alcance BEFORE UPDATE OF project_id, company_id ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_mover_alcance();
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.contrasenas_pago;
CREATE TRIGGER trg_zzcompras_mover_alcance BEFORE UPDATE OF project_id, company_id ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_mover_alcance();

-- ── (e) Permisos de ejecución: solo los invocan los triggers ────────────────
REVOKE ALL ON FUNCTION public.compras_exigir_permiso(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_orden()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_recepcion()                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_factura()                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_orden_pago()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_contrasena()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_mover_alcance()                      FROM PUBLIC, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 2 · PROTECCIÓN DE LA SEPARACIÓN SOLICITANTE/APROBADOR
-- (fragmento: separacion/pieza.sql)
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA SEP · D2 / P-2 · el interruptor de la separación solicitante/aprobador
--             (compras_config.aprobacion_separada) solo cambia por una RPC, con motivo, y deja una
--             bitácora que nadie reescribe. Fragmento IDEMPOTENTE, sin BEGIN/COMMIT, para la migración 0900.
--
-- QUÉ FALLABA (comprobado sobre la base de 20261027000800; el prototipo P-2 cierra solo la mitad)
--   La política de compras_config solo exige `edit` (`delete` para borrar) y el trigger de la separación
--   (compras_tg_oc_ciclo) lee ESA fila. Quien solicita una orden y tiene `edit` podía apagar el interruptor,
--   aprobar lo suyo y volver a encenderlo. El prototipo P-2 cierra al editor, pero deja abierto:
--     · TRUNCATE: no pasa por RLS y `authenticated` conserva el privilegio sobre compras_config (hasta un operador
--       SIN permisos vaciaba la tabla y la separación quedaba apagada de todas las empresas).
--     · El administrador, el propietario y el super administrador cambian el interruptor SIN motivo y SIN rastro.
--     · Mover `company_id` (super administrador): la fila de la empresa desaparece.
--     · La AUSENCIA: si la fila falta por una vía que el trigger de fila no ve, nada recuerda que estuvo encendida y
--       quien edita la re-crea «apagada» (o la enciende por su cuenta). Lo mismo con DELETE + INSERT (reemplazo).
--
-- QUÉ HACE ESTA PIEZA
--   1. Tabla protegida `compras_config_separacion_bitacora` (empresa, actor sellado por el servidor, fecha, valor anterior,
--      valor nuevo, motivo, origen). Solo se ESCRIBE (trigger que rechaza UPDATE/DELETE/TRUNCATE a todos, RLS de lectura
--      para administrador/propietario de la empresa y super administrador, sin DML para ningún rol de la API).
--   2. RPC `compras_separacion_configurar(empresa, activa, motivo)`: ÚNICA vía para cambiar el interruptor desde una sesión
--      de usuario. Autoriza (super administrador, o propietario/administrador DE ESA empresa, con un perfil ACTIVO en app_users),
--      valida el alcance y el motivo,
--      serializa con un candado asesor por empresa, rechaza «sin cambio» y empresa inexistente (nunca finge éxito) y
--      devuelve el estado resultante.
--   3. Trigger de fila BEFORE sobre compras_config (INSERT/UPDATE/DELETE) y de sentencia BEFORE TRUNCATE: una sesión de usuario no
--      enciende, apaga, borra, vacía, reemplaza ni mueve la fila que tiene (o recuerda) la separación encendida, salvo la RPC.
--      Si la fila falta y la bitácora dice «activa», un INSERT de usuario nace ENCENDIDO (la ausencia no apaga).
--   4. Trigger AFTER de fila: TODA variación del valor establecido deja su fila en la bitácora (también las del sistema,
--      con actor sellado por el servidor y origen 'sistema'); y, como red de seguridad, rechaza lo que una carrera haya
--      dejado pasar el BEFORE.
--   5. Línea base: una fila de bitácora por cada empresa que ya tenga la separación encendida (hoy: ninguna en producción).
--
-- RONDA DE CORRECCIONES (escéptico independiente): todo lo siguiente lo demuestran pruebas ROJAS sin la corrección y VERDES con ella.
--   · Autorización con NULL (BLOQUEANTE): quien tiene un JWT válido pero NO tiene fila en app_users no tiene rol ni empresa
--     (current_user_role(), is_super_admin() y get_my_company_id() devuelven NULL) y `IF NOT (NULL OR NULL)` es NULL: no entra al IF.
--     Toda condición de autorización y de alcance se escribe ahora a prueba de NULL (COALESCE / IS TRUE: lo desconocido no autoriza)
--     y la RPC exige además un perfil ACTIVO en app_users. El resto de la pieza se revisó con el mismo criterio (ver cada función).
--   · Administrador desactivado: la RPC y la lectura de la bitácora exigen app_users.activo IS TRUE.
--   · Motivo útil: al menos 10 letras o cifras (no basta la longitud: «..........» o chr(1)×12 ya no valen) y al menos una letra
--     (un número no es una razón). Ver el detalle junto a la RPC.
--
-- QUÉ NO CAMBIA
--   · Los lectores del interruptor —compras_tg_oc_ciclo, compras_tg_permiso_orden_separada, compras_oc_excepcion_contrato—
--     siguen leyendo `compras_config.aprobacion_separada`, la MISMA fila, sin una segunda fuente que pueda divergir. La
--     bitácora es memoria y evidencia, no un segundo interruptor.
--   · Las demás columnas de compras_config (tolerancias, mínimo, requiere_recepcion) siguen editables con `edit`.
--   · No se enciende la separación en ninguna empresa, no hay umbrales ni prohibiciones entre personas nuevas.
--   · Los procesos sin sesión de usuario o con conta.allow_system_write (service_role, mantenimiento, la purga de una empresa)
--     cambian la configuración como siempre: quedan en la bitácora con origen 'sistema'. PENDIENTE DE DECISIÓN DEL DUEÑO (ver INFORME):
--     se mantiene a propósito; scripts/diagnostico-compras-controles.sql (vigilancia.sql) lista esos cambios para revisarlos.
--
-- ORDEN DE DISPARO en compras_config (alfabético): trg_compras_00_config_separacion (BEFORE fila) → trg_compras_config_touch
--   (BEFORE UPDATE, updated_at) → … → trg_zz_compras_config_separacion_bitacora (AFTER fila). El rechazo va primero: no se
--   toca nada de una fila que se va a rechazar.
--
-- LÍMITES (honestos)
--   · Quien tiene el rol de base de datos del propietario puede deshabilitar triggers (ALTER TABLE … DISABLE TRIGGER) o usar
--     session_replication_role = replica: no es una vía de la API y ningún trigger lo impide. Si la fila se borra así, la
--     bitácora sigue diciendo «activa»: un INSERT de usuario nace encendido y la RPC la restablece.
--   · El permiso de la RPC es un GUC local de la transacción (empresa:valor) que la RPC pone justo antes de escribir y borra justo
--     después: no sirve para otra empresa, para el valor contrario ni para sentencias posteriores. Con SQL directo (no la API)
--     cualquiera puede poner un GUC; de eso no protege un trigger.
--   · Los lectores ven la fila: mientras la fila falte por una vía sin trigger, la separación está apagada para ellos (D2).
--   · Un administrador SIGUE pudiendo apagar la separación (confianza plena en esa figura), pero solo por la RPC, con motivo,
--     y queda escrito quién, cuándo, de qué valor a cuál y por qué.
--   · La lectura de la memoria (última fila de la bitácora) asume READ COMMITTED, el nivel de PostgREST y de todo el repo.
--   · El motivo «útil» es higiene del rastro, no seguridad: un administrador siempre puede escribir «aaaaaaaaaa». «Alfanumérico» es el de la
--     locale de la base ([[:alnum:]]); se descuentan los rellenos Hangul invisibles, pero no se persigue todo Unicode (marcas combinantes, etc.).
--   · app_users.activo solo lo exigen la RPC, la lectura de la bitácora y el código de rechazo de esta pieza; el resto del repo (RLS de las demás
--     tablas, user_has_permission) no lo consulta: un usuario desactivado conserva allí lo que ya tenía. No se toca en esta pieza.
--
-- CÓMO REVERTIR: reversion_pieza.sql (sección para scripts/reversion-compras-controles.sql; comprobada: devuelve el catálogo EXACTO).
--   La bitácora es evidencia: se conserva si tiene algo más que la línea base, salvo SET compras.reversion_descartar_bitacora = 'si'.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · La bitácora ──────────────────────────────────────────────────────────
-- Sin llave foránea a companies ni a app_users, A PROPÓSITO: es memoria de auditoría y debe sobrevivir a la empresa y a la
-- persona (una FK en cascada chocaría con el trigger de inmutabilidad al purgar una empresa, y SET NULL reescribiría la fila).
-- `valor_anterior` NULL = línea base (sin antecedente). Toda fila es un CAMBIO real (anterior ≠ nuevo).
CREATE TABLE IF NOT EXISTS public.compras_config_separacion_bitacora (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     uuid        NOT NULL,
  actor_id       uuid,
  cambiado_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  valor_anterior boolean,
  valor_nuevo    boolean     NOT NULL,
  motivo         text,
  origen         text        NOT NULL,
  CONSTRAINT compras_config_sep_bit_origen_check  CHECK (origen IN ('usuario', 'sistema', 'linea_base')),
  CONSTRAINT compras_config_sep_bit_cambio_check  CHECK (valor_anterior IS DISTINCT FROM valor_nuevo),
  -- COALESCE: un motivo NULL daría NULL y un CHECK con NULL pasa.
  CONSTRAINT compras_config_sep_bit_usuario_check CHECK (origen <> 'usuario' OR (actor_id IS NOT NULL AND COALESCE(char_length(motivo), 0) >= 10)),
  CONSTRAINT compras_config_sep_bit_motivo_check  CHECK (motivo IS NULL OR motivo !~ '^[[:space:]]|[[:space:]]$')
);
-- Empresa/fecha: el listado de la pantalla. Empresa/id: la «última fila» (valor establecido) sin depender del reloj.
CREATE INDEX IF NOT EXISTS idx_compras_config_sep_bit_empresa_fecha ON public.compras_config_separacion_bitacora (company_id, cambiado_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_compras_config_sep_bit_empresa_id    ON public.compras_config_separacion_bitacora (company_id, id DESC);

COMMENT ON TABLE public.compras_config_separacion_bitacora IS
  'Bitácora APPEND-ONLY de los cambios del interruptor compras_config.aprobacion_separada. La última fila de una empresa es su valor establecido. La escribe el trigger de compras_config; nadie la edita ni la borra.';
COMMENT ON COLUMN public.compras_config_separacion_bitacora.actor_id IS
  'auth.uid() de la sesión, tomado en el servidor (nunca de un parámetro). NULL = sin sesión de usuario.';
COMMENT ON COLUMN public.compras_config_separacion_bitacora.origen IS
  'usuario = compras_separacion_configurar (con motivo) · sistema = proceso sin sesión de usuario o conta.allow_system_write · linea_base = ya estaba encendida cuando se creó la bitácora.';

-- Lectura: administrador/propietario de la empresa y super administrador, con un perfil ACTIVO en app_users. Escritura: ninguna
-- política y ningún privilegio. Una política que da NULL no muestra la fila, pero se escribe a prueba de NULL de todos modos: sin
-- perfil (JWT válido sin fila en app_users) o con el perfil desactivado, el resultado es siempre «ninguna fila».
ALTER TABLE public.compras_config_separacion_bitacora ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compras_config_separacion_bitacora_select ON public.compras_config_separacion_bitacora;
CREATE POLICY compras_config_separacion_bitacora_select ON public.compras_config_separacion_bitacora
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = (SELECT auth.uid()) AND u.activo IS TRUE)
         AND (COALESCE((SELECT public.is_super_admin()), false)
              OR (company_id = (SELECT public.get_my_company_id())
                  AND COALESCE((SELECT public.current_user_role()) IN ('company_owner', 'admin'), false))));
REVOKE ALL ON TABLE public.compras_config_separacion_bitacora FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.compras_config_separacion_bitacora TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.compras_config_separacion_bitacora_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- Inmutable PARA TODOS (también el propietario de la tabla y el super administrador): ni UPDATE ni DELETE ni TRUNCATE.
-- No es SECURITY DEFINER a propósito: no consulta nada y el rechazo no depende de quién llame.
CREATE OR REPLACE FUNCTION public.compras_tg_config_separacion_bitacora_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'COMPRAS_SEPARACION_BITACORA_INMUTABLE: la bitácora de la separación solicitante/aprobador solo se escribe; no se modifica, no se borra ni se vacía (% rechazado).', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
REVOKE ALL ON FUNCTION public.compras_tg_config_separacion_bitacora_inmutable() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_compras_00_sep_bitacora_inmutable ON public.compras_config_separacion_bitacora;
CREATE TRIGGER trg_compras_00_sep_bitacora_inmutable
  BEFORE UPDATE OR DELETE ON public.compras_config_separacion_bitacora
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_config_separacion_bitacora_inmutable();
DROP TRIGGER IF EXISTS trg_compras_00_sep_bitacora_sin_vaciar ON public.compras_config_separacion_bitacora;
CREATE TRIGGER trg_compras_00_sep_bitacora_sin_vaciar
  BEFORE TRUNCATE ON public.compras_config_separacion_bitacora
  FOR EACH STATEMENT EXECUTE FUNCTION public.compras_tg_config_separacion_bitacora_inmutable();

-- ── 2 · Línea base ───────────────────────────────────────────────────────────
-- Una fila por cada empresa que YA tiene la separación encendida y aún no tiene bitácora. Re-aplicar la migración no duplica
-- (NOT EXISTS por empresa) ni «resucita» una separación que un administrador apagó después (hay bitácora).
INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen)
SELECT c.company_id, NULL, NULL, true,
       'Línea base: la separación solicitante/aprobador ya estaba encendida cuando se creó esta bitácora.', 'linea_base'
  FROM public.compras_config c
 WHERE c.aprobacion_separada
   AND NOT EXISTS (SELECT 1 FROM public.compras_config_separacion_bitacora b WHERE b.company_id = c.company_id);

-- ── 3 · Ayudas internas (nadie las invoca desde la API) ──────────────────────
-- Valor ESTABLECIDO por la bitácora: su última fila (por id, no por fecha: el id sigue el orden del candado). NULL = sin bitácora.
CREATE OR REPLACE FUNCTION public.compras_separacion_memoria(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT b.valor_nuevo FROM public.compras_config_separacion_bitacora b
   WHERE b.company_id = p_company_id ORDER BY b.id DESC LIMIT 1
$$;

-- ¿Este cambio (empresa, valor) lo está haciendo la RPC? La RPC marca la transacción —y solo para ese cambio— con un GUC LOCAL
-- «empresa:valor» y lo borra al terminar la escritura: no se puede aprovechar para otra empresa, para el valor contrario ni
-- para sentencias posteriores de la misma transacción. Fuera de la API (SQL directo con rol propietario) cualquiera puede poner un
-- GUC: ese límite lo cubre quien administra la base, no un trigger.
CREATE OR REPLACE FUNCTION public.compras_separacion_via_rpc(p_company_id uuid, p_valor boolean)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  -- Siempre true o false, nunca NULL: quien llama la niega con NOT y un NOT NULL dejaría pasar (lo desconocido no autoriza).
  SELECT COALESCE(p_company_id IS NOT NULL AND p_valor IS NOT NULL
                  AND COALESCE(public.compras_sesion_usuario(), false)
                  AND COALESCE(current_setting('compras.separacion_rpc', true), '') = p_company_id::text || ':' || p_valor::text,
                  false)
$$;

-- El rechazo, con el código que corresponde a quien lo recibe: quien no es administrador, «solo el administrador»; al
-- administrador (y al super administrador) se le indica la vía.
CREATE OR REPLACE FUNCTION public.compras_separacion_rechazar(p_que text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- A prueba de NULL: sin perfil (o desactivado) no es administrador y recibe SOLO_ADMIN (el rechazo se da en ambos casos).
  IF EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = auth.uid() AND u.activo IS TRUE)
     AND (COALESCE(public.is_super_admin(), false) OR COALESCE(public.current_user_role() IN ('company_owner', 'admin'), false)) THEN
    RAISE EXCEPTION 'COMPRAS_CONFIG_SEPARACION_VIA_RPC: el interruptor de la separación solicitante/aprobador no se cambia escribiendo en compras_config (% rechazado, ni siquiera para el administrador): usa compras_separacion_configurar(empresa, activa, motivo), que valida el alcance, exige el motivo y deja la bitácora.', p_que
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RAISE EXCEPTION 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN: encender o apagar la separación solicitante/aprobador (o borrar, vaciar, reemplazar o mover la configuración que la tiene encendida: % rechazado) lo hace únicamente el administrador de la empresa, con un motivo, desde compras_separacion_configurar.', p_que
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Anota UN cambio del valor establecido. Si quien escribe es una sesión de usuario y no es la RPC, es una evasión que se coló
-- por una carrera con el BEFORE: se rechaza aquí (la sentencia entera se revierte). Una empresa que ya no existe (purga en
-- cascada) no es un cambio del interruptor: se anota como sistema.
CREATE OR REPLACE FUNCTION public.compras_separacion_registrar(p_company_id uuid, p_antes boolean, p_despues boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rpc boolean;
BEGIN
  IF p_antes IS NOT DISTINCT FROM p_despues THEN
    RETURN;
  END IF;
  v_rpc := COALESCE(public.compras_separacion_via_rpc(p_company_id, p_despues), false);
  -- Lo desconocido se trata como sesión de usuario (COALESCE(…, true)): si no se puede saber, se rechaza.
  IF COALESCE(public.compras_sesion_usuario(), true) AND NOT v_rpc
     AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    PERFORM public.compras_separacion_rechazar('cambio del interruptor');
  END IF;
  INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, motivo, origen)
  VALUES (p_company_id, auth.uid(), p_antes, p_despues,
          CASE WHEN v_rpc THEN current_setting('compras.separacion_motivo', true) END,
          CASE WHEN v_rpc THEN 'usuario' ELSE 'sistema' END);
END;
$$;

REVOKE ALL ON FUNCTION public.compras_separacion_memoria(uuid)                      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compras_separacion_via_rpc(uuid, boolean)             FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compras_separacion_rechazar(text)                     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compras_separacion_registrar(uuid, boolean, boolean)  FROM PUBLIC, anon, authenticated, service_role;

-- ── 4 · Triggers de compras_config ───────────────────────────────────────────
-- BEFORE de fila: el control. Solo juzga a las sesiones de usuario (auth.uid() presente y sin conta.allow_system_write).
--   INSERT  fila ausente: no nace encendida por INSERT (solo la RPC); si la bitácora dice «activa», nace ENCENDIDA (se fuerza).
--           fila presente (UPSERT o llave duplicada): lo que haga con el interruptor lo juzga el BEFORE UPDATE.
--   UPDATE  cambiar el interruptor ⇒ solo la RPC. Mover `company_id` de una configuración que tiene o recuerda la separación
--           encendida (en cualquiera de las dos empresas) ⇒ rechazado. Cambiar tolerancias, mínimo o requiere_recepcion ⇒ libre.
--   DELETE  borrar la fila que la tiene encendida ⇒ rechazado (sin fila = apagada). Excepción: la empresa ya no existe (purga).
CREATE OR REPLACE FUNCTION public.compras_tg_config_separacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_memoria boolean;
BEGIN
  -- IS FALSE y no NOT: si la sesión fuese desconocida (NULL) el control SÍ se aplica (lo desconocido no se exime).
  IF public.compras_sesion_usuario() IS FALSE THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;   -- sistema: se anota en el AFTER
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Misma llave de candado que la RPC: el INSERT y la RPC de una empresa no se pisan (ver compras_separacion_configurar).
    PERFORM pg_advisory_xact_lock(hashtext('compras_separacion'), hashtext(NEW.company_id::text));
    IF COALESCE(public.compras_separacion_via_rpc(NEW.company_id, NEW.aprobacion_separada), false) THEN
      RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM public.compras_config c WHERE c.company_id = NEW.company_id) THEN
      RETURN NEW;                                              -- UPSERT o llave duplicada: lo resuelve el BEFORE UPDATE / la llave
    END IF;
    v_memoria := public.compras_separacion_memoria(NEW.company_id);
    IF NEW.aprobacion_separada AND NOT COALESCE(v_memoria, false) THEN
      PERFORM public.compras_separacion_rechazar('INSERT con la separación encendida');
    ELSIF NOT NEW.aprobacion_separada AND COALESCE(v_memoria, false) THEN
      NEW.aprobacion_separada := true;                         -- la ausencia de la fila no apaga lo que estaba establecido
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      IF OLD.aprobacion_separada OR NEW.aprobacion_separada
         OR COALESCE(public.compras_separacion_memoria(OLD.company_id), false)
         OR COALESCE(public.compras_separacion_memoria(NEW.company_id), false) THEN
        PERFORM public.compras_separacion_rechazar('mover la configuración de empresa');
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.aprobacion_separada IS DISTINCT FROM OLD.aprobacion_separada
       AND NOT COALESCE(public.compras_separacion_via_rpc(NEW.company_id, NEW.aprobacion_separada), false) THEN
      PERFORM public.compras_separacion_rechazar('UPDATE del interruptor');
    END IF;
    RETURN NEW;

  ELSE
    IF OLD.aprobacion_separada AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = OLD.company_id) THEN
      PERFORM public.compras_separacion_rechazar('DELETE de la configuración encendida');
    END IF;
    RETURN OLD;
  END IF;
END;
$$;

-- BEFORE TRUNCATE de sentencia: vaciar la tabla apagaría la separación de TODAS las empresas y no pasa por RLS. Ninguna sesión de
-- usuario ni rol de la API (anon/authenticated, con o sin JWT) puede. Un proceso de sistema sí; las empresas que la tenían
-- encendida quedan anotadas como apagadas.
CREATE OR REPLACE FUNCTION public.compras_tg_config_separacion_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(public.compras_sesion_usuario(), true) OR COALESCE(current_setting('role', true) IN ('anon', 'authenticated'), true) THEN
    RAISE EXCEPTION 'COMPRAS_CONFIG_SEPARACION_TRUNCATE: la configuración de compras no se vacía desde una sesión de usuario: apagaría la separación solicitante/aprobador de todas las empresas.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.compras_config_separacion_bitacora (company_id, actor_id, valor_anterior, valor_nuevo, origen)
  SELECT c.company_id, auth.uid(), true, false, 'sistema'
    FROM public.compras_config c WHERE c.aprobacion_separada;
  RETURN NULL;
END;
$$;

-- AFTER de fila: la bitácora. Cada lado del cambio es (empresa, valor anterior, valor nuevo). El «anterior» de una fila que
-- existía es el que tenía (OLD); el de una fila que nace es el establecido por la bitácora (o apagado si no hay).
CREATE OR REPLACE FUNCTION public.compras_tg_config_separacion_bitacora()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.compras_separacion_registrar(NEW.company_id, COALESCE(public.compras_separacion_memoria(NEW.company_id), false), NEW.aprobacion_separada);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
      PERFORM public.compras_separacion_registrar(NEW.company_id, OLD.aprobacion_separada, NEW.aprobacion_separada);
    ELSE                                                       -- mover = borrar en una empresa + nacer en la otra
      PERFORM public.compras_separacion_registrar(OLD.company_id, OLD.aprobacion_separada, false);
      PERFORM public.compras_separacion_registrar(NEW.company_id, COALESCE(public.compras_separacion_memoria(NEW.company_id), false), NEW.aprobacion_separada);
    END IF;
  ELSE
    PERFORM public.compras_separacion_registrar(OLD.company_id, OLD.aprobacion_separada, false);   -- sin fila = apagada
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.compras_tg_config_separacion()           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compras_tg_config_separacion_truncate()  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compras_tg_config_separacion_bitacora()  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_compras_00_config_separacion ON public.compras_config;
CREATE TRIGGER trg_compras_00_config_separacion
  BEFORE INSERT OR UPDATE OR DELETE ON public.compras_config
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_config_separacion();
DROP TRIGGER IF EXISTS trg_compras_00_config_separacion_truncate ON public.compras_config;
CREATE TRIGGER trg_compras_00_config_separacion_truncate
  BEFORE TRUNCATE ON public.compras_config
  FOR EACH STATEMENT EXECUTE FUNCTION public.compras_tg_config_separacion_truncate();
DROP TRIGGER IF EXISTS trg_zz_compras_config_separacion_bitacora ON public.compras_config;
CREATE TRIGGER trg_zz_compras_config_separacion_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.compras_config
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_config_separacion_bitacora();

-- Privilegios de compras_config que ninguna sesión de la API necesita (la migración 20261026000200 dejó fuera esta tabla):
-- `anon` no tiene política alguna y TRUNCATE no pasa por RLS. El trigger de TRUNCATE sigue siendo el control; esto es la 2.ª capa.
REVOKE ALL ON TABLE public.compras_config FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.compras_config FROM authenticated;

-- ── 5 · La RPC ───────────────────────────────────────────────────────────────
-- ÚNICA vía para encender o apagar la separación desde una sesión de usuario. El actor lo sella el servidor (auth.uid()); no hay
-- parámetro de actor. Candado asesor por empresa (la misma llave que el BEFORE INSERT): dos administradores que conmutan a la vez
-- se serializan, el segundo ve el valor que dejó el primero, la bitácora no pierde ni duplica cambios y valor_anterior encadena.
-- Orden de bloqueo: candado asesor → fila de compras_config (FOR UPDATE). Las demás escrituras de usuario o bien toman el mismo
-- candado antes (INSERT) o bien no lo toman (UPDATE/DELETE de otras columnas): no hay ciclo de espera entre ellas.
-- Devuelve el estado resultante leído de la fila (no lo que se pidió): nunca anuncia lo que no quedó escrito.
CREATE OR REPLACE FUNCTION public.compras_separacion_configurar(p_company_id uuid, p_activa boolean, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_motivo    text;
  v_util      text;         -- el motivo sin espacios ni signos: solo letras y cifras (según la configuración regional de la base)
  v_existe    boolean;
  v_fila      boolean;      -- lo que lee el circuito (NULL = sin fila)
  v_memoria   boolean;      -- lo establecido por la bitácora (NULL = sin bitácora)
  v_antes     boolean;      -- «valor anterior» que quedará en la bitácora
  v_igual     boolean;      -- ¿ya está como se pide?
  v_registra  boolean;      -- ¿este cambio mueve el valor establecido (y por lo tanto deja fila en la bitácora)?
  v_ultimo    bigint;
  v_final     boolean;
  v_bit       public.compras_config_separacion_bitacora%ROWTYPE;
  v_n         integer;
BEGIN
  -- AUTORIZACIÓN A PRUEBA DE NULL. Quien tiene un JWT válido pero NO tiene fila en app_users no tiene rol ni empresa:
  -- current_user_role(), is_super_admin() y get_my_company_id() devuelven NULL y `IF NOT (NULL OR NULL)` es NULL, que NO entra al IF
  -- (la autorización se saltaba entera). Aquí lo desconocido NO autoriza: cada condición se lleva a true/false con COALESCE.
  IF NOT COALESCE(public.compras_sesion_usuario(), false) THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_SESION: cambiar la separación solicitante/aprobador exige una sesión de usuario: el actor lo toma el servidor de la sesión.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_company_id IS NULL OR p_activa IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_PARAMETROS: indica la empresa y si la separación queda activa (true) o desactivada (false).'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT (COALESCE(public.is_super_admin(), false) OR COALESCE(public.current_user_role() IN ('company_owner', 'admin'), false)) THEN
    RAISE EXCEPTION 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN: encender o apagar la separación solicitante/aprobador lo hace únicamente el administrador de la empresa (o el super administrador).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT COALESCE(public.is_super_admin(), false) AND p_company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'COMPRAS_ALCANCE_EMPRESA: la separación solicitante/aprobador solo la cambia el administrador DE ESA empresa.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Y un perfil que EXISTA y esté ACTIVO (app_users.activo): un administrador desactivado ya no cambia el control. Va después del rol y
  -- del alcance, con su propio código, para que cada capa tenga su firma y se pueda probar por separado.
  IF NOT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = v_uid AND u.activo IS TRUE) THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_PERFIL: tu usuario no tiene un perfil activo en la aplicación; la separación solicitante/aprobador solo la cambia un administrador activo.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id) THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_EMPRESA_INEXISTENTE: la empresa % no existe; no se cambió nada.', p_company_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Motivo: sin espacios (ni saltos de línea, ni espacios duros o de ancho cero) en los extremos y de 10 a 1000 caracteres; y ÚTIL:
  --   · al menos 10 caracteres alfanuméricos (letras o cifras: se quitan los espacios, los signos y los caracteres de control o invisibles
  --     antes de contar), de modo que «..........», «----------» o chr(1)×12 no valen aunque midan lo suficiente;
  --   · y al menos una letra: una cifra o un folio suelto no es una razón («0000000000», «1234567890»); «Folio 2026-0415 de cierre» sí vale.
  -- «Alfanumérico» es el de la configuración regional de la base ([[:alnum:]]): en UTF8 con una locale que entiende Unicode cuentan
  -- también las letras con tilde y la eñe; en SQL_ASCII o con locale C solo las ASCII (un motivo real en español siempre trae de sobra:
  -- «Se reactiva por auditoría interna 2026» pasa en todas). Es higiene del rastro, no un juicio sobre el contenido: «aaaaaaaaaa» pasa.
  -- Los rellenos Hangul (U+115F, U+1160, U+3164, U+FFA0) son «letras» (categoría Lo) que no se ven: se descuentan expresamente. Límite
  -- conocido: otras marcas combinantes o signos sueltos pueden contar como alfanuméricos en algunas locales; no se persigue todo Unicode.
  -- La longitud se acota ANTES de recorrer el texto con las expresiones regulares (un motivo de megabytes no cuesta nada).
  v_motivo := regexp_replace(COALESCE(p_motivo, ''), '^[\s\u00a0\u200b\ufeff]+|[\s\u00a0\u200b\ufeff]+$', '', 'g');
  IF char_length(v_motivo) > 1000 THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_MOTIVO: el motivo no puede pasar de 1000 caracteres (tiene %).', char_length(v_motivo)
      USING ERRCODE = 'check_violation';
  END IF;
  v_util := regexp_replace(v_motivo, '[^[:alnum:]]|[\u115f\u1160\u3164\uffa0]', '', 'g');
  IF char_length(v_util) < 10 OR v_util !~ '[[:alpha:]]' THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_MOTIVO: cambiar la separación exige un motivo real: al menos 10 letras o cifras (sin contar espacios, signos ni caracteres invisibles) y al menos una letra.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('compras_separacion'), hashtext(p_company_id::text));
  SELECT c.aprobacion_separada INTO v_fila FROM public.compras_config c WHERE c.company_id = p_company_id FOR UPDATE;
  v_existe  := FOUND;
  v_memoria := public.compras_separacion_memoria(p_company_id);

  -- «Sin cambio»: pedir lo que ya es no es una operación y no se finge éxito. Con fila, lo que dice la fila (lo que lee el circuito);
  -- sin fila (= apagada), solo si la bitácora tampoco da la separación por establecida.
  v_igual := CASE WHEN v_existe THEN v_fila = p_activa ELSE NOT p_activa AND NOT COALESCE(v_memoria, false) END;
  IF v_igual THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_SIN_CAMBIO: la separación solicitante/aprobador de la empresa ya está %; no se cambió nada.',
      CASE WHEN p_activa THEN 'activada' ELSE 'desactivada' END
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lo que anotará el trigger como «anterior»: lo que tenía la fila o, si no había fila, lo establecido por la bitácora. Si ya
  -- coincide con lo pedido (fila ausente y bitácora «activa» al volver a activar) no hay cambio que anotar: solo se restablece la fila.
  v_antes    := CASE WHEN v_existe THEN v_fila ELSE COALESCE(v_memoria, false) END;
  v_registra := v_antes IS DISTINCT FROM p_activa;
  v_ultimo   := COALESCE((SELECT max(b.id) FROM public.compras_config_separacion_bitacora b WHERE b.company_id = p_company_id), 0);

  PERFORM set_config('compras.separacion_rpc', p_company_id::text || ':' || p_activa::text, true);
  PERFORM set_config('compras.separacion_motivo', v_motivo, true);
  IF v_existe THEN
    UPDATE public.compras_config SET aprobacion_separada = p_activa WHERE company_id = p_company_id;
  ELSE
    INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (p_company_id, p_activa)
      ON CONFLICT (company_id) DO NOTHING;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('compras.separacion_rpc', '', true);       -- el permiso de la RPC vale para esa escritura, no para el resto
  PERFORM set_config('compras.separacion_motivo', '', true);    -- de la transacción
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_NO_APLICADA: la configuración de la empresa cambió mientras se aplicaba el cambio; no se cambió nada. Reintenta.'
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT c.aprobacion_separada INTO v_final FROM public.compras_config c WHERE c.company_id = p_company_id;
  IF v_final IS DISTINCT FROM p_activa THEN
    RAISE EXCEPTION 'COMPRAS_SEPARACION_NO_APLICADA: la configuración quedó en % y se pidió %; no se cambió nada.', v_final, p_activa
      USING ERRCODE = 'serialization_failure';
  END IF;

  SELECT b.* INTO v_bit FROM public.compras_config_separacion_bitacora b
   WHERE b.company_id = p_company_id AND b.id > v_ultimo ORDER BY b.id DESC LIMIT 1;
  IF v_registra AND v_bit.id IS NULL THEN
    -- El cambio se escribió pero la bitácora no (triggers deshabilitados): no hay cambio sin rastro.
    RAISE EXCEPTION 'COMPRAS_SEPARACION_SIN_BITACORA: el cambio no dejó rastro en la bitácora; se revierte.'
      USING ERRCODE = 'internal_error';
  END IF;

  RETURN jsonb_build_object(
    'company_id',          p_company_id,
    'aprobacion_separada', v_final,
    'valor_anterior',      v_antes,
    'motivo',              v_motivo,
    'actor_id',            v_uid,
    'cambiado_at',         COALESCE(v_bit.cambiado_at, clock_timestamp()),
    'bitacora_id',         v_bit.id,
    -- true: la fila no existía pero la bitácora ya daba el valor por establecido; solo se restableció la fila (no es un cambio nuevo).
    'restablecida',        NOT v_registra);
END;
$$;

REVOKE ALL ON FUNCTION public.compras_separacion_configurar(uuid, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.compras_separacion_configurar(uuid, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.compras_separacion_configurar(uuid, boolean, text) IS
  'Enciende/apaga la separación solicitante/aprobador de una empresa. Solo propietario/administrador ACTIVO de esa empresa o super administrador activo (quien no tiene perfil en app_users no es nadie); motivo real obligatorio (10–1000 caracteres, al menos 10 letras o cifras y una letra); deja bitácora; rechaza empresa inexistente y «sin cambio». Devuelve el estado resultante.';


-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 3a · NÚMEROS DE FACTURA (alternativa A de RG-4): funciones y disparador
-- (fragmento: factura/pieza.sql)
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA · RG-4 (alternativa A) · números de factura que se parecen pero son distintos
-- ════════════════════════════════════════════════════════════════════════════
-- Fragmento IDEMPOTENTE para pegar en la migración 20261027000900 (sin BEGIN/COMMIT).
--
-- DEFECTO (RG-4). compras_normalizar_numero borra todo lo que no es A-Z0-9, así que dos números
--   válidos y DISTINTOS que concatenan igual («1-23» = serie 1, correlativo 23; «12-3» = serie 12,
--   correlativo 3) se rechazaban como duplicado, sin salida alguna ni para un administrador.
--
-- REGLA (decisión D3, alternativa A). Dos números son «el mismo» —se rechaza el segundo— si tienen la
--   misma clave alfanumérica (la que indexa idx_facturas_prov_numero_norm) Y sus separadores son
--   COMPATIBLES. Perfil de separadores = en qué posiciones de la clave hay un separador entre dos
--   caracteres alfanuméricos («1-23» → {1}; «12-3» → {2}; «FAC-001» → {3}; «FAC001» → {}); los separadores
--   de los extremos y el TIPO de separador (guion, punto, espacio, barra…) no cuentan. Compatibles = el
--   perfil de uno está incluido en el del otro. Se tratan como DISTINTOS solo cuando AMBOS traen
--   separadores y ninguno incluye al otro («1-23» / «12-3»; «A-12» / «A1-2»). Un número con separador
--   frente a uno sin él («1-23» / «123») sigue rechazándose (ambiguo: del lado seguro, como en 0400).
--
-- UNA SOLA NORMALIZACIÓN. La clave del índice, la del candado consultivo y la de la consulta de duplicados
--   salen de compras_normalizar_numero (STRICT desde 0800): el trigger la calcula UNA vez (v_norm) y la
--   usa para el candado y para la consulta, y la consulta compara contra la MISMA expresión del índice.
--   El índice NO cambia (no hay REINDEX ni candado de tabla): el perfil de separadores solo se evalúa
--   sobre los pocos candidatos que el índice devuelve. Estas funciones no aportan una segunda clave.
--
-- CUERPO FINAL DEL TRIGGER = el vigente tras 0800 (EV-09: el mensaje solo nombra lo que la persona ve,
--   ORDER BY compras_puede_ver_documento DESC) + el predicado «numero_factura IS NOT NULL» (DEP-2, pata 2)
--   + el criterio de separadores (RG-4). Mismo SQLSTATE (23505) y mismo CONSTRAINT (uq_facturas_prov_numero):
--   los clientes y las pruebas existentes no cambian. NO recrea el trigger ni el índice: solo funciones.
--
-- NO HACE: no crea ningún índice único (ningún dato existente puede hacerla fallar), no toca filas, no
--   fusiona ni renumera facturas. Un par equivalente PREEXISTENTE no se revalida (el trigger solo evalúa
--   el alta y el cambio de número/proveedor). No retiene ningún candado sobre facturas_proveedor.
--
-- SUGERENCIA DEL AVISO (ronda de correcciones). El aviso que nombra la factura existente distingue tres casos según cómo se
--   relacionan los separadores de los dos números (el candidato ya pasó el filtro, así que un perfil incluye al otro):
--     · el que se escribe trae MENOS separadores («123» frente a «1-23») → «escríbelo tal como viene impreso, con su guion…; si ya lo
--       escribiste así, la existente se registró con más separadores: corrige o anula esa primero»;
--     · el que se escribe trae MÁS («1-23» frente a «123»; «A-1-2» frente a «A-12») → «la existente se registró con menos
--       separadores…: corrige o anula esa primero» (ya no manda a escribir el guion que la persona acaba de escribir);
--     · IGUALES («ocu 7002» frente a «OCU-7002») → difieren solo en mayúsculas, espacios o tipo de separador.
--   EV-09: esa redacción depende de la estructura de la factura existente, así que SOLO se usa donde la persona ya la ve. El aviso
--   genérico (factura de un proyecto que no ve) es UN solo texto constante: no cambia con la estructura de la oculta.
--
-- LÍMITES CONOCIDOS (los dos primeros heredados de 0400, no introducidos aquí; con prueba en el INFORME y en RG-4.limites.sh):
--   · Una transacción en REPEATABLE READ / SERIALIZABLE cuya instantánea es anterior al alta de otra sesión no ve a
--     esa otra factura (el candado la serializa, pero la instantánea es vieja). PostgREST/Supabase usa READ COMMITTED.
--   · Reactivar una factura anulada solo cambia `estado`, que este trigger no vigila; lo cierra cxp_proteger_factura
--     (CXP_INMUTABLE) para toda sesión de usuario. El camino de sistema (conta.allow_system_write = on) no pasa por ahí.
--   · Un número SIN separador frente a dos con separadores en posiciones distintas («123» / «1-23» + «12-3») se
--     rechaza (ambiguo, del lado seguro): quien tenga «1-23» y «12-3» no puede registrar «123» del mismo proveedor.
--   · Caracteres INVISIBLES o de formato dentro del número (U+200B espacio de ancho cero, U+00AD guion blando…, típicos de pegar
--     desde un PDF) cuentan como separador al calcular el perfil: «F<U+200B>AC001» tiene el perfil {1} y «FAC-001» el {3}, así que se
--     tratan como distintas y un duplicado real escrito así deja de detectarse (0800 lo rechazaba). Solo en el interior: al principio o
--     al final se recortan. NO se corrige aquí: ni con \uXXXX en un regexp (falla en bases SQL_ASCII, como la plantilla local) ni con
--     chr(>127); ignorar «cualquier otro no alfanumérico» en el perfil cambiaría la alternativa A (el guion largo «–», separador
--     legítimo de muchos PDF, dejaría de distinguir «1–23» de «12–3»). Límite de la alternativa A: ver INFORME «Límites documentados».
--   · Sondeo: quien NO ve una factura puede deducir su estructura de separadores probando números (rechazo = compatible, alta =
--     incomparable); 0800 solo dejaba saber que existe la clave. Hay que adivinar la clave y el mensaje no revela nada más (EV-09).
--   · De los 5 pares «ambiguos» de RG-4.comparacion.sql se rechazan 3. «FAC-001»/«FA-C001» y «1.234»/«12.34» PASAN: tienen la
--     MISMA forma (un separador por número, en posición distinta, tipo de separador indiferente) que «B-100»/«B1-00» y
--     «2-345»/«23-45», que deben pasar; ninguna regla que mire solo la estructura puede separarlos (prueba [RG-4·forma]).
--
-- PARTE 2 (recomendada, archivo aparte): pieza_factura_crear.sql. La pantalla crea facturas SOLO por
--   compras_factura_crear, que reescribe el mensaje del trigger; sin la parte 2 la sugerencia de abajo no llega a la pantalla.
--
-- CÓMO REVERTIR (sin pérdida de datos; el orden importa): reversion_RG-4.sql — primero CREATE OR REPLACE
--   compras_tg_factura_numero_equivalente (cuerpo y comentario de 20261027000800; copia exacta en
--   `vigente_0800_trigger.sql`) y compras_factura_crear, después DROP FUNCTION public.compras_numeros_equivalentes(text, text)
--   y DROP FUNCTION public.compras_numero_separadores(text). Comprobado: devuelve el catálogo EXACTO a hall_b0800.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Perfil de separadores de un número ──────────────────────────────────────
-- Posiciones (sobre la clave alfanumérica) donde hay un separador entre dos caracteres alfanuméricos.
-- Usa la misma clase de caracteres que compras_normalizar_numero ([^A-Z0-9] tras upper()); la prueba
-- RG-4 la contrasta con una implementación de referencia carácter a carácter.
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
  'Posiciones, sobre la clave alfanumérica del número, donde hay un separador entre dos caracteres alfanuméricos («1-23» → {1}; «FAC001» → {}). Los separadores de los extremos y el tipo de separador no cuentan. Para distinguir «1-23» de «12-3» (RG-4).';

-- ── ¿Pueden ser la misma factura? ───────────────────────────────────────────
-- Misma clave alfanumérica Y separadores compatibles (el perfil de uno incluido en el del otro).
-- Sin clave (solo separadores) no hay identidad que comparar: falso.
CREATE OR REPLACE FUNCTION public.compras_numeros_equivalentes(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
  SELECT COALESCE(
           public.compras_normalizar_numero(p_a) = public.compras_normalizar_numero(p_b)
           AND (   public.compras_numero_separadores(p_a) <@ public.compras_numero_separadores(p_b)
                OR public.compras_numero_separadores(p_b) <@ public.compras_numero_separadores(p_a)),
           false)
$$;

COMMENT ON FUNCTION public.compras_numeros_equivalentes(text, text) IS
  'Dos números de factura que pueden ser la misma: igual clave alfanumérica (compras_normalizar_numero) y separadores compatibles (uno incluido en el otro). «1-23» y «12-3» NO lo son; «FAC-001» y «FAC001» sí; «1-23» y «123» sí (ambiguo: se rechaza).';

-- Solo las usa el trigger (SECURITY DEFINER): no se exponen a los roles de la API.
REVOKE ALL ON FUNCTION public.compras_numero_separadores(text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_numeros_equivalentes(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compras_numero_separadores(text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.compras_numeros_equivalentes(text, text) TO service_role;

-- ── Trigger: cuerpo vigente (0400 + EV-09 de 0800) + [DEP-2] pata 2 + [RG-4] ──
CREATE OR REPLACE FUNCTION public.compras_tg_factura_numero_equivalente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_norm text := public.compras_normalizar_numero(NEW.numero_factura);
  v_dup  record;
  v_pn   integer[];   -- perfil de separadores del número que se escribe
  v_pe   integer[];   -- perfil de separadores del número de la factura existente
  v_que  text;        -- qué hacer, según cómo se relacionan los dos perfiles
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
  -- La clave del candado es v_norm, la MISMA que la de la consulta de abajo y la del índice; dos números
  -- equivalentes comparten siempre v_norm, así que siempre se serializan («1-23» y «12-3» también, sin
  -- consecuencia: la segunda ve a la primera y la deja pasar).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('factura-numero:' || NEW.company_id::text || ':' || NEW.proveedor_id::text || ':' || v_norm, 0));

  -- [EV-09] se trae también el proyecto de la factura existente, y se prefiere una que la
  -- persona pueda ver para que el mensaje, si nombra algo, nombre algo suyo.
  SELECT f.numero_factura, f.estado, f.fecha_emision, f.monto_total, f.company_id, f.project_id INTO v_dup
    FROM public.facturas_proveedor f
   WHERE f.company_id   = NEW.company_id
     AND f.proveedor_id = NEW.proveedor_id
     AND f.id          <> NEW.id
     AND f.estado      <> 'anulada'
     AND f.numero_factura IS NOT NULL            -- [DEP-2] hace demostrable el predicado del índice parcial
     -- El número IDÉNTICO lo rechaza el índice único `uq_facturas_prov_numero` con su error
     -- de siempre; aquí solo el mismo número escrito de otra forma.
     AND f.numero_factura IS DISTINCT FROM NEW.numero_factura
     AND public.compras_normalizar_numero(f.numero_factura) = v_norm      -- candidatos: los devuelve el índice
     AND public.compras_numeros_equivalentes(f.numero_factura, NEW.numero_factura)   -- [RG-4] separadores compatibles
   ORDER BY public.compras_puede_ver_documento(f.company_id, f.project_id) DESC
   LIMIT 1;

  IF FOUND THEN
    -- Mismo SQLSTATE y mismo nombre de restricción que el índice único exacto: la RPC
    -- `compras_factura_crear` ya traduce ese error y el cliente ya lo muestra.
    -- [EV-09] si la factura existente es de un proyecto que la persona no ve, el mensaje no
    -- dice su número, fecha, importe ni estado (el aviso de duplicado se conserva).
    IF public.compras_puede_ver_documento(v_dup.company_id, v_dup.project_id) THEN
      -- [RG-4] La sugerencia depende de cómo se relacionan los separadores de los dos números, y solo se da aquí,
      -- donde la persona ya ve la factura existente (su estructura no es un dato nuevo para ella). El candidato
      -- pasó el filtro de equivalencia, así que un perfil incluye al otro: igual, el existente trae menos, o el nuevo.
      v_pn := public.compras_numero_separadores(NEW.numero_factura);
      v_pe := public.compras_numero_separadores(v_dup.numero_factura);
      v_que := CASE
        WHEN v_pn = v_pe THEN
          'Si es otra, revisa que su número esté escrito tal como viene impreso; si lo está, la existente solo difiere en mayúsculas, espacios o tipo de separador: corrige o anula esa primero.'
        WHEN v_pe <@ v_pn THEN
          'Si es otra, la existente se registró con menos separadores que el número que escribiste: corrige o anula esa primero.'
        ELSE
          'Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo (p. ej. «A-123»); si ya lo escribiste así, la existente se registró con más separadores: corrige o anula esa primero.'
        END;
      RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («%», % por %, %). Si es la misma, no la registres otra vez. %',
        v_dup.numero_factura, to_char(v_dup.fecha_emision, 'DD/MM/YYYY'), v_dup.monto_total, v_dup.estado, v_que
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_facturas_prov_numero';
    END IF;
    -- [RG-4] El aviso genérico NO mira los separadores de la factura que la persona no ve: el mismo texto para
    -- cualquier factura oculta (quien sondea no aprende su estructura por la redacción); ver INFORME, límite EV-09.
    RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente. Si es la misma, no la registres otra vez. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo (p. ej. «A-123»); si ya lo escribiste así, pide a quien administra las facturas que corrija o anule primero la existente.'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_facturas_prov_numero';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_factura_numero_equivalente() IS
  'Rechaza una factura cuyo número, ignorando mayúsculas, espacios y puntuación, ya existe (no anulada) para el mismo proveedor, salvo que ambos traigan separadores en posiciones distintas («1-23» ≠ «12-3»; RG-4). Solo al nacer o al cambiar número/proveedor. Candidatos por idx_facturas_prov_numero_norm; la clave del candado, la del índice y la de la consulta son compras_normalizar_numero. El aviso sugiere según los separadores (más, menos o iguales) solo si la persona ve la factura existente (EV-09).';

REVOKE ALL ON FUNCTION public.compras_tg_factura_numero_equivalente() FROM PUBLIC, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 3b · compras_factura_crear deja pasar el mensaje del disparador
-- (fragmento: factura/pieza_factura_crear.sql)
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA RG-4 · PARTE 2 (recomendada) · compras_factura_crear conserva el mensaje del trigger de equivalencia
-- ════════════════════════════════════════════════════════════════════════════
-- Fragmento IDEMPOTENTE para pegar en la migración 20261027000900 DESPUÉS de pieza.sql (sin BEGIN/COMMIT).
--
-- DEFECTO. La pantalla crea facturas SOLO por esta RPC. Su manejador de `unique_violation` traducía TODO error de
--   la restricción `uq_facturas_prov_numero` a «…con el número "<lo que escribió la persona>"…», también el que
--   levanta el TRIGGER de equivalencia (mismo SQLSTATE y misma restricción a propósito). Con la regla nueva eso
--   engaña: quien escribe «123» frente a una «1-23» ya registrada lee «ya hay una factura con el número "123"»;
--   y el mensaje del trigger —que nombra la factura existente solo si la persona la ve (EV-09) y explica cómo
--   registrar la otra («escribe su número tal como viene impreso…»)— nunca llega a la pantalla.
--
-- CORRECCIÓN (3 líneas sobre el cuerpo VIGENTE tras 0800, copiado del catálogo): el manejador captura
--   MESSAGE_TEXT y, si el error ya viene con el código COMPRAS_FACTURA_NUMERO_DUPLICADO (lo levantó el trigger), lo
--   re-lanza TAL CUAL. El número IDÉNTICO (lo rechaza el índice único, con su mensaje nativo) se traduce como siempre.
--   Mismo SQLSTATE (23505). La idempotencia no cambia: el reintento con la misma clave se recupera ANTES de insertar.
--
-- CÓMO REVERTIR: CREATE OR REPLACE con el cuerpo de 20261021000900 / 0800 (copia exacta en
--   `vigente_0800_factura_crear.sql`).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.compras_factura_crear(p_company_id uuid, p_project_id uuid, p_cabecera jsonb, p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_clave   text    := NULLIF(btrim(COALESCE(p_cabecera->>'clave_idempotencia', '')), '');
  v_prov    uuid    := NULLIF(p_cabecera->>'proveedor_id', '')::uuid;
  v_orden   uuid    := NULLIF(p_cabecera->>'orden_compra_id', '')::uuid;
  v_numero  text    := NULLIF(btrim(COALESCE(p_cabecera->>'numero_factura', '')), '');
  v_emision date    := COALESCE(NULLIF(p_cabecera->>'fecha_emision', '')::date, CURRENT_DATE);
  v_vence   date    := NULLIF(p_cabecera->>'fecha_vencimiento', '')::date;
  v_concepto text   := NULLIF(btrim(COALESCE(p_cabecera->>'concepto', '')), '');
  v_categ   text    := COALESCE(NULLIF(btrim(COALESCE(p_cabecera->>'categoria', '')), ''), 'otros');
  v_moneda  text    := NULLIF(upper(btrim(COALESCE(p_cabecera->>'moneda', ''))), '');
  v_notas   text    := NULLIF(btrim(COALESCE(p_cabecera->>'notas', '')), '');
  v_monto   numeric;
  v_iva     numeric;
  v_base    text;
  v_o       public.ordenes_compra%ROWTYPE;
  v_cab     jsonb;
  v_norm    jsonb;
  v_hash    text;
  v_exist   public.facturas_proveedor%ROWTYPE;
  v_fac     public.facturas_proveedor%ROWTYPE;
  v_n       int;
  v_invalid int;
  v_ajenas  int;
  v_dist    int;
  v_cons    text;
  v_msg     text;
  v_estado  text;
BEGIN
  -- ── Quién llama y dónde ──────────────────────────────────────────────────
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_EMPRESA: falta la empresa de la factura.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (public.is_super_admin() OR p_company_id = public.get_my_company_id()) THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_EMPRESA: no se registran facturas en una empresa distinta de la tuya.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_clave IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_REQUERIDA: la factura necesita una clave de idempotencia (una por intento de captura) para que un reintento o un doble clic no la duplique.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_clave) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_REQUERIDA: la clave de idempotencia debe tener entre 8 y 200 caracteres.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_prov IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_PROVEEDOR: falta el proveedor.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_concepto IS NULL OR length(v_concepto) < 3 THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_CONCEPTO: el concepto es obligatorio (mínimo 3 caracteres).' USING ERRCODE = 'check_violation';
  END IF;

  -- ── Proyecto, proveedor y orden: de esta empresa, y entre sí coherentes ──
  IF p_project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_PROYECTO: el proyecto no existe en esta empresa.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proveedores WHERE id = v_prov AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_PROVEEDOR: el proveedor no existe en esta empresa.' USING ERRCODE = 'check_violation';
  END IF;
  v_base := public.conta_moneda_base(p_company_id, p_project_id);

  IF v_orden IS NOT NULL THEN
    SELECT * INTO v_o FROM public.ordenes_compra WHERE id = v_orden AND company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN: la orden no existe en esta empresa.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_o.proveedor_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_PROVEEDOR: la orden es de otro proveedor que la factura.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_o.project_id IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_PROYECTO: la orden es de otra contabilidad (proyecto o empresa) que la factura.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_moneda IS NOT NULL AND v_moneda <> COALESCE(v_o.moneda, v_base) THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_MONEDA_ORDEN: la factura de una orden va en la moneda de la orden (%), no en %.',
        COALESCE(v_o.moneda, v_base), v_moneda USING ERRCODE = 'check_violation';
    END IF;
    v_moneda := v_o.moneda;        -- la moneda sale de la orden

    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_SIN_RENGLONES: una factura contra una orden se captura por renglón: indica qué se factura de cada uno.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE r.orden_compra_linea_id IS NULL OR COALESCE(r.cantidad, 0) <= 0
                                  OR COALESCE(r.precio_unitario, -1) < 0 OR COALESCE(r.iva_monto, 0) < 0),
           COUNT(*) FILTER (WHERE r.orden_compra_linea_id IS NOT NULL AND NOT EXISTS (
                              SELECT 1 FROM public.orden_compra_lineas ocl
                               WHERE ocl.id = r.orden_compra_linea_id
                                 AND ocl.orden_compra_id = v_orden AND ocl.company_id = p_company_id)),
           COUNT(DISTINCT r.orden_compra_linea_id)
      INTO v_n, v_invalid, v_ajenas, v_dist
      FROM jsonb_to_recordset(p_lineas) AS r(orden_compra_linea_id uuid, descripcion text, cantidad numeric,
                                             precio_unitario numeric, iva_monto numeric);
    IF v_invalid > 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_LINEA_INVALIDA: % renglón(es) sin renglón de orden, con cantidad menor o igual a cero, o con precio o IVA negativo.', v_invalid
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_ajenas > 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_LINEA_AJENA: % renglón(es) no son de la orden de esta factura.', v_ajenas
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_dist <> v_n THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_LINEA_REPETIDA: un mismo renglón de la orden aparece más de una vez en la factura.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(round(r.cantidad * r.precio_unitario, 2) + COALESCE(r.iva_monto, 0)), 0),
           COALESCE(SUM(COALESCE(r.iva_monto, 0)), 0)
      INTO v_monto, v_iva
      FROM jsonb_to_recordset(p_lineas) AS r(orden_compra_linea_id uuid, descripcion text, cantidad numeric,
                                             precio_unitario numeric, iva_monto numeric);
  ELSE
    IF p_lineas IS NOT NULL AND jsonb_typeof(p_lineas) = 'array' AND jsonb_array_length(p_lineas) > 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_RENGLONES_SIN_ORDEN: los renglones se cuadran contra una orden; una factura sin orden no los lleva.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_monto := NULLIF(p_cabecera->>'monto_total', '')::numeric;
    v_iva   := COALESCE(NULLIF(p_cabecera->>'iva_monto', '')::numeric, 0);
    IF v_monto IS NULL OR v_monto <= 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_MONTO: el monto debe ser mayor que 0.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_iva < 0 OR v_iva > v_monto THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_MONTO: el IVA no puede ser negativo ni exceder el total.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- ── Huella del contenido: las mismas cifras escritas distinto (40 / 40.0) y el
  -- orden de los renglones NO la cambian; un valor distinto sí. ──────────────
  v_cab := jsonb_build_object(
    'company_id', p_company_id, 'project_id', p_project_id, 'proveedor_id', v_prov,
    'orden_compra_id', v_orden, 'numero_factura', v_numero, 'fecha_emision', v_emision,
    'fecha_vencimiento', v_vence, 'concepto', v_concepto, 'categoria', v_categ,
    'moneda', v_moneda, 'notas', v_notas,
    'monto_total', round(v_monto, 2)::text, 'iva_monto', round(v_iva, 2)::text);
  IF v_orden IS NOT NULL THEN
    SELECT jsonb_agg(x.l ORDER BY x.l::text) INTO v_norm
      FROM (SELECT jsonb_build_object(
                     'orden_compra_linea_id', r.orden_compra_linea_id,
                     'descripcion',    NULLIF(btrim(COALESCE(r.descripcion, '')), ''),
                     'cantidad',       round(r.cantidad, 4)::text,
                     'precio_unitario', round(r.precio_unitario, 4)::text,
                     'iva_monto',      round(COALESCE(r.iva_monto, 0), 2)::text) AS l
              FROM jsonb_to_recordset(p_lineas) AS r(orden_compra_linea_id uuid, descripcion text, cantidad numeric,
                                                       precio_unitario numeric, iva_monto numeric)) x;
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('cabecera', v_cab, 'lineas', v_norm)::text, 'UTF8')), 'hex');

  -- Los intentos simultáneos con la misma clave se ejecutan de uno en uno: el
  -- segundo espera, ve la factura del primero y la recupera (o se rechaza).
  PERFORM pg_advisory_xact_lock(hashtextextended('compras_factura:' || p_company_id::text || ':' || v_clave, 0));

  SELECT * INTO v_exist FROM public.facturas_proveedor
   WHERE company_id = p_company_id AND clave_idempotencia = v_clave;
  IF FOUND THEN
    IF v_exist.hash_contenido IS NULL THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_SIN_HUELLA: la clave ya identifica una factura creada fuera de esta función y no se puede verificar que el contenido sea el mismo. Usa otra clave.'
        USING ERRCODE = 'unique_violation';
    END IF;
    IF v_exist.hash_contenido <> v_hash THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_CONFLICTO: la clave de idempotencia ya se usó para una factura con OTRO contenido. Un reintento debe enviar lo mismo; una factura distinta lleva una clave nueva.'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object(
      'factura', to_jsonb(v_exist),
      'lineas', (SELECT COALESCE(jsonb_agg(to_jsonb(fl) ORDER BY fl.linea), '[]'::jsonb)
                   FROM public.factura_proveedor_lineas fl WHERE fl.factura_id = v_exist.id),
      'reutilizada', true);
  END IF;

  -- ── El estado de la orden limita las facturas NUEVAS ─────────────────────
  -- Va DESPUÉS de recuperar una operación ya completada: un reintento legítimo
  -- (respuesta perdida, doble clic) de una factura que cerró la orden devuelve la
  -- factura original; no se vuelve a escribir nada. Se relee el estado tras el
  -- bloqueo por si la orden cambió mientras esta sesión esperaba.
  IF v_orden IS NOT NULL THEN
    SELECT estado INTO v_estado FROM public.ordenes_compra WHERE id = v_orden AND company_id = p_company_id;
    IF v_estado IS NULL OR v_estado NOT IN ('emitida', 'recibida_parcial', 'recibida') THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_ESTADO: la orden está "%" y no admite facturas nuevas (solo emitida, recibida parcial o recibida).', COALESCE(v_estado, 'inexistente')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- ── Escritura: cabecera y renglones en la MISMA transacción ──────────────
  BEGIN
    INSERT INTO public.facturas_proveedor
      (company_id, project_id, proveedor_id, orden_compra_id, numero_factura, fecha_emision, fecha_vencimiento,
       concepto, categoria, moneda, monto_total, iva_monto, notas, clave_idempotencia, hash_contenido, estado)
    VALUES
      (p_company_id, p_project_id, v_prov, v_orden, v_numero, v_emision, v_vence,
       v_concepto, v_categ, v_moneda, v_monto, v_iva, v_notas, v_clave, v_hash, 'registrada')
    RETURNING * INTO v_fac;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
    IF v_cons = 'uq_facturas_prov_numero' THEN
      -- [RG-4] Si lo rechazó el trigger de equivalencia (compras_tg_factura_numero_equivalente), su mensaje
      -- ya dice contra qué factura chocó (solo si la persona puede verla, EV-09) y qué hacer si es otra: se
      -- conserva tal cual. Solo el índice único exacto (el MISMO texto) se traduce aquí, como siempre.
      IF v_msg LIKE 'COMPRAS_FACTURA_NUMERO_DUPLICADO:%' THEN
        RAISE EXCEPTION '%', v_msg USING ERRCODE = 'unique_violation';
      END IF;
      RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con el número "%". Si es la misma, no la registres otra vez.', v_numero
        USING ERRCODE = 'unique_violation';
    END IF;
    -- La clave la tiene una factura que esta sesión no ve (otro alcance): no se
    -- revela nada, solo se pide otra clave.
    RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_EN_USO: la clave de idempotencia ya está en uso. Usa otra clave.'
      USING ERRCODE = 'unique_violation';
  END;

  IF v_orden IS NOT NULL THEN
    -- Si un renglón falla (línea ajena a la orden, cantidad inválida…) se revierte
    -- TAMBIÉN la cabecera: no queda ninguna factura a medias.
    INSERT INTO public.factura_proveedor_lineas
      (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
    SELECT p_company_id, v_fac.id, r.orden_compra_linea_id, r.n,
           COALESCE(NULLIF(btrim(COALESCE(r.descripcion, '')), ''), ocl.descripcion),
           r.cantidad, r.precio_unitario, COALESCE(r.iva_monto, 0)
      FROM (SELECT x.*, row_number() OVER (ORDER BY x.ord) AS n
              FROM ROWS FROM (jsonb_to_recordset(p_lineas) AS (orden_compra_linea_id uuid, descripcion text, cantidad numeric,
                                                               precio_unitario numeric, iva_monto numeric))
                   WITH ORDINALITY AS x(orden_compra_linea_id, descripcion, cantidad, precio_unitario, iva_monto, ord)) r
      JOIN public.orden_compra_lineas ocl ON ocl.id = r.orden_compra_linea_id
     ORDER BY r.n;
  END IF;

  SELECT * INTO v_fac FROM public.facturas_proveedor WHERE id = v_fac.id;
  RETURN jsonb_build_object(
    'factura', to_jsonb(v_fac),
    'lineas', (SELECT COALESCE(jsonb_agg(to_jsonb(fl) ORDER BY fl.linea), '[]'::jsonb)
                 FROM public.factura_proveedor_lineas fl WHERE fl.factura_id = v_fac.id),
    'reutilizada', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.compras_factura_crear(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_factura_crear(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- POST-VUELO · la migración dejó lo que prometía y NADA de lo que prometía no tocar
-- ════════════════════════════════════════════════════════════════════════════
-- Si algo no cuadra, la excepción deshace TODA la migración (una sola transacción): no queda un estado a medias.
DO $postvuelo$
DECLARE
  v_n bigint;
BEGIN
  -- Las cinco llaves existen, en la categoría del módulo, con la etiqueta «Compras y pagos — …».
  SELECT count(*) INTO v_n FROM public.permissions
   WHERE key IN ('platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
                 'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar',
                 'platform.contabilidad.compras.pago_anular')
     AND category = 'platform_contabilidad' AND label LIKE 'Compras y pagos — %';
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: las cinco llaves por acción no quedaron bien sembradas en el catálogo (%/5). Se deshace todo.', v_n;
  END IF;

  -- NINGÚN rol recibió una llave nueva (las asignaciones se deciden aparte; ver scripts/propuesta-asignaciones-permisos-compras.sql).
  SELECT count(*) INTO v_n FROM public.role_permissions
   WHERE permission_key IN ('platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
                            'platform.contabilidad.compras.orden_pago_aprobar', 'platform.contabilidad.compras.pago_ejecutar',
                            'platform.contabilidad.compras.pago_anular');
  IF v_n <> COALESCE(NULLIF(current_setting('compras.m0900_grants', true), ''), '0')::bigint THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: esta migración no concede llaves, pero hay % concesión(es) donde había %. Se deshace todo.',
      v_n, COALESCE(NULLIF(current_setting('compras.m0900_grants', true), ''), '0');
  END IF;

  -- Las asignaciones de proyecto (Alexander Monterroso, Marco Santos Godoy y todas las demás) quedan exactamente como estaban.
  SELECT count(*) INTO v_n FROM public.user_project_assignments;
  IF v_n <> COALESCE(NULLIF(current_setting('compras.m0900_asignaciones', true), ''), '0')::bigint THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: las asignaciones de proyecto cambiaron (% ahora, % antes). Se deshace todo.',
      v_n, current_setting('compras.m0900_asignaciones', true);
  END IF;

  -- La separación no se activó ni se desactivó en ninguna empresa.
  SELECT count(*) INTO v_n FROM public.compras_config WHERE aprobacion_separada;
  IF v_n <> COALESCE(NULLIF(current_setting('compras.m0900_encendidas', true), ''), '0')::bigint THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: el número de empresas con la separación encendida cambió (% ahora, % antes). Se deshace todo.',
      v_n, current_setting('compras.m0900_encendidas', true);
  END IF;

  -- Los disparadores de las cinco tablas y los de la configuración existen.
  SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname = 'trg_zzcompras_mover_alcance'
     AND c.relname IN ('ordenes_compra', 'recepciones', 'facturas_proveedor', 'ordenes_pago', 'contrasenas_pago');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: el disparador de movimiento de documentos no quedó en las cinco tablas (%/5). Se deshace todo.', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND c.oid = 'public.compras_config'::regclass
     AND t.tgname IN ('trg_compras_00_config_separacion', 'trg_compras_00_config_separacion_truncate', 'trg_zz_compras_config_separacion_bitacora');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: los tres disparadores de la protección de la separación no quedaron en compras_config (%/3). Se deshace todo.', v_n;
  END IF;
  IF to_regprocedure('public.compras_separacion_configurar(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.compras_exigir_permiso(text,text,uuid,uuid)') IS NULL
     OR to_regprocedure('public.compras_numeros_equivalentes(text,text)') IS NULL
     OR to_regclass('public.compras_config_separacion_bitacora') IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_MIGRACION_POSTVUELO: falta alguno de los objetos nuevos. Se deshace todo.';
  END IF;
  RAISE NOTICE '20261027000900 · post-vuelo: 5 llaves sembradas, 0 concesiones nuevas, asignaciones de proyecto intactas, separación sin cambios, disparadores y funciones nuevos presentes.';
END
$postvuelo$;

COMMIT;
