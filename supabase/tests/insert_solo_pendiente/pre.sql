-- Puente de columnas ANTES de aplicar 20260907000400: en producción las puso
-- 20260907000300 (materializar), que aquí no se aplica entera — arrastra el
-- motor de rutinas completo (20260904*, 20260907000200) y este sandbox prueba
-- LA POLICY DE INSERT y el gate de UPDATE, no la materialización (esa tiene
-- su harness propio, y snapshot_del_scope ya ejecuta la RPC real con guard).
-- Misma forma y defaults que declara 20260907000300.
ALTER TABLE public.tareas_bloque
  ADD COLUMN IF NOT EXISTS duracion_estimada_min  int,
  ADD COLUMN IF NOT EXISTS checklist              jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS instrucciones_seguridad text,
  ADD COLUMN IF NOT EXISTS requiere_comentario    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_checklist     boolean NOT NULL DEFAULT false;
