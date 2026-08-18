#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Migrations guard — análisis ESTÁTICO de supabase/migrations/ (auditoría
// 2026-07-28, Bloque A · PR-9). Corre en cada PR, sin credenciales ni red.
//
// POR QUÉ EXISTE, SIENDO QUE YA HAY UN security-guard.mjs
// `security-guard.mjs` valida el catálogo de PRODUCCIÓN. Eso es justo donde el
// drift NO se ve: si alguien habilita RLS a mano en el dashboard, prod queda
// verde para siempre y el repo puede quedarse sin la migración correspondiente.
// Cualquier deploy fresco, preview branch o staging provisionado desde el repo
// nace entonces con el hueco. Este guard mira el REPO, no prod, y corre en PR
// (antes del merge), no de noche (después).
//
// Los dos hallazgos que motivan cada regla son reales y de este repo:
//
//   (a) `fuentes_agua`, `empresa` y `user_sessions` llevaban desde marzo sin
//       `ENABLE ROW LEVEL SECURITY` en ninguna de las 352 migraciones.
//       `fuentes_agua` tenía además 8 policies que eran código muerto.
//
//   (b) `get_company_effective_limits` recibió un guard anti cross-tenant en
//       20260606150000 y lo PERDIÓ seis días después en 20260612210000, porque
//       un `CREATE OR REPLACE` de la misma firma reescribió el cuerpo sin él
//       (y conservó el GRANT). Un guard copiado dentro de cada cuerpo se puede
//       perder por omisión; por eso ahora se exige la llamada nombrada a
//       `assert_company_scope()`.
//
// LECCIÓN INCORPORADA: la regla (a) descuenta las tablas DROPEADAS. Durante esta
// misma auditoría se reportó como vulnerable una policy de
// `user_module_permissions` sin notar que la tabla se había dropeado con CASCADE
// un mes antes. Un guard que no modele el DROP repetiría ese falso positivo.
//
//   (e) El P1 del 2026-08 (#765): 8 funciones SECURITY DEFINER se mergearon sin
//       `REVOKE ... FROM PUBLIC` y quedaron ejecutables por `anon` — CREATE
//       FUNCTION concede EXECUTE a PUBLIC por defecto. La única que intentó
//       cerrarse (`conta_puede_escribir`, 20260818000000) hizo `REVOKE FROM
//       anon` SIN PUBLIC, que es un no-op: anon nunca tuvo grant directo,
//       hereda el de PUBLIC. La única red era el security-guard nocturno, que
//       mira PROD DESPUÉS del merge. Esta regla exige el REVOKE en el repo,
//       ANTES del merge. Aplica solo a funciones nacidas después del fix
//       (20260825010000): el legado está saneado en prod y auditado; exigirlo
//       retroactivamente forzaría ~30 entradas de allowlist sin valor.
//       La ACL se modela POR FIRMA (nombre + tipos normalizados, como
//       pg_get_function_identity_arguments): PostgreSQL permite overloads y
//       cada uno tiene su propia ACL — un REVOKE sobre foo(uuid) no protege
//       foo(text). Y se procesan también los GRANT: un GRANT EXECUTE ... TO
//       PUBLIC o TO anon POSTERIOR al REVOKE re-expone la función y vuelve a
//       contar como hallazgo. Ambos eran falsos negativos de la primera
//       versión de la regla.
//
// Uso:  node scripts/migrations-guard.mjs
// Test: scripts/__tests__/migrations-guard.test.mjs (vitest) — importa los
//       helpers exportados; por eso main() solo corre como módulo principal.
// ════════════════════════════════════════════════════════════════════════════

import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')
const ALLOWLIST_PATH = join(__dirname, 'migrations-guard.allowlist.json')

// ── Utilidades de parseo ────────────────────────────────────────────────────
// Las migraciones son SQL con comentarios `--` extensos (convención del repo).
// Se despojan antes de aplicar los patrones para que un ejemplo citado dentro
// de un comentario no cuente como código real — esto importa mucho aquí,
// porque varias migraciones citan el SQL vulnerable que vienen a arreglar.
export function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

const RE_CREATE_TABLE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][\w]*)"?/gi
const RE_DROP_TABLE =
  /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][\w]*)"?/gi
