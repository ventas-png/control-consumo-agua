-- ════════════════════════════════════════════════════════════════════════════
-- Sandbox de la migración de cierre posfusión (20260903000000)
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ ES. Un banco de pruebas CONDUCTUAL de la migración de mantenimiento:
-- monta en una base desechable el andamiaje mínimo del que depende
-- —`paquetes_recibidos` con su CHECK NOT VALID, la vista de compatibilidad y,
-- según el escenario, el respaldo de correspondencia—, aplica LA MIGRACIÓN
-- REAL (el runner le pasa el archivo del repo, no una copia) y comprueba qué
-- pasó: si abortó, con qué mensaje, y qué quedó en pie.
--
-- POR QUÉ ASÍ. Las dos cosas que hace la migración son irreversibles o
-- destructivas —validar una constraint y borrar la única copia de unas filas—,
-- y su valor está justamente en ABORTAR cuando algo no cuadra. Una prueba que
-- sólo mirara el camino feliz no diría nada del camino que importa.
--
-- LOS DATOS ESPERADOS SE ESCRIBEN A MANO. El escenario `respaldo-completo`
-- declara literalmente las filas que la cadena de migraciones DEBIÓ producir,
-- en vez de generarlas con las mismas expresiones que la migración usa para
-- compararlas. Si se generaran, la prueba compararía la migración consigo misma
-- y pasaría aunque el mapeo estuviera mal.
--
-- Uso:  scripts/cierre-posfusion-sandbox.sh
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS sandbox;

