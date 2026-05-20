-- Ampliación del expediente de personal del condominio.
-- Convierte el módulo de Personal en una ficha/base de datos más completa.
-- Agrega: contactos de emergencia, afiliaciones (IGSS/IRTRA/NIT), tags,
-- códigos de acceso, equipo asignado y datos médicos / contrato / personales / bancarios.
-- foto_url ya existe desde la fase 4 (20260420000004), por eso no se agrega aquí.
-- La RLS de la tabla ya cubre todas las columnas (no se requieren políticas nuevas).

ALTER TABLE public.personal_condominio
  -- Contactos de emergencia: [{ nombre, parentesco, telefono }]
  ADD COLUMN IF NOT EXISTS contactos_emergencia jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Afiliaciones / identificadores patronales (Guatemala: IGSS, IRTRA, NIT;
  -- en otros países, el equivalente local de seguridad social / fisco).
  ADD COLUMN IF NOT EXISTS numero_igss  text,
  ADD COLUMN IF NOT EXISTS numero_irtra text,
  ADD COLUMN IF NOT EXISTS nit          text,
  -- Etiquetas libres asignadas (ej. "llave maestra", "turno fin de semana").
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  -- Códigos de acceso asignados: [{ tipo, codigo, descripcion }]
  ADD COLUMN IF NOT EXISTS codigos_acceso jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Equipo personal asignado: [{ item, cantidad, fecha_entrega, notas }]
  ADD COLUMN IF NOT EXISTS equipo_asignado jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Datos médicos / seguridad
  ADD COLUMN IF NOT EXISTS tipo_sangre text,
  ADD COLUMN IF NOT EXISTS alergias    text,
  -- Datos de contrato
  ADD COLUMN IF NOT EXISTS tipo_contrato      text,
  ADD COLUMN IF NOT EXISTS fecha_fin_contrato date,
  ADD COLUMN IF NOT EXISTS supervisor         text,
  -- Datos personales
  ADD COLUMN IF NOT EXISTS direccion    text,
  ADD COLUMN IF NOT EXISTS genero       text,
  ADD COLUMN IF NOT EXISTS estado_civil text,
  -- Datos bancarios (para pago de planilla)
  ADD COLUMN IF NOT EXISTS banco         text,
  ADD COLUMN IF NOT EXISTS numero_cuenta text,
  ADD COLUMN IF NOT EXISTS tipo_cuenta   text;
