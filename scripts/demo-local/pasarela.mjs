// Pasarela LOCAL que imita la API de Supabase para la demo: /rest/v1 → PostgREST, /auth/v1 con
// usuarios y contraseñas de auth.users (bcrypt de pgcrypto), /storage/v1 en disco, /functions/v1 vacío.
// Sólo escucha en 127.0.0.1. No toca nada remoto.
import { createServer, request as httpRequest } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'

const PUERTO = Number(process.env.PASARELA_PUERTO ?? 54321)
const POSTGREST = process.env.POSTGREST_URL ?? 'http://127.0.0.1:54330'
const SECRETO = process.env.JWT_SECRET
const ALMACEN = process.env.ALMACEN ?? join(import.meta.dirname, 'storage')
const PG = { PGHOST: '/tmp/demosock', PGPORT: '55700', PGUSER: 'postgres', PGDATABASE: 'demo' }
if (!SECRETO) throw new Error('Falta JWT_SECRET')

const b64 = (b) => Buffer.from(b).toString('base64url')
export function firmar(claims) {
  const cab = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const cuerpo = b64(JSON.stringify(claims))
  const firma = createHmac('sha256', SECRETO).update(`${cab}.${cuerpo}`).digest('base64url')
  return `${cab}.${cuerpo}.${firma}`
}
function verificar(token) {
  const [cab, cuerpo, firma] = (token ?? '').split('.')
  if (!firma) return null
  const esperada = createHmac('sha256', SECRETO).update(`${cab}.${cuerpo}`).digest('base64url')
  if (esperada !== firma) return null
  const c = JSON.parse(Buffer.from(cuerpo, 'base64url').toString())
  return c.exp && c.exp * 1000 < Date.now() ? null : c
}

/** Una consulta parametrizada por psql: las variables van por -v y se citan con :'nombre'. */
function sql(consulta, vars = {}) {
  const args = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  return new Promise((ok, mal) => {
    const p = execFile('psql', args, { env: { ...process.env, ...PG } }, (err, out) => (err ? mal(err) : ok(out.trim())))
    p.stdin.end(consulta)
  })
}

async function usuario(id) {
  const fila = await sql(`SELECT json_build_object('id', id, 'email', email, 'created_at', created_at,
      'user_metadata', coalesce(raw_user_meta_data, '{}'), 'app_metadata', coalesce(raw_app_meta_data, '{"provider":"email","providers":["email"]}'))
    FROM auth.users WHERE id = :'id'`, { id })
  if (!fila) return null
  const u = JSON.parse(fila)
  return { ...u, aud: 'authenticated', role: 'authenticated', email_confirmed_at: u.created_at, confirmed_at: u.created_at,
    last_sign_in_at: new Date().toISOString(), updated_at: u.created_at, identities: [], factors: [], is_anonymous: false }
}

async function sesion(u) {
  const ahora = Math.floor(Date.now() / 1000)
  const exp = ahora + 8 * 3600
  const access = firmar({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: ahora, exp,
    aal: 'aal1', amr: [{ method: 'password', timestamp: ahora }], session_id: randomUUID(),
    app_metadata: u.app_metadata, user_metadata: u.user_metadata, is_anonymous: false })
  return { access_token: access, token_type: 'bearer', expires_in: exp - ahora, expires_at: exp,
    refresh_token: `rt.${u.id}.${randomUUID()}`, user: u }
}

function leer(req) {
  return new Promise(ok => { const t = []; req.on('data', c => t.push(c)); req.on('end', () => ok(Buffer.concat(t))) })
}
function json(res, estado, cuerpo) {
  res.writeHead(estado, { 'content-type': 'application/json', ...cors() }); res.end(JSON.stringify(cuerpo))
}
function cors() {
  return { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*',
    'access-control-expose-headers': 'content-range, content-profile, x-total-count' }
}

