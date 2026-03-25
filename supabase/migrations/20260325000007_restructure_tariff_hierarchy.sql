-- Reestructura la jerarquía de asignación de tarifas:
-- Tarifa → Contador → Unidad → Cliente
--
-- Antes: tarifa asignada al cliente
-- Ahora: tarifa asignada al contador; unidad enlazada al cliente

-- 1. Agregar cliente_id a unidades (unidad pertenece a un cliente)
ALTER TABLE public.unidades
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL;

-- 2. Agregar contador_id a registros (lectura ligada al contador específico)
ALTER TABLE public.registros
  ADD COLUMN IF NOT EXISTS contador_id uuid REFERENCES public.contadores(id) ON DELETE SET NULL;

-- 3. Eliminar campos de tarifa del cliente (tarifa_id FK primero, luego columnas numéricas)
ALTER TABLE public.clientes
  DROP COLUMN IF EXISTS tarifa_id,
  DROP COLUMN IF EXISTS tarifa,
  DROP COLUMN IF EXISTS canon,
  DROP COLUMN IF EXISTS consumo_minimo;

-- 4. Eliminar cliente_id de contadores (cliente ahora se deriva via unidad)
ALTER TABLE public.contadores
  DROP COLUMN IF EXISTS cliente_id;