// El nombre de la policy puede ir entre comillas Y LLEVAR ESPACIOS
// ("No direct access to user_sessions"), y el ON suele caer en la línea
// siguiente. Un patrón que asuma nombre sin espacios se salta esas policies y
// declara "sin policy" tablas que sí la tienen — falso positivo peligroso,
// porque empuja a añadir una policy permisiva donde ya hay una deny-all.
const RE_CREATE_POLICY =
  /CREATE\s+POLICY\s+(?:"[^"]+"|[\w]+)\s+ON\s+(?:public\.)?"?([a-zA-Z_][\w]*)"?/gi
const RE_ENABLE_RLS =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-zA-Z_][\w]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi
// ── Regla (e): identidad y firma de funciones ───────────────────────────────
// La identidad canónica es nombre + lista de TIPOS normalizados (equivalente a
// pg_get_function_identity_arguments). El repo escribe los REVOKE/GRANT con
// tipos pelados ('uuid, text') y los CREATE con nombre de parámetro
// ('p_movimiento_id uuid'); además mezcla alias ('int' e 'integer' conviven en
// las migraciones actuales). Ambas grafías deben producir la misma clave, o un
// REVOKE correcto se daría por ausente (falso positivo) o se asignaría al
// overload equivocado (falso negativo).
const TYPE_ALIASES = new Map([
  ['int', 'integer'],
  ['int2', 'smallint'],
  ['int4', 'integer'],
  ['int8', 'bigint'],
  ['bool', 'boolean'],
  ['varchar', 'character varying'],
  ['timestamptz', 'timestamp with time zone'],
  ['float4', 'real'],
  ['float8', 'double precision'],
])
// Si el PRIMER token del parámetro es uno de estos, no hay nombre de parámetro:
// todo el texto es un tipo multi-palabra ('double precision', 'character
// varying', 'timestamp with time zone').
const MULTIWORD_TYPE_STARTERS = new Set([
  'double',
  'timestamp',
  'time',
  'character',
  'char',
  'bit',
  'national',
])

// Split por comas de nivel superior: los typmods llevan comas propias
// (numeric(10,2)) y un split ingenuo partiría el tipo en dos parámetros.
function splitTopLevel(raw) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of raw) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts
}

export function normalizeArgs(raw) {
  const tipos = []
  for (let part of splitTopLevel(raw ?? '')) {
    part = part.trim()
    if (part === '') continue
    // DEFAULT/'=' no forman parte de la identidad.
    part = part.replace(/\s+DEFAULT\s[\s\S]*$/i, '').replace(/\s*=[\s\S]*$/, '')
    // Modo del parámetro: IN/INOUT/VARIADIC se descartan del texto; los OUT no
    // forman parte de la identidad de la función (igual que en Postgres).
    const modo = /^(IN|OUT|INOUT|VARIADIC)\s+/i.exec(part)
    if (modo) {
      if (modo[1].toUpperCase() === 'OUT') continue
      part = part.slice(modo[0].length)
    }
    let tokens = part.trim().split(/\s+/)
    if (tokens.length > 1 && !MULTIWORD_TYPE_STARTERS.has(tokens[0].toLowerCase())) {
      tokens = tokens.slice(1) // el primer token era el nombre del parámetro
    }
    let tipo = tokens.join(' ').toLowerCase()
    const esArray = /\[\s*\]$/.test(tipo)
    tipo = tipo
      .replace(/\[\s*\]$/, '')
      .replace(/^public\./, '')
      .replace(/\([^)]*\)/g, '') // typmod fuera: numeric(10,2) ≡ numeric
      .replace(/\s+/g, ' ')
      .trim()
    tipo = TYPE_ALIASES.get(tipo) ?? tipo
    tipos.push(tipo + (esArray ? '[]' : ''))
  }
  return tipos.join(',')
}

export function fnKey(name, rawArgs) {
  return `${name.toLowerCase()}(${normalizeArgs(rawArgs)})`
}

