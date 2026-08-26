-- ============================================================================
-- Drift de esquema: siete columnas que existen SÓLO en producción.
-- ============================================================================
-- CÓMO SE ENCONTRÓ. El job E2E (#781) corre contra un Supabase sandbox
-- construido ENTERAMENTE desde supabase/migrations. Ahí la pestaña
-- Condominios → Cuotas mostraba «📤 Emitir» en filas ya emitidas, y la prueba
-- «emite una cuota pendiente» quedaba en rojo aunque la fila SÍ transicionaba
-- en la base (emitida_at se estampaba). Causa: useCuotasPorProyectoConEstado-
-- Query selecciona CUOTA_AGREGADO_COLS, que nombra fecha_pago, metodo_pago y
-- referencia_pago; PostgREST responde 400 «column does not exist», runQuery
-- devuelve undefined, la proyección queda vacía y estadoCanonicoDe() cae al
-- `estado` legacy — que las transiciones NO escriben. Es decir: la UI de
-- cobranza se degrada en silencio a un estado que nunca cambia.
--
-- Las columnas se habían añadido a mano en producción y nunca se capturaron en
-- una migración. La cabecera de 20260604180000_cuota_condominio_state_machine_
-- mora.sql ya las daba por existentes ("…monto, periodo, fecha_vencimiento,
-- estado, fecha_pago/metodo_pago"), lo que muestra hace cuánto arrastramos el
-- desfase sin notarlo: producción funciona, y sólo un entorno nuevo lo revela.
--
-- QUÉ SE ROMPE SIN ESTO, en cualquier entorno levantado desde migraciones
-- (el sandbox E2E, un restore de disaster-recovery, una región nueva):
--   · cuotas_condominio.{fecha_pago,metodo_pago,referencia_pago}
--       → la proyección de cuotas con estado falla entera (400) y el gating de
--         emitir/pagar/anular pasa a leer el `estado` legacy.
--   · cuotas_condominio.comprobante_url
--       → declarada en src/types/condominios/core.ts y en database.types.ts.
--   · {contadores,tarifas,unidades}.updated_by_name
--       → ContadoresSection, TarifasSection y UnidadesSection la ESCRIBEN en
--         cada guardado; sin ella el update responde 400 y no se guarda nada.
--         (En `clientes` sí la crea 20260317000001_baseline_legacy_tables_
--         phase2.sql: el desfase es de estas tres tablas, no del concepto.)
--
-- SOBRE PRODUCCIÓN. Todo es ADD COLUMN IF NOT EXISTS de columnas nullable sin
-- default: en producción ya existen, así que la migración es un no-op — no
-- reescribe la tabla, no toma lock largo, no toca ni una fila. Su valor es
-- dejar el esquema REPRODUCIBLE desde el repositorio.
--
-- La guarda que impide que vuelva a pasar vive en
-- src/domain/condominios/__tests__/columnas-vs-migraciones.test.ts: exige que
-- cada columna que la app nombra esté creada por alguna migración.
-- ============================================================================

-- ── cuotas_condominio: datos del pago registrado ────────────────────────────
-- Los escribe usePagarCuotaMutation al confirmar el pago desde
-- CuotasTab (fecha + método + referencia opcional) y los lee la proyección.
ALTER TABLE public.cuotas_condominio
  ADD COLUMN IF NOT EXISTS fecha_pago      date,
  ADD COLUMN IF NOT EXISTS metodo_pago     text,
  ADD COLUMN IF NOT EXISTS referencia_pago text,
  ADD COLUMN IF NOT EXISTS comprobante_url text;

COMMENT ON COLUMN public.cuotas_condominio.fecha_pago      IS 'Fecha en que se registró el pago de la cuota (la elige quien cobra; puede ser anterior a hoy).';
COMMENT ON COLUMN public.cuotas_condominio.metodo_pago     IS 'efectivo | transferencia | cheque | tarjeta | deposito | otro.';
COMMENT ON COLUMN public.cuotas_condominio.referencia_pago IS 'Referencia o número de transacción del pago. Opcional.';
COMMENT ON COLUMN public.cuotas_condominio.comprobante_url IS 'URL del comprobante adjunto al pago. Opcional.';

-- ── updated_by_name: nombre visible de quien editó por última vez ───────────
-- Alimenta el tag "editado por …" (getEditedTagInfo). Se guarda desnormalizado
-- a propósito: el tag debe sobrevivir al borrado del usuario que editó.
ALTER TABLE public.contadores ADD COLUMN IF NOT EXISTS updated_by_name text;
ALTER TABLE public.tarifas    ADD COLUMN IF NOT EXISTS updated_by_name text;
ALTER TABLE public.unidades   ADD COLUMN IF NOT EXISTS updated_by_name text;

COMMENT ON COLUMN public.contadores.updated_by_name IS 'Nombre (o email) de quien editó por última vez, desnormalizado para el tag "editado por".';
COMMENT ON COLUMN public.tarifas.updated_by_name    IS 'Nombre (o email) de quien editó por última vez, desnormalizado para el tag "editado por".';
COMMENT ON COLUMN public.unidades.updated_by_name   IS 'Nombre (o email) de quien editó por última vez, desnormalizado para el tag "editado por".';
