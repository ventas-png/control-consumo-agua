-- ════════════════════════════════════════════════════════════════════════════
-- Limpieza: asignación por turno/cargo/persona + rutas diarias con evidencia
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ FALTABA
-- `programacion_limpieza` es hoy un catálogo de áreas con `responsable` TEXTO
-- LIBRE ("Nombre o empresa"). El condominio ya tiene su plantilla cargada en
-- `personal_condominio` (nombre, cargo, turno), pero las dos tablas no se
-- tocan: no se puede responder "¿qué le toca hoy a la conserje del turno
-- diurno?" ni "¿quedó hecha el área, con foto?".
--
-- Y sin ejecución por día tampoco hay dónde poner lo que el operativo tiene que
-- reportar EN el momento: la foto de que quedó limpia, y la novedad ("la llave
-- del lobby gotea") que hoy se pierde en un WhatsApp.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `programacion_limpieza` gana la asignación: a quién (personal_id), o a
--      qué perfil (turno + cargo) cuando el área la cubre "quien esté de turno".
--      `responsable` se conserva intacta — sigue sirviendo para empresas
--      externas, que no están en `personal_condominio`.
--   2. `ejecuciones_limpieza`: una fila por (área, día). Es la ruta del día del
--      empleado: se genera desde las áreas asignadas, se cierra con fotos y
--      admite una novedad con prioridad y bandera de mantenimiento.
--
-- POR QUÉ UNA TABLA NUEVA Y NO `tareas_bloque`
-- `bloques_turno`/`tareas_bloque` (20260424000060) modelan el turno COMPLETO de
-- un operativo: se abre un bloque, se le cuelgan tareas de cualquier tipo y un
-- supervisor las revisa. Una ruta de limpieza es más chica y tiene su propio
-- ciclo: nace de una programación con frecuencia, y al cerrarse tiene que mover
-- `ultima_ejecucion`/`proxima_ejecucion` del área. Meterla ahí obligaría a que
-- `tareas_bloque` supiera de frecuencias y de programaciones, y a abrir un
-- bloque de turno para poder marcar un área. Se queda al lado, con FK a la
-- programación, que es lo que de verdad la define.
--
-- RLS: mismas policies que el resto del módulo tras el hardening RBAC
-- (20260518000010) — gate por `user_has_permission('condominios.tab.prog_limpieza')`,
-- que es el permiso que ya controla quién ve este tab. El helper
-- `rbac_install_company_policies` NO se puede reusar: aquella migración lo
-- dropea al final a propósito, así que las cuatro policies van escritas.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
-- DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- REVERSA: DROP TABLE public.ejecuciones_limpieza; y DROP COLUMN de las cinco
-- columnas nuevas de `programacion_limpieza`.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. programacion_limpieza — a quién le toca
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.programacion_limpieza
  ADD COLUMN IF NOT EXISTS personal_id    uuid REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS turno          text,
  ADD COLUMN IF NOT EXISTS cargo          text,
  ADD COLUMN IF NOT EXISTS orden          int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requiere_foto  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.programacion_limpieza.personal_id IS
  'Empleado asignado (personal_condominio). NULL = el área la cubre quien encaje con turno/cargo, o un tercero (ver `responsable`).';
COMMENT ON COLUMN public.programacion_limpieza.turno IS
  'Turno al que corresponde el área: diurno | nocturno | rotativo. NULL = cualquier turno.';
COMMENT ON COLUMN public.programacion_limpieza.cargo IS
  'Cargo que debe cubrirla: conserje | guardia | jardinero | mantenimiento | administrador | otro. NULL = cualquier cargo.';
COMMENT ON COLUMN public.programacion_limpieza.orden IS
  'Orden del área dentro de la ruta del empleado (menor primero).';
COMMENT ON COLUMN public.programacion_limpieza.requiere_foto IS
  'Si es true, la ejecución del día no se puede cerrar sin al menos una foto.';

-- Los valores se validan con CHECK y no con un enum de PG: el resto del módulo
-- (frecuencia, estado, cargo/turno de personal_condominio) usa text + CHECK, y
-- un enum obliga a migración para agregar un valor.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prog_limpieza_turno_check') THEN
    ALTER TABLE public.programacion_limpieza
      ADD CONSTRAINT prog_limpieza_turno_check
      CHECK (turno IS NULL OR turno IN ('diurno', 'nocturno', 'rotativo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prog_limpieza_cargo_check') THEN
    ALTER TABLE public.programacion_limpieza
      ADD CONSTRAINT prog_limpieza_cargo_check
      CHECK (cargo IS NULL OR cargo IN ('conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_prog_limpieza_personal
  ON public.programacion_limpieza(project_id, personal_id)
  WHERE personal_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ejecuciones_limpieza — la ruta del día
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ejecuciones_limpieza (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id             uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  programacion_id        uuid        NOT NULL REFERENCES public.programacion_limpieza(id) ON DELETE CASCADE,
  personal_id            uuid        REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  fecha                  date        NOT NULL,
  turno                  text,
  orden                  int         NOT NULL DEFAULT 0,
  estado                 text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'completada' | 'con_novedad' | 'omitida'
  completada_en          timestamptz,
  foto_urls              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  observacion            text,
  -- Novedad: lo que el operativo encontró y no le toca resolver a él.
  novedad                text,
  requiere_mantenimiento boolean     NOT NULL DEFAULT false,
  prioridad              text,
  -- 'baja' | 'media' | 'alta'
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ejec_limpieza_estado_check
    CHECK (estado IN ('pendiente', 'completada', 'con_novedad', 'omitida')),
  CONSTRAINT ejec_limpieza_prioridad_check
    CHECK (prioridad IS NULL OR prioridad IN ('baja', 'media', 'alta')),
  CONSTRAINT ejec_limpieza_turno_check
    CHECK (turno IS NULL OR turno IN ('diurno', 'nocturno', 'rotativo'))
);

COMMENT ON TABLE public.ejecuciones_limpieza IS
  'Ejecución diaria de un área de limpieza: la ruta del empleado. Una fila por (programación, fecha).';
COMMENT ON COLUMN public.ejecuciones_limpieza.foto_urls IS
  'Paths (bare) de `condominios-media` con la evidencia. Se firman al render (SecureImage), igual que tareas_bloque.foto_urls.';
COMMENT ON COLUMN public.ejecuciones_limpieza.requiere_mantenimiento IS
  'El operativo marca el área como necesitada de mantenimiento; el admin la ve en el resumen de novedades.';

-- Una ejecución por área y día: es lo que hace que "generar la ruta" se pueda
-- repetir sin duplicar filas (el generador hace ON CONFLICT DO NOTHING) y que
-- reasignar el área a otra persona sea un UPDATE, no una fila paralela.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ejec_limpieza_prog_fecha
  ON public.ejecuciones_limpieza(programacion_id, fecha);

CREATE INDEX IF NOT EXISTS idx_ejec_limpieza_project_fecha
  ON public.ejecuciones_limpieza(project_id, company_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ejec_limpieza_personal
  ON public.ejecuciones_limpieza(personal_id, fecha DESC)
  WHERE personal_id IS NOT NULL;
-- Parcial: el resumen de novedades solo mira las filas marcadas, que son pocas.
CREATE INDEX IF NOT EXISTS idx_ejec_limpieza_novedades
  ON public.ejecuciones_limpieza(project_id, fecha DESC)
  WHERE requiere_mantenimiento OR estado = 'con_novedad';

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.ejecuciones_limpieza ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ejecuciones_limpieza_select" ON public.ejecuciones_limpieza;
CREATE POLICY "ejecuciones_limpieza_select" ON public.ejecuciones_limpieza
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.prog_limpieza'))
  );

DROP POLICY IF EXISTS "ejecuciones_limpieza_insert" ON public.ejecuciones_limpieza;
CREATE POLICY "ejecuciones_limpieza_insert" ON public.ejecuciones_limpieza
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.prog_limpieza'))
  );

DROP POLICY IF EXISTS "ejecuciones_limpieza_update" ON public.ejecuciones_limpieza;
CREATE POLICY "ejecuciones_limpieza_update" ON public.ejecuciones_limpieza
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.prog_limpieza'))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.prog_limpieza'))
  );

