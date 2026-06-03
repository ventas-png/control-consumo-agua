// T7 — Hooks de query del dominio Agua. EJEMPLO CANÓNICO de la convención.
//
// IMPORTANTE: este PR aterriza el scaffold; los hooks AÚN NO se cablean a
// componentes (ver src/domain/README.md → "Orden de adopción"). Cuando se
// migre, un componente reemplaza su `fetch + useState/useEffect` por:
//
//   const { data: clientes = [], isLoading } = useClientesQuery(companyId)
//
// y deja de recibir esos datos por props desde App/useData. Mientras conviven,
// no se debe migrar la MISMA entidad en dos sitios a la vez (evita doble fetch).
import { useQuery } from '@tanstack/react-query'
import type { Cliente, Registro, Ruta } from '../../types'
import { supabase } from '../../lib/supabase'
import { runQuery } from '../queryFetch'
import { aguaKeys } from './keys'

// Columnas de listado de registros. NUNCA incluir `foto`: es base64 (hasta
// ~15 MB por fila, TOAST) e infla el payload hasta tumbar el statement_timeout
// de PostgREST. Espeja REGISTROS_LIST_COLS de useData.
const REGISTROS_LIST_COLS =
  'id,cliente_id,cliente_nombre,contador_id,project_id,fecha,lectura_anterior,lectura_actual,consumo,tarifa_aplicada,tarifa_exceso_aplicada,canon_aplicado,monto_calculado,tipo_cobro,estado,monto_pagado,fecha_pago,mes,fecha_lectura_anterior,dias_servicio,notas,gps,created_at'

// `clientes` no tiene columna company_id — el scoping por tenant lo hace RLS vía
// la junction company_clientes. Por eso aquí NO filtramos por company_id (igual
// que useData); el companyId solo entra en la query key para aislar el caché.
export function useClientesQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.clientes(companyId),
    queryFn: async () =>
      (await runQuery<Cliente[]>((signal) =>
        supabase.from('clientes').select('*').abortSignal(signal),
      )) ?? [],
  })
}

// `registros`: RLS scopea por company vía projects + company_clientes. Limit 5000
// para no exceder el statement_timeout en empresas con mucho histórico (el
// dashboard filtra por rango de fechas, no necesita más).
export function useRegistrosQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.registros(companyId),
    queryFn: async () =>
      (await runQuery<Registro[]>((signal) =>
        supabase
          .from('registros')
          .select(REGISTROS_LIST_COLS)
          .order('fecha', { ascending: false })
          .limit(5000)
          .abortSignal(signal),
      )) ?? [],
  })
}

// `rutas` se scopea server-side por RLS. El filtrado fino por proyecto asignado
// (filterRutasByProjectAccess en lib/rutasAccess) se aplica en el consumidor: el
// hook devuelve el set que RLS permite.
export function useRutasQuery(companyId?: string) {
  return useQuery({
    queryKey: aguaKeys.rutas(companyId),
    queryFn: async () =>
      (await runQuery<Ruta[]>((signal) =>
        supabase
          .from('rutas')
          .select('*')
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      )) ?? [],
  })
}
