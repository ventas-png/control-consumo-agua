// Edge Function: purgar-fotos-registros
// -----------------------------------------------------------------------------
// Purga por RETENCIÓN las fotos que viven en buckets privados. Hoy son dos, con
// plazos distintos porque son datos distintos:
//
//   `registro-fotos`        90 d   la foto de una lectura de agua. Prueba de un
//                                  número; pasado un trimestre, el número ya se
//                                  cobró y la foto solo pesa.
//   `presencia-evidencias` 365 d   la foto y la ubicación de un fichaje. Prueba
//                                  de que UNA PERSONA estuvo en un sitio a una
//                                  hora. Se guarda un ciclo laboral completo
//                                  —la planilla del año, el aguinaldo, el bono
//                                  14— porque es la ventana en la que un
//                                  marcaje se discute; pasada, es una serie
//                                  temporal de la cara de cada trabajador sin
//                                  ninguna pregunta que conteste.
//
// EN LOS DOS CASOS LA FILA SOBREVIVE. Se anula la columna de la foto (y, en el
// fichaje, el GPS que la acompaña); la lectura y el marcaje —hora, estado,
// horas trabajadas— son dato de negocio y de planilla, y no se tocan. Ver
// docs/PURGA_FOTOS_SCHEDULE.md.
//
// De `registros` solo se tocan las fotos en formato PATH de Storage; las
// heredadas en base64 (data-URI inline en la columna) las limpia el paso SQL de
// `purgar_datos_expirados`. `presencia_personal` nunca tuvo base64.
//
// La antigüedad se mide con la fecha de negocio de cada fila (`registros.fecha`,
// `presencia_personal.fecha`). No se filtra por estado de pago ni de asistencia:
// la política es por tiempo, y una excepción por estado sería una retención que
// nadie podría explicar.
//
// Invocada por pg_cron → pg_net (run_purga_fotos_storage, secretos en Vault) con
// la service_role key, o manualmente por un super_admin con su JWT. En
// config.toml va con verify_jwt = false: valida el token a mano (service_role o
// super_admin), igual que route-reminders / delete-company.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { diasDelBody, purgarObjetivo, type ClientePurga, type ObjetivoPurga } from './logic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const DIAS_REGISTROS_DEFAULT = 90
const DIAS_PRESENCIA_DEFAULT = 365

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()

    // ── Auth: interno (cron, service key) o super_admin (JWT) ──
    if (!token) return json({ error: 'Unauthorized' }, 401)
    let autorizado = await timingSafeEqualSecret(token, SERVICE_ROLE_KEY)
    if (!autorizado) {
      const { data: { user }, error } = await admin.auth.getUser(token)
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      const { data: au } = await admin.from('app_users').select('role').eq('id', user.id).maybeSingle()
      if (au?.role === 'super_admin') autorizado = true
    }
    if (!autorizado) return json({ error: 'Forbidden' }, 403)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    // `dias` a secas es la clave histórica de esta función, cuando purgaba una
    // sola cosa: se conserva para no romper una invocación manual guardada.
    const diasRegistros = diasDelBody(body, ['dias_registros', 'dias'], DIAS_REGISTROS_DEFAULT)
    const diasPresencia = diasDelBody(body, ['dias_presencia'], DIAS_PRESENCIA_DEFAULT)

    const objetivos: ObjetivoPurga[] = [
      {
        nombre: 'registros',
        tabla: 'registros',
        bucket: 'registro-fotos',
        columnaFecha: 'fecha',
        columnasFoto: ['foto'],
        excluirLike: 'data:%',
        diasRetencion: diasRegistros,
      },
      {
        nombre: 'presencia',
        tabla: 'presencia_personal',
        bucket: 'presencia-evidencias',
        columnaFecha: 'fecha',
        columnasFoto: ['foto_entrada', 'foto_salida'],
        // El GPS caduca con la foto: es el mismo dato —dónde estuvo una persona
        // identificada— y sin la foto ya no resuelve el marcaje que justificaba
        // guardarlo.
        columnasAcompanantes: ['gps_entrada', 'gps_salida'],
        diasRetencion: diasPresencia,
      },
    ]

    // Cada objetivo se barre por separado y su fallo no aborta al otro: que la
    // purga del fichaje tropiece no es motivo para dejar de purgar lecturas, ni
    // al revés.
    const resultados = []
    for (const objetivo of objetivos) {
      resultados.push(await purgarObjetivo(admin as unknown as ClientePurga, objetivo))
    }
    const errores = resultados.flatMap(r => r.errores.map(e => `${r.nombre}/${e}`))

    return json({
      success: errores.length === 0,
      objetivos: resultados,
      // Totales agregados: lo que miraba quien ya leía esta respuesta.
      objetos_borrados: resultados.reduce((n, r) => n + r.objetos_borrados, 0),
      filas_actualizadas: resultados.reduce((n, r) => n + r.filas_actualizadas, 0),
      errores,
    })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
