-- ============================================================================
-- CHECK constraints de reglas de negocio (cond:C2, F2.3)
-- ============================================================================
-- Defense in depth para validaciones que hoy solo viven en cliente. Sirven
-- como última línea: aunque un bug del front, una llamada via SQL Editor o un
-- import malformado intente meter un monto negativo o una hora_salida antes
-- de hora_entrada, la DB lo rechaza.
--
-- Idempotencia: DO blocks que comprueban pg_constraint antes de ADD CONSTRAINT.
-- Producción no se altera donde el constraint ya existe; donde no, lo añade.
-- En branches DB nuevas, los CHECKs se crean directos.
--
-- Validación previa: ejecutado SELECT contra producción que confirma cero
-- filas violan ninguno de estos CHECKs antes de aplicarlos (2026-05-27).
-- ============================================================================

DO $$
BEGIN
  -- cuotas_condominio: el monto siempre debe ser positivo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cuotas_condominio_monto_positivo'
      AND conrelid = 'public.cuotas_condominio'::regclass
  ) THEN
    ALTER TABLE public.cuotas_condominio
      ADD CONSTRAINT cuotas_condominio_monto_positivo CHECK (monto > 0);
  END IF;

  -- fondo_reserva_condominio: aportes/retiros/ajustes siempre con monto > 0
  -- (el sentido de retiro/ajuste se modela en `tipo`, no en signo).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fondo_reserva_condominio_monto_positivo'
      AND conrelid = 'public.fondo_reserva_condominio'::regclass
  ) THEN
    ALTER TABLE public.fondo_reserva_condominio
      ADD CONSTRAINT fondo_reserva_condominio_monto_positivo CHECK (monto > 0);
  END IF;

  -- pagos: el monto recibido debe ser positivo (un pago de 0 o negativo es
  -- siempre un error de captura).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pagos_monto_positivo'
      AND conrelid = 'public.pagos'::regclass
  ) THEN
    ALTER TABLE public.pagos
      ADD CONSTRAINT pagos_monto_positivo CHECK (monto > 0);
  END IF;

  -- reservas_amenidades: la hora de fin debe ser estrictamente posterior a la
  -- hora de inicio. Una reserva de duración cero no tiene sentido y suele
  -- indicar un bug del cliente al seleccionar el rango.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservas_amenidades_horas_validas'
      AND conrelid = 'public.reservas_amenidades'::regclass
  ) THEN
    ALTER TABLE public.reservas_amenidades
      ADD CONSTRAINT reservas_amenidades_horas_validas CHECK (hora_fin > hora_inicio);
  END IF;

  -- visitantes: hora_salida (opcional) debe ser posterior o igual a la entrada
  -- cuando se registra. El IS NULL permite el caso "visita sin checkout aún".
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'visitantes_salida_despues_entrada'
      AND conrelid = 'public.visitantes'::regclass
  ) THEN
    ALTER TABLE public.visitantes
      ADD CONSTRAINT visitantes_salida_despues_entrada
        CHECK (hora_salida IS NULL OR hora_salida >= hora_entrada);
  END IF;

  -- registros (agua): el consumo, si se persiste, no puede ser negativo. Esta
  -- es la primera mitad de F2.3 que valida lecturas; la otra mitad
  -- (lectura_actual >= lectura_anterior) se hace en cliente con la nueva
  -- función `validarLectura` de src/lib/business.ts. En DB lo modelamos a
  -- través de `consumo` (que se calcula como lectura_actual - lectura_anterior)
  -- para no rechazar registros legítimos donde una lectura fue ingresada como
  -- "reseteo del medidor" tras un cambio físico (caso documentado en
  -- agua:C1). En ese caso, consumo se guarda como 0 con notas explicativas.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registros_consumo_no_negativo'
      AND conrelid = 'public.registros'::regclass
  ) THEN
    ALTER TABLE public.registros
      ADD CONSTRAINT registros_consumo_no_negativo
        CHECK (consumo IS NULL OR consumo >= 0);
  END IF;
END $$;
