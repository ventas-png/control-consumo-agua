import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { CajaChica, MovimientoCaja } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'

interface Props {
  cajas: CajaChica[]
  movimientos: MovimientoCaja[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.caja_chica.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const BLANK_CAJA = { responsable: '', monto_inicial: '', notas: '' }
const BLANK_MOV = { tipo: 'egreso', concepto: '', monto: '', comprobante: '', fecha: hoyLocalISO() }

function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2 })}` }

export function CajaChicaTab({ cajas, movimientos, proyectoId, companyId, moneda, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [showCajaForm, setShowCajaForm] = useState(false)
  const [formCaja, setFormCaja] = useState({ ...BLANK_CAJA })
  const [savingCaja, setSavingCaja] = useState(false)
  // Por id y no la fila: tras cerrar la caja, `cajas` llega refrescado y la
  // ventana muestra el estado vigente (antes se parchaba la copia a mano).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showMovForm, setShowMovForm] = useState(false)
  const [formMov, setFormMov] = useState({ ...BLANK_MOV })
  const [savingMov, setSavingMov] = useState(false)

  function setFC<K extends keyof typeof formCaja>(k: K, v: typeof formCaja[K]) { setFormCaja(p => ({ ...p, [k]: v })) }
  function setFM<K extends keyof typeof formMov>(k: K, v: typeof formMov[K]) { setFormMov(p => ({ ...p, [k]: v })) }

  const selected = selectedId ? cajas.find(c => c.id === selectedId) ?? null : null

  function cerrarDetalle() {
    if (savingMov) return
    setSelectedId(null)
    // El movimiento a medio escribir es de esta caja: no debe aparecer en otra.
    setShowMovForm(false)
    setFormMov({ ...BLANK_MOV })
  }

  function cerrarCajaForm() {
    if (savingCaja) return
    setShowCajaForm(false)
  }

  async function handleAbrirCaja() {
    if (!formCaja.responsable.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El responsable es obligatorio.' })
    setSavingCaja(true)
    const { error } = await createCondominioRow('caja_chica', {
      company_id: companyId, project_id: proyectoId,
      responsable: formCaja.responsable.trim(),
      monto_inicial: parseFloat(formCaja.monto_inicial) || 0,
      notas: formCaja.notas || null,
    })
    setSavingCaja(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowCajaForm(false); setFormCaja({ ...BLANK_CAJA }); onRefresh()
  }

  async function handleCerrarCaja(caja: CajaChica) {
    const result = await openPromptDialog({
      title: 'Cerrar Caja',
      fields: [{
        name: 'cerrado_por',
        label: 'Cerrado por',
        placeholder: 'Nombre del responsable',
        required: true,
        autoFocus: true,
      }],
      submitText: 'Cerrar caja',
    })
    if (!result?.cerrado_por) return
    const cerrado_por = result.cerrado_por
    await updateCondominioRow('caja_chica', caja.id, { estado: 'cerrada', fecha_cierre: hoyLocalISO(), cerrado_por })
    onRefresh()
  }

  async function handleSaveMovimiento() {
    if (!selected) return
    if (!formMov.concepto.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El concepto es obligatorio.' })
    if (!formMov.monto || parseFloat(formMov.monto) <= 0) return notify({ variant: 'warning', title: 'Requerido', text: 'El monto debe ser mayor a 0.' })
    setSavingMov(true)
    const { error } = await createCondominioRow('movimientos_caja', {
      company_id: companyId, caja_id: selected.id,
      tipo: formMov.tipo, concepto: formMov.concepto.trim(),
      monto: parseFloat(formMov.monto), comprobante: formMov.comprobante || null,
      fecha: formMov.fecha,
    })
    setSavingMov(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowMovForm(false); setFormMov({ ...BLANK_MOV }); onRefresh()
  }

  async function handleDeleteMovimiento(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar movimiento?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('movimientos_caja', id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const selectedMovs = selected ? movimientos.filter(m => m.caja_id === selected.id) : []
  const totalIngresos = selectedMovs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0)
  const totalEgresos  = selectedMovs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0)
  const saldo = (selected ? Number(selected.monto_inicial) : 0) + totalIngresos - totalEgresos

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }
  const movLabelStyle: CSSProperties = { fontSize: '10px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '2px' }
  const estadoPill = (estado: CajaChica['estado']) => (
    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap',
      background: estado === 'abierta' ? 'var(--at-success-tint)' : 'var(--at-chip)',
      color: estado === 'abierta' ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
      {estado === 'abierta' ? 'Abierta' : 'Cerrada'}
    </span>
  )

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Caja Chica</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{cajas.filter(c => c.estado === 'abierta').length} caja(s) abierta(s)</p>
        </div>
        {/* Sin `!showCajaForm`: el botón sigue montado detrás de la ventana y
            recupera el foco al cerrarla. */}
        {canCreate && (
          <button onClick={() => setShowCajaForm(true)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Abrir Caja
          </button>
        )}
      </div>

      {/* Abrir caja en ventana (antes se desplegaba arriba de la lista). */}
      {showCajaForm && (
        <EditModal
          title="Abrir nueva caja"
          maxWidth="600px"
          fullScreenOnMobile
          closeOnBackdropClick={!savingCaja}
          closeOnEscape={!savingCaja}
          onClose={cerrarCajaForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarCajaForm} disabled={savingCaja}>Cancelar</Button>
            <Button onClick={handleAbrirCaja} loading={savingCaja} loadingText="Abriendo…">Abrir caja</Button>
          </>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="caja-responsable" style={labelStyle}>Responsable *</label>
              <input id="caja-responsable" style={inputStyle} value={formCaja.responsable} onChange={e => setFC('responsable', e.target.value)} placeholder="Nombre del responsable" autoFocus />
            </div>
            <div>
              <label htmlFor="caja-monto-inicial" style={labelStyle}>Monto inicial ({moneda})</label>
              <input id="caja-monto-inicial" style={inputStyle} type="number" step="0.01" value={formCaja.monto_inicial} onChange={e => setFC('monto_inicial', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label htmlFor="caja-notas" style={labelStyle}>Notas</label>
              <input id="caja-notas" style={inputStyle} value={formCaja.notas} onChange={e => setFC('notas', e.target.value)} placeholder="Observaciones…" />
            </div>
          </div>
        </EditModal>
      )}

      {/* Lista a todo el ancho — los movimientos de cada caja se abren en
          ventana. Antes iban en una columna al lado de una lista fija de 300px
          que en el teléfono dejaba el detalle fuera de la pantalla. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {cajas.length === 0 ? (
          <EmptyState icon="💵" title="No hay cajas chicas" />
        ) : cajas.map(c => {
          const movs = movimientos.filter(m => m.caja_id === c.id)
          const ing = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0)
          const egr = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0)
          const sal = Number(c.monto_inicial) + ing - egr
          return (
            <div key={c.id}
              style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
              <button type="button" className="cond-row-main" onClick={() => setSelectedId(c.id)}
                style={{ flex: '1 1 220px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '13px' }}>{c.responsable}</span>
                  {estadoPill(c.estado)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Apertura: {c.fecha_apertura}</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: sal >= 0 ? 'var(--at-primary)' : 'var(--at-danger)', marginTop: '3px' }}>
                  Saldo: {fmt(sal, moneda)}
                </div>
              </button>
              {canEdit && c.estado === 'abierta' && (
                <button onClick={() => handleCerrarCaja(c)}
                  style={{ margin: '8px 0 8px auto', padding: '4px 9px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                  Cerrar
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Movimientos de la caja en ventana: a pantalla completa en el teléfono. */}
      {selected && (
        <EditModal
          title={`Caja chica — ${selected.responsable}`}
          subtitle={<span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {estadoPill(selected.estado)}
            <span>Apertura: {selected.fecha_apertura}</span>
          </span>}
          maxWidth="760px"
          fullScreenOnMobile
          closeOnBackdropClick={!savingMov}
          closeOnEscape={!savingMov}
          onClose={cerrarDetalle}
          // La misma acción de la fila: con la ventana abierta la lista queda detrás.
          footer={canEdit && selected.estado === 'abierta'
            ? <Button variant="outline-danger" onClick={() => handleCerrarCaja(selected)}>Cerrar caja</Button>
            : undefined}
        >
          {/* Summary — tarjetas que se reacomodan: en el teléfono tres columnas
              fijas partían los montos. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', marginBottom: '12px' }}>
            {[
              { label: 'Monto inicial', value: fmt(Number(selected.monto_inicial), moneda), color: 'var(--at-ink-3)' },
              { label: 'Ingresos', value: fmt(totalIngresos, moneda), color: 'var(--at-success)' },
              { label: 'Egresos', value: fmt(totalEgresos, moneda), color: 'var(--at-danger)' },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '8px', textAlign: 'center', border: '1px solid var(--at-line)' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{k.label}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginBottom: '12px', padding: '8px', background: saldo >= 0 ? 'var(--at-success-tint)' : 'var(--at-danger-tint)', borderRadius: '8px' }}>
            <span style={{ fontWeight: 800, fontSize: '14px', color: saldo >= 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>Saldo actual: {fmt(saldo, moneda)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Movimientos ({selectedMovs.length})</span>
            {canCreate && selected.estado === 'abierta' && !showMovForm && (
              <button onClick={() => setShowMovForm(true)}
                style={{ padding: '4px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                + Movimiento
              </button>
            )}
          </div>

          {showMovForm && (
            <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px', marginBottom: '10px', border: '1px solid var(--at-line)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                <div>
                  <label htmlFor="caja-mov-tipo" style={movLabelStyle}>Tipo</label>
                  <select id="caja-mov-tipo" style={{ ...inputStyle, fontSize: '12px' }} value={formMov.tipo} onChange={e => setFM('tipo', e.target.value)}>
                    <option value="egreso">Egreso</option>
                    <option value="ingreso">Ingreso</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="caja-mov-concepto" style={movLabelStyle}>Concepto *</label>
                  <input id="caja-mov-concepto" style={{ ...inputStyle, fontSize: '12px' }} value={formMov.concepto} onChange={e => setFM('concepto', e.target.value)} placeholder="Descripción…" autoFocus />
                </div>
                <div>
                  <label htmlFor="caja-mov-monto" style={movLabelStyle}>Monto *</label>
                  <input id="caja-mov-monto" style={{ ...inputStyle, fontSize: '12px' }} type="number" step="0.01" value={formMov.monto} onChange={e => setFM('monto', e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label htmlFor="caja-mov-fecha" style={movLabelStyle}>Fecha</label>
                  <input id="caja-mov-fecha" style={{ ...inputStyle, fontSize: '12px' }} type="date" value={formMov.fecha} onChange={e => setFM('fecha', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="caja-mov-comprobante" style={movLabelStyle}>Comprobante</label>
                  <input id="caja-mov-comprobante" style={{ ...inputStyle, fontSize: '12px' }} value={formMov.comprobante} onChange={e => setFM('comprobante', e.target.value)} placeholder="Nº factura…" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <Button size="sm" onClick={handleSaveMovimiento} loading={savingMov} loadingText="Guardando…">Guardar</Button>
                <Button size="sm" variant="secondary" onClick={() => { setShowMovForm(false); setFormMov({ ...BLANK_MOV }) }} disabled={savingMov}>Cancelar</Button>
              </div>
            </div>
          )}

          {selectedMovs.length === 0 ? (
            <EmptyState icon="📋" title="Sin movimientos" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {[...selectedMovs].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(m => (
                <div key={m.id} style={{ background: 'var(--at-surface)', borderRadius: '7px', padding: '7px 10px', border: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: m.tipo === 'ingreso' ? 'var(--at-success)' : 'var(--at-danger)', whiteSpace: 'nowrap' }}>
                      {m.tipo === 'ingreso' ? '+' : '-'}{fmt(Number(m.monto), moneda)}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginLeft: '8px' }}>{m.concepto}</span>
                    {m.comprobante && <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginLeft: '6px' }}>#{m.comprobante}</span>}
                    <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{m.fecha}</div>
                  </div>
                  {canDelete && (
                    <button onClick={() => handleDeleteMovimiento(m.id)} aria-label={`Eliminar movimiento ${m.concepto}`}
                      style={{ padding: '2px 6px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', color: 'var(--at-danger)', flexShrink: 0 }}>🗑️</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </EditModal>
      )}
    </div>
  )
}