// Referencia a función en DROP/REVOKE/GRANT: la firma es OPCIONAL (Postgres la
// permite omitir si el nombre no es ambiguo) — sin paréntesis, el evento aplica
// a TODOS los overloads del nombre. Los args toleran un nivel de anidación
// (typmods).
const FN_REF = String.raw`(?:public\.)?"?([a-zA-Z_][\w]*)"?\s*(\(((?:[^()]|\([^()]*\))*)\))?`
const RE_DROP_FUNCTION = new RegExp(
  String.raw`DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?${FN_REF}`,
  'gi',
)
const RE_REVOKE_FN = new RegExp(
  String.raw`REVOKE\s+(?:EXECUTE|ALL)(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION\s+${FN_REF}\s+FROM\s+([^;]*)`,
  'gi',
)
const RE_GRANT_FN = new RegExp(
  String.raw`GRANT\s+(?:EXECUTE|ALL)(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION\s+${FN_REF}\s+TO\s+([^;]*)`,
  'gi',
)

function collect(re, text) {
  const out = []
  let m
  re.lastIndex = 0
  while ((m = re.exec(text)) !== null) out.push(m[1].toLowerCase())
  return out
}

// Extrae definiciones de función con su cuerpo, para poder inspeccionar si el
// cuerpo lleva el guard. Soporta $$ y $etiqueta$ como delimitadores. Los args
// toleran un nivel de anidación (typmods/DEFAULTs con paréntesis).
export function extractFunctions(sql) {
  const out = []
  const re =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z_][\w]*)"?\s*\(((?:[^()]|\([^()]*\))*)\)/gi
  let m
  while ((m = re.exec(sql)) !== null) {
    const name = m[1].toLowerCase()
    const args = m[2]
    const rest = sql.slice(m.index)
    // Cuerpo entre el primer par de delimitadores dollar-quoted.
    const dq = /\$([a-zA-Z_]*)\$/.exec(rest)
    let body = ''
    let header = rest.slice(0, dq ? dq.index : 400)
    if (dq) {
      const tag = `$${dq[1]}$`
      const start = dq.index + tag.length
      const end = rest.indexOf(tag, start)
      body = end === -1 ? rest.slice(start) : rest.slice(start, end)
    }
    out.push({ name, args, header, body, index: m.index })
  }
  return out
}

// ── Regla (e): eventos de ACL por firma ─────────────────────────────────────
// Corte de retroactividad: 20260825010000 cerró las 8 del P1; lo anterior está
// saneado en prod (guard nocturno verde) y queda grandfathered. Un DROP+CREATE
// de una función vieja en una migración nueva SÍ queda sujeto.
export const SECDEF_CUTOFF = '20260825010000'

function roleFlags(rolesRaw) {
  // El `public.` que precede al nombre de la función es el ESQUEMA; aquí solo
  // se mira la lista de roles después de FROM/TO, donde `public` es el rol.
  return {
    public: /\bpublic\b/i.test(rolesRaw ?? ''),
    anon: /\banon\b/i.test(rolesRaw ?? ''),
  }
}

