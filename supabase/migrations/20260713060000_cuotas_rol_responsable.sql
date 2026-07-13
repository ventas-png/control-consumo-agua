-- Cuotas diferenciadas propietario/inquilino — etiquetar cada cuota con un
-- ROL RESPONSABLE (P1 · cobranza · portal propietario/inquilino).
--
-- Una unidad puede tener propietario E inquilino a la vez (unidad_residentes,
-- fase 1-3). Algunos cargos son responsabilidad del dueño (p. ej. cuotas
-- extraordinarias / obras) y otros del inquilino (p. ej. mantenimiento según el
-- contrato). Esta migración añade `rol_responsable` a la cuota (y a la plantilla
-- que la genera) para poder etiquetar quién responde por cada cargo.
--
-- VOCABULARIO: reutiliza EXACTAMENTE el CHECK de `unidad_residentes.tipo`
-- ('propietario' | 'arrendatario' | 'familiar' | 'otro') para que el rol de la
-- cuota y el rol del residente sean el mismo dominio — habilitando, más adelante,
-- enrutar el cargo al login del residente cuyo `unidad_residentes.tipo` coincide.
--
-- BEHAVIOR-PRESERVING: columnas aditivas y NULLABLE (default NULL = "sin
-- diferenciar / responsabilidad de la unidad", que es el comportamiento de hoy).
-- El backfill NO toca filas existentes: todas quedan NULL, así que ninguna cuota
-- cambia de dueño ni de visibilidad. NO se modifica RLS: el residente sigue
-- viendo TODAS las cuotas de su unidad (la separación de visibilidad por rol es
-- un cambio posterior y separado, con QA en preview por tocar el portal del
-- residente). Esta migración solo "arma" la etiqueta; su consumo es informativo.

-- ── cuotas_condominio.rol_responsable ────────────────────────────────────────
ALTER TABLE public.cuotas_condominio
  ADD COLUMN IF NOT EXISTS rol_responsable text;

ALTER TABLE public.cuotas_condominio
  DROP CONSTRAINT IF EXISTS cuotas_condominio_rol_responsable_check;
ALTER TABLE public.cuotas_condominio
  ADD CONSTRAINT cuotas_condominio_rol_responsable_check
  CHECK (rol_responsable IS NULL OR rol_responsable IN ('propietario','arrendatario','familiar','otro'));

COMMENT ON COLUMN public.cuotas_condominio.rol_responsable IS
  'Rol del residente responsable del cargo (mismo dominio que unidad_residentes.tipo). '
  'NULL = sin diferenciar (responsabilidad de la unidad). No altera RLS: informativo.';

-- Índice parcial para el filtro futuro del portal (solo filas etiquetadas).
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_rol_responsable
  ON public.cuotas_condominio(unidad_id, rol_responsable)
  WHERE rol_responsable IS NOT NULL;

-- ── plantillas_cuota.rol_responsable ─────────────────────────────────────────
-- La plantilla lleva un rol responsable por defecto que la generación en lote
-- estampa en cada cuota generada (misma semántica; NULL = sin diferenciar).
ALTER TABLE public.plantillas_cuota
  ADD COLUMN IF NOT EXISTS rol_responsable text;

ALTER TABLE public.plantillas_cuota
  DROP CONSTRAINT IF EXISTS plantillas_cuota_rol_responsable_check;
ALTER TABLE public.plantillas_cuota
  ADD CONSTRAINT plantillas_cuota_rol_responsable_check
  CHECK (rol_responsable IS NULL OR rol_responsable IN ('propietario','arrendatario','familiar','otro'));

COMMENT ON COLUMN public.plantillas_cuota.rol_responsable IS
  'Rol responsable por defecto que la generación en lote estampa en cada cuota. '
  'Mismo dominio que unidad_residentes.tipo. NULL = sin diferenciar.';