async function auth(req, res, url) {
  const ruta = url.pathname.replace('/auth/v1', '')
  const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
  if (ruta === '/token') {
    const cuerpo = JSON.parse((await leer(req)).toString() || '{}')
    if (url.searchParams.get('grant_type') === 'password') {
      const id = await sql(`SELECT id FROM auth.users WHERE lower(email) = lower(:'e')
        AND encrypted_password = extensions.crypt(:'p', encrypted_password)`, { e: cuerpo.email ?? '', p: cuerpo.password ?? '' })
      if (!id) return json(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
      return json(res, 200, await sesion(await usuario(id)))
    }
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const id = String(cuerpo.refresh_token ?? '').split('.')[1]
      const u = id && await usuario(id)
      return u ? json(res, 200, await sesion(u)) : json(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
    }
  }
  if (ruta === '/user') {
    const c = verificar(token)
    const u = c && c.sub && await usuario(c.sub)
    return u ? json(res, 200, u) : json(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })
  }
  if (ruta === '/logout') { res.writeHead(204, cors()); return res.end() }
  if (ruta === '/factors') return json(res, 200, [])
  if (ruta === '/settings') return json(res, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: true })
  return json(res, 404, { msg: `Pasarela demo: ${ruta} no simulado` })
}

async function storage(req, res, url) {
  const ruta = decodeURIComponent(url.pathname.replace('/storage/v1', ''))
  let m
  if (req.method === 'POST' && (m = /^\/object\/sign\/([^/]+)$/.exec(ruta))) {
    // createSignedUrls: varias rutas de un balde de una vez.
    const cuerpo = JSON.parse((await leer(req)).toString() || '{}')
    return json(res, 200, (cuerpo.paths ?? []).map(p => ({ error: null, path: p, signedURL: `/object/sign/${m[1]}/${p}?token=demo` })))
  }
  if (req.method === 'POST' && (m = /^\/object\/sign\/(.+)$/.exec(ruta))) {
    return json(res, 200, { signedURL: `/object/sign/${m[1]}?token=demo` })
  }
  if ((req.method === 'POST' || req.method === 'PUT') && (m = /^\/object\/(?!public\/|sign\/)(.+)$/.exec(ruta))) {
    let cuerpo = await leer(req)
    const tipo = req.headers['content-type'] ?? ''
    if (tipo.startsWith('multipart/form-data')) {
      // Primer archivo del formulario: entre la línea en blanco de su cabecera y el límite siguiente.
      const limite = Buffer.from('--' + tipo.split('boundary=')[1])
      const ini = cuerpo.indexOf('\r\n\r\n', cuerpo.indexOf(limite)) + 4
      const fin = cuerpo.indexOf(limite, ini) - 2
      cuerpo = cuerpo.subarray(ini, fin)
    }
    const destino = join(ALMACEN, m[1])
    mkdirSync(dirname(destino), { recursive: true }); writeFileSync(destino, cuerpo)
    return json(res, 200, { Key: m[1], Id: randomUUID() })
  }
  if (req.method === 'GET' && (m = /^\/object\/(?:public|sign|authenticated)\/(.+)$/.exec(ruta))) {
    const archivo = join(ALMACEN, m[1])
    if (!existsSync(archivo)) return json(res, 404, { error: 'not_found' })
    const tipos = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' }
    res.writeHead(200, { 'content-type': tipos[extname(archivo).toLowerCase()] ?? 'application/octet-stream', ...cors() })
    return res.end(readFileSync(archivo))
  }
  if (req.method === 'DELETE') return json(res, 200, [])
  if (req.method === 'POST' && ruta.startsWith('/object/list')) return json(res, 200, [])
  return json(res, 200, {})
}

function rest(req, res, url) {
  const destino = new URL(POSTGREST + url.pathname.replace('/rest/v1', '') + url.search)
  const cab = { ...req.headers }
  delete cab.host
  if (!cab.authorization && cab.apikey) cab.authorization = `Bearer ${cab.apikey}`
  const p = httpRequest(destino, { method: req.method, headers: cab }, r => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors() }); r.pipe(res)
  })
  p.on('error', e => json(res, 502, { message: `PostgREST no responde: ${e.message}` }))
  req.pipe(p)
}

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end() }
    const url = new URL(req.url, 'http://x')
    if (url.pathname.startsWith('/rest/v1')) return rest(req, res, url)
    if (url.pathname.startsWith('/auth/v1')) return await auth(req, res, url)
    if (url.pathname.startsWith('/storage/v1')) return await storage(req, res, url)
    if (url.pathname.startsWith('/functions/v1')) return json(res, 200, {})
    return json(res, 404, { msg: 'Pasarela demo: ruta no simulada' })
  } catch (e) {
    console.error(e); json(res, 500, { msg: String(e.message ?? e) })
  }
}).listen(PUERTO, '127.0.0.1', () => console.log(`pasarela en http://127.0.0.1:${PUERTO}`))