// Devuelve los eventos create/drop/revoke/grant de un SQL (ya sin comentarios),
// en ORDEN DOCUMENTAL. Procesarlos agrupados por tipo rompe los dos patrones
// reales del repo: `DROP viejo + CREATE con firma nueva` (los drops agrupados
// al final borrarían la encarnación recién creada → falso negativo) y `CREATE
// helper temporal + DROP al final del archivo` (los creates agrupados dejarían
// viva una función que ya no existe → falso positivo).
// `args === null` significa "sin firma escrita" → aplica a todos los overloads.
export function extractAclEvents(sql) {
  const events = []
  for (const fn of extractFunctions(sql)) {
    events.push({
      i: fn.index,
      kind: 'create',
      name: fn.name,
      args: fn.args,
      isSecdef: /SECURITY\s+DEFINER/i.test(fn.header),
    })
  }
  for (const m of sql.matchAll(RE_DROP_FUNCTION)) {
    events.push({ i: m.index, kind: 'drop', name: m[1].toLowerCase(), args: m[2] ? m[3] : null })
  }
  for (const m of sql.matchAll(RE_REVOKE_FN)) {
    events.push({
      i: m.index,
      kind: 'revoke',
      name: m[1].toLowerCase(),
      args: m[2] ? m[3] : null,
      ...roleFlags(m[4]),
    })
  }
  for (const m of sql.matchAll(RE_GRANT_FN)) {
    events.push({
      i: m.index,
      kind: 'grant',
      name: m[1].toLowerCase(),
      args: m[2] ? m[3] : null,
      ...roleFlags(m[4]),
    })
  }
  // REVOKE/GRANT dinámicos: `DO $$ ... FOREACH fn IN ARRAY
  // ARRAY['f()','public.g(uuid)'] ... EXECUTE format('REVOKE ... FROM PUBLIC...',
  // fn) $$` — el patrón de la casa para barridos (20260604250000, 20260612192952,
  // 20260825010000). Cada literal del ARRAY lleva su FIRMA COMPLETA y se asocia
  // a ella (no al nombre pelado). Solo cuentan literales con paréntesis, así los
  // arrays de TABLAS de los DO de policies no se confunden con funciones. Los
  // roles se leen del string del format(), acotado por su comilla de cierre.
  for (const m of sql.matchAll(/DO\s*\$\$[\s\S]*?END\s*\$\$/gi)) {
    const block = m[0]
    const revoke = /REVOKE\s+(?:EXECUTE|ALL)(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION[^']*?\bFROM\b([^']*)'/i.exec(
      block,
    )
    const grant = /GRANT\s+(?:EXECUTE|ALL)(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION[^']*?\bTO\b([^']*)'/i.exec(
      block,
    )
    if (!revoke && !grant) continue
    for (const arr of block.match(/ARRAY\s*\[([^\]]*)\]/gi) ?? []) {
      for (const lit of arr.matchAll(/'(?:public\.)?([a-zA-Z_][\w]*)\(([^']*?)\)'/g)) {
        if (revoke) {
          events.push({
            i: m.index,
            kind: 'revoke',
            name: lit[1].toLowerCase(),
            args: lit[2],
            ...roleFlags(revoke[1]),
          })
        }
        if (grant) {
          events.push({
            i: m.index,
            kind: 'grant',
            name: lit[1].toLowerCase(),
            args: lit[2],
            ...roleFlags(grant[1]),
          })
        }
      }
    }
  }
  return events.sort((a, b) => a.i - b.i)
}

// Aplica los eventos de un archivo sobre el estado acumulado de ACLs.
// La ENCARNACIÓN por firma es lo que importa: CREATE OR REPLACE conserva la ACL
// (y por tanto un REVOKE previo), DROP + CREATE la resetea al grant implícito
// de PUBLIC, y un GRANT posterior a PUBLIC/anon la RE-EXPONE.
export function applyAclEvents(acl, events, { file, version }) {
  const overloadKeys = (name) => [...acl.keys()].filter((k) => k.startsWith(`${name}(`))
  for (const ev of events) {
    if (ev.kind === 'create') {
      const key = fnKey(ev.name, ev.args)
      const prev = acl.get(key)
      if (prev) {
        prev.isSecdef = ev.isSecdef // OR REPLACE: cambia la definición, conserva la ACL
      } else {
        acl.set(key, {
          createdIn: file,
          createdVersion: version,
          isSecdef: ev.isSecdef,
          publicGrant: true, // el grant implícito de CREATE FUNCTION
          anonGrant: false,
        })
      }
    } else if (ev.kind === 'drop') {
      const keys = ev.args === null ? overloadKeys(ev.name) : [fnKey(ev.name, ev.args)]
      for (const k of keys) acl.delete(k)
    } else {
      const keys = ev.args === null ? overloadKeys(ev.name) : [fnKey(ev.name, ev.args)]
      const expone = ev.kind === 'grant'
      for (const k of keys) {
        const entry = acl.get(k)
        if (!entry) continue
        if (ev.public) entry.publicGrant = expone
        if (ev.anon) entry.anonGrant = expone
      }
    }
  }
  return acl
}

