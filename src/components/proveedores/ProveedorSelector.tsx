// Selector de proveedor del CATÁLOGO COMPARTIDO.
//
// Es el mismo proveedor en Contabilidad y en Operaciones: se elige por su `id`
// (nunca por texto libre ni por el nombre) y se busca por nombre, código o
// identificación fiscal. Cada opción dice si se le puede comprar HOY en el
// proyecto activo y, si no, por qué.
//
// Lo que este componente NO hace: decidir. La habilitación que muestra espeja a
// `proveedor_habilitado_en`; si discrepara, el servidor igual rechaza al
// guardar. Sirve para no ofrecer lo que se va a rechazar.
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  buscarProveedores,
  etiquetaProveedor,
  identificacionDe,
  motivoNoHabilitado,
  proveedorHabilitadoEn,
} from '../../domain/proveedores/identidad'
import { ESTADO_PROVEEDOR_LABELS } from '../../types/compras'
import { hoyLocalISO } from '../../lib/format'
import type { ProveedorCatalogo, ProveedorProyecto } from '../../types/proveedores'
import { StatusBadge } from '../shared/StatusBadge'

const MAX_VISIBLES = 40

const caja: CSSProperties = {
  padding: '8px 10px', border: '1px solid var(--at-line)', borderRadius: 8, fontSize: 13,
  background: 'var(--at-surface)', color: 'var(--at-ink)', width: '100%', boxSizing: 'border-box',
}

interface Props {
  proveedores: readonly ProveedorCatalogo[]
  asignaciones: readonly ProveedorProyecto[]
  /** Proyecto activo; null = contabilidad de la empresa. */
  projectId: string | null
  value: string | null
  onChange: (id: string | null, proveedor: ProveedorCatalogo | null) => void
  /**
   * Opciones que NO se pueden elegir y por qué. Por defecto ninguna: capturar un
   * borrador con un proveedor aún no autorizado es válido; lo que exige
   * habilitación es activar o aprobar. Devuelve el motivo o null.
   */
  bloquear?: (p: ProveedorCatalogo) => string | null
  /** Oculta a quien hoy no está habilitado en este proyecto. */
  soloHabilitados?: boolean
  disabled?: boolean
  label?: string
  placeholder?: string
}

