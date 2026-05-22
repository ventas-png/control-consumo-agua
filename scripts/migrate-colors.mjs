#!/usr/bin/env node
/**
 * Codemod: reemplaza hex de estado hardcodeados por tokens semánticos
 * (--at-success / --at-warning / --at-danger / --at-info) definidos en
 * src/index.css. Soporta la "migración total" del color por secciones.
 *
 * USO:
 *   node scripts/migrate-colors.mjs <dir> [--write]
 *
 *   node scripts/migrate-colors.mjs src/components/condominios          # dry-run
 *   node scripts/migrate-colors.mjs src/components/condominios --write  # aplica
 *
 * Por defecto hace DRY-RUN (no escribe): imprime cuántos reemplazos haría por
 * archivo. Con --write aplica los cambios in situ.
 *
 * IMPORTANTE — revisión manual obligatoria:
 *   El script avisa (⚠) cuando un fondo de estado queda junto a texto blanco
 *   (`color: 'white'` / '#fff'), patrón de "badge sólido" que en modo oscuro
 *   pierde contraste. Esos casos deben convertirse a <StatusBadge solid> a mano.
 *   Tras cada corrida, revisar el diff antes de commitear.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// Mapa hex (minúsculas) → token. Derivado de las frecuencias reales del repo.
const MAP = {
  // success / verde
  '#16a34a': 'var(--at-success)', '#10b981': 'var(--at-success)', '#22c55e': 'var(--at-success)',
  '#15803d': 'var(--at-success-strong)', '#059669': 'var(--at-success-strong)',
  '#dcfce7': 'var(--at-success-tint)', '#f0fdf4': 'var(--at-success-tint)', '#d1fae5': 'var(--at-success-tint)',
  '#bbf7d0': 'var(--at-success-border)', '#86efac': 'var(--at-success-border)',
  // warning / ámbar
  '#d97706': 'var(--at-warning)', '#f59e0b': 'var(--at-warning)', '#ea580c': 'var(--at-warning)', '#f97316': 'var(--at-warning)',
  '#92400e': 'var(--at-warning-strong)', '#c2410c': 'var(--at-warning-strong)',
  '#fef3c7': 'var(--at-warning-tint)', '#fff7ed': 'var(--at-warning-tint)', '#fffbeb': 'var(--at-warning-tint)',
  '#fefce8': 'var(--at-warning-tint)', '#fef9c3': 'var(--at-warning-tint)',
  '#fde68a': 'var(--at-warning-border)', '#fed7aa': 'var(--at-warning-border)',
  // danger / rojo
  '#ef4444': 'var(--at-danger)', '#dc2626': 'var(--at-danger)', '#f87171': 'var(--at-danger)',
  '#991b1b': 'var(--at-danger-strong)', '#b91c1c': 'var(--at-danger-strong)',
  '#fef2f2': 'var(--at-danger-tint)', '#fee2e2': 'var(--at-danger-tint)', '#fef9f9': 'var(--at-danger-tint)',
  '#fecaca': 'var(--at-danger-border)', '#fca5a5': 'var(--at-danger-border)',
  // info / azul
  '#2563eb': 'var(--at-info)', '#3b82f6': 'var(--at-info)',
  '#1d4ed8': 'var(--at-info-strong)',
  '#dbeafe': 'var(--at-info-tint)', '#eff6ff': 'var(--at-info-tint)', '#bfdbfe': 'var(--at-info-border)',
}

const args = process.argv.slice(2)
const write = args.includes('--write')
const root = args.find(a => !a.startsWith('--'))
if (!root) {
  console.error('Uso: node scripts/migrate-colors.mjs <dir> [--write]')
  process.exit(1)
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else if (['.tsx', '.ts'].includes(extname(p))) out.push(p)
  }
  return out
}

let totalRepl = 0, totalFiles = 0, totalWarn = 0
for (const file of walk(root)) {
  let src = readFileSync(file, 'utf8')
  let count = 0
  for (const [hex, token] of Object.entries(MAP)) {
    const re = new RegExp(hex, 'gi')
    src = src.replace(re, () => { count++; return token })
  }
  if (count === 0) continue
  totalFiles++
  totalRepl += count

  // Aviso: fondo de estado + texto blanco = badge sólido a revisar a mano.
  const warnLines = src.split('\n').filter(l =>
    /var\(--at-(success|warning|danger|info)\)/.test(l) && /(color:\s*['"`]?(white|#fff{1,3})\b)/i.test(l)
  )
  if (warnLines.length) totalWarn += warnLines.length

  console.log(`${write ? '✏️ ' : '· '}${file}: ${count} reemplazos${warnLines.length ? `  ⚠ ${warnLines.length} posible(s) badge sólido` : ''}`)
  if (write) writeFileSync(file, src)
}

console.log(`\n${write ? 'Aplicado' : 'DRY-RUN'}: ${totalRepl} reemplazos en ${totalFiles} archivos. ${totalWarn} línea(s) marcadas para revisión manual.`)
if (!write) console.log('Re-ejecuta con --write para aplicar.')
