import { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import type { Registro, Cliente, UserRole, UserSession, Pago, ConvenioPago, FormaPago } from '../../types'
import { calcularTotalPagar } from '../../lib/business'
import { useSignedUrl } from '../../lib/storageUrls'
import { PagoModal } from './PagoModal'
import { ConvenioModal } from './ConvenioModal'
import { PagosHistorial } from './PagosHistorial'

// Pequeño wrapper para firmar el link al comprobante (bucket pagos-comprobantes
// es privado tras S6 follow-up). Tipo y label se pasan como props.
function ComprobanteLink({ src, tipo }: { src: string; tipo?: string | null }) {
  const signed = useSignedUrl(src, 'pagos-comprobantes')
  if (!signed) return null
  return (
    <a
      href={signed}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        fontSize: '13px',
        color: '#1B3B36',
        textDecoration: 'none',
        fontWeight: 600,
      }}
    >
      📎 Ver comprobante{tipo ? ` (${tipo})` : ''}
    </a>
  )
}

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  userRole: UserRole
  currentUser: UserSession
  moneda?: string
  onEstadoUpdated: (id: string, estado: Registro['estado']) => void
  onRegistroUpdated?: (id: string, partial: Partial<Registro>) => void
  canCreate?: boolean
  canEdit?: boolean
  canChangeStatus?: boolean
}

type Tab = 'pendientes' | 'verificaciones' | 'historial' | 'convenios'

const FORMA_PAGO_LABELS: Record<FormaPago, string> = {
  efectivo: '💵 Efectivo',
  transferencia: '🏦 Transferencia',
  deposito: '🏧 Depósito',
  tarjeta_credito: '💳 Tarjeta Crédito',
  tarjeta_debito: '💳 Tarjeta Débito',
  cheque: '📄 Cheque',
  convenio_pago: '🤝 Convenio de Pago',
  otro: '📎 Otro',
}