export function ProveedorSelector({
  proveedores, asignaciones, projectId, value, onChange, bloquear, soloHabilitados = false,
  disabled = false, label = 'Proveedor', placeholder = 'Buscar por nombre, código o NIT…',
}: Props) {
  const uid = useId()
  const hoy = hoyLocalISO()
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(0)
  const refInput = useRef<HTMLInputElement>(null)

  const seleccionado = useMemo(() => proveedores.find((p) => p.id === value) ?? null, [proveedores, value])

  const lista = useMemo(() => {
    const base = soloHabilitados
      ? proveedores.filter((p) => proveedorHabilitadoEn(p, asignaciones, projectId, hoy))
      : proveedores
    return buscarProveedores(base, texto).slice(0, MAX_VISIBLES)
  }, [proveedores, asignaciones, projectId, hoy, soloHabilitados, texto])

  function elegir(p: ProveedorCatalogo) {
    if (bloquear?.(p)) return
    onChange(p.id, p)
    setTexto('')
    setAbierto(false)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActivo((a) => Math.min(a + 1, lista.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && abierto && lista[activo]) { e.preventDefault(); elegir(lista[activo]) }
    else if (e.key === 'Escape') { setAbierto(false) }
  }

  const idLista = `${uid}-lista`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
      <label htmlFor={`${uid}-entrada`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-soft)' }}>{label}</label>

      {seleccionado && !abierto && (
        <div
          data-testid="proveedor-seleccionado"
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 10px', borderRadius: 8,
                   border: '1px solid var(--at-line)', background: 'var(--at-chip)' }}
        >
          <strong>{etiquetaProveedor(seleccionado)}</strong>
          {identificacionDe(seleccionado) && (
            <span style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>
              {seleccionado.nit ?? seleccionado.rfc}{seleccionado.pais ? ` · ${seleccionado.pais}` : ''}
            </span>
          )}
          <EstadoYHabilitacion p={seleccionado} asignaciones={asignaciones} projectId={projectId} hoy={hoy} />
          {!disabled && (
            <button
              type="button"
              onClick={() => { onChange(null, null); setAbierto(true); setTimeout(() => refInput.current?.focus(), 0) }}
              style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: 'var(--at-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >
              Cambiar
            </button>
          )}
        </div>
      )}

      {(!seleccionado || abierto) && (
        <>
          <input
            id={`${uid}-entrada`}
            ref={refInput}
            role="combobox"
            aria-expanded={abierto}
            aria-controls={idLista}
            aria-autocomplete="list"
            aria-activedescendant={abierto && lista[activo] ? `${uid}-op-${lista[activo].id}` : undefined}
            value={texto}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActivo(0) }}
            onFocus={() => setAbierto(true)}
            onKeyDown={onKey}
            style={caja}
          />
          {abierto && (
            <ul
              id={idLista}
              role="listbox"
              aria-label={`${label}: resultados`}
              style={{ listStyle: 'none', margin: 0, padding: 4, position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                       maxHeight: 280, overflowY: 'auto', border: '1px solid var(--at-line)', borderRadius: 8,
                       background: 'var(--at-surface)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
            >
              {lista.length === 0 && (
                <li role="presentation" style={{ padding: 10, fontSize: 12, color: 'var(--at-ink-soft)' }}>
                  {proveedores.length === 0
                    ? 'Todavía no hay proveedores. Regístralos en Contabilidad → Proveedores.'
                    : 'Sin coincidencias. Se busca por nombre, código o NIT/RFC.'}
                </li>
              )}
              {lista.map((p, i) => {
                const motivoBloqueo = bloquear?.(p) ?? null
                return (
                  <li
                    key={p.id}
                    id={`${uid}-op-${p.id}`}
                    role="option"
                    aria-selected={p.id === value}
                    aria-disabled={motivoBloqueo ? true : undefined}
                    onMouseDown={(e) => { e.preventDefault(); elegir(p) }}
                    onMouseEnter={() => setActivo(i)}
                    style={{ padding: '7px 10px', borderRadius: 6, cursor: motivoBloqueo ? 'not-allowed' : 'pointer',
                             opacity: motivoBloqueo ? 0.55 : 1, background: i === activo ? 'var(--at-chip)' : 'transparent' }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{etiquetaProveedor(p)}</strong>
                      {identificacionDe(p) && (
                        <span style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>{p.nit ?? p.rfc}{p.pais ? ` · ${p.pais}` : ''}</span>
                      )}
                      <EstadoYHabilitacion p={p} asignaciones={asignaciones} projectId={projectId} hoy={hoy} />
                    </div>
                    {motivoBloqueo && <div style={{ fontSize: 11, color: 'var(--at-danger)' }}>{motivoBloqueo}</div>}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function EstadoYHabilitacion({
  p, asignaciones, projectId, hoy,
}: { p: ProveedorCatalogo; asignaciones: readonly ProveedorProyecto[]; projectId: string | null; hoy: string }) {
  const estado = p.estado ?? (p.activo ? 'autorizado' : 'suspendido')
  const motivo = motivoNoHabilitado(p, asignaciones, projectId, hoy)
  return (
    <>
      <StatusBadge tone={estado === 'autorizado' ? 'success' : estado === 'vetado' ? 'danger' : 'warning'}>
        {ESTADO_PROVEEDOR_LABELS[estado] ?? estado}
      </StatusBadge>
      {motivo && <span style={{ fontSize: 11, color: 'var(--at-danger)' }}>{motivo}</span>}
    </>
  )
}
