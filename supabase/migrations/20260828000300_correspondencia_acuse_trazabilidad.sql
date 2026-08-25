-- ============================================================
-- Correspondencia: acuse de recibo, evidencia y trazabilidad
-- ============================================================
-- Fase 0 de la convergencia Correspondencia ↔ Paquetería.
--
-- RENUMERADA — Y NO REAPLICABLE.
--
-- Nació como 20260828000000. #779 (Renta) aterrizó en `main` con una migración
-- que usaba exactamente ese número, y `scripts/migrations-guard.mjs` (regla (d))
-- no admite versiones duplicadas, así que se movió a 20260828000300.
--
-- El renombre es lo ÚNICO que cambió: el SQL ejecutable no se tocó.
--
-- Lo que NO se debe deducir de eso: esta migración no es idempotente ni
-- reaplicable. Forma parte de una cadena de SEIS que corre UNA sola vez y EN
-- ORDEN:
--   1. 20260828000300_correspondencia_acuse_trazabilidad  ← esta
--        añade columnas a la TABLA `correspondencia_condominio`.
--   2. 20260829000600_recepcion_motor_unico
--        migra sus filas y sustituye la tabla por una VISTA.
-- Después del paso 2, el `ALTER TABLE … ADD COLUMN` de abajo ya no tiene una
-- tabla contra la cual correr: `correspondencia_condominio` es una vista, y
-- Postgres lo rechaza con SQLSTATE 42809.
--
-- En concreto: una base que ya recibió esta migración bajo su timestamp
-- anterior (20260828000000) NO puede recibirla otra vez bajo el nuevo. El
-- Supabase Preview de este PR está en ese estado, y por eso su check sale en
-- rojo: el bot sólo empuja archivos NUEVOS, el nombre nuevo se lo parece, y
-- reaplicarla ahí falla. La salida correcta es reconstruir esa base desde cero
-- aplicando la cadena completa en orden — no debilitar esta migración.
--
-- Que falle ruidosamente es el comportamiento buscado. No se le añaden
-- `IF EXISTS`, `DO NOTHING` ni excepciones tragadas para que "pase": eso la
-- volvería fail-open y convertiría un estado inesperado en un verde falso.
--
-- POR QUÉ: `correspondencia_condominio` y `paquetes_recibidos` modelan lo
-- mismo (algo físico que entra o sale de recepción a nombre de una unidad),
-- pero correspondencia nació sin nada de lo que hace robusta a paquetería.
-- El hueco grave: se usa para 'notificacion_legal' y NO deja prueba de
-- entrega — solo cambia `estado` a 'atendido'. No hay quién recibió, cuándo,
-- con qué firma, ni evidencia fotográfica. Un juzgado no acepta eso.
--
-- Esta migración le da a correspondencia el mismo acuse que ya tiene un sobre
-- de Amazon en paquetería, REUSANDO NOMBRES DE COLUMNA IDÉNTICOS a
-- paquetes_recibidos (fotos, firma_path, entregado_a_nombre, entregado_via,
-- hora_entrega, recibido_por, entregado_por, empresa_mensajeria). No es
-- cosmético: la Fase 1 unifica ambas tablas en un solo motor con una columna
-- `clase`, y con estos nombres esa migración es un INSERT..SELECT directo en
-- vez de un mapeo columna por columna.
--
-- NO se añade `hora_recepcion` (que sí tiene paquetes): `created_at` ya es el
-- instante del registro y `fecha` es la fecha del documento. Inventar una
-- tercera marca implicaría rellenar filas históricas con now(), que sería
-- falso. En la Fase 1 se mapea hora_recepcion := created_at.

ALTER TABLE public.correspondencia_condominio
  -- Evidencia y acuse (espejo de paquetes_recibidos)
  ADD COLUMN IF NOT EXISTS fotos              text[],
  ADD COLUMN IF NOT EXISTS firma_path         text,
  ADD COLUMN IF NOT EXISTS entregado_a_nombre text,
  ADD COLUMN IF NOT EXISTS entregado_via      text,   -- 'portal' | 'porteria'
  ADD COLUMN IF NOT EXISTS hora_entrega       timestamptz,
  ADD COLUMN IF NOT EXISTS recibido_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entregado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Trazabilidad del envío
  ADD COLUMN IF NOT EXISTS empresa_mensajeria text,
  -- Plazo legal: una notificación judicial o un requerimiento tienen fecha
  -- límite de descargo. Sin esto el vencimiento solo vive en la cabeza de
  -- quien recibió el sobre.
  ADD COLUMN IF NOT EXISTS fecha_limite       date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'correspondencia_entregado_via_chk') THEN
    ALTER TABLE public.correspondencia_condominio
      ADD CONSTRAINT correspondencia_entregado_via_chk
      CHECK (entregado_via IS NULL OR entregado_via IN ('portal','porteria'));
  END IF;
END $$;

-- Vencimientos: el Panel General y la bandeja de recepción preguntan por los
-- pendientes con plazo. Índice parcial — la mayoría de la correspondencia no
-- tiene fecha límite.
CREATE INDEX IF NOT EXISTS idx_correspondencia_fecha_limite
  ON public.correspondencia_condominio(project_id, fecha_limite)
  WHERE fecha_limite IS NOT NULL AND estado = 'pendiente';

-- Búsqueda por guía desde la bandeja unificada (mismo criterio que
-- idx_paquetes_codigo_retiro: parcial, la guía suele ser NULL).
CREATE INDEX IF NOT EXISTS idx_correspondencia_numero_guia
  ON public.correspondencia_condominio(numero_guia)
  WHERE numero_guia IS NOT NULL;

COMMENT ON COLUMN public.correspondencia_condominio.firma_path IS
  'Ruta en el bucket condominios-media de la firma de acuse. Prueba de entrega para notificaciones legales.';
COMMENT ON COLUMN public.correspondencia_condominio.fecha_limite IS
  'Plazo legal de la pieza (descargo, respuesta). Alimenta las alertas de vencimiento.';
