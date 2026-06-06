import { useState, useCallback, type CSSProperties} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify, confirm } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { condominiosKeys } from '../../../domain/condominios/keys'
import { RecargoMora, EstadoRecargo, TipoRecargo, Unidad, CuotaCondominio, ReglaMoraConfig } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
// T4 · cond:C4 — el recargo de mora se calcula con la función PURA de la
// foundation (#398), que respeta reglas_mora_config (tipo/valor/aplicar_sobre/
// dias_vencimiento/periodo_gracia) en vez del antiguo `base * pct / 100` a mano.
import { calcularMoraCuota, type ReglaMora } from '../../../lib/businessCondominios'
// cond:C4 — ledger de recargos de mora vía la capa de datos T4. Reactivo a las
// invalidaciones de las mutations de cuota (que tocan condominiosKeys.all), así
// la lista refleja al instante lo que aplica el cron de mora (cond:C6) o las
// acciones de cuota. Cae a la prop `recargos` si la query aún no resolvió.
import { useRecargosMoraQuery } from '../../../domain/condominios/queries'

interface Props {
  recargos: RecargoMora[]
  cuotas: CuotaCondominio[]
  reglas: ReglaMoraConfig[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CFG: Record<EstadoRecargo, { label: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  aplicado:  { label: 'Aplicado',  bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  anulado:   { label: 'Anulado',   bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

// T4 · cond:C4 — adapta la fila de config a la ReglaMora que consume
// calcularMoraCuota (business.ts). Misma forma; sólo selecciona los campos.
function reglaMoraDe(regla: ReglaMoraConfig): ReglaMora {
  return {
    tipo: regla.tipo,
    valor: regla.valor,
    aplicar_sobre: regla.aplicar_sobre,
    dias_vencimiento: regla.dias_vencimiento,
    periodo_gracia: regla.periodo_gracia,
  }
}

/**
 * Días transcurridos desde la fecha base de la cuota hasta `hoy`. La base es la
 * de la máquina de estados (emitida_at) o, en su defecto, created_at — misma
 * derivación que el cron de mora (cond:C6, COALESCE(emitida_at, created_at)).
 * Pura: `hoy` se inyecta para tests deterministas.
 */
export function diasTranscurridosCuota(
  cuota: { emitida_at?: string | null; created_at?: string | null; fecha_vencimiento?: string | null },
  hoy: string = new Date().toISOString().slice(0, 10),
): number {
  const base = cuota.emitida_at ?? cuota.created_at ?? cuota.fecha_vencimiento
  if (!base) return 0
  const ms = new Date(hoy).getTime() - new Date(base).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.floor(ms / 86_400_000))
}

export default function RecargosTab({ recargos, cuotas, reglas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoRecargo | ''>('')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [form, setForm] = useState({
    unidad_id: '', cuota_id: '', tipo: 'porcentaje' as TipoRecargo,
    valor: '', fecha_aplicacion: new Date().toISOString().slice(0, 10), motivo: '',
  })

  const cuotasVencidas = cuotas.filter(c => c.estado === 'moroso' || c.estado === 'pendiente')
  const cuotasUnidad = form.unidad_id ? cuotasVencidas.filter(c => c.unidad_id === form.unidad_id) : []

  // cond:C4 — fuente del ledger: la query T4 (reactiva), scopeada a este proyecto;
  // cae a la prop mientras carga / si está vacía para no romper el primer render.
  const qc = useQueryClient()
  const { data: recargosQuery } = useRecargosMoraQuery(companyId)
  const recargosProyecto = recargosQuery && recargosQuery.length > 0
    ? recargosQuery.filter(r => r.project_id === proyectoId)
    : recargos

  // Tras un write de recargo: refresca la carga del prop (CondominiosSection) y
  // además invalida la query del ledger para que la lista reaccione al instante.
  const refrescar = useCallback(() => {
    void qc.invalidateQueries({ queryKey: condominiosKeys.recargosMora(companyId) })
    void onRefresh()
  }, [qc, companyId, onRefresh])

  const lista = recargosProyecto.filter(r =>
    (!filtroEstado || r.estado === filtroEstado) &&
    (!filtroUnidad || r.unidad_id === filtroUnidad)
  )

  const totalAplicado = recargosProyecto.filter(r => r.estado === 'aplicado').reduce((s, r) => s + r.monto_calculado, 0)
  const totalPendiente = recargosProyecto.filter(r => r.estado === 'pendiente').reduce((s, r) => s + r.monto_calculado, 0)

  function calcularMonto() {
    if (!form.valor) return null
    const valor = parseFloat(form.valor)
    if (form.tipo === 'monto_fijo') return valor
    if (form.cuota_id) {
      const cuota = cuotas.find(c => c.id === form.cuota_id)
      if (cuota) {
        // cond:C4 — recargo porcentual sobre la cuota vía la función pura. Como es
        // una aplicación MANUAL e inmediata (el admin escribe el %), no exigimos
        // vencimiento/gracia: regla con dias=0/gracia=0 → base * pct/100, pero ya
        // sin aritmética a mano.
        const regla: ReglaMora = { tipo: 'porcentaje', valor, aplicar_sobre: 'monto_cuota', dias_vencimiento: 0, periodo_gracia: 0 }
        return calcularMoraCuota(regla, 0, cuota.monto).monto
      }
    }
    return null
  }

  const montoPreview = calcularMonto()

  function resetForm() {
    setForm({ unidad_id: '', cuota_id: '', tipo: 'porcentaje', valor: '', fecha_aplicacion: new Date().toISOString().slice(0, 10), motivo: '' })
    setMostrarForm(false)
  }

  async function guardar() {
    if (!form.unidad_id || !form.valor) { notify({ variant: 'warning', title: 'Error', text: 'Unidad y valor son obligatorios' }); return }
    const monto = montoPreview
    if (!monto || monto <= 0) { notify({ variant: 'warning', title: 'Error', text: 'El monto calculado debe ser mayor a 0' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('recargos_mora', {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id,
      cuota_id: form.cuota_id || null,
      tipo: form.tipo,
      valor: parseFloat(form.valor),
      monto_calculado: monto,
      fecha_aplicacion: form.fecha_aplicacion,
      motivo: form.motivo.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    resetForm(); refrescar()
  }

  async function cambiarEstado(r: RecargoMora, estado: EstadoRecargo) {
    const update: Record<string, unknown> = { estado }
    if (estado === 'anulado') update.fecha_anulacion = new Date().toISOString()
    await updateCondominioRow('recargos_mora', r.id, update)
    refrescar()
  }

  async function aplicarMasivo() {
    const hoy = new Date().toISOString().slice(0, 10)
    const reglaActiva = reglas.find(r => r.activa)
    // cuotas vencidas: moroso o pendiente con fecha_vencimiento superada
    const cuotasVenc = cuotas.filter(c =>
      c.estado === 'moroso' ||
      (c.estado === 'pendiente' && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
    )
    const unidadesMorosas = [...new Set(cuotasVenc.map(c => c.unidad_id).filter(Boolean))]
    if (unidadesMorosas.length === 0) { notify({ variant: 'info', title: 'Sin cuotas vencidas', text: 'No hay cuotas vencidas a las que aplicar recargo.' }); return }

    let pct = 5
    let tipoRecargo: TipoRecargo = 'porcentaje'
    let motivo = `Recargo masivo mora`
    // Regla efectiva que alimenta calcularMoraCuota. Con regla activa usamos sus
    // parámetros completos (incl. dias_vencimiento/periodo_gracia/aplicar_sobre);
    // sin ella, construimos una regla mínima de porcentaje a partir del % del
    // prompt (vencimiento/gracia = 0, comportamiento equivalente al previo pero
    // ya pasando por la función pura).
    let reglaEfectiva: ReglaMora

    if (reglaActiva) {
      pct = reglaActiva.valor
      tipoRecargo = reglaActiva.tipo === 'porcentaje' ? 'porcentaje' : 'monto_fijo'
      motivo = `Recargo automático — ${reglaActiva.nombre}`
      reglaEfectiva = reglaMoraDe(reglaActiva)
      const conf = await confirm({
        icon: 'question',
        title: 'Aplicar mora automática',
        text: `Usando regla "${reglaActiva.nombre}" — Tipo: ${tipoRecargo === 'porcentaje' ? pct + '%' : moneda + ' ' + pct + ' fijo'} · ${unidadesMorosas.length} unidades afectadas`,
        variant: 'danger',
        confirmText: 'Aplicar',
      })
      if (!conf.isConfirmed) return
    } else {
      // F3.4d: PromptDialog accesible reemplaza Swal con input number + preConfirm
      const result = await openPromptDialog({
        title: 'Recargo masivo por mora',
        description: `${unidadesMorosas.length} unidades con cuotas vencidas. Configura reglas automáticas en la pestaña "Reglas mora".`,
        fields: [
          {
            name: 'pct',
            label: 'Porcentaje de recargo',
            type: 'number',
            required: true,
            initialValue: '5',
            min: 0.1,
            max: 100,
            step: 0.1,
            autoFocus: true,
          },
        ],
        submitText: 'Aplicar',
        validate: (data) => {
          const v = parseFloat(data.pct)
          return v > 0 ? null : 'Porcentaje debe ser mayor a 0'
        },
      })
      if (!result) return
      pct = parseFloat(result.pct)
      reglaEfectiva = { tipo: 'porcentaje', valor: pct, aplicar_sobre: 'monto_cuota', dias_vencimiento: 0, periodo_gracia: 0 }
    }

    setSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    // cond:C4 — el recargo por unidad es la SUMA del recargo de cada cuota
    // vencida, calculado con calcularMoraCuota (respeta vencimiento/gracia de la
    // regla). Para monto_fijo, la regla aplica el fijo por cuota.
    const rows = unidadesMorosas.map(uid => {
      const cuotasU = cuotasVenc.filter(c => c.unidad_id === uid)
      const monto_calculado = parseFloat(
        cuotasU.reduce((s, c) => {
          const dias = diasTranscurridosCuota(c, today)
          return s + calcularMoraCuota(reglaEfectiva, dias, c.monto).monto
        }, 0).toFixed(2),
      )
      return {
        company_id: companyId, project_id: proyectoId,
        unidad_id: uid, tipo: tipoRecargo, valor: pct,
        monto_calculado, fecha_aplicacion: today, motivo,
      }
    }).filter(r => r.monto_calculado > 0) // omite unidades cuya mora resultó 0 (en gracia)

    if (rows.length === 0) {
      setSaving(false)
      notify({ variant: 'info', title: 'Sin recargo aplicable', text: 'Las cuotas vencidas aún están dentro del periodo de gracia de la regla.' })
      return
    }

    const { error } = await createCondominioRow('recargos_mora', rows)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: `${rows.length} recargos creados`, text: `Total: ${moneda} ${rows.reduce((s, r) => s + r.monto_calculado, 0).toFixed(2)}`, duration: 2200 })
    refrescar()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Recargos aplicados', val: recargosProyecto.filter(r => r.estado === 'aplicado').length, sub: `${moneda} ${totalAplicado.toLocaleString()}`, bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
          { label: 'Pendientes de aplicar', val: recargosProyecto.filter(r => r.estado === 'pendiente').length, sub: `${moneda} ${totalPendiente.toLocaleString()}`, bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
          { label: 'Anulados', val: recargosProyecto.filter(r => r.estado === 'anulado').length, sub: '', bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
          { label: 'Unidades con mora', val: new Set(cuotas.filter(c => c.estado === 'moroso').map(c => c.unidad_id)).size, sub: '', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 10, color: k.color }}>{k.label}</div>
            {k.sub && <div style={{ fontSize: 11, color: k.color, fontWeight: 600 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Filtros + botones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          {(['', 'pendiente', 'aplicado', 'anulado'] as (EstadoRecargo | '')[]).map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-accent-hover)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-accent-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
              {e === '' ? 'Todos' : ESTADO_CFG[e].label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && (
            <button onClick={aplicarMasivo} disabled={saving}
              style={{ padding: '8px 14px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              ⚡ Recargo masivo
            </button>
          )}
          {canCreate && (
            <button onClick={() => setMostrarForm(!mostrarForm)}
              style={{ padding: '8px 14px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
              {mostrarForm ? '✕ Cancelar' : '+ Recargo individual'}
            </button>
          )}
        </div>
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo recargo de mora</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad *</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value, cuota_id: '' }))}>
                <option value="">Seleccionar…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Cuota relacionada</label>
              <select style={inp} value={form.cuota_id} onChange={e => setForm(p => ({ ...p, cuota_id: e.target.value }))} disabled={!form.unidad_id}>
                <option value="">Sin cuota específica</option>
                {cuotasUnidad.map(c => <option key={c.id} value={c.id}>{c.concepto} {c.periodo} — {moneda} {c.monto}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Tipo</label>
              <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoRecargo }))}>
                <option value="porcentaje">Porcentaje (%)</option>
                <option value="monto_fijo">Monto fijo</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Valor ({form.tipo === 'porcentaje' ? '%' : moneda}) *</label>
              <input type="number" step="0.01" style={inp} value={form.valor} onChange={e => setForm(p => ({ ...p, valor: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha de aplicación</label>
              <input type="date" style={inp} value={form.fecha_aplicacion} onChange={e => setForm(p => ({ ...p, fecha_aplicacion: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Motivo</label>
              <input style={inp} value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          {montoPreview !== null && (
            <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13, color: 'var(--at-warning-strong)' }}>
              Monto a cobrar: <strong>{moneda} {montoPreview.toFixed(2)}</strong>
            </div>
          )}
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear recargo'}
          </button>
        </div>
      )}

      {/* Tabla — F3.9: migrado a <DataTable> shared */}
      <DataTable<RecargoMora>
        data={lista}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'fecha_aplicacion', direction: 'desc' }}
        emptyState={{ icon: '💰', title: 'Sin recargos de mora registrados' }}
        columns={[
          { key: 'unidad_nombre', header: 'Unidad', sortable: true,
            accessor: (r) => unidades.find(u => u.id === r.unidad_id)?.nombre ?? r.unidad_nombre ?? '',
            render: (r) => <span style={{ fontWeight: 600 }}>{unidades.find(u => u.id === r.unidad_id)?.nombre ?? r.unidad_nombre ?? '—'}</span> },
          { key: 'fecha_aplicacion', header: 'Fecha', sortable: true,
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{r.fecha_aplicacion}</span> },
          { key: 'tipo', header: 'Tipo', sortable: true, hideOnMobile: true,
            render: (r) => <span style={{ color: 'var(--at-ink-2)' }}>{r.tipo === 'porcentaje' ? `${r.valor}%` : 'Fijo'}</span> },
          { key: 'valor', header: 'Valor', sortable: true, hideOnMobile: true,
            render: (r) => <span style={{ color: 'var(--at-ink-2)' }}>{r.tipo === 'porcentaje' ? `${r.valor}%` : `${moneda} ${r.valor}`}</span> },
          { key: 'monto_calculado', header: 'Monto', align: 'right', sortable: true,
            render: (r) => <span style={{ fontWeight: 700, color: 'var(--at-danger)' }}>{moneda} {r.monto_calculado.toFixed(2)}</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (r) => {
              const ec = ESTADO_CFG[r.estado]
              return <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
            } },
          { key: 'motivo', header: 'Motivo', hideOnMobile: true,
            accessor: (r) => r.motivo ?? '',
            render: (r) => <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}>{r.motivo ?? '—'}</span> },
          { key: 'actions', header: '', align: 'right',
            render: (r) => (canEdit && r.estado === 'pendiente') ? (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button onClick={(e) => { e.stopPropagation(); cambiarEstado(r, 'aplicado') }}
                  style={{ padding: '4px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Aplicar</button>
                <button onClick={(e) => { e.stopPropagation(); cambiarEstado(r, 'anulado') }}
                  style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Anular</button>
              </div>
            ) : null },
        ] satisfies DataTableColumn<RecargoMora>[]}
      />
    </div>
  )
}
