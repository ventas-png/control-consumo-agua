-- Notas administrativas → minutas de reunión.
--
-- POR QUÉ. La pestaña «Notas Admin» era texto libre (título + contenido). La
-- administración la usa para dejar constancia de reuniones con empleados,
-- propietarios/inquilinos y proveedores, y necesita lo que una minuta tiene y
-- una nota no: QUIÉNES participaron (y quién la gestionó), QUÉ puntos se
-- abordaron y, por cada punto, los acuerdos y los compromisos con responsable
-- y fecha límite para darles seguimiento.
--
-- Se amplía la misma tabla en vez de crear otras: la minuta es una unidad de
-- edición (se captura y se corrige entera, como el acta de una asamblea), el
-- mismo criterio con el que `actas_reunion` guarda `asistentes` y
-- `orden_del_dia` como JSON. Mantener la tabla conserva el permiso
-- condominios.tab.notas_admin.* y sus políticas (20261104000400) sin tocar RLS.
--
-- Forma de los JSON (la pantalla los valida; ver docs/MINUTAS_REUNION.md):
--   participantes: [{ id, tipo: 'empleado'|'residente'|'proveedor'|'otro',
--                     ref_id, nombre, detalle, gestiona }]
--   puntos:        [{ id, titulo, descripcion,
--                     acuerdos: [{ id, tipo: 'acuerdo'|'compromiso', texto,
--                                  responsable_id, fecha_limite, cumplido, cumplido_at }] }]
--
-- `contenido` pasa a ser el objetivo de la reunión (opcional en pantalla): se
-- le da DEFAULT '' para que las minutas sin objetivo no choquen con el NOT NULL;
-- las notas existentes conservan su texto.
--
-- Reversión:
--   ALTER TABLE public.notas_admin
--     DROP CONSTRAINT IF EXISTS notas_admin_participantes_array,
--     DROP CONSTRAINT IF EXISTS notas_admin_puntos_array,
--     DROP COLUMN IF EXISTS fecha_reunion,
--     DROP COLUMN IF EXISTS participantes,
--     DROP COLUMN IF EXISTS puntos,
--     ALTER COLUMN contenido DROP DEFAULT;
--   DROP INDEX IF EXISTS public.idx_notas_admin_fecha_reunion;

ALTER TABLE public.notas_admin
  ADD COLUMN IF NOT EXISTS fecha_reunion date,
  ADD COLUMN IF NOT EXISTS participantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS puntos        jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.notas_admin
  ALTER COLUMN contenido SET DEFAULT '';

-- Las dos columnas son LISTAS: un objeto o un escalar guardado por error
-- rompería a la pantalla al recorrerlas.
ALTER TABLE public.notas_admin
  ADD CONSTRAINT notas_admin_participantes_array CHECK (jsonb_typeof(participantes) = 'array'),
  ADD CONSTRAINT notas_admin_puntos_array        CHECK (jsonb_typeof(puntos) = 'array');

-- Las notas que ya existían son reuniones del día en que se escribieron: así
-- la lista, que ordena por fecha de reunión, no las manda al final.
UPDATE public.notas_admin
   SET fecha_reunion = (created_at AT TIME ZONE 'America/Guatemala')::date
 WHERE fecha_reunion IS NULL;

CREATE INDEX IF NOT EXISTS idx_notas_admin_fecha_reunion
  ON public.notas_admin (project_id, fecha_reunion DESC);

COMMENT ON COLUMN public.notas_admin.participantes IS
  'Participantes de la minuta (JSON): tipo empleado/residente/proveedor/otro, nombre, detalle y quién la gestiona.';
COMMENT ON COLUMN public.notas_admin.puntos IS
  'Puntos abordados (JSON) con sus acuerdos y compromisos (responsable, fecha límite, cumplido).';
