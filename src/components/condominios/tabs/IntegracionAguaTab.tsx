import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Unidad } from '../../../types'
import Swal from 'sweetalert2'

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
  const [resumen, setResumen] = useState<ResumenMedidor[]>([])
  const [loading, setLoading] = useState(true)

  // Generación de cuotas
  const [tarifa, setTarifa] = useState('')
  const [periodo, setPeriodo] = useState(new Date().toISOString().slice(0, 7))
  const [fechaVenc, setFechaVenc] = useState('')
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set())
  const [generando, setGenerando] = useState(false)
  const [showGenerar, setShowGenerar] = useState(false)

  useEffect(() => {
    async function cargar() {
      setLoading(true)

      const { data: contadores } = await supabase
        .from('contadores')
        .select('id, numero_medidor, unidad_id, unidades(nombre)')
        .eq('project_id', proyectoId)
        .eq('company_id', companyId)
        .order('numero_medidor')

      if (!contadores || contadores.length === 0) { setLoading(false); return }

      const ids = (contadores as Record<string, unknown>[]).map(c => c.id as string)

      const { data: registros } = await supabase
        .from('registros')
        .select('contador_id, lectura_actual, consumo, fecha')
        .in('contador_id', ids)
        .order('fecha', { ascending: false })

      const lista: ResumenMedidor[] = (contadores as Record<string, unknown>[]).map(c => {
        const regs = ((registros ?? []) as Record<string, unknown>[]).filter(r => r.contador_id === c.id)
        const ultima = regs[0] as Record<string, unknown> | undefined
        const unidad = unidades.find(u => u.id === (c.unidad_id as string))
        const nombre = (c.unidades as { nombre: string } | null)?.nombre ?? unidad?.nombre ?? 'Sin unidad'
        return {
          contador_id: c.id as string,
          numero_medidor: c.numero_medidor as string,
          unidad_id: (c.unidad_id as string) ?? null,
          unidad_nombre: nombre,
          ultima_lectura: ultima ? (ultima.lectura_actual as number) : null,
          consumo_ultimo: ultima ? (ultima.consumo as number) : null,
          fecha_lectura: ultima ? (ultima.fecha as string) : null,
        }
      })

      setResumen(lista)
      setLoading(false)
    }
    cargar()
  }, [proyectoId, companyId, unidades])

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
    if (!tarifa || tarifaNum <= 0) { Swal.fire('Error', 'Ingresa una tarifa válida por m³.', 'warning'); return }
    if (!periodo) { Swal.fire('Error', 'Selecciona el período.', 'warning'); return }
    if (seleccionadas.size === 0) { Swal.fire('Error', 'Selecciona al menos una unidad.', 'warning'); return }

    const items = conGenerables.filter(r => seleccionadas.has(r.contador_id))
    const total = items.reduce((s, r) => s + (r.consumo_ultimo ?? 0) * tarifaNum, 0)

    const { isConfirmed } = await Swal.fire({
      title: `Generar ${items.length} cuotas de agua`,
      html: `<p style="font-size:13px;color:#3E5A4C;margin:0 0 8px">Período: <strong>${periodo}</strong></p>
             <p style="font-size:13px;color:#3E5A4C;margin:0 0 8px">Tarifa: <strong>${moneda} ${tarifaNum.toFixed(4)}/m³</strong></p>
             <p style="font-size:16px;font-weight:800;color:#1B3B36">Total a generar: ${moneda} ${total.toFixed(2)}</p>`,
      icon: 'question', showCancelButton: true,
      confirmButtonText: '💧 Generar cuotas', cancelButtonText: 'Cancelar', confirmButtonColor: '#1B3B36',
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

    const { error } = await supabase.from('cuotas_condominio').insert(inserts)
    setGenerando(false)

    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: `${items.length} cuotas de agua generadas`, text: `Total: ${moneda} ${total.toFixed(2)}`, timer: 2000, showConfirmButton: false })
    setSeleccionadas(new Set())
    setShowGenerar(false)
    onRefresh()
  }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Medidores activos', val: resumen.length, color: '#1B3B36', bg: '#EEF2EC' },
          { label: 'Consumo total último período', val: `${totalConsumo.toLocaleString('es')} m³`, color: '#16a34a', bg: '#f0fdf4' },
          { label: 'Promedio por unidad', val: isNaN(promedio) || promedio === 0 ? '—' : `${promedio.toFixed(1)} m³`, color: '#9C5733', bg: '#FAF1EA' },
          { label: 'Sin lectura registrada', val: sinLectura, color: sinLectura > 0 ? '#d97706' : '#16a34a', bg: sinLectura > 0 ? '#fef3c7' : '#f0fdf4' },
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
            style={{ padding: '8px 18px', background: showGenerar ? '#EAE6D8' : '#1B3B36', color: showGenerar ? '#3E5A4C' : '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {showGenerar ? '✕ Cancelar' : '💧 Generar cuotas de agua'}
          </button>
        </div>
      )}

      {/* Panel generación */}
      {showGenerar && (
        <div style={{ background: '#EEF2EC', border: '1px solid #C2D2CA', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: '#0E2A24' }}>Generar cuotas de agua por consumo</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: 4 }}>Tarifa por m³ ({moneda}) *</label>
              <input type="number" step="0.0001" min="0" value={tarifa}
                onChange={e => setTarifa(e.target.value)} placeholder="0.0000"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #577B69', borderRadius: 6, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: 4 }}>Período (YYYY-MM) *</label>
              <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #577B69', borderRadius: 6, fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: 4 }}>Fecha vencimiento</label>
              <input type="date" value={fechaVenc} onChange={e => setFechaVenc(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #577B69', borderRadius: 6, fontSize: 13 }} />
            </div>
          </div>

          {tarifaNum > 0 && (
            <div style={{ background: '#fff', border: '1px solid #C2D2CA', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#D9E2DC', borderBottom: '1px solid #C2D2CA' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#102622', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={seleccionadas.size === conGenerables.length} onChange={toggleAll} />
                  {seleccionadas.size} de {conGenerables.length} unidades · Total: {moneda} {conGenerables.filter(r => seleccionadas.has(r.contador_id)).reduce((s, r) => s + (r.consumo_ultimo ?? 0) * tarifaNum, 0).toFixed(2)}
                </label>
              </div>
              {conGenerables.map(r => {
                const monto = ((r.consumo_ultimo ?? 0) * tarifaNum).toFixed(2)
                return (
                  <div key={r.contador_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #EAE6D8' }}>
                    <input type="checkbox" checked={seleccionadas.has(r.contador_id)} onChange={() => toggle(r.contador_id)} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#15291F' }}>{r.unidad_nombre}</span>
                    <span style={{ fontSize: 12, color: '#7E9389' }}>#{r.numero_medidor}</span>
                    <span style={{ fontSize: 12, color: '#3E5A4C' }}>{r.consumo_ultimo} m³</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1B3B36', minWidth: 80, textAlign: 'right' }}>{moneda} {monto}</span>
                  </div>
                )
              })}
            </div>
          )}

          <button onClick={generarCuotasAgua} disabled={generando || tarifaNum <= 0 || seleccionadas.size === 0}
            style={{ padding: '9px 20px', background: generando || tarifaNum <= 0 || seleccionadas.size === 0 ? '#7E9389' : '#1B3B36', color: '#fff', border: 'none', borderRadius: 8, cursor: generando || tarifaNum <= 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}>
            {generando ? '⏳ Generando…' : `💧 Generar ${seleccionadas.size} cuota${seleccionadas.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {/* Lista de medidores */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#7E9389', padding: '48px 0', fontSize: 13 }}>Cargando medidores…</div>
      ) : resumen.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#7E9389', padding: '48px 0', fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>💧</div>
          No hay medidores configurados para este proyecto.
          <div style={{ fontSize: 11, marginTop: 4 }}>Crea contadores en el módulo principal de agua.</div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E1DDD0', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Consumo por unidad — última lectura disponible</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resumen.map(r => {
              const pct = r.consumo_ultimo ? (r.consumo_ultimo / maxConsumo) * 100 : 0
              const alto = r.consumo_ultimo !== null && promedio > 0 && r.consumo_ultimo > promedio * 1.5
              return (
                <div key={r.contador_id} style={{ padding: '10px 12px', background: '#FAF7EF', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color: '#15291F' }}>{r.unidad_nombre}</span>
                      <span style={{ fontSize: 10, color: '#7E9389' }}>#{r.numero_medidor}</span>
                      {alto && <span style={{ fontSize: 10, background: '#fef2f2', color: '#ef4444', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>⚠ Alto</span>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: alto ? '#ef4444' : '#15291F' }}>
                        {r.consumo_ultimo !== null ? `${r.consumo_ultimo} m³` : '—'}
                      </span>
                      {r.fecha_lectura && <div style={{ fontSize: 10, color: '#7E9389' }}>{r.fecha_lectura}</div>}
                    </div>
                  </div>
                  <div style={{ background: '#E1DDD0', borderRadius: 4, height: 6 }}>
                    <div style={{ height: '100%', background: alto ? '#ef4444' : '#2F5D4F', width: `${pct}%`, borderRadius: 4 }} />
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
