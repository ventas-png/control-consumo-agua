import { mesLocalISO } from '../../../lib/format'
import { useState, useMemo } from 'react'
import { useMedidoresAguaPorProyectoQuery } from '../../../domain/agua/queries'
import { validatedInsertMany, esDuplicadoLlaveNatural } from '../../../lib/validatedInsert'
import { cuotaInputSchema } from '../../../domain/condominios/schemas'
import { Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  onRefresh: () => void
}

interface ResumenMedidor {
  contador_id: string
  numero_medidor: string
  unidad_id: string | null
  unidad_nombre: string
  ultima_lectura: number | null
  consumo_ultimo: number | null
  fecha_lectura: string | null
}

export default function IntegracionAguaTab({ unidades, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  // Capa de datos (T7): lectura dependiente (contadores → registros) vía
  // TanStack Query. El resumen se arma en un useMemo para que el prop `unidades`
  // (fallback de nombre) no entre en la query key ni dispare refetch.
  const { data, isLoading: loading } = useMedidoresAguaPorProyectoQuery(companyId, proyectoId)
  const resumen = useMemo<ResumenMedidor[]>(() => {
    const contadores = data?.contadores ?? []
    const registros = data?.registros ?? []
    return contadores.map(c => {
      const regs = registros.filter(r => r.contador_id === c.id)
      const ultima = regs[0]
      const unidad = unidades.find(u => u.id === c.unidad_id)
      const nombre = c.unidades?.nombre ?? unidad?.nombre ?? 'Sin unidad'
      return {
        contador_id: c.id,
        numero_medidor: c.numero_medidor,
        unidad_id: c.unidad_id ?? null,
        unidad_nombre: nombre,
        ultima_lectura: ultima ? ultima.lectura_actual : null,
        consumo_ultimo: ultima ? ultima.consumo : null,
        fecha_lectura: ultima ? ultima.fecha : null,
      }
    })
  }, [data, unidades])

  // Generación de cuotas
  const [tarifa, setTarifa] = useState('')
  const [periodo, setPeriodo] = useState(mesLocalISO())
  const [fechaVenc, setFechaVenc] = useState('')
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [generando, setGenerando] = useState(false)
  const [showGenerar, setShowGenerar] = useState(false)

  const totalConsumo = resumen.reduce((s, r) => s + (r.consumo_ultimo ?? 0), 0)
  const sinLectura = resumen.filter(r => !r.fecha_lectura).length
  const conConsumo = resumen.filter(r => r.consumo_ultimo !== null && r.consumo_ultimo > 0)
  const promedio = conConsumo.length > 0 ? totalConsumo / conConsumo.length : 0
  const maxConsumo = Math.max(...resumen.map(r => r.consumo_ultimo ?? 0), 1)

  const tarifaNum = parseFloat(tarifa) || 0
  const conGenerables = resumen.filter(r => r.consumo_ultimo !== null && r.consumo_ultimo > 0 && r.unidad_id)

  function toggleAll() {
    if (seleccionadas.size === conGenerables.length) setSeleccionadas(new Set())
    else setSeleccionadas(new Set(conGenerables.map(r => r.contador_id)))
  }

  function toggle(id: string) {
    setSeleccionadas(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }

  async function generarCuotasAgua() {
    if (!tarifa || tarifaNum <= 0) { notify({ variant: 'warning', title: 'Error', text: 'Ingresa una tarifa válida por m³.' }); return }
    if (!periodo) { notify({ variant: 'warning', title: 'Error', text: 'Selecciona el período.' }); return }
    if (seleccionadas.size === 0) { notify({ variant: 'warning', title: 'Error', text: 'Selecciona al menos una unidad.' }); return }

    const items = conGenerables.filter(r => seleccionadas.has(r.contador_id))
    const total = items.reduce((s, r) => s + (r.consumo_ultimo ?? 0) * tarifaNum, 0)

    const { isConfirmed } = await confirm({
      title: `Generar ${items.length} cuotas de agua`,
      text: `Período: ${periodo} · Tarifa: ${moneda} ${tarifaNum.toFixed(4)}/m³ · Total: ${moneda} ${total.toFixed(2)}`,
      icon: 'question',
      confirmText: '💧 Generar cuotas',
    })
    if (!isConfirmed) return

    setGenerando(true)
    const inserts = items.map(r => ({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: r.unidad_id,
      concepto: 'CAM',
      monto: parseFloat(((r.consumo_ultimo ?? 0) * tarifaNum).toFixed(2)),
      periodo,
      fecha_vencimiento: fechaVenc || null,
      estado: 'pendiente',
      notas: `Consumo agua: ${r.consumo_ultimo} m³ × ${moneda} ${tarifaNum}/m³`,
    }))

    // cond:C2 — batch insert con pre-validación Zod por fila.
    const { error } = await validatedInsertMany('cuotas_condominio', cuotaInputSchema, inserts)
    setGenerando(false)

    // E1: llave natural — estas cuotas de agua ya se generaron para el período.
    if (esDuplicadoLlaveNatural(error)) {
      notify({ variant: 'warning', title: 'Cuotas ya generadas', text: `Alguna unidad ya tiene la cuota de agua de ${periodo}. No se duplicó nada — actualizá la vista.` })
      onRefresh(); return
    }
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: `${items.length} cuotas de agua generadas`, text: `Total: ${moneda} ${total.toFixed(2)}`, duration: 2000 })
    setSeleccionadas(new Set())
    setShowGenerar(false)
    onRefresh()
  }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Medidores activos', val: resumen.length, color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
          { label: 'Consumo total último período', val: `${totalConsumo.toLocaleString('es')} m³`, color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Promedio por unidad', val: isNaN(promedio) || promedio === 0 ? '—' : `${promedio.toFixed(1)} m³`, color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
          { label: 'Sin lectura registrada', val: sinLectura, color: sinLectura > 0 ? 'var(--at-warning)' : 'var(--at-success)', bg: sinLectura > 0 ? 'var(--at-warning-tint)' : 'var(--at-success-tint)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color, fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Botón generar */}
      {canCreate && conGenerables.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={() => { setShowGenerar(!showGenerar); setSeleccionadas(new Set(conGenerables.map(r => r.contador_id))) }}
            style={{ padding: '8px 18px', background: showGenerar ? 'var(--at-chip)' : 'var(--at-primary)', color: showGenerar ? 'var(--at-ink-2)' : 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {showGenerar ? '✕ Cancelar' : '💧 Generar cuotas de agua'}
          </button>
        </div>
      )}

      {/* Panel generación */}
      {showGenerar && (
        <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: 'var(--at-ink-deep)' }}>Generar cuotas de agua por consumo</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Tarifa por m³ ({moneda}) *</label>
              <input type="number" step="0.0001" min="0" value={tarifa}
                onChange={e => setTarifa(e.target.value)} placeholder="0.0000"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-accent-2)', borderRadius: 6, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Período (YYYY-MM) *</label>
              <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-accent-2)', borderRadius: 6, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Fecha vencimiento</label>
              <input type="date" value={fechaVenc} onChange={e => setFechaVenc(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-accent-2)', borderRadius: 6, fontSize: 13 }} />
            </div>
          </div>

          {tarifaNum > 0 && (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--at-primary-soft)', borderBottom: '1px solid var(--at-primary-soft-2)' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-primary-hover)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={seleccionadas.size === conGenerables.length} onChange={toggleAll} />
                  {seleccionadas.size} de {conGenerables.length} unidades · Total: {moneda} {conGenerables.filter(r => seleccionadas.has(r.contador_id)).reduce((s, r) => s + (r.consumo_ultimo ?? 0) * tarifaNum, 0).toFixed(2)}
                </label>
              </div>
              {conGenerables.map(r => {
                const monto = ((r.consumo_ultimo ?? 0) * tarifaNum).toFixed(2)
                return (
                  <div key={r.contador_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--at-chip)' }}>
                    <input type="checkbox" checked={seleccionadas.has(r.contador_id)} onChange={() => toggle(r.contador_id)} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--at-ink)' }}>{r.unidad_nombre}</span>
                    <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>#{r.numero_medidor}</span>
                    <span style={{ fontSize: 12, color: 'var(--at-ink-2)' }}>{r.consumo_ultimo} m³</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-primary)', minWidth: 80, textAlign: 'right' }}>{moneda} {monto}</span>
                  </div>
                )
              })}
            </div>
          )}

          <button onClick={generarCuotasAgua} disabled={generando || tarifaNum <= 0 || seleccionadas.size === 0}
            style={{ padding: '9px 20px', background: generando || tarifaNum <= 0 || seleccionadas.size === 0 ? 'var(--at-ink-3)' : 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: generando || tarifaNum <= 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}>
            {generando ? '⏳ Generando…' : `💧 Generar ${seleccionadas.size} cuota${seleccionadas.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Lista de medidores */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '48px 0', fontSize: 13 }}>Cargando medidores…</div>
      ) : resumen.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '48px 0', fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>💧</div>
          No hay medidores configurados para este proyecto.
          <div style={{ fontSize: 11, marginTop: 4 }}>Crea contadores en el módulo principal de agua.</div>
        </div>
      ) : (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Consumo por unidad — última lectura disponible</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resumen.map(r => {
              const pct = r.consumo_ultimo ? (r.consumo_ultimo / maxConsumo) * 100 : 0
              const alto = r.consumo_ultimo !== null && promedio > 0 && r.consumo_ultimo > promedio * 1.5
              return (
                <div key={r.contador_id} style={{ padding: '10px 12px', background: 'var(--at-surface-2)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--at-ink)' }}>{r.unidad_nombre}</span>
                      <span style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>#{r.numero_medidor}</span>
                      {alto && <span style={{ fontSize: 10, background: 'var(--at-danger-tint)', color: 'var(--at-danger)', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>⚠ Alto</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: alto ? 'var(--at-danger)' : 'var(--at-ink)' }}>
                        {r.consumo_ultimo !== null ? `${r.consumo_ultimo} m³` : '—'}
                      </span>
                      {r.fecha_lectura && <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{r.fecha_lectura}</div>}
                    </div>
                  </div>
                  <div style={{ background: 'var(--at-line)', borderRadius: 4, height: 6 }}>
                    <div style={{ height: '100%', background: alto ? 'var(--at-danger)' : 'var(--at-primary-2)', width: `${pct}%`, borderRadius: 4 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
