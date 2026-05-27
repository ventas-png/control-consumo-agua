// Health probe — endpoint público sin JWT que confirma que la edge function
// está viva y que las env vars críticas están presentes. Está pensado para
// monitoreo externo (UptimeRobot, Pingdom, Better Uptime) y para alertar al
// equipo cuando algo está mal antes de que un usuario lo descubra.
//
// Por qué no consultar la DB: queremos que sea barato y rápido (<100 ms),
// sin abrir conexiones. La conectividad a Postgres se valida mejor desde
// otras funciones que sí dependen de ella; aquí solo verificamos que las
// piezas estructurales (URL, anon key, service-role key) están configuradas.

import { getCorsHeaders } from '../_shared/cors.ts'

const STARTED_AT = Date.now()

interface HealthResponse {
  status: 'ok' | 'degraded'
  timestamp: string
  uptime_ms: number
  checks: {
    supabase_url: boolean
    supabase_anon_key: boolean
    service_role_key: boolean
  }
}

Deno.serve((req: Request) => {
  const cors = getCorsHeaders(req.headers.get('origin'))

  // Preflight.
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }

  // Solo aceptamos GET (o HEAD para herramientas de monitoreo). Cualquier
  // otra cosa devuelve 405 sin desperdiciar trabajo.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const checks = {
    supabase_url: Boolean(Deno.env.get('SUPABASE_URL')),
    supabase_anon_key: Boolean(Deno.env.get('SUPABASE_ANON_KEY')),
    service_role_key: Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
  }
  const healthy = Object.values(checks).every(Boolean)

  const body: HealthResponse = {
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime_ms: Date.now() - STARTED_AT,
    checks,
  }

  // 200 cuando todo OK; 503 (Service Unavailable) si falta algo estructural,
  // para que el monitoreo externo lo detecte sin parsear el JSON.
  return new Response(req.method === 'HEAD' ? null : JSON.stringify(body), {
    status: healthy ? 200 : 503,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
})