// Una firma viola la regla si es SECURITY DEFINER, anon puede ejecutarla (por
// el grant de PUBLIC o por grant directo), nació después del corte y no está
// exceptuada. El allowlist acepta la firma completa normalizada (recomendado)
// o el nombre pelado (compatibilidad con el formato original).
export function evaluateSecdefRule(acl, { cutoff = SECDEF_CUTOFF, allowSet = new Set() } = {}) {
  return [...acl.entries()]
    .filter(
      ([key, s]) =>
        s.isSecdef &&
        (s.publicGrant || s.anonGrant) &&
        s.createdVersion > cutoff &&
        !allowSet.has(key) &&
        !allowSet.has(key.slice(0, key.indexOf('('))),
    )
    .map(([key, s]) => ({ key, file: s.createdIn }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

async function main() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort() // el timestamp del nombre define el orden de aplicación

  const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8'))
  // Las entradas pueden ser string o {fn|table, reason}: se exige `reason` en
  // forma de objeto para que ninguna excepción entre sin justificación escrita.
  const norm = (list, key) =>
    new Set((list ?? []).map((e) => (typeof e === 'string' ? e : e[key] ?? e.fn ?? e.name)))
  const allowNoRls = norm(allowlist.tables_without_rls, 'table')
  const allowNoScope = norm(allowlist.functions_without_company_scope, 'fn')
  const allowNoPolicy = norm(allowlist.tables_without_policy, 'table')
  // Regla (e): las entradas con firma se normalizan igual que los eventos, para
  // que 'foo(uuid)' y 'foo(p_id uuid)' casen; un nombre pelado sigue valiendo
  // por compatibilidad (exceptúa todos los overloads).
  const allowNoPublicRevoke = new Set(
    [...norm(allowlist.security_definer_without_public_revoke, 'fn')].map((s) => {
      const m = /^(?:public\.)?([a-zA-Z_][\w]*)\s*\(([\s\S]*)\)\s*$/.exec(s)
      return m ? fnKey(m[1], m[2]) : s.toLowerCase()
    }),
  )

  // Estado acumulado aplicando las migraciones en orden.
  const liveTables = new Set() // creadas y no dropeadas
  const rlsEnabled = new Set()
  const createdIn = new Map() // tabla → primera migración que la crea
  const functions = new Map() // nombre → última definición (last writer gana)
  const grantedToAuthenticated = new Set()
  const tablesWithPolicy = new Set()
  // Regla (e): ACL efectiva por FIRMA (ver extractAclEvents/applyAclEvents).
  const secdefAcl = new Map() // firma → { createdIn, createdVersion, isSecdef, publicGrant, anonGrant }

  for (const file of files) {
    const raw = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    const sql = stripComments(raw)
    const fileVersion = (/^(\d{14})_/.exec(file) ?? [])[1] ?? ''

    for (const t of collect(RE_CREATE_TABLE, sql)) {
      if (!liveTables.has(t)) createdIn.set(t, file)
      liveTables.add(t)
    }
    for (const t of collect(RE_DROP_TABLE, sql)) {
      liveTables.delete(t)
      rlsEnabled.delete(t)
    }
    for (const t of collect(RE_ENABLE_RLS, sql)) rlsEnabled.add(t)

    // Policies, en sus DOS formas. Contar solo las estáticas daría un falso
    // positivo enorme: TODO el ERP financiero (conta_*, cxp_*, presupuesto_*,
    // bancos) crea sus policies dentro de bloques `DO $$ ... FOREACH t IN ARRAY
    // ARRAY['tabla_a','tabla_b'] ... EXECUTE format('CREATE POLICY ...') $$`.
    // Un escaneo ingenuo declara "sin policy" 11 tablas que sí las tienen.
    for (const t of collect(RE_CREATE_POLICY, sql)) tablesWithPolicy.add(t)
    for (const doBlock of sql.match(/DO\s*\$\$[\s\S]*?END\s*\$\$/gi) ?? []) {
      if (!/CREATE\s+POLICY/i.test(doBlock)) continue
      for (const arr of doBlock.match(/ARRAY\s*\[([^\]]*)\]/gi) ?? []) {
        for (const lit of arr.match(/'([\w]+)'/g) ?? []) {
          tablesWithPolicy.add(lit.replace(/'/g, '').toLowerCase())
        }
      }
    }

    // Regla (b): mapa por nombre, last-writer-gana (sin cambios).
    for (const fn of extractFunctions(sql)) {
      functions.set(fn.name, { ...fn, file })
    }
    // Regla (e): eventos por firma en orden documental.
    applyAclEvents(secdefAcl, extractAclEvents(sql), { file, version: fileVersion })

    // GRANT EXECUTE ... TO ... authenticated
    const grantRe =
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?"?([a-zA-Z_][\w]*)"?[^;]*?\bauthenticated\b/gi
    let g
    while ((g = grantRe.exec(sql)) !== null) {
      grantedToAuthenticated.add(g[1].toLowerCase())
    }
  }

  // ── Regla (a): toda tabla viva de public debe tener RLS ───────────────────
  const missingRls = [...liveTables]
    .filter((t) => !rlsEnabled.has(t) && !allowNoRls.has(t))
    .sort()

  // ── Regla (c): RLS habilitada pero SIN ninguna policy ────────────────────
  // Es fail-closed (nadie lee), así que no es un agujero — pero sí un estado
  // ambiguo: no se distingue "deny-all a propósito" de "se olvidó la policy",
  // y el repo deja de reproducir prod, donde el guard nocturno exige ≥1 policy.
  // Exigir una deny-all EXPLÍCITA vuelve la intención auditable.
  const rlsNoPolicy = [...liveTables]
    .filter((t) => rlsEnabled.has(t) && !tablesWithPolicy.has(t) && !allowNoPolicy.has(t))
    .sort()

  // ── Regla (d): el NOMBRE del archivo es la identidad de la migración ─────
  // El historial remoto (`supabase_migrations.schema_migrations`) se indexa por
  // `version` = los 14 dígitos del nombre, y apply-migrations-prod.yml registra
  // con `ON CONFLICT (version) DO NOTHING`. Consecuencia de dos archivos con el
  // mismo timestamp: el segundo se aplica (el push a main lo aplica por nombre
  // de archivo) pero NUNCA queda registrado — y entonces el modo reconciliar,
  // que decide por versión, se lo salta creyéndolo ya aplicado.
  //
  // Pasó de verdad: 20260713100000 (soft_delete_registros vs
  // solicitudes_enforce_rbac_gate) y 20260713110000 (ambiente_pago_tenant vs
  // cerrar_ciclo_cuotas). Los cuatro estaban aplicados en prod por suerte, no
  // por diseño: los dos ensombrecidos eran justamente los que arreglaban el
  // pago en línea. Se detectó auditando por qué el branching de Supabase
  // reportaba MIGRATIONS_FAILED (2026-07-29).
  //
  // Un timestamp de más (…100001) cuesta nada; un archivo invisible para el
  // reconciliador cuesta un incidente de producción.
  const byVersion = new Map()
  const malformedNames = []
  for (const file of files) {
    const m = /^(\d{14})_/.exec(file)
    if (!m) {
      malformedNames.push(file)
      continue
    }
    const version = m[1]
    if (!byVersion.has(version)) byVersion.set(version, [])
    byVersion.get(version).push(file)
  }
  const duplicateVersions = [...byVersion.entries()]
    .filter(([, group]) => group.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))

  // ── Regla (b): RPC SECURITY DEFINER con p_company_id/p_project_id,
  //    ejecutable por `authenticated`, debe llamar a assert_company_scope() ──
  const missingScope = []
  for (const [name, fn] of functions) {
    if (allowNoScope.has(name)) continue
    if (!/SECURITY\s+DEFINER/i.test(fn.header)) continue
    if (!/\bp_(company|project)_id\b/i.test(fn.args)) continue
    if (!grantedToAuthenticated.has(name)) continue
    // Lo que se exige NO es una forma concreta de guard, sino que el cuerpo
    // consulte la identidad REAL del caller en algún punto. Hay dos patrones
    // válidos y ambos se aceptan:
    //
    //   · RECHAZAR  → assert_company_scope() / RAISE 42501  (get_company_*)
    //   · FILTRAR   → WHERE ... = get_my_company_id()       (agua_*, kpis_*)
    //
    // Filtrar es incluso preferible en RPCs de reporte: devuelve vacío en vez
    // de reventar. Exigir solo el RAISE marcaba como vulnerables funciones
    // correctamente acotadas (agua_anomalias_consumo, get_kpis_tenant_mensual,
    // agua_consumo_comunidad) — y un guard que grita en falso acaba apagado.
    //
    // Lo que SÍ se caza: un cuerpo que use el id que le pasa el cliente sin
    // referirse jamás a quién es el caller.
    //
    // Por eso la lista incluye también los helpers de identidad POR PROYECTO
    // (user_has_project_access / user_is_project_exempt): resuelven `auth.uid()`
    // y responden "¿este caller puede ver ESTE proyecto?", que es exactamente la
    // pregunta que la regla exige. Sin ellos, `can_access_project` —el helper de
    // alcance por proyecto que evalúan las policies de agua— salía como
    // vulnerable pese a no mirar más que al caller.
    const guarded =
      /assert_company_scope|get_my_company_id|get_my_cliente_id|get_my_user_id|is_super_admin|user_has_project_access|user_is_project_exempt/i.test(
        fn.body,
      )
    if (!guarded) missingScope.push({ name, file: fn.file })
  }

  // ── Regla (e): SECURITY DEFINER nueva ejecutable por anon ─────────────────
  // CREATE FUNCTION concede EXECUTE a PUBLIC por defecto y `anon` lo hereda;
  // el ALTER DEFAULT PRIVILEGES de 20260610061000 no es fiable (lo advierte él
  // mismo). Un `REVOKE ... FROM anon` a secas NO cierra nada (el P1 de
  // conta_puede_escribir): tiene que figurar PUBLIC. Y un GRANT posterior a
  // PUBLIC o a anon re-expone la firma. Aplica a encarnaciones nacidas después
  // del corte; ver SECDEF_CUTOFF arriba.
  const missingPublicRevoke = evaluateSecdefRule(secdefAcl, {
    cutoff: SECDEF_CUTOFF,
    allowSet: allowNoPublicRevoke,
  })

  // ── Reporte ───────────────────────────────────────────────────────────────
  const report = ['🔎 Migrations guard — análisis estático del repo', '']
  report.push(
    `(a) tablas de public vivas SIN ENABLE ROW LEVEL SECURITY: ${missingRls.length}`,
  )
  for (const t of missingRls) {
    report.push(`    ✗ ${t}  [creada en ${createdIn.get(t)} — sin RLS en ninguna migración]`)
  }
  report.push(`(c) tablas con RLS pero SIN ninguna policy: ${rlsNoPolicy.length}`)
  for (const t of rlsNoPolicy) {
    report.push(`    ✗ ${t}  [RLS habilitada y ninguna policy — declara una deny-all explícita]`)
  }
  report.push(
    `(b) RPCs SECURITY DEFINER con p_company_id/p_project_id ejecutables por authenticated y SIN guard de scope: ${missingScope.length}`,
  )
  for (const f of missingScope) {
    report.push(`    ✗ ${f.name}  [última definición en ${f.file} — falta assert_company_scope()]`)
  }
  report.push(
    `(e) firmas SECURITY DEFINER nuevas ejecutables por anon: ${missingPublicRevoke.length}`,
  )
  for (const f of missingPublicRevoke) {
    report.push(
      `    ✗ ${f.key}  [creada en ${f.file} — anon puede ejecutarla (grant implícito de PUBLIC, o un GRANT posterior a PUBLIC/anon); añade REVOKE EXECUTE ... FROM PUBLIC, anon sobre ESTA firma]`,
    )
  }
  report.push(
    `(d) versiones de migración duplicadas o nombres no parseables: ${duplicateVersions.length + malformedNames.length}`,
  )
  for (const [version, group] of duplicateVersions) {
    report.push(`    ✗ ${version}  [${group.join(' · ')} — renombra uno a ${version.slice(0, 13)}1]`)
  }
  for (const f of malformedNames) {
    report.push(`    ✗ ${f}  [el nombre debe ser <timestamp de 14 dígitos>_nombre.sql]`)
  }

  console.log(report.join('\n'))
  console.log('')

  const total =
    missingRls.length +
    rlsNoPolicy.length +
    missingScope.length +
    missingPublicRevoke.length +
    duplicateVersions.length +
    malformedNames.length
  if (total > 0) {
    console.error(`❌ migrations-guard: ${total} hallazgo(s) en el repo.`)
    console.error('   (a)/(b)/(c)/(e): añade la migración que falta, o —si la excepción es')
    console.error('   intencional y revisada— documéntala en scripts/migrations-guard.allowlist.json')
    console.error('   con su `reason`. (d) NO es allowlisteable: renombra el archivo (el nombre es')
    console.error('   la identidad de la migración en el historial remoto).')
    process.exit(1)
  }
  console.log(
    '✅ migrations-guard: RLS + policies declaradas, RPCs con scope y SECURITY DEFINER nuevas con REVOKE de PUBLIC.',
  )
  process.exit(0)
}

// Solo como módulo principal: el test (vitest) importa los helpers exportados
// y NO debe disparar el análisis completo ni el process.exit.
const esModuloPrincipal =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (esModuloPrincipal) {
  main().catch((err) => {
    console.error(`❌ migrations-guard: error inesperado — ${err.stack || err.message}`)
    process.exit(1)
  })
}