export function CobrosSection({ registros, clientes, userRole, currentUser, moneda = 'Q', onEstadoUpdated, onRegistroUpdated, canCreate: _canCreate = true, canEdit: _canEdit = true, canChangeStatus: _canChangeStatus = true }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('pendientes')
  const [filtroBusqueda, setFiltroBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'mora'>('todos')
  const [pagoModal, setPagoModal] = useState<Registro | null>(null)
  const [convenioModal, setConvenioModal] = useState<Registro[] | null>(null)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [convenios, setConvenios] = useState<ConvenioPago[]>([])
  const [loadingPagos, setLoadingPagos] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [verificando, setVerificando] = useState<string | null>(null)

  const canEdit = userRole !== 'viewer'

  const cargarPagosYConvenios = useCallback(async () => {
    setLoadingPagos(true)
    const [pagosRes, conveniosRes] = await Promise.all([
      supabase
        .from('pagos')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('convenios_pago')
        .select('*')
        .order('created_at', { ascending: false }),
    ])
    if (pagosRes.data) setPagos(pagosRes.data as Pago[])
    if (conveniosRes.data) setConvenios(conveniosRes.data as ConvenioPago[])
    setLoadingPagos(false)
  }, [])

  useEffect(() => { void cargarPagosYConvenios() }, [cargarPagosYConvenios])

  // Registros pendientes o en mora
  const registrosPendientes = registros.filter(r =>
    r.estado === 'pendiente' || r.estado === 'mora'
  )

  const registrosFiltrados = registrosPendientes.filter(r => {
    const cliente = clientes.find(c => c.id === r.cliente_id)
    const matchBusqueda = !filtroBusqueda || (
      (cliente?.nombre ?? '').toLowerCase().includes(filtroBusqueda.toLowerCase()) ||
      (cliente?.codigo ?? '').toLowerCase().includes(filtroBusqueda.toLowerCase())
    )
    const matchEstado = filtroEstado === 'todos' || r.estado === filtroEstado
    return matchBusqueda && matchEstado
  }).sort((a, b) => {
    // Mora primero, luego pendiente; dentro de cada grupo por fecha ascendente (más antiguo primero)
    if (a.estado !== b.estado) return a.estado === 'mora' ? -1 : 1
    return new Date(a.fecha).getTime() - new Date(b.fecha).getTime()
  })

  function getTotal(r: Registro) {
    return r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
  }

  function getSaldo(r: Registro) {
    return Math.max(0, getTotal(r) - (r.monto_pagado ?? 0))
  }

  const totalPendiente = registrosFiltrados.reduce((acc, r) => acc + getSaldo(r), 0)
  const countMora = registrosPendientes.filter(r => r.estado === 'mora').length

  function toggleRow(id: string) {
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedRows.size === registrosFiltrados.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(registrosFiltrados.map(r => r.id)))
    }
  }

  async function marcarMora() {
    if (selectedRows.size === 0) return
    const ids = [...selectedRows]
    const { error } = await supabase
      .from('registros')
      .update({ estado: 'mora' })
      .in('id', ids)
    if (!error) {
      ids.forEach(id => onEstadoUpdated(id, 'mora'))
      setSelectedRows(new Set())
      void Swal.fire({ icon: 'success', title: `${ids.length} registro(s) marcados en mora`, timer: 1500, showConfirmButton: false })
    }
  }

  function abrirConvenioGrupal() {
    const seleccionados = registrosFiltrados.filter(r => selectedRows.has(r.id))
    if (seleccionados.length === 0) return
    setConvenioModal(seleccionados)
  }

  async function handleVerificarPago(pagoId: string, aprobar: boolean) {
    setVerificando(pagoId)

    const pago = pagos.find(p => p.id === pagoId)
    if (!pago) {
      setVerificando(null)
      return
    }

    try {
      if (aprobar) {
        // Verify the payment
        const { error } = await supabase
          .from('pagos')
          .update({
            verification_status: 'verificado',
            estado: 'verificado',
            verified_by: currentUser.user_id,
            verified_at: new Date().toISOString(),
          })
          .eq('id', pagoId)

        if (error) throw error

        // Update the registro monto_pagado if needed
        if (pago.registro_id) {
          const registro = registros.find(r => r.id === pago.registro_id)
          if (registro) {
            const nuevoMontoPagado = (registro.monto_pagado ?? 0) + pago.monto
            const total = registro.monto_calculado ?? 0
            const saldo = total - nuevoMontoPagado

            // Update registro state and status
            const { error: updateError } = await supabase
              .from('registros')
              .update({
                monto_pagado: nuevoMontoPagado,
                estado: saldo <= 0 ? 'pagado' : 'pendiente',
              })
              .eq('id', pago.registro_id)

            if (updateError) throw updateError

            if (onRegistroUpdated) {
              onRegistroUpdated(pago.registro_id, {
                monto_pagado: nuevoMontoPagado,
                estado: saldo <= 0 ? 'pagado' : 'pendiente',
              })
            }
          }
        }

        void Swal.fire({
          icon: 'success',
          title: '✅ Pago verificado',
          text: `Pago de ${moneda} ${pago.monto.toFixed(2)} ha sido verificado correctamente`,
          timer: 2000,
          showConfirmButton: false,
        })
      } else {
        // Ask for rejection reason
        const { value: razon } = await Swal.fire({
          icon: 'question',
          title: '❌ Rechazar Pago',
          input: 'textarea',
          inputPlaceholder: 'Motivo del rechazo...',
          inputAttributes: { required: 'true' },
          showCancelButton: true,
          confirmButtonText: 'Rechazar',
          cancelButtonText: 'Cancelar',
        })

        if (razon) {
          const { error } = await supabase
            .from('pagos')
            .update({
              verification_status: 'rechazado',
              estado: 'rechazado',
              verified_by: currentUser.user_id,
              verified_at: new Date().toISOString(),
              verification_notes: razon,
            })
            .eq('id', pagoId)

          if (error) throw error

          void Swal.fire({
            icon: 'success',
            title: '❌ Pago rechazado',
            text: 'El cliente será notificado del rechazo',
            timer: 2000,
            showConfirmButton: false,
          })
        }
      }

      void cargarPagosYConvenios()
    } catch (err: any) {
      void Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || 'No se pudo procesar la verificación',
      })
    } finally {
      setVerificando(null)
    }
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'pendientes', label: 'Cargos Pendientes', icon: '⏳' },
    { id: 'verificaciones', label: 'Verificaciones Pendientes', icon: '✔️' },
    { id: 'historial', label: 'Historial de Pagos', icon: '📋' },
    { id: 'convenios', label: 'Convenios', icon: '🤝' },
  ]

  return (
    <div>
      {/* Header con resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '16px', marginBottom: '28px' }}>
        {[
          { label: 'Total por Cobrar', value: `${moneda} ${totalPendiente.toFixed(2)}`, icon: '💰', bg: 'linear-gradient(135deg,#f59e0b,#d97706)', },
          { label: 'En Mora', value: `${countMora} cobro${countMora !== 1 ? 's' : ''}`, icon: '⚠️', bg: 'linear-gradient(135deg,#ef4444,#dc2626)', },
          { label: 'Pagos Hoy', value: pagos.filter(p => p.created_at?.startsWith(new Date().toISOString().split('T')[0])).length.toString(), icon: '✅', bg: 'linear-gradient(135deg,#10b981,#059669)', },
          { label: 'Convenios Activos', value: convenios.filter(c => c.estado === 'activo').length.toString(), icon: '🤝', bg: 'linear-gradient(135deg,#B96A3F,#9C5733)', },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, borderRadius: '16px', padding: '20px', color: 'white', boxShadow: '0 8px 20px rgba(0,0,0,0.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '12px', opacity: 0.85, fontWeight: 500, marginBottom: '6px' }}>{s.label}</div>
                <div style={{ fontSize: '26px', fontWeight: 700 }}>{s.value}</div>
              </div>
              <div style={{ fontSize: '28px', opacity: 0.8 }}>{s.icon}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #E1DDD0', marginBottom: '24px', overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 20px', fontSize: '14px', fontWeight: activeTab === tab.id ? 700 : 500,
            color: activeTab === tab.id ? '#1B3B36' : '#7E9389',
            background: 'transparent', border: 'none',
            borderBottom: activeTab === tab.id ? '3px solid #1B3B36' : '3px solid transparent',
            cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Cargos Pendientes ── */}
      {activeTab === 'pendientes' && (
        <div>
          {/* Filtros y acciones */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={filtroBusqueda}
              onChange={e => setFiltroBusqueda(e.target.value)}
              style={{ flex: 1, minWidth: '200px', padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #E1DDD0', fontSize: '14px', fontFamily: 'inherit' }}
            />
            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value as any)}
              style={{ padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #E1DDD0', fontSize: '14px', fontFamily: 'inherit', background: 'white' }}
            >
              <option value="todos">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="mora">En mora</option>
            </select>

            {selectedRows.size > 0 && canEdit && (
              <>
                <button onClick={marcarMora} style={{
                  padding: '10px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: '#fee2e2', color: '#dc2626', fontWeight: 600, fontSize: '13px',
                }}>
                  ⚠️ Marcar mora ({selectedRows.size})
                </button>
                <button onClick={abrirConvenioGrupal} style={{
                  padding: '10px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  background: '#F4EBE3', color: '#9C5733', fontWeight: 600, fontSize: '13px',
                }}>
                  🤝 Crear convenio ({selectedRows.size})
                </button>
              </>
            )}
          </div>

          {/* Tabla */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ background: '#FAF7EF', borderBottom: '2px solid #E1DDD0' }}>
                  <tr>
                    {canEdit && (
                      <th scope="col" style={{ padding: '14px 16px', textAlign: 'center', width: '44px' }}>
                        <input type="checkbox" checked={selectedRows.size === registrosFiltrados.length && registrosFiltrados.length > 0}
                          onChange={toggleAll} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                      </th>
                    )}
                    {[
                      { label: 'Cliente', secondary: false },
                      { label: 'Fecha', secondary: true },
                      { label: 'Cargo ('+moneda+')', secondary: false },
                      { label: 'Abonado', secondary: true },
                      { label: 'Saldo', secondary: false },
                      { label: 'Estado', secondary: false },
                      { label: 'Acciones', secondary: false },
                    ].map(({ label: h, secondary }) => (
                      <th scope="col" key={h} className={secondary ? 'table-col-secondary' : undefined} style={{ padding: '14px 16px', textAlign: h === 'Cargo ('+moneda+')' || h === 'Abonado' || h === 'Saldo' ? 'right' : 'left', fontWeight: 700, color: '#3E5A4C', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {registrosFiltrados.length === 0 ? (
                    <tr><td colSpan={canEdit ? 8 : 7} style={{ padding: '40px', textAlign: 'center', color: '#7E9389' }}>
                      No hay cargos pendientes
                    </td></tr>
                  ) : registrosFiltrados.map(r => {
                    const cliente = clientes.find(c => c.id === r.cliente_id)
                    const total = getTotal(r)
                    const abonado = r.monto_pagado ?? 0
                    const saldo = getSaldo(r)
                    const isMora = r.estado === 'mora'
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid #EAE6D8', background: selectedRows.has(r.id) ? '#EEF2EC' : undefined }}
                        onMouseEnter={e => { if (!selectedRows.has(r.id)) (e.currentTarget as HTMLTableRowElement).style.background = '#FAF7EF' }}
                        onMouseLeave={e => { if (!selectedRows.has(r.id)) (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}>
                        {canEdit && (
                          <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                            <input type="checkbox" checked={selectedRows.has(r.id)} onChange={() => toggleRow(r.id)}
                              style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ fontWeight: 600, color: '#15291F' }}>{cliente?.nombre ?? r.cliente_nombre}</div>
                          <div style={{ fontSize: '12px', color: '#7E9389' }}>{cliente?.codigo}</div>
                        </td>
                        <td className="table-col-secondary" style={{ padding: '14px 16px', color: '#3E5A4C', whiteSpace: 'nowrap' }}>
                          {new Date(r.fecha).toLocaleDateString('es-GT')}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: '#15291F' }}>
                          {total.toFixed(2)}
                        </td>
                        <td className="table-col-secondary" style={{ padding: '14px 16px', textAlign: 'right', color: abonado > 0 ? '#10b981' : '#7E9389' }}>
                          {abonado > 0 ? abonado.toFixed(2) : '—'}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: isMora ? '#dc2626' : '#f59e0b', fontSize: '15px' }}>
                          {saldo.toFixed(2)}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                            background: isMora ? '#fee2e2' : '#fef3c7',
                            color: isMora ? '#dc2626' : '#b45309',
                          }}>
                            {isMora ? '⚠ Mora' : '⏳ Pendiente'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          {canEdit && (
                            <button onClick={() => setPagoModal(r)} style={{
                              padding: '8px 14px', minHeight: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                              background: 'linear-gradient(135deg,#1B3B36,#102622)', color: 'white',
                              fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap',
                            }}>
                              💰 Aplicar Pago
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Verificaciones Pendientes ── */}
      {activeTab === 'verificaciones' && (
        <div>
          {(() => {
            const pagosParaVerificar = pagos.filter(p => p.verification_status === 'pendiente')

            if (pagosParaVerificar.length === 0) {
              return (
                <div style={{
                  background: '#FAF7EF',
                  borderRadius: '12px',
                  padding: '48px 24px',
                  textAlign: 'center',
                  border: '1px solid #E1DDD0',
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>✅</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#15291F', marginBottom: '4px' }}>
                    Sin verificaciones pendientes
                  </div>
                  <div style={{ color: '#7E9389', fontSize: '14px' }}>
                    Todos los pagos manuales han sido verificados
                  </div>
                </div>
              )
            }

            return (
              <div style={{ display: 'grid', gap: '12px' }}>
                {pagosParaVerificar.map(pago => {
                  const cliente = clientes.find(c => c.id === pago.cliente_id)
                  const registro = registros.find(r => r.id === pago.registro_id)

                  return (
                    <div
                      key={pago.id}
                      style={{
                        background: 'white',
                        borderRadius: '12px',
                        padding: '16px',
                        border: '2px solid #fbbf24',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: 700, color: '#15291F' }}>
                                {cliente?.nombre ?? 'Cliente desconocido'}
                              </div>
                              <div style={{ fontSize: '12px', color: '#7E9389' }}>
                                Lectura: {registro ? new Date(registro.fecha).toLocaleDateString('es-GT') : 'N/A'}
                              </div>
                            </div>
                            <span style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: '#fef3c7',
                              color: '#b45309',
                            }}>
                              ⏳ Pendiente de verificación
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', fontSize: '13px', marginTop: '12px' }}>
                            <div>
                              <div style={{ color: '#7E9389', marginBottom: '2px' }}>Monto Pagado</div>
                              <div style={{ fontWeight: 700, color: '#15291F' }}>{moneda} {pago.monto.toFixed(2)}</div>
                            </div>
                            <div>
                              <div style={{ color: '#7E9389', marginBottom: '2px' }}>Forma de Pago</div>
                              <div style={{ fontWeight: 700, color: '#15291F' }}>{FORMA_PAGO_LABELS[pago.metodo] ?? pago.metodo}</div>
                            </div>
                            <div>
                              <div style={{ color: '#7E9389', marginBottom: '2px' }}>Comprobante</div>
                              <div style={{ fontWeight: 700, color: pago.numero_documento ? '#15291F' : '#7E9389' }}>
                                {pago.numero_documento ?? 'Sin número'}
                              </div>
                            </div>
                          </div>

                          {pago.comprobante_url && (
                            <div style={{ marginTop: '12px' }}>
                              <ComprobanteLink src={pago.comprobante_url} tipo={pago.comprobante_tipo} />
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '160px' }}>
                          <button
                            onClick={() => void handleVerificarPago(pago.id, true)}
                            disabled={verificando === pago.id}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: 'none',
                              background: verificando === pago.id ? '#C7C2B0' : '#10b981',
                              color: 'white',
                              fontWeight: 700,
                              fontSize: '13px',
                              cursor: verificando === pago.id ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {verificando === pago.id ? '⏳...' : '✅ Verificar'}
                          </button>
                          <button
                            onClick={() => void handleVerificarPago(pago.id, false)}
                            disabled={verificando === pago.id}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: '1.5px solid #ef4444',
                              background: 'white',
                              color: '#ef4444',
                              fontWeight: 700,
                              fontSize: '13px',
                              cursor: verificando === pago.id ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                              opacity: verificando === pago.id ? 0.5 : 1,
                            }}
                          >
                            ❌ Rechazar
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── TAB: Historial de Pagos ── */}
      {activeTab === 'historial' && (
        <PagosHistorial
          pagos={pagos}
          clientes={clientes}
          registros={registros}
          moneda={moneda}
          loading={loadingPagos}
          formasPagoLabels={FORMA_PAGO_LABELS}
        />
      )}

      {/* ── TAB: Convenios ── */}
      {activeTab === 'convenios' && (
        <ConveniosLista
          convenios={convenios}
          clientes={clientes}
          moneda={moneda}
          canEdit={canEdit}
          onRefresh={cargarPagosYConvenios}
        />
      )}

      {/* Modal aplicar pago */}
      {pagoModal && (
        <PagoModal
          registro={pagoModal}
          cliente={clientes.find(c => c.id === pagoModal.cliente_id)}
          moneda={moneda}
          currentUserId={currentUser.user_id}
          formasPagoLabels={FORMA_PAGO_LABELS}
          onClose={() => setPagoModal(null)}
          onSuccess={(registroId, nuevoEstado, montoPagado) => {
            onEstadoUpdated(registroId, nuevoEstado)
            if (onRegistroUpdated) onRegistroUpdated(registroId, { monto_pagado: montoPagado })
            setPagoModal(null)
            void cargarPagosYConvenios()
          }}
        />
      )}

      {/* Modal convenio grupal */}
      {convenioModal && (
        <ConvenioModal
          registros={convenioModal}
          clientes={clientes}
          moneda={moneda}
          currentUserId={currentUser.user_id}
          onClose={() => setConvenioModal(null)}
          onSuccess={() => {
            setConvenioModal(null)
            setSelectedRows(new Set())
            void cargarPagosYConvenios()
          }}
        />
      )}
    </div>
  )
}

/* ── Listado de Convenios (inline) ── */
interface ConveniosListaProps {
  convenios: ConvenioPago[]
  clientes: Cliente[]
  moneda: string
  canEdit: boolean
  onRefresh: () => void
}

function ConveniosLista({ convenios, clientes, moneda, canEdit, onRefresh }: ConveniosListaProps) {
  const ESTADO_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
    activo:     { label: 'Activo',      bg: '#dcfce7', color: '#15803d' },
    completado: { label: 'Completado',  bg: '#D9E2DC', color: '#102622' },
    incumplido: { label: 'Incumplido',  bg: '#fee2e2', color: '#dc2626' },
    cancelado:  { label: 'Cancelado',   bg: '#EAE6D8', color: '#7E9389' },
  }

  async function cambiarEstado(id: string, estado: string) {
    const { error } = await supabase.from('convenios_pago').update({ estado }).eq('id', id)
    if (!error) {
      onRefresh()
      void Swal.fire({ icon: 'success', title: 'Estado actualizado', timer: 1200, showConfirmButton: false })
    }
  }

  if (convenios.length === 0) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#7E9389', background: 'white', borderRadius: '12px' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>🤝</div>
        <div style={{ fontWeight: 600 }}>No hay convenios registrados</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {convenios.map(conv => {
        const cliente = clientes.find(c => c.id === conv.cliente_id)
        const pct = conv.monto_total > 0 ? (conv.monto_pagado / conv.monto_total) * 100 : 0
        const est = ESTADO_CONFIG[conv.estado] ?? ESTADO_CONFIG.activo
        return (
          <div key={conv.id} style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #E1DDD0', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '16px', color: '#15291F', marginBottom: '4px' }}>
                  {cliente?.nombre ?? '—'}
                  <span style={{ marginLeft: '8px', fontSize: '12px', color: '#7E9389', fontWeight: 400 }}>
                    Convenio #{conv.numero_convenio}
                  </span>
                </div>
                {conv.descripcion && <div style={{ fontSize: '13px', color: '#7E9389', marginBottom: '8px' }}>{conv.descripcion}</div>}
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '13px', color: '#3E5A4C' }}>
                  <span>📅 Inicio: <strong>{new Date(conv.fecha_inicio + 'T12:00:00').toLocaleDateString('es-GT')}</strong></span>
                  {conv.fecha_vencimiento && <span>⏰ Vence: <strong>{new Date(conv.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es-GT')}</strong></span>}
                  {conv.cuotas_pactadas && <span>📋 Cuotas: <strong>{conv.cuotas_pactadas}</strong></span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: est.bg, color: est.color }}>
                  {est.label}
                </span>
                {canEdit && conv.estado === 'activo' && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'flex-end' }}>
                    <button onClick={() => cambiarEstado(conv.id, 'completado')} style={{ padding: '5px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: '#D9E2DC', color: '#102622', fontSize: '12px', fontWeight: 600 }}>
                      ✓ Completar
                    </button>
                    <button onClick={() => cambiarEstado(conv.id, 'incumplido')} style={{ padding: '5px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: '#fee2e2', color: '#dc2626', fontSize: '12px', fontWeight: 600 }}>
                      ✗ Incumplido
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Barra de progreso */}
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: '#7E9389' }}>Pagado: <strong style={{ color: '#10b981' }}>{moneda} {conv.monto_pagado.toFixed(2)}</strong></span>
                <span style={{ color: '#7E9389' }}>Total: <strong style={{ color: '#15291F' }}>{moneda} {conv.monto_total.toFixed(2)}</strong></span>
              </div>
              <div style={{ height: '8px', background: '#E1DDD0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: pct >= 100 ? '#10b981' : '#1B3B36', borderRadius: '4px', transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '12px', color: '#7E9389', marginTop: '4px', textAlign: 'right' }}>{pct.toFixed(1)}% completado</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
