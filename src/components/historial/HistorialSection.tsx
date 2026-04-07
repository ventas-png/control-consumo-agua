import { useState } from 'react'
import Swal from 'sweetalert2'
import type { Registro, Cliente, UserRole } from '../../types'
import { supabase } from '../../lib/supabase'
import { calcularTotalPagar } from '../../lib/business'
import { exportarPDFGlobal } from '../../lib/pdf'
import { APP_CONFIG } from '../../lib/config'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  userRole: UserRole
  moneda?: string
  onEstadoUpdated: (id: string, estado: Registro['estado']) => void
}

export function HistorialSection({ registros, clientes, userRole, moneda = 'Q', onEstadoUpdated }: Props) {
  const [filtroTexto, setFiltroTexto] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [editModal, setEditModal] = useState<{ registroId: string; estado: Registro['estado'] } | null>(null)
  const [savingEstado, setSavingEstado] = useState(false)

  const canEdit = userRole !== 'viewer'

  const filtrados = registros
    .filter(r => {
      const matchTxt = (r.cliente_nombre ?? '').toLowerCase().includes(filtroTexto.toLowerCase())
      const matchEst = filtroEstado ? r.estado === filtroEstado : true
      return matchTxt && matchEst
    })
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

  function getTotal(r: Registro): number {
    return r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
  }

  function enviarWhatsApp(registro: Registro) {
    const cliente = clientes.find(c => c.id === registro.cliente_id)
    const rawTel = cliente?.whatsapp ?? cliente?.telefono ?? ''
    if (!rawTel) { Swal.fire('Sin Teléfono', 'Este cliente no tiene teléfono.', 'warning'); return }
    let telefono = rawTel.trim().replace(/[\s\-\.\(\)]/g, '')
    if (telefono.startsWith('+')) telefono = telefono.slice(1)
    else { telefono = telefono.replace(/\D/g, ''); if (telefono.length === 8) telefono = APP_CONFIG.COUNTRY_CODE + telefono }
    const total = getTotal(registro)
    const msg = `Hola ${registro.cliente_nombre}, su recibo de agua potable:\n📅 Fecha: ${new Date(registro.fecha).toLocaleDateString()}\n💧 Lectura Actual: ${registro.lectura_actual}\n📊 Consumo: ${registro.consumo.toFixed(2)} m³\n💰 Total a Pagar: ${moneda}${total.toFixed(2)}\nℹ️ Estado: ${registro.estado.toUpperCase()}\n\nGracias por su pago puntual.`
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function updateEstado() {
    if (!editModal) return
    setSavingEstado(true)
    const { error } = await supabase
      .from('registros')
      .update({ estado: editModal.estado })
      .eq('id', editModal.registroId)

    if (!error) {
      onEstadoUpdated(editModal.registroId, editModal.estado)
      setEditModal(null)
      Swal.fire({ icon: 'success', title: 'Estado actualizado', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', 'No se pudo actualizar el estado', 'error')
    }
    setSavingEstado(false)
  }

  const pillStyle = (estado: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; color: string }> = {
      pendiente: { bg: '#fef3c7', color: '#92400e' },
      pagado: { bg: '#d1fae5', color: '#065f46' },
      mora: { bg: '#fee2e2', color: '#991b1b' },
    }
    return { padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, ...colors[estado] }
  }

  const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #cbd5e0', borderRadius: '8px', fontSize: '14px' }

  return (
    <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px' }}>
        <span style={{ fontSize: '20px', fontWeight: 700 }}>Historial de Lecturas</span>
        <button onClick={() => exportarPDFGlobal(filtrados)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
          📄 PDF Reporte
        </button>
      </div>

      <div style={{ background: '#f8fafc', padding: '15px', marginBottom: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Buscar..." value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)} style={inputStyle} />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={inputStyle}>
          <option value="">Todos los Estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="pagado">Pagado</option>
          <option value="mora">Mora</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white' }}>
            <tr>
              {['Fecha', 'Cliente', 'Lect. Ant.', 'Lect. Act.', 'Consumo', `Total (${moneda})`, 'Estado', 'Acciones'].map(h => (
                <th scope="col" key={h} style={{ padding: '14px 12px', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.map(r => {
              const total = getTotal(r)
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '14px 12px' }}>{new Date(r.fecha).toLocaleDateString()}</td>
                  <td style={{ padding: '14px 12px' }}>{r.cliente_nombre}</td>
                  <td style={{ padding: '14px 12px' }}>{r.lectura_anterior}</td>
                  <td style={{ padding: '14px 12px' }}>{r.lectura_actual}</td>
                  <td style={{ padding: '14px 12px' }}><strong>{r.consumo.toFixed(2)}</strong></td>
                  <td style={{ padding: '14px 12px' }}>{moneda}{total.toFixed(2)}</td>
                  <td style={{ padding: '14px 12px' }}><span style={pillStyle(r.estado)}>{r.estado}</span></td>
                  <td style={{ padding: '14px 12px' }}>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      {canEdit && (
                        <button onClick={() => setEditModal({ registroId: r.id, estado: r.estado })} aria-label="Editar estado" style={{ padding: '6px 10px', background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>✏️</button>
                      )}
                      <button onClick={() => enviarWhatsApp(r)} aria-label="Enviar por WhatsApp" style={{ padding: '6px 10px', background: '#25D366', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>📱</button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Sin registros</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Status Modal */}
      {editModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setEditModal(null)}
        >
          <div style={{ background: 'white', padding: '32px', borderRadius: '16px', width: '90%', maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>Modificar Estado de Pago</h3>
              <button onClick={() => setEditModal(null)} aria-label="Cerrar modal" style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>&times;</button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px' }}>Nuevo Estado</label>
              <select
                value={editModal.estado}
                onChange={e => setEditModal(prev => prev ? { ...prev, estado: e.target.value as Registro['estado'] } : null)}
                style={{ width: '100%', padding: '12px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px' }}
              >
                <option value="pendiente">Pendiente</option>
                <option value="pagado">Pagado</option>
                <option value="mora">Mora</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={updateEstado} disabled={savingEstado} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                {savingEstado ? 'Guardando...' : 'Actualizar Estado'}
              </button>
              <button onClick={() => setEditModal(null)} style={{ flex: 1, padding: '12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
