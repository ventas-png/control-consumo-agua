import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { SuministroCondominio, MovimientoSuministro, CategoriaSupministro, UnidadMedidaSum, TipoMovimientoSum } from '../../../types'

interface Props {
  suministros: SuministroCondominio[]
  movimientos: MovimientoSuministro[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaSupministro; label: string; icon: string }[] = [
  { value: 'limpieza',    label: 'Limpieza',    icon: '🧹' },
  { value: 'herramienta', label: 'Herramienta', icon: '🔧' },
  { value: 'material',    label: 'Material',    icon: '🧱' },
  { value: 'oficina',     label: 'Oficina',     icon: '📎' },
  { value: 'seguridad',   label: 'Seguridad',   icon: '🛡️' },
  { value: 'otro',        label: 'Otro',        icon: '📦' },
]

const UNIDADES: UnidadMedidaSum[] = ['unidad', 'litro', 'kg', 'metro', 'caja', 'rollo', 'otro']

const TIPOS_MOV: { value: TipoMovimientoSum; label: string; color: string }[] = [
  { value: 'entrada', label: 'Entrada', color: '#10b981' },
  { value: 'salida',  label: 'Salida',  color: '#ef4444' },
  { value: 'ajuste',  label: 'Ajuste',  color: '#f59e0b' },
]

export default function SuministrosTab({ suministros, movimientos, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<SuministroCondominio | null>(null)
  const [vista, setVista] = useState<'lista' | 'nuevo' | 'movimiento'>('lista')
  const [saving, setSaving] = useState(false)
  const [filtro, setFiltro] = useState<CategoriaSupministro | ''>('')
  const [soloAlertas, setSoloAlertas] = useState(false)

  const [form, setForm] = useState({
    nombre: '', categoria: 'limpieza' as CategoriaSupministro,
    unidad_medida: 'unidad' as UnidadMedidaSum, stock_actual: '0', stock_minimo: '0',
    ubicacion: '', proveedor: '', costo_unitario: '', notas: '',
  })

  const [movForm, setMovForm] = useState({
    tipo: 'salida' as TipoMovimientoSum, cantidad: '', motivo: '',
    area_destino: '', realizado_por: '', fecha: new Date().toISOString().split('T')[0], notas: '',
  })

  const lista = suministros.filter(s =>
    (filtro === '' || s.categoria === filtro) &&
    (!soloAlertas || s.stock_actual <= s.stock_minimo)
  )

  const alertas = suministros.filter(s => s.activo && s.stock_actual <= s.stock_minimo)
  const movsDelSelected = selected ? movimientos.filter(m => m.suministro_id === selected.id) : []

  async function guardar() {
    if (!form.nombre.trim()) { Swal.fire('Faltan datos', 'Nombre obligatorio', 'warning'); return }
    setSaving(true)
    const { error } = await supabase.from('suministros_condominio').insert({
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), categoria: form.categoria,
      unidad_medida: form.unidad_medida,
      stock_actual: parseFloat(form.stock_actual) || 0,
      stock_minimo: parseFloat(form.stock_minimo) || 0,
      ubicacion: form.ubicacion.trim() || null,
      proveedor: form.proveedor.trim() || null,
      costo_unitario: form.costo_unitario ? parseFloat(form.costo_unitario) : null,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm({ nombre: '', categoria: 'limpieza', unidad_medida: 'unidad', stock_actual: '0', stock_minimo: '0', ubicacion: '', proveedor: '', costo_unitario: '', notas: '' })
    setVista('lista')
    onRefresh()
  }

  async function registrarMovimiento() {
    if (!selected || !movForm.cantidad) { Swal.fire('Faltan datos', 'Cantidad obligatoria', 'warning'); return }
    const cant = parseFloat(movForm.cantidad)
    if (isNaN(cant) || cant <= 0) { Swal.fire('Inválido', 'Cantidad debe ser positiva', 'warning'); return }

    setSaving(true)
    const { error: errMov } = await supabase.from('movimientos_suministro').insert({
      company_id: companyId, suministro_id: selected.id,
      tipo: movForm.tipo, cantidad: cant,
      motivo: movForm.motivo.trim() || null, area_destino: movForm.area_destino.trim() || null,
      realizado_por: movForm.realizado_por.trim() || null, fecha: movForm.fecha,
      notas: movForm.notas.trim() || null,
    })
    if (errMov) { setSaving(false); Swal.fire('Error', errMov.message, 'error'); return }

    // Actualizar stock
    let nuevoStock = selected.stock_actual
    if (movForm.tipo === 'entrada') nuevoStock += cant
    else if (movForm.tipo === 'salida') nuevoStock = Math.max(0, nuevoStock - cant)
    else nuevoStock = cant // ajuste directo

    const { error: errStock } = await supabase.from('suministros_condominio').update({ stock_actual: nuevoStock }).eq('id', selected.id)
    setSaving(false)
    if (errStock) { Swal.fire('Error', errStock.message, 'error'); return }

    setMovForm({ tipo: 'salida', cantidad: '', motivo: '', area_destino: '', realizado_por: '', fecha: new Date().toISOString().split('T')[0], notas: '' })
    setVista('lista')
    onRefresh()
  }

  async function toggleActivo(s: SuministroCondominio) {
    await supabase.from('suministros_condominio').update({ activo: !s.activo }).eq('id', s.id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #C7C2B0', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#7E9389', marginBottom: 3, display: 'block' }

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      {/* Lista */}
      <div style={{ width: 300, borderRight: '1px solid #E1DDD0', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #E1DDD0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Suministros</span>
            {canCreate && (
              <button onClick={() => { setVista('nuevo'); setSelected(null) }}
                style={{ padding: '5px 10px', background: '#B96A3F', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                + Nuevo
              </button>
            )}
          </div>
          <select style={{ ...inp, marginBottom: 6 }} value={filtro} onChange={e => setFiltro(e.target.value as CategoriaSupministro | '')}>
            <option value="">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloAlertas} onChange={e => setSoloAlertas(e.target.checked)} />
            Solo alertas de stock ({alertas.length})
          </label>
        </div>

        {alertas.length > 0 && !soloAlertas && (
          <div style={{ padding: '6px 12px', background: '#fef3c7', borderBottom: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
            ⚠️ {alertas.length} suministros bajo mínimo
          </div>
        )}

        {lista.length === 0 && <div style={{ textAlign: 'center', color: '#7E9389', padding: '32px 16px', fontSize: 13 }}>Sin suministros</div>}

        {lista.map(s => {
          const cat = CATEGORIAS.find(c => c.value === s.categoria)
          const alerta = s.stock_actual <= s.stock_minimo
          return (
            <div key={s.id} onClick={() => { setSelected(s); setVista('lista') }}
              style={{ padding: '10px 12px', borderBottom: '1px solid #EAE6D8', cursor: 'pointer', background: selected?.id === s.id ? '#F4EBE3' : '#fff', opacity: s.activo ? 1 : 0.5, borderLeft: alerta ? '3px solid #f59e0b' : '3px solid transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{cat?.icon} {s.nombre}</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: alerta ? '#ef4444' : '#10b981' }}>
                  {s.stock_actual} {s.unidad_medida}
                </span>
              </div>
              {alerta && <div style={{ fontSize: 11, color: '#f59e0b' }}>⚠️ Mínimo: {s.stock_minimo}</div>}
              {s.ubicacion && <div style={{ fontSize: 11, color: '#7E9389' }}>{s.ubicacion}</div>}
            </div>
          )
        })}
      </div>

      {/* Panel derecho */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {/* Formulario nuevo */}
        {vista === 'nuevo' && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Nuevo suministro</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Nombre *</label>
                <input style={inp} placeholder="Detergente multiusos…" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Categoría</label>
                <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaSupministro }))}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Unidad de medida</label>
                <select style={inp} value={form.unidad_medida} onChange={e => setForm(p => ({ ...p, unidad_medida: e.target.value as UnidadMedidaSum }))}>
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Stock actual</label>
                <input type="number" style={inp} value={form.stock_actual} onChange={e => setForm(p => ({ ...p, stock_actual: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Stock mínimo</label>
                <input type="number" style={inp} value={form.stock_minimo} onChange={e => setForm(p => ({ ...p, stock_minimo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Ubicación</label>
                <input style={inp} placeholder="Cuarto de limpieza…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Proveedor</label>
                <input style={inp} value={form.proveedor} onChange={e => setForm(p => ({ ...p, proveedor: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Costo unitario ({moneda})</label>
                <input type="number" style={inp} value={form.costo_unitario} onChange={e => setForm(p => ({ ...p, costo_unitario: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Notas</label>
                <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={saving}
                style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Guardar'}
              </button>
              <button onClick={() => setVista('lista')}
                style={{ padding: '8px 16px', background: '#EAE6D8', color: '#3E5A4C', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Formulario movimiento */}
        {vista === 'movimiento' && selected && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Registrar movimiento</div>
            <div style={{ fontSize: 13, color: '#7E9389', marginBottom: 16 }}>
              {selected.nombre} — Stock actual: <strong>{selected.stock_actual} {selected.unidad_medida}</strong>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Tipo *</label>
                <select style={inp} value={movForm.tipo} onChange={e => setMovForm(p => ({ ...p, tipo: e.target.value as TipoMovimientoSum }))}>
                  {TIPOS_MOV.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Cantidad *{movForm.tipo === 'ajuste' ? ' (nuevo stock)' : ''}</label>
                <input type="number" style={inp} value={movForm.cantidad} onChange={e => setMovForm(p => ({ ...p, cantidad: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Fecha</label>
                <input type="date" style={inp} value={movForm.fecha} onChange={e => setMovForm(p => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Motivo</label>
                <input style={inp} placeholder="Consumo semanal…" value={movForm.motivo} onChange={e => setMovForm(p => ({ ...p, motivo: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Área destino</label>
                <input style={inp} placeholder="Lobby, piscina…" value={movForm.area_destino} onChange={e => setMovForm(p => ({ ...p, area_destino: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Realizado por</label>
                <input style={inp} value={movForm.realizado_por} onChange={e => setMovForm(p => ({ ...p, realizado_por: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={registrarMovimiento} disabled={saving}
                style={{ padding: '8px 20px', background: '#B96A3F', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {saving ? 'Guardando…' : '✅ Registrar'}
              </button>
              <button onClick={() => setVista('lista')}
                style={{ padding: '8px 16px', background: '#EAE6D8', color: '#3E5A4C', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Detalle */}
        {vista === 'lista' && selected && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 20 }}>
                  {CATEGORIAS.find(c => c.value === selected.categoria)?.icon} {selected.nombre}
                </div>
                <div style={{ fontSize: 13, color: '#7E9389', marginTop: 4 }}>
                  {selected.ubicacion && <span>{selected.ubicacion} · </span>}
                  {selected.proveedor && <span>Proveedor: {selected.proveedor}</span>}
                </div>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setVista('movimiento')}
                    style={{ padding: '7px 14px', background: '#B96A3F', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    + Movimiento
                  </button>
                  <button onClick={() => toggleActivo(selected)}
                    style={{ padding: '7px 14px', background: '#EAE6D8', color: '#3E5A4C', border: '1px solid #E1DDD0', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                    {selected.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              )}
            </div>

            {/* Stock KPI */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
              {[
                { label: `Stock actual (${selected.unidad_medida})`, value: selected.stock_actual, color: selected.stock_actual <= selected.stock_minimo ? '#ef4444' : '#10b981' },
                { label: `Stock mínimo (${selected.unidad_medida})`, value: selected.stock_minimo, color: '#7E9389' },
                { label: `Costo unitario (${moneda})`, value: selected.costo_unitario?.toFixed(2) ?? '—', color: '#B96A3F' },
              ].map(k => (
                <div key={k.label} style={{ background: '#FAF7EF', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: '#7E9389' }}>{k.label}</div>
                </div>
              ))}
            </div>

            {selected.stock_actual <= selected.stock_minimo && (
              <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#92400e' }}>
                ⚠️ Stock bajo mínimo — requiere reposición
              </div>
            )}

            {/* Historial movimientos */}
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Últimos movimientos</div>
            {movsDelSelected.length === 0
              ? <div style={{ color: '#7E9389', fontSize: 13 }}>Sin movimientos registrados</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#FAF7EF' }}>
                      {['Fecha', 'Tipo', 'Cantidad', 'Motivo', 'Área', 'Por'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: '#7E9389', fontWeight: 600, borderBottom: '1px solid #E1DDD0', fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movsDelSelected.slice(0, 30).map(m => {
                      const tipo = TIPOS_MOV.find(t => t.value === m.tipo)
                      return (
                        <tr key={m.id} style={{ borderBottom: '1px solid #EAE6D8' }}>
                          <td style={{ padding: '7px 10px' }}>{m.fecha}</td>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 8, background: tipo?.color + '20', color: tipo?.color, fontSize: 11 }}>{tipo?.label}</span>
                          </td>
                          <td style={{ padding: '7px 10px', fontWeight: 600 }}>{m.cantidad} {selected.unidad_medida}</td>
                          <td style={{ padding: '7px 10px' }}>{m.motivo || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{m.area_destino || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{m.realizado_por || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
          </div>
        )}

        {vista === 'lista' && !selected && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#7E9389', fontSize: 14 }}>
            Selecciona un suministro o crea uno nuevo
          </div>
        )}
      </div>
    </div>
  )
}
