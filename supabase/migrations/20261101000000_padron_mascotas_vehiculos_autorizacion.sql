-- ════════════════════════════════════════════════════════════════════════════
-- Mascotas y vehículos: el residente los registra desde el portal y la
-- administración los AUTORIZA — mismo circuito que la solicitud de renta.
--
-- POR QUÉ
-- Hasta hoy `mascotas` y `vehiculos_residentes` eran un padrón que solo llenaba
-- el staff (RLS de escritura = permiso del tab). El residente no tenía cómo
-- avisar que tiene un perro nuevo o cambió de carro, y la administración no
-- tenía dónde pedirle el carnet de vacunación ni asignar el TAG de ingreso.
--
-- CIRCUITO (calcado de la solicitud de renta, 20260829000200/20260829000300):
--   1) portal_reservar_*  → crea/devuelve el BORRADOR del residente; su id es la
--                           carpeta de los adjuntos en `padron-docs`.
--   2) portal_enviar_*    → valida todo SERVER-SIDE y pasa a 'pendiente'; avisa
--                           al staff del proyecto.
--   3) resolver_*         → la administración aprueba o rechaza (rechazo con
--                           motivo). Al aprobar un vehículo puede asignar el TAG.
--   4) portal_baja_*      → el residente retira la solicitud pendiente o da de
--                           baja la mascota/vehículo aprobado.
--   +) portal_descartar_* → tira el borrador.
--   +) asignar_tag_vehiculo → asignar/reponer/quitar el TAG después de aprobar.
--
-- DISEÑO: el estado vive EN LA MISMA FILA del padrón (no una tabla de
-- solicitudes aparte) porque la mascota/vehículo ES lo que se autoriza. Para
-- que ningún consumidor existente (Directorio, KPIs, filtros `activo`) cuente
-- como autorizado algo que no lo está, la base impone:
--
--     CHECK (activo = false OR estado = 'aprobada')
--
-- Las filas existentes y las que el staff crea directo nacen 'aprobada'
-- (DEFAULT), así que su comportamiento no cambia.
--
-- QUIÉN: cualquier residente de la unidad (propietario, inquilino o familiar,
-- mis_unidades_ids()) — la mascota y el carro son de quien vive ahí, no solo del
-- dueño. Retirar/dar de baja: quien la solicitó o el propietario de la unidad.
-- La escritura del residente es SOLO por estas RPC: las policies de escritura
-- de las tablas siguen exigiendo el permiso del tab (rbac phase1), que un
-- `cliente` no tiene.
--
-- CÓMO REVERTIR: scripts/reversion-padron-autorizacion.sql
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, constraints por DO-block, CREATE OR
-- REPLACE, DROP … IF EXISTS antes de CREATE.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas del circuito (las dos tablas)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.mascotas
  ADD COLUMN IF NOT EXISTS estado               text        NOT NULL DEFAULT 'aprobada',
  ADD COLUMN IF NOT EXISTS cliente_id           uuid        REFERENCES public.clientes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS documentos           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fecha_solicitud      timestamptz,
  ADD COLUMN IF NOT EXISTS fecha_resolucion     timestamptz,
  ADD COLUMN IF NOT EXISTS comentario_admin     text,
  ADD COLUMN IF NOT EXISTS resuelto_por         text,
  ADD COLUMN IF NOT EXISTS resuelto_por_user_id uuid,
  -- Ficha ampliada de la mascota
  ADD COLUMN IF NOT EXISTS sexo                 text,
  ADD COLUMN IF NOT EXISTS peso_kg              numeric(6,2),
  ADD COLUMN IF NOT EXISTS tamano               text,
  ADD COLUMN IF NOT EXISTS esterilizada         boolean,
  ADD COLUMN IF NOT EXISTS microchip            text,
  ADD COLUMN IF NOT EXISTS vacunas              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fecha_ultima_desparasitacion date,
  ADD COLUMN IF NOT EXISTS veterinario          text,
  ADD COLUMN IF NOT EXISTS veterinario_telefono text;

ALTER TABLE public.vehiculos_residentes
  ADD COLUMN IF NOT EXISTS estado               text        NOT NULL DEFAULT 'aprobada',
  ADD COLUMN IF NOT EXISTS cliente_id           uuid        REFERENCES public.clientes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS documentos           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fecha_solicitud      timestamptz,
  ADD COLUMN IF NOT EXISTS fecha_resolucion     timestamptz,
  ADD COLUMN IF NOT EXISTS comentario_admin     text,
  ADD COLUMN IF NOT EXISTS resuelto_por         text,
  ADD COLUMN IF NOT EXISTS resuelto_por_user_id uuid,
  -- TAG de ingreso (sticker, RFID, tarjeta, control…) que asigna la administración
  ADD COLUMN IF NOT EXISTS tag_codigo           text,
  ADD COLUMN IF NOT EXISTS tag_tipo             text,
  ADD COLUMN IF NOT EXISTS tag_asignado_at      timestamptz;