DROP POLICY IF EXISTS "ejecuciones_limpieza_delete" ON public.ejecuciones_limpieza;
CREATE POLICY "ejecuciones_limpieza_delete" ON public.ejecuciones_limpieza
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );

-- ── Trazabilidad (20260731000000) ───────────────────────────────────────────
-- Misma pareja que el resto de tablas de hechos: quién la creó (inmutable) y
-- quién la dio por hecha. Sin esto, la tabla nace fuera del panel de actividad.
ALTER TABLE public.ejecuciones_limpieza
  ADD COLUMN IF NOT EXISTS creado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.ejecuciones_limpieza;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.ejecuciones_limpieza
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

DROP TRIGGER IF EXISTS trg_sellar_cierre ON public.ejecuciones_limpieza;
CREATE TRIGGER trg_sellar_cierre
  BEFORE UPDATE ON public.ejecuciones_limpieza
  FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre('completada_en', 'completada_por');

COMMENT ON COLUMN public.ejecuciones_limpieza.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';
COMMENT ON COLUMN public.ejecuciones_limpieza.completada_por IS
  'Usuario que marcó completada_en. Lo sella la BD (trg_sellar_cierre).';

-- ── Bitácora de acciones (20260731000100) ───────────────────────────────────
-- Es una tabla de HECHOS (no un catálogo), así que entra en la línea de tiempo
-- legible del condominio con el mismo trigger que usan las demás.
DROP TRIGGER IF EXISTS trg_bitacora ON public.ejecuciones_limpieza;
CREATE TRIGGER trg_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.ejecuciones_limpieza
-- `entidad_desc` toma la primera columna no vacía de la lista: la novedad si la
-- hay, si no la observación, y si no el estado — que nunca es NULL, para que la
-- fila recién generada tampoco entre a la bitácora sin descripción.
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora('Limpieza', 'novedad,observacion,estado', '', '');