-- ── Andamiaje ───────────────────────────────────────────────────────────────
-- Sólo lo que la migración toca. Sin RLS ni helpers de RBAC: aquí no se prueba
-- quién puede ver qué, se prueba qué hace la migración con los datos.
CREATE TABLE public.paquetes_recibidos (
  id                 uuid PRIMARY KEY,
  company_id         uuid        NOT NULL,
  project_id         uuid        NOT NULL,
  unidad_id          uuid,
  clase              text        NOT NULL DEFAULT 'paquete',
  destinatario_tipo  text        NOT NULL DEFAULT 'unidad',
  tipo               text,
  descripcion        text        NOT NULL,
  remitente          text,
  destinatario       text,
  num_guia           text,
  empresa_mensajeria text,
  estado             text        NOT NULL DEFAULT 'pendiente',
  direccion          text        NOT NULL DEFAULT 'entrante',
  prioridad          text        NOT NULL DEFAULT 'normal',
  fecha_limite       date,
  fecha_pieza        date,
  notas              text,
  fotos              text[],
  firma_path         text,
  entregado_a_nombre text,
  entregado_via      text,
  hora_recepcion     timestamptz NOT NULL DEFAULT now(),
  hora_entrega       timestamptz,
  recibido_por       uuid,
  entregado_por      uuid,
  creado_por         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- La vista de compatibilidad: la migración le pone un COMMENT, así que tiene
-- que existir. Su forma no es lo que se prueba aquí.
CREATE VIEW public.correspondencia_condominio AS
SELECT id, company_id, project_id,
       CASE direccion WHEN 'saliente' THEN 'salida' ELSE 'entrada' END AS tipo,
       tipo AS categoria, descripcion AS asunto, remitente, destinatario,
       fecha_pieza AS fecha, num_guia AS numero_guia, empresa_mensajeria,
       prioridad, estado, notas AS observaciones, unidad_id, created_at
  FROM public.paquetes_recibidos
 WHERE clase = 'correspondencia';

-- Un comentario ANTERIOR y reconocible. La migración lo reemplaza por el suyo;
-- si aborta, tiene que seguir siendo exactamente éste. Es la sonda que
-- distingue «no escribió» de «escribió y luego falló otra cosa».
COMMENT ON VIEW public.correspondencia_condominio IS
  'COMENTARIO ANTERIOR DEL SANDBOX — no debe cambiar si la migración aborta';

-- El respaldo, con la forma que tenía `correspondencia_condominio` cuando
-- 20260829000600 hizo `CREATE TABLE ... AS TABLE`: las columnas originales de
-- 20260420000014, más las de acuse que añadió 20260828000300, más el
-- `creado_por` que reparte 20260731000000.
CREATE TABLE sandbox.plantilla_respaldo (
  id                 uuid PRIMARY KEY,
  company_id         uuid        NOT NULL,
  project_id         uuid        NOT NULL,
  tipo               text        NOT NULL DEFAULT 'entrada',
  categoria          text        NOT NULL DEFAULT 'carta',
  asunto             text        NOT NULL,
  remitente          text,
  destinatario       text,
  fecha              date        NOT NULL DEFAULT CURRENT_DATE,
  numero_guia        text,
  prioridad          text        NOT NULL DEFAULT 'normal',
  estado             text        NOT NULL DEFAULT 'pendiente',
  observaciones      text,
  unidad_id          uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  fotos              text[],
  firma_path         text,
  entregado_a_nombre text,
  entregado_via      text,
  hora_entrega       timestamptz,
  recibido_por       uuid,
  entregado_por      uuid,
  empresa_mensajeria text,
  fecha_limite       date,
  creado_por         uuid
);

-- ── Identidades fijas, para que los mensajes de fallo sean legibles ─────────
CREATE TABLE sandbox.ids (nombre text PRIMARY KEY, v uuid NOT NULL);
INSERT INTO sandbox.ids VALUES
  ('empresa', '11111111-1111-1111-1111-111111111111'),
  ('proyecto','22222222-2222-2222-2222-222222222222'),
  ('unidad',  '33333333-3333-3333-3333-333333333333'),
  ('r1',      'aaaaaaa1-0000-4000-8000-000000000001'),
  ('r2',      'aaaaaaa2-0000-4000-8000-000000000002'),
  ('r3',      'aaaaaaa3-0000-4000-8000-000000000003'),
  ('paq',     'bbbbbbb1-0000-4000-8000-000000000001');

CREATE FUNCTION sandbox.id(text) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT v FROM sandbox.ids WHERE nombre = $1 $$;

-- ── El CHECK, tal como lo dejó 20260901000000 ───────────────────────────────
-- Se añade DESPUÉS de sembrar: `NOT VALID` no revisa las filas que ya estaban,
-- pero sí las que se insertan después, así que los escenarios con vocabulario
-- inválido no podrían sembrarse con la constraint ya puesta.
CREATE PROCEDURE sandbox.poner_check() LANGUAGE sql AS $$
  ALTER TABLE public.paquetes_recibidos
    ADD CONSTRAINT paquetes_estado_chk CHECK (
      CASE clase
        WHEN 'paquete'         THEN estado IN ('pendiente','entregado','devuelto')
        WHEN 'correspondencia' THEN estado IN ('pendiente','atendido','archivado','devuelto')
        ELSE false
      END
    ) NOT VALID;
$$;

/**
 * Siembra el escenario pedido y deja la base lista para aplicar la migración.
 *
 * Cada escenario se monta sobre una base recién creada: el runner no reutiliza
 * estado entre uno y otro.
 */
CREATE PROCEDURE sandbox.montar(p_escenario text) LANGUAGE plpgsql AS $proc$
DECLARE
  c   uuid := sandbox.id('empresa');
  pr  uuid := sandbox.id('proyecto');
  u   uuid := sandbox.id('unidad');
BEGIN
  -- Una pieza de paquetería válida, presente en todos los escenarios: si la
  -- migración tocara algo que no debe, se nota aquí.
  INSERT INTO public.paquetes_recibidos
    (id, company_id, project_id, unidad_id, clase, destinatario_tipo, tipo,
     descripcion, estado, direccion, hora_recepcion, created_at)
  VALUES
    (sandbox.id('paq'), c, pr, u, 'paquete', 'unidad', 'caja',
     'Paquete de Amazon', 'entregado', 'entrante',
     '2026-07-01 08:00+00', '2026-07-01 08:00+00');

  IF p_escenario = 'vocabulario-valido' THEN
    -- Las siete combinaciones admitidas, ni una menos.
    INSERT INTO public.paquetes_recibidos
      (id, company_id, project_id, unidad_id, clase, destinatario_tipo,
       descripcion, estado, direccion)
    SELECT gen_random_uuid(), c, pr, u, v.clase, 'unidad',
           format('%s / %s', v.clase, v.estado), v.estado, 'entrante'
      FROM (VALUES
        ('paquete','pendiente'), ('paquete','entregado'), ('paquete','devuelto'),
        ('correspondencia','pendiente'), ('correspondencia','atendido'),
        ('correspondencia','archivado'), ('correspondencia','devuelto')
      ) AS v(clase, estado);

  ELSIF p_escenario = 'vocabulario-invalido' THEN
    -- Tres formas distintas de estar fuera del vocabulario: estado de la otra
    -- clase, estado inexistente, y una clase que no existe.
    INSERT INTO public.paquetes_recibidos
      (id, company_id, project_id, unidad_id, clase, destinatario_tipo,
       descripcion, estado, direccion)
    VALUES
      (gen_random_uuid(), c, pr, u, 'paquete',         'unidad', 'estado ajeno',      'atendido',  'entrante'),
      (gen_random_uuid(), c, pr, u, 'paquete',         'unidad', 'estado ajeno 2',    'atendido',  'entrante'),
      (gen_random_uuid(), c, pr, u, 'correspondencia', 'unidad', 'estado de paquete', 'entregado', 'entrante'),
      (gen_random_uuid(), c, pr, u, 'sobre',           'unidad', 'clase inventada',   'pendiente', 'entrante');

  ELSIF p_escenario IN ('respaldo-vacio', 'respaldo-completo',
                        'respaldo-incompleto', 'respaldo-incompleto-recuperado',
                        'respaldo-alterado') THEN
    CREATE TABLE public.correspondencia_condominio_respaldo
      (LIKE sandbox.plantilla_respaldo INCLUDING ALL);

    IF p_escenario <> 'respaldo-vacio' THEN
      -- ── Las filas ORIGINALES, tal como estaban antes de la unificación ────
      INSERT INTO public.correspondencia_condominio_respaldo
        (id, company_id, project_id, tipo, categoria, asunto, remitente, destinatario,
         fecha, numero_guia, prioridad, estado, observaciones, unidad_id, created_at,
         entregado_a_nombre, entregado_via, hora_entrega, empresa_mensajeria)
      VALUES
        -- R1 · normal, sin acuse.
        (sandbox.id('r1'), c, pr, 'entrada', 'carta', 'Recibo de luz', 'EEGSA', 'Ana',
         '2026-07-01', 'G-1', 'normal', 'pendiente', 'dejar en portería', u,
         '2026-07-01 10:00+00', NULL, NULL, NULL, NULL),
        -- R2 · atendida SIN nombre ni hora: la que dispara el relleno de acuse.
        (sandbox.id('r2'), c, pr, 'salida', 'notificacion_legal', 'Requerimiento', 'Juzgado', 'Admin',
         '2026-07-02', NULL, 'urgente', 'atendido', NULL, NULL,
         '2026-07-02 09:30+00', NULL, NULL, NULL, 'Cargo Expreso'),
        -- R3 · vocabulario sucio: categoría, estado y prioridad fuera de lista.
        (sandbox.id('r3'), c, pr, 'otra', 'publicidad', 'Volante', NULL, NULL,
         '2026-07-03', NULL, 'baja', 'raro', NULL, u,
         '2026-07-03 11:15+00', NULL, NULL, NULL, NULL);

      -- ── Lo que la cadena DEBIÓ dejar en destino, escrito a mano ───────────
      INSERT INTO public.paquetes_recibidos
        (id, company_id, project_id, unidad_id, clase, destinatario_tipo, tipo,
         descripcion, remitente, destinatario, num_guia, empresa_mensajeria,
         estado, direccion, prioridad, fecha_pieza, notas,
         entregado_a_nombre, hora_recepcion, hora_entrega, created_at)
      VALUES
        (sandbox.id('r1'), c, pr, u, 'correspondencia', 'unidad', 'carta',
         'Recibo de luz', 'EEGSA', 'Ana', 'G-1', NULL,
         'pendiente', 'entrante', 'normal', '2026-07-01', 'dejar en portería',
         NULL, '2026-07-01 10:00+00', NULL, '2026-07-01 10:00+00'),
        (sandbox.id('r2'), c, pr, NULL, 'correspondencia', 'administracion', 'notificacion_legal',
         'Requerimiento', 'Juzgado', 'Admin', NULL, 'Cargo Expreso',
         'atendido', 'saliente', 'urgente', '2026-07-02', NULL,
         'No registrado (acuse anterior a 2026-08-31)',
         '2026-07-02 09:30+00', '2026-07-02 09:30+00', '2026-07-02 09:30+00'),
        (sandbox.id('r3'), c, pr, u, 'correspondencia', 'unidad', 'otro',
         'Volante', NULL, NULL, NULL, NULL,
         'archivado', 'entrante', 'normal', '2026-07-03', NULL,
         NULL, '2026-07-03 11:15+00', NULL, '2026-07-03 11:15+00');

      IF p_escenario IN ('respaldo-incompleto', 'respaldo-incompleto-recuperado') THEN
        -- Una pieza respaldada que NO llegó al motor unificado.
        DELETE FROM public.paquetes_recibidos WHERE id = sandbox.id('r2');
      ELSIF p_escenario = 'respaldo-alterado' THEN
        -- Llegó, pero con el asunto cambiado: el respaldo ya no la respalda.
        UPDATE public.paquetes_recibidos
           SET descripcion = 'Recibo de agua'
         WHERE id = sandbox.id('r1');
      END IF;
    END IF;

  ELSIF p_escenario = 'sin-respaldo' THEN
    NULL;  -- la tabla no existe; la migración tiene que tratarlo como no-op

  ELSE
    RAISE EXCEPTION 'escenario desconocido: %', p_escenario;
  END IF;

  CALL sandbox.poner_check();
END;
$proc$;


/**
 * Repone la pieza R2 que `respaldo-incompleto` había borrado del destino, con
 * exactamente los valores que la cadena de migraciones debió dejar.
 *
 * Sirve al escenario de recuperación: reparar el dato y volver a aplicar la
 * migración tiene que converger, porque bajo `psql` un aborto en la retirada
 * del respaldo deja el VALIDATE de la sección 2 ya cometido.
 */
CREATE PROCEDURE sandbox.reponer_r2() LANGUAGE sql AS $$
  INSERT INTO public.paquetes_recibidos
    (id, company_id, project_id, unidad_id, clase, destinatario_tipo, tipo,
     descripcion, remitente, destinatario, num_guia, empresa_mensajeria,
     estado, direccion, prioridad, fecha_pieza, notas,
     entregado_a_nombre, hora_recepcion, hora_entrega, created_at)
  VALUES
    (sandbox.id('r2'), sandbox.id('empresa'), sandbox.id('proyecto'), NULL,
     'correspondencia', 'administracion', 'notificacion_legal',
     'Requerimiento', 'Juzgado', 'Admin', NULL, 'Cargo Expreso',
     'atendido', 'saliente', 'urgente', '2026-07-02', NULL,
     'No registrado (acuse anterior a 2026-08-31)',
     '2026-07-02 09:30+00', '2026-07-02 09:30+00', '2026-07-02 09:30+00');
$$;


/**
 * Deshace la alteración que `respaldo-alterado` introdujo en el destino: le
 * devuelve a R1 la descripción que la cadena de migraciones había dejado.
 *
 * Sirve al escenario de divergencia: primero se comprueba que la migración
 * abortó SIN tocar nada, y después que, reparado el dato, la misma migración
 * completa las tres escrituras.
 */
CREATE PROCEDURE sandbox.reparar_r1() LANGUAGE sql AS $$
  UPDATE public.paquetes_recibidos
     SET descripcion = 'Recibo de luz'
   WHERE id = sandbox.id('r1');
$$;
