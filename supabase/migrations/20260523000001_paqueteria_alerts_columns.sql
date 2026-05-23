-- ============================================================
-- Paquetería: columnas para fotos, tipo, firma y aviso al vecino
-- ============================================================
-- Amplía paquetes_recibidos para soportar: varias fotos del paquete, tipo de
-- envío (paquete/documento/sobre/otro), firma de recepción (ruta a archivo en
-- el bucket condominios-media), datos de quién/cómo se entregó, y la marca de
-- que ya se notificó al residente (idempotencia del aviso).

ALTER TABLE public.paquetes_recibidos
  ADD COLUMN IF NOT EXISTS fotos              text[],
  ADD COLUMN IF NOT EXISTS tipo               text NOT NULL DEFAULT 'paquete',
  ADD COLUMN IF NOT EXISTS firma_path         text,
  ADD COLUMN IF NOT EXISTS entregado_a_nombre text,
  ADD COLUMN IF NOT EXISTS entregado_via      text,   -- 'portal' | 'porteria'
  ADD COLUMN IF NOT EXISTS notificado_at      timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_tipo_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_tipo_chk CHECK (tipo IN ('paquete','documento','sobre','otro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paquetes_entregado_via_chk') THEN
    ALTER TABLE public.paquetes_recibidos
      ADD CONSTRAINT paquetes_entregado_via_chk
      CHECK (entregado_via IS NULL OR entregado_via IN ('portal','porteria'));
  END IF;
END $$;

-- Notificación in-app ligada a un paquete (para navegar y para limpiar en cascada).
ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS paquete_id uuid REFERENCES public.paquetes_recibidos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_un_paquete
  ON public.user_notifications(paquete_id) WHERE paquete_id IS NOT NULL;
