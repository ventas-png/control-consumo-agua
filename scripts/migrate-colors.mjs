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
  // status: tonos fuertes/tints adicionales vistos en el repo
  '#166534': 'var(--at-success-strong)', '#065f46': 'var(--at-success-strong)', '#6ee7b7': 'var(--at-success-border)',
  '#854d0e': 'var(--at-warning-strong)', '#9a3412': 'var(--at-warning-strong)', '#b45309': 'var(--at-warning-strong)', '#ffedd5': 'var(--at-warning-tint)',
  '#7f1d1d': 'var(--at-danger-strong)', '#fff1f2': 'var(--at-danger-tint)',
  // neutrales de marca = valores EXACTOS del tema claro en index.css. Mapearlos
  // a su token añade soporte de modo oscuro (eran grises/superficies fijos).
  // Sólo los inequívocos (texto atenuado, líneas, superficies, chip, fondo);
  // se omiten los "ink" oscuros (#15291f/#3e5a4c) y el blanco por ambigüedad
  // texto-vs-fondo.
  '#7e9389': 'var(--at-ink-3)',
  '#e1ddd0': 'var(--at-line)', '#c7c2b0': 'var(--at-line-strong)',
  '#faf7ef': 'var(--at-surface-2)', '#f2efe7': 'var(--at-bg)', '#eae6d8': 'var(--at-chip)',
  // marca: accent / primary (valores EXACTOS del tema claro) → su token.
  '#b96a3f': 'var(--at-accent)', '#9c5733': 'var(--at-accent-hover)', '#ce8a63': 'var(--at-accent-light)',
  '#577b69': 'var(--at-accent-2)',
  '#1b3b36': 'var(--at-primary)', '#102622': 'var(--at-primary-hover)', '#2f5d4f': 'var(--at-primary-2)',
  '#d9e2dc': 'var(--at-primary-soft)', '#9cc6b6': 'var(--at-primary-mint)',
  // verdes semánticos adicionales vistos en el repo
  '#1e8a5b': 'var(--at-success)', '#34d399': 'var(--at-success)',
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

let totalRepl = 0, totalFiles = 0, totalWarn = 0, totalSolid = 0
for (const file of walk(root)) {
  let src = readFileSync(file, 'utf8')
  let count = 0
  for (const [hex, token] of Object.entries(MAP)) {
    const re = new RegExp(hex, 'gi')
    src = src.replace(re, () => { count++; return token })
  }
  // Pasada de badges sólidos: si una línea usa un token de estado como fondo
  // (color directo, gradiente, o clave `bg:`) y además texto blanco
  // hardcodeado, ese blanco pierde contraste en modo oscuro (el base se
  // aclara). Cámbialo por var(--at-on-status), que se invierte por tema
  // (blanco en claro, casi negro en oscuro). Corre independiente del conteo
  // de hex para poder arreglar también archivos ya tokenizados.
  let solid = 0
  src = src.split('\n').map(line => {
    const hasStatusToken = /var\(--at-(?:success|warning|danger|info)(?:-strong)?\)/.test(line)
    const inBgContext = /(background|gradient|\bbg\s*:)/.test(line)
    if (!hasStatusToken || !inBgContext) return line
    return line.replace(/(color\s*:\s*)(['"`])(white|#fff|#ffffff)\2/gi, (_m, p, q) => { solid++; return `${p}${q}var(--at-on-status)${q}` })
  }).join('\n')
  totalSolid += solid

  if (count === 0 && solid === 0) continue
  totalFiles++
  totalRepl += count

  // Aviso: tras la pasada anterior, líneas que aún combinan token de estado +
  // texto blanco (p. ej. fondo/color en líneas distintas) → revisión manual.
  const warnLines = src.split('\n').filter(l =>
    /var\(--at-(success|warning|danger|info)\)/.test(l) && /(color:\s*['"`]?(white|#fff{1,3})\b)/i.test(l)
  )
  if (warnLines.length) totalWarn += warnLines.length

  console.log(`${write ? '✏️ ' : '· '}${file}: ${count} reemplazos${solid ? `, ${solid} badge(s) sólido(s)` : ''}${warnLines.length ? `  ⚠ ${warnLines.length} línea(s) a revisar` : ''}`)
  if (write) writeFileSync(file, src)
}

console.log(`\n${write ? 'Aplicado' : 'DRY-RUN'}: ${totalRepl} reemplazos + ${totalSolid} badges sólidos en ${totalFiles} archivos. ${totalWarn} línea(s) para revisión manual.`)
if (!write) console.log('Re-ejecuta con --write para aplicar.')