-- CHECKs por DO-block: ADD CONSTRAINT no tiene IF NOT EXISTS.
DO $$
DECLARE
  v_def text[][] := ARRAY[
    ['mascotas', 'mascotas_estado_check',
     $c$CHECK (estado IN ('borrador','pendiente','aprobada','rechazada','baja'))$c$],
    ['mascotas', 'mascotas_activo_solo_aprobada',
     $c$CHECK (activo = false OR estado = 'aprobada')$c$],
    ['mascotas', 'mascotas_documentos_check',
     $c$CHECK (jsonb_typeof(documentos) = 'array' AND jsonb_array_length(documentos) <= 8)$c$],
    ['mascotas', 'mascotas_vacunas_check',
     $c$CHECK (jsonb_typeof(vacunas) = 'array' AND jsonb_array_length(vacunas) <= 30)$c$],
    ['mascotas', 'mascotas_sexo_check',
     $c$CHECK (sexo IS NULL OR sexo IN ('macho','hembra'))$c$],
    ['mascotas', 'mascotas_tamano_check',
     $c$CHECK (tamano IS NULL OR tamano IN ('pequeno','mediano','grande'))$c$],
    ['mascotas', 'mascotas_peso_check',
     $c$CHECK (peso_kg IS NULL OR (peso_kg > 0 AND peso_kg < 500))$c$],
    ['vehiculos_residentes', 'vehiculos_residentes_estado_check',
     $c$CHECK (estado IN ('borrador','pendiente','aprobada','rechazada','baja'))$c$],
    ['vehiculos_residentes', 'vehiculos_residentes_activo_solo_aprobada',
     $c$CHECK (activo = false OR estado = 'aprobada')$c$],
    ['vehiculos_residentes', 'vehiculos_residentes_documentos_check',
     $c$CHECK (jsonb_typeof(documentos) = 'array' AND jsonb_array_length(documentos) <= 8)$c$],
    ['vehiculos_residentes', 'vehiculos_residentes_tag_tipo_check',
     $c$CHECK (tag_tipo IS NULL OR tag_tipo IN ('sticker','rfid','tarjeta','control','otro'))$c$]
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_def, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'public' AND r.relname = v_def[i][1] AND c.conname = v_def[i][2]
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', v_def[i][1], v_def[i][2], v_def[i][3]);
    END IF;
  END LOOP;
END $$;

-- Un borrador por residente y unidad: hace idempotente (y libre de carreras) el
-- "reservar".
CREATE UNIQUE INDEX IF NOT EXISTS idx_mascotas_borrador_residente
  ON public.mascotas (unidad_id, cliente_id) WHERE estado = 'borrador';
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehiculos_borrador_residente
  ON public.vehiculos_residentes (unidad_id, cliente_id) WHERE estado = 'borrador';

-- Un TAG no puede estar asignado a dos vehículos autorizados del mismo proyecto.
-- Al dar de baja o rechazar, el TAG queda libre (la fila deja de ser 'aprobada').
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehiculos_tag_unico
  ON public.vehiculos_residentes (project_id, upper(btrim(tag_codigo)))
  WHERE tag_codigo IS NOT NULL AND estado = 'aprobada';

-- La cola de la administración filtra por estado.
CREATE INDEX IF NOT EXISTS idx_mascotas_estado  ON public.mascotas (project_id, estado);
CREATE INDEX IF NOT EXISTS idx_vehiculos_estado ON public.vehiculos_residentes (project_id, estado);

COMMENT ON COLUMN public.mascotas.estado IS
  'borrador|pendiente|aprobada|rechazada|baja. Solo una fila aprobada puede estar activa (CHECK). Las que crea el staff nacen aprobadas.';
COMMENT ON COLUMN public.mascotas.vacunas IS
  'Arreglo de {tipo, fecha, proxima?}. fecha_ultima_vacuna se deriva de aquí al enviar desde el portal.';
COMMENT ON COLUMN public.vehiculos_residentes.estado IS
  'borrador|pendiente|aprobada|rechazada|baja. Solo una fila aprobada puede estar activa (CHECK). Las que crea el staff nacen aprobadas.';
COMMENT ON COLUMN public.vehiculos_residentes.tag_codigo IS
  'TAG de ingreso asignado por la administración. Único por proyecto entre vehículos aprobados.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helpers internos (no expuestos)
-- ─────────────────────────────────────────────────────────────────────────────
-- Valida el arreglo de documentos: tope, forma y que cada path cuelgue de la
-- carpeta de ESTA fila. Sin el prefijo, un path de otra solicitud de la misma
-- unidad se registraría como propio.
CREATE OR REPLACE FUNCTION public.padron_validar_documentos(p_documentos jsonb, p_prefijo text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v_docs jsonb := coalesce(p_documentos, '[]'::jsonb);
  v_doc  jsonb;
BEGIN
  IF jsonb_typeof(v_docs) <> 'array' THEN
    RAISE EXCEPTION 'Los documentos deben venir como arreglo.';
  END IF;
  IF jsonb_array_length(v_docs) > 8 THEN
    RAISE EXCEPTION 'Máximo 8 documentos por solicitud.';
  END IF;
  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_docs) LOOP
    IF jsonb_typeof(v_doc) <> 'object' OR nullif(btrim(coalesce(v_doc->>'path', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Un documento llegó sin path.';
    END IF;
    IF left(v_doc->>'path', length(p_prefijo)) <> p_prefijo OR position('..' IN v_doc->>'path') > 0 THEN
      RAISE EXCEPTION 'El documento "%" no pertenece a esta solicitud.', v_doc->>'path';
    END IF;
  END LOOP;
  RETURN v_docs;
END;
$fn$;
REVOKE ALL ON FUNCTION public.padron_validar_documentos(jsonb, text) FROM PUBLIC, anon, authenticated;

-- ¿Puede el usuario actual retirar/dar de baja esta fila? Quien la solicitó, o
-- el propietario de la unidad.
CREATE OR REPLACE FUNCTION public.padron_puede_retirar(p_unidad_id uuid, p_cliente_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT current_user_role() = 'cliente'
     AND (
       (p_cliente_id IS NOT NULL AND p_cliente_id = get_my_cliente_id()
        AND EXISTS (SELECT 1 FROM public.mis_unidades_ids() x WHERE x = p_unidad_id))
       OR EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id)
     );
$fn$;
REVOKE ALL ON FUNCTION public.padron_puede_retirar(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Aviso in_app al residente que solicitó, cuando la administración resuelve.
-- Nunca impide la resolución.
CREATE OR REPLACE FUNCTION public.padron_avisar_residente(
  p_company_id uuid, p_cliente_id uuid, p_titulo text, p_cuerpo text, p_seccion text, p_extra jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_destinos uuid[];
BEGIN
  IF p_cliente_id IS NULL THEN RETURN; END IF;
  SELECT array_agg(au.id) INTO v_destinos
    FROM public.app_users au
   WHERE au.cliente_id = p_cliente_id AND coalesce(au.activo, true);
  PERFORM public.notif_encolar_in_app(p_company_id, v_destinos, 'solicitud', p_titulo, p_cuerpo, p_seccion, p_extra);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'padron_avisar_residente: %', SQLERRM;
END;
$fn$;
REVOKE ALL ON FUNCTION public.padron_avisar_residente(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MASCOTAS — RPC del portal
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_reservar_mascota(p_unidad_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id      uuid;
  v_cliente uuid := get_my_cliente_id();
  v_unidad  public.unidades%ROWTYPE;
BEGIN
  IF current_user_role() <> 'cliente' OR v_cliente IS NULL THEN
    RAISE EXCEPTION 'Solo un residente puede registrar mascotas desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: no es residente de la unidad.';
  END IF;

  SELECT * INTO v_unidad FROM public.unidades WHERE id = p_unidad_id;

  -- Idempotente: si ya hay borrador del residente en la unidad, se devuelve ESE
  -- (con lo que ya había subido). El índice único resuelve dos reservas a la vez.
  INSERT INTO public.mascotas (company_id, project_id, unidad_id, cliente_id, nombre, especie, estado, activo)
  VALUES (v_unidad.company_id, v_unidad.project_id, p_unidad_id, v_cliente, '', 'perro', 'borrador', false)
  ON CONFLICT (unidad_id, cliente_id) WHERE estado = 'borrador' DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.mascotas
     WHERE unidad_id = p_unidad_id AND cliente_id = v_cliente AND estado = 'borrador';
  END IF;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.portal_enviar_mascota(
  p_mascota_id uuid,
  p_datos      jsonb,
  p_documentos jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_m        public.mascotas%ROWTYPE;
  v_d        jsonb := coalesce(p_datos, '{}'::jsonb);
  v_nombre   text;
  v_especie  text;
  v_vacunas  jsonb := coalesce(p_datos->'vacunas', '[]'::jsonb);
  v_vac      jsonb;
  v_fecha    date;
  v_ultima   date;
  v_hoy      date := current_date;
  v_foto     text;
  v_nac      date;
  v_desp     date;
  v_peso     numeric;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo un residente puede enviar la solicitud desde el portal.';
  END IF;
  IF jsonb_typeof(v_d) <> 'object' THEN
    RAISE EXCEPTION 'Los datos de la mascota deben venir como objeto.';
  END IF;

  SELECT * INTO v_m FROM public.mascotas WHERE id = p_mascota_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe.';
  END IF;
  IF v_m.cliente_id IS DISTINCT FROM get_my_cliente_id()
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_ids() x WHERE x = v_m.unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la solicitud no es suya.';
  END IF;
  IF v_m.estado <> 'borrador' THEN
    RAISE EXCEPTION 'La solicitud ya fue enviada (estado actual: %).', v_m.estado;
  END IF;

  v_nombre  := nullif(btrim(coalesce(v_d->>'nombre', '')), '');
  v_especie := coalesce(nullif(btrim(v_d->>'especie'), ''), 'perro');
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'El nombre de la mascota es requerido.';
  END IF;
  IF v_especie NOT IN ('perro', 'gato', 'ave', 'otro') THEN
    RAISE EXCEPTION 'Especie inválida: %', v_especie;
  END IF;
  IF nullif(v_d->>'sexo', '') IS NOT NULL AND v_d->>'sexo' NOT IN ('macho', 'hembra') THEN
    RAISE EXCEPTION 'Sexo inválido: %', v_d->>'sexo';
  END IF;
  IF nullif(v_d->>'tamano', '') IS NOT NULL AND v_d->>'tamano' NOT IN ('pequeno', 'mediano', 'grande') THEN
    RAISE EXCEPTION 'Tamaño inválido: %', v_d->>'tamano';
  END IF;

  BEGIN
    v_nac  := nullif(v_d->>'fecha_nacimiento', '')::date;
    v_desp := nullif(v_d->>'fecha_ultima_desparasitacion', '')::date;
    v_peso := nullif(v_d->>'peso_kg', '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Fecha o peso con formato inválido.';
  END;
  IF v_nac > v_hoy OR v_desp > v_hoy THEN
    RAISE EXCEPTION 'Las fechas de nacimiento y desparasitación no pueden ser futuras.';
  END IF;
  IF v_peso IS NOT NULL AND (v_peso <= 0 OR v_peso >= 500) THEN
    RAISE EXCEPTION 'Peso inválido: % kg.', v_peso;
  END IF;

  -- Vacunas: cada una con tipo y fecha aplicada (no futura); la próxima dosis es
  -- opcional. Perros y gatos deben declarar al menos una.
  IF jsonb_typeof(v_vacunas) <> 'array' THEN
    RAISE EXCEPTION 'Las vacunas deben venir como arreglo.';
  END IF;
  IF jsonb_array_length(v_vacunas) > 30 THEN
    RAISE EXCEPTION 'Máximo 30 vacunas por mascota.';
  END IF;
  FOR v_vac IN SELECT * FROM jsonb_array_elements(v_vacunas) LOOP
    IF jsonb_typeof(v_vac) <> 'object' OR nullif(btrim(coalesce(v_vac->>'tipo', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Cada vacuna debe indicar su tipo.';
    END IF;
    BEGIN
      v_fecha := (v_vac->>'fecha')::date;
      PERFORM nullif(v_vac->>'proxima', '')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'La vacuna "%" tiene una fecha inválida.', v_vac->>'tipo';
    END;
    IF v_fecha IS NULL THEN
      RAISE EXCEPTION 'La vacuna "%" no indica la fecha en que se aplicó.', v_vac->>'tipo';
    END IF;
    IF v_fecha > v_hoy THEN
      RAISE EXCEPTION 'La vacuna "%" tiene fecha futura.', v_vac->>'tipo';
    END IF;
    v_ultima := greatest(v_ultima, v_fecha);
  END LOOP;
  IF v_especie IN ('perro', 'gato') AND jsonb_array_length(v_vacunas) = 0 THEN
    RAISE EXCEPTION 'Registre al menos una vacuna de la mascota (perros y gatos).';
  END IF;

  -- La foto la sube ImageUploader a condominios-media bajo {proyecto}/mascotas/.
  v_foto := nullif(btrim(coalesce(v_d->>'foto_url', '')), '');
  IF v_foto IS NOT NULL
     AND (left(v_foto, length(v_m.project_id::text || '/mascotas/')) <> v_m.project_id::text || '/mascotas/'
          OR position('..' IN v_foto) > 0) THEN
    RAISE EXCEPTION 'La foto no pertenece a este condominio.';
  END IF;

  UPDATE public.mascotas
     SET nombre                       = v_nombre,
         especie                      = v_especie,
         raza                         = nullif(btrim(coalesce(v_d->>'raza', '')), ''),
         color                        = nullif(btrim(coalesce(v_d->>'color', '')), ''),
         sexo                         = nullif(v_d->>'sexo', ''),
         tamano                       = nullif(v_d->>'tamano', ''),
         peso_kg                      = v_peso,
         esterilizada                 = CASE WHEN jsonb_typeof(v_d->'esterilizada') = 'boolean' THEN (v_d->>'esterilizada')::boolean END,
         microchip                    = nullif(btrim(coalesce(v_d->>'microchip', '')), ''),
         fecha_nacimiento             = v_nac,
         fecha_ultima_desparasitacion = v_desp,
         veterinario                  = nullif(btrim(coalesce(v_d->>'veterinario', '')), ''),
         veterinario_telefono         = nullif(btrim(coalesce(v_d->>'veterinario_telefono', '')), ''),
         notas                        = nullif(btrim(coalesce(v_d->>'notas', '')), ''),
         foto_url                     = v_foto,
         vacunas                      = v_vacunas,
         fecha_ultima_vacuna          = v_ultima,
         documentos                   = public.padron_validar_documentos(
                                          p_documentos,
                                          v_m.unidad_id::text || '/mascotas/' || v_m.id::text || '/'),
         estado                       = 'pendiente',
         activo                       = false,
         fecha_solicitud              = now()
   WHERE id = v_m.id;

  RETURN v_m.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.portal_descartar_mascota(p_mascota_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_m public.mascotas%ROWTYPE;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el residente puede descartar su borrador.';
  END IF;
  SELECT * INTO v_m FROM public.mascotas WHERE id = p_mascota_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_m.cliente_id IS DISTINCT FROM get_my_cliente_id() THEN
    RAISE EXCEPTION 'No autorizado: el borrador no es suyo.';
  END IF;
  IF v_m.estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede descartar un borrador.';
  END IF;
  DELETE FROM public.mascotas WHERE id = v_m.id;
END;
$fn$;

-- Retira la solicitud pendiente o da de baja la mascota aprobada.
CREATE OR REPLACE FUNCTION public.portal_baja_mascota(p_mascota_id uuid, p_motivo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_m public.mascotas%ROWTYPE;
BEGIN
  SELECT * INTO v_m FROM public.mascotas WHERE id = p_mascota_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La mascota no existe.';
  END IF;
  IF NOT public.padron_puede_retirar(v_m.unidad_id, v_m.cliente_id) THEN
    RAISE EXCEPTION 'No autorizado: solo quien la registró o el propietario de la unidad.';
  END IF;
  IF v_m.estado NOT IN ('pendiente', 'aprobada') THEN
    RAISE EXCEPTION 'La mascota no tiene solicitud ni autorización vigente (estado: %).', v_m.estado;
  END IF;

  UPDATE public.mascotas
     SET estado = 'baja', activo = false, fecha_resolucion = now(),
         notas  = CASE WHEN nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN notas
                       ELSE concat_ws(E'\n', notas, 'Baja: ' || btrim(p_motivo)) END
   WHERE id = v_m.id;
  RETURN v_m.estado;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. VEHÍCULOS — RPC del portal
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_reservar_vehiculo(p_unidad_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id      uuid;
  v_cliente uuid := get_my_cliente_id();
  v_unidad  public.unidades%ROWTYPE;
BEGIN
  IF current_user_role() <> 'cliente' OR v_cliente IS NULL THEN
    RAISE EXCEPTION 'Solo un residente puede registrar vehículos desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: no es residente de la unidad.';
  END IF;

  SELECT * INTO v_unidad FROM public.unidades WHERE id = p_unidad_id;

  INSERT INTO public.vehiculos_residentes (company_id, project_id, unidad_id, cliente_id, placa, tipo, estado, activo)
  VALUES (v_unidad.company_id, v_unidad.project_id, p_unidad_id, v_cliente, '', 'auto', 'borrador', false)
  ON CONFLICT (unidad_id, cliente_id) WHERE estado = 'borrador' DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.vehiculos_residentes
     WHERE unidad_id = p_unidad_id AND cliente_id = v_cliente AND estado = 'borrador';
  END IF;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.portal_enviar_vehiculo(
  p_vehiculo_id uuid,
  p_datos       jsonb,
  p_documentos  jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_v     public.vehiculos_residentes%ROWTYPE;
  v_d     jsonb := coalesce(p_datos, '{}'::jsonb);
  v_placa text;
  v_tipo  text;
  v_anio  int;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo un residente puede enviar la solicitud desde el portal.';
  END IF;
  IF jsonb_typeof(v_d) <> 'object' THEN
    RAISE EXCEPTION 'Los datos del vehículo deben venir como objeto.';
  END IF;

  SELECT * INTO v_v FROM public.vehiculos_residentes WHERE id = p_vehiculo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe.';
  END IF;
  IF v_v.cliente_id IS DISTINCT FROM get_my_cliente_id()
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_ids() x WHERE x = v_v.unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la solicitud no es suya.';
  END IF;
  IF v_v.estado <> 'borrador' THEN
    RAISE EXCEPTION 'La solicitud ya fue enviada (estado actual: %).', v_v.estado;
  END IF;

  -- Placa normalizada: mayúsculas, sin espacios repetidos.
  v_placa := upper(regexp_replace(btrim(coalesce(v_d->>'placa', '')), '\s+', ' ', 'g'));
  IF v_placa = '' THEN
    RAISE EXCEPTION 'La placa es requerida.';
  END IF;
  IF v_placa !~ '^[A-Z0-9][A-Z0-9 -]{1,14}$' THEN
    RAISE EXCEPTION 'Placa inválida: %', v_placa;
  END IF;
  v_tipo := coalesce(nullif(btrim(v_d->>'tipo'), ''), 'auto');
  IF v_tipo NOT IN ('auto', 'moto', 'camion', 'otro') THEN
    RAISE EXCEPTION 'Tipo de vehículo inválido: %', v_tipo;
  END IF;
  BEGIN
    v_anio := nullif(v_d->>'anio', '')::int;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Año inválido.';
  END;
  IF v_anio IS NOT NULL AND (v_anio < 1950 OR v_anio > extract(year FROM current_date)::int + 1) THEN
    RAISE EXCEPTION 'Año inválido: %', v_anio;
  END IF;

  -- La misma placa no puede estar pendiente ni autorizada dos veces en el
  -- condominio (en otra unidad sería un vehículo que ya tiene dueño registrado).
  IF EXISTS (
    SELECT 1 FROM public.vehiculos_residentes x
     WHERE x.project_id = v_v.project_id AND x.id <> v_v.id
       AND x.estado IN ('pendiente', 'aprobada')
       AND upper(regexp_replace(btrim(x.placa), '\s+', ' ', 'g')) = v_placa
  ) THEN
    RAISE EXCEPTION 'La placa % ya está registrada o en revisión en el condominio.', v_placa;
  END IF;

  UPDATE public.vehiculos_residentes
     SET placa           = v_placa,
         tipo            = v_tipo,
         marca           = nullif(btrim(coalesce(v_d->>'marca', '')), ''),
         modelo          = nullif(btrim(coalesce(v_d->>'modelo', '')), ''),
         color           = nullif(btrim(coalesce(v_d->>'color', '')), ''),
         anio            = v_anio,
         notas           = nullif(btrim(coalesce(v_d->>'notas', '')), ''),
         documentos      = public.padron_validar_documentos(
                             p_documentos,
                             v_v.unidad_id::text || '/vehiculos/' || v_v.id::text || '/'),
         estado          = 'pendiente',
         activo          = false,
         fecha_solicitud = now()
   WHERE id = v_v.id;

  RETURN v_v.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.portal_descartar_vehiculo(p_vehiculo_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_v public.vehiculos_residentes%ROWTYPE;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el residente puede descartar su borrador.';
  END IF;
  SELECT * INTO v_v FROM public.vehiculos_residentes WHERE id = p_vehiculo_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_v.cliente_id IS DISTINCT FROM get_my_cliente_id() THEN
    RAISE EXCEPTION 'No autorizado: el borrador no es suyo.';
  END IF;
  IF v_v.estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede descartar un borrador.';
  END IF;
  DELETE FROM public.vehiculos_residentes WHERE id = v_v.id;
END;
$fn$;

-- Retira la solicitud pendiente o da de baja el vehículo aprobado (libera su TAG
-- para el índice único: la fila deja de estar 'aprobada').
CREATE OR REPLACE FUNCTION public.portal_baja_vehiculo(p_vehiculo_id uuid, p_motivo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_v public.vehiculos_residentes%ROWTYPE;
BEGIN
  SELECT * INTO v_v FROM public.vehiculos_residentes WHERE id = p_vehiculo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El vehículo no existe.';
  END IF;
  IF NOT public.padron_puede_retirar(v_v.unidad_id, v_v.cliente_id) THEN
    RAISE EXCEPTION 'No autorizado: solo quien lo registró o el propietario de la unidad.';
  END IF;
  IF v_v.estado NOT IN ('pendiente', 'aprobada') THEN
    RAISE EXCEPTION 'El vehículo no tiene solicitud ni autorización vigente (estado: %).', v_v.estado;
  END IF;

  UPDATE public.vehiculos_residentes
     SET estado = 'baja', activo = false, fecha_resolucion = now(),
         notas  = CASE WHEN nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN notas
                       ELSE concat_ws(E'\n', notas, 'Baja: ' || btrim(p_motivo)) END
   WHERE id = v_v.id;
  RETURN v_v.estado;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Resolución por la administración
-- ─────────────────────────────────────────────────────────────────────────────
-- Mismo gate que la RLS de staff sobre cada tabla (company + permiso del tab).
-- La identidad de auditoría sale de auth.uid(), no del cliente.
CREATE OR REPLACE FUNCTION public.resolver_mascota(
  p_mascota_id uuid,
  p_aprobar    boolean,
  p_comentario text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_m          public.mascotas%ROWTYPE;
  v_uid        uuid := auth.uid();
  v_nombre     text;
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
BEGIN
  IF p_aprobar IS NULL THEN
    RAISE EXCEPTION 'Indique si se aprueba o se rechaza.';
  END IF;
  SELECT * INTO v_m FROM public.mascotas WHERE id = p_mascota_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe.';
  END IF;
  IF NOT (
    public.is_super_admin()
    OR (v_m.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.mascotas'))
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver solicitudes de mascotas.';
  END IF;
  IF v_m.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud no está pendiente (estado actual: %).', v_m.estado;
  END IF;
  IF NOT p_aprobar AND v_comentario IS NULL THEN
    RAISE EXCEPTION 'Indique el motivo del rechazo: el residente lo verá en su portal.';
  END IF;

  SELECT full_name INTO v_nombre FROM public.app_users WHERE id = v_uid;

  UPDATE public.mascotas
     SET estado               = CASE WHEN p_aprobar THEN 'aprobada' ELSE 'rechazada' END,
         activo               = p_aprobar,
         comentario_admin     = v_comentario,
         resuelto_por         = v_nombre,
         resuelto_por_user_id = v_uid,
         fecha_resolucion     = now()
   WHERE id = v_m.id;

  PERFORM public.padron_avisar_residente(
    v_m.company_id, v_m.cliente_id,
    CASE WHEN p_aprobar THEN 'Mascota autorizada: ' ELSE 'Mascota no autorizada: ' END || v_m.nombre,
    coalesce(v_comentario, CASE WHEN p_aprobar THEN 'La administración aprobó el registro.' ELSE '' END),
    'mascotas',
    jsonb_build_object('mascota_id', v_m.id));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.resolver_vehiculo(
  p_vehiculo_id uuid,
  p_aprobar     boolean,
  p_comentario  text DEFAULT NULL,
  p_tag_codigo  text DEFAULT NULL,
  p_tag_tipo    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_v          public.vehiculos_residentes%ROWTYPE;
  v_uid        uuid := auth.uid();
  v_nombre     text;
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_tag        text := nullif(btrim(coalesce(p_tag_codigo, '')), '');
  v_tag_tipo   text := nullif(btrim(coalesce(p_tag_tipo, '')), '');
BEGIN
  IF p_aprobar IS NULL THEN
    RAISE EXCEPTION 'Indique si se aprueba o se rechaza.';
  END IF;
  SELECT * INTO v_v FROM public.vehiculos_residentes WHERE id = p_vehiculo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe.';
  END IF;
  IF NOT (
    public.is_super_admin()
    OR (v_v.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.vehiculos'))
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver solicitudes de vehículos.';
  END IF;
  IF v_v.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La solicitud no está pendiente (estado actual: %).', v_v.estado;
  END IF;
  IF NOT p_aprobar AND v_comentario IS NULL THEN
    RAISE EXCEPTION 'Indique el motivo del rechazo: el residente lo verá en su portal.';
  END IF;
  IF NOT p_aprobar THEN
    v_tag := NULL; v_tag_tipo := NULL;
  END IF;
  IF v_tag_tipo IS NOT NULL AND v_tag_tipo NOT IN ('sticker', 'rfid', 'tarjeta', 'control', 'otro') THEN
    RAISE EXCEPTION 'Tipo de TAG inválido: %', v_tag_tipo;
  END IF;
  IF v_tag IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.vehiculos_residentes x
     WHERE x.project_id = v_v.project_id AND x.id <> v_v.id AND x.estado = 'aprobada'
       AND upper(btrim(x.tag_codigo)) = upper(v_tag)
  ) THEN
    RAISE EXCEPTION 'El TAG % ya está asignado a otro vehículo del condominio.', v_tag;
  END IF;

  SELECT full_name INTO v_nombre FROM public.app_users WHERE id = v_uid;

  UPDATE public.vehiculos_residentes
     SET estado               = CASE WHEN p_aprobar THEN 'aprobada' ELSE 'rechazada' END,
         activo               = p_aprobar,
         tag_codigo           = v_tag,
         tag_tipo             = CASE WHEN v_tag IS NOT NULL THEN coalesce(v_tag_tipo, 'sticker') END,
         tag_asignado_at      = CASE WHEN v_tag IS NOT NULL THEN now() END,
         comentario_admin     = v_comentario,
         resuelto_por         = v_nombre,
         resuelto_por_user_id = v_uid,
         fecha_resolucion     = now()
   WHERE id = v_v.id;

  PERFORM public.padron_avisar_residente(
    v_v.company_id, v_v.cliente_id,
    CASE WHEN p_aprobar THEN 'Vehículo autorizado: ' ELSE 'Vehículo no autorizado: ' END || v_v.placa,
    coalesce(v_comentario, '')
      || CASE WHEN v_tag IS NOT NULL THEN CASE WHEN v_comentario IS NOT NULL THEN ' — ' ELSE '' END || 'TAG asignado: ' || v_tag
              WHEN p_aprobar AND v_comentario IS NULL THEN 'La administración aprobó el registro.'
              ELSE '' END,
    'vehiculos',
    jsonb_build_object('vehiculo_id', v_v.id));
END;
$fn$;

-- Asignar, reponer (TAG perdido) o quitar el TAG de un vehículo YA autorizado.
CREATE OR REPLACE FUNCTION public.asignar_tag_vehiculo(
  p_vehiculo_id uuid,
  p_tag_codigo  text,
  p_tag_tipo    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_v        public.vehiculos_residentes%ROWTYPE;
  v_tag      text := nullif(btrim(coalesce(p_tag_codigo, '')), '');
  v_tag_tipo text := nullif(btrim(coalesce(p_tag_tipo, '')), '');
BEGIN
  SELECT * INTO v_v FROM public.vehiculos_residentes WHERE id = p_vehiculo_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El vehículo no existe.';
  END IF;
  IF NOT (
    public.is_super_admin()
    OR (v_v.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.vehiculos'))
  ) THEN
    RAISE EXCEPTION 'No autorizado para asignar TAGs de vehículos.';
  END IF;
  IF v_v.estado <> 'aprobada' THEN
    RAISE EXCEPTION 'Solo se asigna TAG a un vehículo autorizado (estado actual: %).', v_v.estado;
  END IF;
  IF v_tag_tipo IS NOT NULL AND v_tag_tipo NOT IN ('sticker', 'rfid', 'tarjeta', 'control', 'otro') THEN
    RAISE EXCEPTION 'Tipo de TAG inválido: %', v_tag_tipo;
  END IF;
  IF v_tag IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.vehiculos_residentes x
     WHERE x.project_id = v_v.project_id AND x.id <> v_v.id AND x.estado = 'aprobada'
       AND upper(btrim(x.tag_codigo)) = upper(v_tag)
  ) THEN
    RAISE EXCEPTION 'El TAG % ya está asignado a otro vehículo del condominio.', v_tag;
  END IF;

  UPDATE public.vehiculos_residentes
     SET tag_codigo      = v_tag,
         tag_tipo        = CASE WHEN v_tag IS NOT NULL THEN coalesce(v_tag_tipo, tag_tipo, 'sticker') END,
         tag_asignado_at = CASE WHEN v_tag IS NOT NULL THEN now() END
   WHERE id = v_v.id;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Aviso al staff al ENVIAR (no al reservar el borrador)
-- ─────────────────────────────────────────────────────────────────────────────
-- Reutiliza el trigger genérico de 20260819000000. Solo UPDATE: el portal
-- siempre pasa por borrador, y lo que el staff crea directo nace 'aprobada'.
DROP TRIGGER IF EXISTS trg_notif_solicitud_mascota ON public.mascotas;
CREATE TRIGGER trg_notif_solicitud_mascota
  AFTER UPDATE ON public.mascotas
  FOR EACH ROW
  WHEN (NEW.estado = 'pendiente' AND OLD.estado IS DISTINCT FROM 'pendiente')
  EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('mascota', 'condominios');

DROP TRIGGER IF EXISTS trg_notif_solicitud_vehiculo ON public.vehiculos_residentes;
CREATE TRIGGER trg_notif_solicitud_vehiculo
  AFTER UPDATE ON public.vehiculos_residentes
  FOR EACH ROW
  WHEN (NEW.estado = 'pendiente' AND OLD.estado IS DISTINCT FROM 'pendiente')
  EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('vehículo', 'condominios');

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Bucket privado `padron-docs` (carnet de vacunación, tarjeta de circulación…)
-- ─────────────────────────────────────────────────────────────────────────────
-- Path: {unidad_id}/{mascotas|vehiculos}/{fila_id}/{archivo}
--   • ESCRITURA: solo quien solicitó, y solo mientras su fila sigue en
--     'borrador'. Al enviar, el expediente queda inmutable.
--   • LECTURA: quien solicitó, el propietario de la unidad y el staff de la
--     empresa con el permiso del tab correspondiente.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'padron-docs',
  'padron-docs',
  false,
  10485760,  -- 10 MiB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- ¿El objeto pertenece a una fila del padrón que el usuario puede ESCRIBIR?
-- SECURITY DEFINER porque las policies de storage corren con el rol del
-- usuario y aquí hay que leer la fila sin depender de la RLS de cada tabla.
CREATE OR REPLACE FUNCTION public.padron_doc_escribible(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH seg AS (SELECT (storage.foldername(p_name)) AS f)
  SELECT current_user_role() = 'cliente'
     AND get_my_cliente_id() IS NOT NULL
     AND array_length(seg.f, 1) = 3
     AND (
       (seg.f[2] = 'mascotas' AND EXISTS (
          SELECT 1 FROM public.mascotas m
           WHERE m.id::text = seg.f[3] AND m.unidad_id::text = seg.f[1]
             AND m.estado = 'borrador' AND m.cliente_id = get_my_cliente_id()))
       OR
       (seg.f[2] = 'vehiculos' AND EXISTS (
          SELECT 1 FROM public.vehiculos_residentes v
           WHERE v.id::text = seg.f[3] AND v.unidad_id::text = seg.f[1]
             AND v.estado = 'borrador' AND v.cliente_id = get_my_cliente_id()))
     )
  FROM seg;
$fn$;

CREATE OR REPLACE FUNCTION public.padron_doc_legible(p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH seg AS (SELECT (storage.foldername(p_name)) AS f),
  fila AS (
    SELECT m.company_id, m.unidad_id, m.cliente_id, 'condominios.tab.mascotas' AS permiso
      FROM public.mascotas m, seg
     WHERE seg.f[2] = 'mascotas' AND m.id::text = seg.f[3] AND m.unidad_id::text = seg.f[1]
    UNION ALL
    SELECT v.company_id, v.unidad_id, v.cliente_id, 'condominios.tab.vehiculos'
      FROM public.vehiculos_residentes v, seg
     WHERE seg.f[2] = 'vehiculos' AND v.id::text = seg.f[3] AND v.unidad_id::text = seg.f[1]
  )
  SELECT coalesce(bool_or(
           (fila.company_id = get_my_company_id() AND user_has_permission(fila.permiso))
        OR (current_user_role() = 'cliente' AND fila.cliente_id = get_my_cliente_id())
        OR (current_user_role() = 'cliente'
            AND fila.unidad_id IN (SELECT x FROM public.mis_unidades_propietario_ids() x))
         ), false)
    FROM fila;
$fn$;

REVOKE ALL ON FUNCTION public.padron_doc_escribible(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.padron_doc_legible(text)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.padron_doc_escribible(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.padron_doc_legible(text)    TO authenticated;

DROP POLICY IF EXISTS "padron_docs_select" ON storage.objects;
DROP POLICY IF EXISTS "padron_docs_insert" ON storage.objects;
DROP POLICY IF EXISTS "padron_docs_update" ON storage.objects;
DROP POLICY IF EXISTS "padron_docs_delete" ON storage.objects;

CREATE POLICY "padron_docs_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'padron-docs' AND (is_super_admin() OR public.padron_doc_legible(name)));

CREATE POLICY "padron_docs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'padron-docs' AND (is_super_admin() OR public.padron_doc_escribible(name)));

CREATE POLICY "padron_docs_update" ON storage.objects FOR UPDATE TO authenticated
  USING      (bucket_id = 'padron-docs' AND (is_super_admin() OR public.padron_doc_escribible(name)))
  WITH CHECK (bucket_id = 'padron-docs' AND (is_super_admin() OR public.padron_doc_escribible(name)));

CREATE POLICY "padron_docs_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'padron-docs' AND (is_super_admin() OR public.padron_doc_escribible(name)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. ACL de las RPC
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_firmas text[] := ARRAY[
    'public.portal_reservar_mascota(uuid)',
    'public.portal_enviar_mascota(uuid, jsonb, jsonb)',
    'public.portal_descartar_mascota(uuid)',
    'public.portal_baja_mascota(uuid, text)',
    'public.portal_reservar_vehiculo(uuid)',
    'public.portal_enviar_vehiculo(uuid, jsonb, jsonb)',
    'public.portal_descartar_vehiculo(uuid)',
    'public.portal_baja_vehiculo(uuid, text)',
    'public.resolver_mascota(uuid, boolean, text)',
    'public.resolver_vehiculo(uuid, boolean, text, text, text)',
    'public.asignar_tag_vehiculo(uuid, text, text)'
  ];
  v_f text;
BEGIN
  FOREACH v_f IN ARRAY v_firmas LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_f);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.portal_reservar_mascota(uuid) IS
  'Crea (o devuelve) el borrador de registro de mascota del residente en su unidad. Su id es la carpeta de los adjuntos en padron-docs.';
COMMENT ON FUNCTION public.portal_enviar_mascota(uuid, jsonb, jsonb) IS
  'Valida y envía el borrador de mascota (ficha, vacunas, foto y documentos de {unidad}/mascotas/{id}/). Lo deja pendiente de autorización.';
COMMENT ON FUNCTION public.portal_descartar_mascota(uuid) IS
  'Elimina el borrador de mascota del propio residente.';
COMMENT ON FUNCTION public.portal_baja_mascota(uuid, text) IS
  'Quien la registró o el propietario retira la solicitud pendiente o da de baja la mascota autorizada (estado=baja, activo=false).';
COMMENT ON FUNCTION public.portal_reservar_vehiculo(uuid) IS
  'Crea (o devuelve) el borrador de registro de vehículo del residente en su unidad. Su id es la carpeta de los adjuntos en padron-docs.';
COMMENT ON FUNCTION public.portal_enviar_vehiculo(uuid, jsonb, jsonb) IS
  'Valida y envía el borrador de vehículo (placa única en el condominio, documentos de {unidad}/vehiculos/{id}/). Lo deja pendiente de autorización.';
COMMENT ON FUNCTION public.portal_descartar_vehiculo(uuid) IS
  'Elimina el borrador de vehículo del propio residente.';
COMMENT ON FUNCTION public.portal_baja_vehiculo(uuid, text) IS
  'Quien lo registró o el propietario retira la solicitud pendiente o da de baja el vehículo autorizado (estado=baja, activo=false; libera el TAG).';
COMMENT ON FUNCTION public.resolver_mascota(uuid, boolean, text) IS
  'La administración (permiso condominios.tab.mascotas) aprueba o rechaza (con motivo) una mascota pendiente. Identidad de auditoría desde auth.uid(); avisa al residente.';
COMMENT ON FUNCTION public.resolver_vehiculo(uuid, boolean, text, text, text) IS
  'La administración (permiso condominios.tab.vehiculos) aprueba —asignando opcionalmente el TAG de ingreso— o rechaza (con motivo) un vehículo pendiente. Avisa al residente.';
COMMENT ON FUNCTION public.asignar_tag_vehiculo(uuid, text, text) IS
  'Asigna, repone o quita (NULL) el TAG de ingreso de un vehículo autorizado. Único por proyecto entre vehículos aprobados.';
