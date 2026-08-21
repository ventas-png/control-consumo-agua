-- Solicitud de autorización de renta: datos del contrato + documentos anexos.
--
-- Hasta ahora el propietario solo enviaba `tipo_renta` + `motivo` (20260513000001)
-- y la administración aprobaba a ciegas: los datos reales del arrendatario se
-- capturaban DESPUÉS, a mano, en `contratos_arrendamiento`. Tampoco había forma
-- de anexar respaldo (DPI, contrato firmado, carta de responsabilidad) para
-- evaluar y archivar.
--
-- Esta migración hace que la solicitud viaje completa:
--   • Las columnas de contrato ESPEJAN 1:1 a `contratos_arrendamiento`
--     (20260420000002:298) para que el traspaso al aprobar sea una copia directa.
--     Todas nullable: con `tipo_renta = 'str'` no aplican, y las filas viejas
--     quedan intactas.
--   • `documentos` es un jsonb ARRAY de
--       { path, nombre, etiqueta?, mime?, size? }
--     donde `path` es el path BARE del bucket `renta-docs` (20260828000100); la
--     lectura firma con createSignedUrl, igual que `solicitud_mudanza_unidad.imagenes`.
--   • `contrato_id` enlaza el contrato que crea el RPC de aprobación
--     (20260828000200). Lo pone SOLO ese RPC: la policy de insert del cliente se
--     recrea exigiendo `contrato_id IS NULL`.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS + DO-blocks que chequean pg_constraint.
-- REVERSA: DROP de las columnas nuevas y restaurar la policy de 20260518000012.

-- ── 1) Columnas ──────────────────────────────────────────────────────────────
ALTER TABLE public.solicitud_renta_unidad
  ADD COLUMN IF NOT EXISTS arrendatario_nombre         text,
  ADD COLUMN IF NOT EXISTS arrendatario_identificacion text,
  ADD COLUMN IF NOT EXISTS arrendatario_telefono       text,
  ADD COLUMN IF NOT EXISTS arrendatario_email          text,
  ADD COLUMN IF NOT EXISTS monto_renta                 numeric(12,2),
  ADD COLUMN IF NOT EXISTS deposito                    numeric(12,2),
  ADD COLUMN IF NOT EXISTS dia_pago                    int,
  ADD COLUMN IF NOT EXISTS fecha_inicio                date,
  ADD COLUMN IF NOT EXISTS fecha_fin                   date,
  ADD COLUMN IF NOT EXISTS notas_contrato              text,
  ADD COLUMN IF NOT EXISTS documentos                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contrato_id                 uuid
    REFERENCES public.contratos_arrendamiento(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.solicitud_renta_unidad.documentos IS
  'Array jsonb de adjuntos del propietario: [{path, nombre, etiqueta, mime, size}]. `path` es bare, del bucket renta-docs (primer segmento = unidad_id). Máx. 8.';
COMMENT ON COLUMN public.solicitud_renta_unidad.contrato_id IS
  'Contrato de arrendamiento creado al aprobar (RPC aprobar_solicitud_renta). Lo escribe solo ese RPC.';

-- ── 2) Constraints de dominio ────────────────────────────────────────────────
-- El jsonb y los montos los controla el cliente (policy de insert del portal),
-- así que el tope y los rangos van en la base, no solo en la UI.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'solicitud_renta_dia_pago_check') THEN
    ALTER TABLE public.solicitud_renta_unidad
      ADD CONSTRAINT solicitud_renta_dia_pago_check
      CHECK (dia_pago IS NULL OR (dia_pago BETWEEN 1 AND 28));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'solicitud_renta_montos_check') THEN
    ALTER TABLE public.solicitud_renta_unidad
      ADD CONSTRAINT solicitud_renta_montos_check
      CHECK ((monto_renta IS NULL OR monto_renta >= 0)
         AND (deposito    IS NULL OR deposito    >= 0));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'solicitud_renta_fechas_check') THEN
    ALTER TABLE public.solicitud_renta_unidad
      ADD CONSTRAINT solicitud_renta_fechas_check
      CHECK (fecha_inicio IS NULL OR fecha_fin IS NULL OR fecha_fin >= fecha_inicio);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'solicitud_renta_documentos_check') THEN
    ALTER TABLE public.solicitud_renta_unidad
      ADD CONSTRAINT solicitud_renta_documentos_check
      CHECK (jsonb_typeof(documentos) = 'array' AND jsonb_array_length(documentos) <= 8);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_solicitud_renta_contrato
  ON public.solicitud_renta_unidad (contrato_id)
  WHERE contrato_id IS NOT NULL;

-- ── 3) El portal no puede enlazar un contrato ────────────────────────────────
-- Cuerpo idéntico al de 20260518000012 salvo el término `contrato_id IS NULL`.
DROP POLICY IF EXISTS "solicitud_renta_cliente_insert" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_cliente_insert" ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = solicitud_renta_unidad.unidad_id
        AND u.cliente_id = public.get_my_cliente_id()
    )
    -- Cliente cannot pre-approve their own request
    AND estado = 'pendiente'
    -- Ni auto-enlazarse un contrato: eso lo hace aprobar_solicitud_renta.
    AND contrato_id IS NULL
  );
