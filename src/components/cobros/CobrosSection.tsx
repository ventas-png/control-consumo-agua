import { useState, useEffect, useCallback, useMemo } from 'react'
import { notify, confirm } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { supabase } from '../../lib/supabase'
import type { Registro, Cliente, Pago, ConvenioPago, FormaPago } from '../../types'
import { useSession } from '../shared/SessionContext'
import { calcularTotalPagar, puedeTransicionarFactura } from '../../lib/business'
import { useSignedUrl } from '../../lib/storageUrls'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import { SelectionToolbar, type BulkAction } from '../shared/SelectionToolbar'
import { PagoModal } from './PagoModal'
import { ConvenioModal } from './ConvenioModal'
import { PagosHistorial } from './PagosHistorial'
import { useQueryClient } from '@tanstack/react-query'
import { FacturaEstadoBadge } from './facturaUi'
import { TimbradoEstadoBadge } from './fiscalUi'
import { useFacturasQuery, useReglasMoraQuery, type FacturaRow } from '../../domain/facturacion/queries'
import { facturacionKeys } from '../../domain/facturacion/keys'
import {
  useEmitirFacturaMutation,
  useAnularFacturaMutation,
  useIvaTasaDefaultQuery,
} from '../../domain/facturacion/mutations'
import { useDocumentosFiscalesQuery } from '../../domain/fiscal/queries'
import { useTimbrarDocumentoMutation, puedeDispararTimbrado } from '../../domain/fiscal/mutations'
import { normalizarEstadoFactura } from '../../lib/business'
import type { DocumentoFiscal } from '../../types/fiscal'

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
        color: 'var(--at-primary)',
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
  moneda?: string
  onEstadoUpdated: (id: string, estado: Registro['estado']) => void
  onRegistroUpdated?: (id: string, partial: Partial<Registro>) => void
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

export function CobrosSection({ registros, clientes, moneda = 'Q', onEstadoUpdated, onRegistroUpdated }: Props) {
  const currentUser = useSession()
  const [activeTab, setActiveTab] = useState<Tab>('pendientes')
  const [filtroBusqueda, setFiltroBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'mora'>('todos')
  const [pagoModal, setPagoModal] = useState<Registro | null>(null)
  const [convenioModal, setConvenioModal] = useState<Registro[] | null>(null)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [convenios, setConvenios] = useState<ConvenioPago[]>([])
  const [loadingPagos, setLoadingPagos] = useState(false)
  const [verificando, setVerificando] = useState<string | null>(null)

  const canEdit = currentUser.role !== 'viewer'
  const companyId = currentUser.company_id
  const qc = useQueryClient()

  // T4 · agua:C4 — proyección de Factura (estado/IVA/mora) sobre `registros`. La
  // tabla recibe `Registro[]` por props (sin campos de facturación); aquí leemos
  // esos campos vía la capa de datos T4 y los cruzamos por id. Las reglas de mora
  // del tenant dan los días de vencimiento al emitir.
  const { data: facturas = [] } = useFacturasQuery(companyId)
  const { data: reglasMora = [] } = useReglasMoraQuery(companyId)
  // Tasa de IVA del tenant (companies.iva_tasa_default) para el snapshot al emitir.
  const { data: ivaTasaDefault } = useIvaTasaDefaultQuery(companyId)
  const facturaById = useMemo(() => {
    const m = new Map<string, FacturaRow>()
    for (const f of facturas) m.set(f.id, f)
    return m
  }, [facturas])

  const emitirMut = useEmitirFacturaMutation(companyId)
  const anularMut = useAnularFacturaMutation(companyId)
  const [accionFacturaId, setAccionFacturaId] = useState<string | null>(null)

  // serv:S11 · estatus de timbrado. Documentos fiscales del tenant indexados por
  // registro_id; como la query ordena por created_at desc, el PRIMERO que veamos
  // de cada registro es el ÚLTIMO comprobante (el que manda para el badge/gate).
  const { data: documentosFiscales = [] } = useDocumentosFiscalesQuery(companyId)
  const docFiscalByRegistro = useMemo(() => {
    const m = new Map<string, DocumentoFiscal>()
    for (const d of documentosFiscales) {
      if (d.registro_id && !m.has(d.registro_id)) m.set(d.registro_id, d)
    }
    return m
  }, [documentosFiscales])
  const timbrarMut = useTimbrarDocumentoMutation(companyId)
  const [timbrandoId, setTimbrandoId] = useState<string | null>(null)

  async function handleTimbrar(r: Registro) {
    const doc = docFiscalByRegistro.get(r.id)
    setTimbrandoId(r.id)
    try {
      const res = await timbrarMut.mutateAsync({
        registroId: r.id,
        estadoUltimoDoc: doc?.estado ?? null,
      })
      notify({
        variant: 'success',
        title: '🧾 Comprobante timbrado',
        text: res.uuid_fiscal
          ? `UUID: ${res.uuid_fiscal}`
          : res.numero
            ? `No. ${[res.serie, res.numero].filter(Boolean).join('-')}`
            : 'Timbrado correctamente (sandbox)',
        duration: 2400,
      })
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo timbrar', text: (err as Error).message })
    } finally {
      setTimbrandoId(null)
    }
  }

  // Días de vencimiento por defecto: de la regla de mora del proyecto si existe,
  // si no 30. (El cálculo de mora en sí lo hace el cron con la misma regla.)
  const diasVencimientoPara = useCallback(
    (projectId?: string | null) => {
      const regla =
        reglasMora.find(r => r.project_id === projectId) ?? reglasMora[0]
      return regla?.dias_vencimiento ?? 30
    },
    [reglasMora],
  )

  async function handleEmitir(r: Registro) {
    const factura = facturaById.get(r.id)
    setAccionFacturaId(r.id)
    try {
      await emitirMut.mutateAsync({
        factura: {
          id: r.id,
          factura_estado: factura?.factura_estado ?? r.estado,
          monto_calculado: factura?.monto_calculado ?? r.monto_calculado,
          mora_monto: factura?.mora_monto,
        },
        // Snapshot ya persistido > tasa del tenant > default GT (en business.ts).
        ivaTasa: factura?.iva_tasa ?? ivaTasaDefault,
        diasVencimiento: diasVencimientoPara(r.project_id),
      })
      notify({ variant: 'success', title: '📤 Factura emitida', duration: 1800 })
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo emitir', text: (err as Error).message })
    } finally {
      setAccionFacturaId(null)
    }
  }

  async function handleAnular(r: Registro) {
    const { isConfirmed } = await confirm({
      title: '¿Anular factura?',
      text: 'La factura quedará anulada (estado terminal). Esta acción no se puede revertir.',
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, anular',
    })
    if (!isConfirmed) return
    const factura = facturaById.get(r.id)
    setAccionFacturaId(r.id)
    try {
      await anularMut.mutateAsync({
        factura: { id: r.id, factura_estado: factura?.factura_estado ?? r.estado },
      })
      notify({ variant: 'success', title: '🚫 Factura anulada', duration: 1800 })
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo anular', text: (err as Error).message })
    } finally {
      setAccionFacturaId(null)
    }
  }

  const cargarPagosYConvenios = useCallback(async () => {
    setLoadingPagos(true)
    const [pagosRes, conveniosRes] = await Promise.all([
      supabase
        .from('pagos')
        .select('*')
        .is('deleted_at', null)
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

  const bulk = useBulkSelection(registrosFiltrados, r => r.id)

  const saldoSeleccionado = useMemo(
    () => bulk.selectedItems.reduce((acc, r) => acc + getSaldo(r), 0),
    [bulk.selectedItems],
  )

  async function marcarMora() {
    if (!bulk.hasSelection) return
    const ids = bulk.selectedItems.map(r => r.id)
    const { error } = await supabase
      .from('registros')
      .update({ estado: 'mora' })
      .in('id', ids)
    if (!error) {
      ids.forEach(id => onEstadoUpdated(id, 'mora'))
      bulk.clear()
      notify({ variant: 'success', title: `${ids.length} registro(s) marcados en mora`, duration: 1500 })
    }
  }

  function abrirConvenioGrupal() {
    if (!bulk.hasSelection) return
    setConvenioModal(bulk.selectedItems)
  }

  const bulkActions: BulkAction[] = useMemo(() => [
    {
      id: 'marcar-mora',
      label: 'Marcar mora',
      icon: '⚠️',
      variant: 'danger',
      onClick: marcarMora,
    },
    {
      id: 'crear-convenio',
      label: 'Crear convenio',
      icon: '🤝',
      variant: 'primary',
      onClick: abrirConvenioGrupal,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [bulk.selectedItems])

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

        notify({
          variant: 'success',
          title: '✅ Pago verificado',
          text: `Pago de ${moneda} ${pago.monto.toFixed(2)} ha sido verificado correctamente`,
          duration: 2000,
        })
      } else {
        // Ask for rejection reason
        const promptResult = await openPromptDialog({
          title: '❌ Rechazar Pago',
          fields: [{
            name: 'razon',
            label: 'Motivo del rechazo',
            control: 'textarea',
            rows: 4,
            placeholder: 'Motivo del rechazo...',
            required: true,
            autoFocus: true,
          }],
          submitText: 'Rechazar',
        })
        const razon = promptResult?.razon

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

          notify({
            variant: 'success',
            title: '❌ Pago rechazado',
            text: 'El cliente será notificado del rechazo',
            duration: 2000,
          })
        }
      }

      void cargarPagosYConvenios()
    } catch (err: any) {
      notify({
        variant: 'error',
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
          { label: 'Total por Cobrar', value: `${moneda} ${totalPendiente.toFixed(2)}`, icon: '💰', bg: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', },
          { label: 'En Mora', value: `${countMora} cobro${countMora !== 1 ? 's' : ''}`, icon: '⚠️', bg: 'linear-gradient(135deg,var(--at-danger),var(--at-danger))', },
          { label: 'Pagos Hoy', value: pagos.filter(p => p.created_at?.startsWith(new Date().toISOString().split('T')[0])).length.toString(), icon: '✅', bg: 'linear-gradient(135deg,var(--at-success),var(--at-success-strong))', },
          { label: 'Convenios Activos', value: convenios.filter(c => c.estado === 'activo').length.toString(), icon: '🤝', bg: 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))', },
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
      <div className="tab-strip-scrollable" style={{ display: 'flex', gap: '8px', borderBottom: '2px solid var(--at-line)', marginBottom: '24px', overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '10px 20px', fontSize: '14px', fontWeight: activeTab === tab.id ? 700 : 500,
            color: activeTab === tab.id ? 'var(--at-primary)' : 'var(--at-ink-3)',
            background: 'transparent', border: 'none',
            borderBottom: activeTab === tab.id ? '3px solid var(--at-primary)' : '3px solid transparent',
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
              style={{ flex: 1, minWidth: '200px', padding: '10px 14px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit' }}
            />
            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value as any)}
              style={{ padding: '10px 14px', borderRadius: '8px', border: '1.5px solid var(--at-line)', fontSize: '14px', fontFamily: 'inherit', background: 'var(--at-surface)' }}
            >
              <option value="todos">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="mora">En mora</option>
            </select>

          </div>

          {/* Bulk actions toolbar (sticky) */}
          {canEdit && (
            <SelectionToolbar
              count={bulk.count}
              actions={bulkActions}
              onClear={bulk.clear}
              entityLabel={{ one: 'cargo', many: 'cargos' }}
              leftSlot={
                <>
                  Saldo seleccionado:{' '}
                  <strong style={{ color: 'var(--at-ink)' }}>
                    {moneda} {saldoSeleccionado.toFixed(2)}
                  </strong>
                </>
              }
            />
          )}

          {/* Tabla */}
          <div style={{ background: 'var(--at-surface)', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
            <div className="table-scroll-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead style={{ background: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
                  <tr>
                    {canEdit && (
                      <th scope="col" style={{ padding: '14px 16px', textAlign: 'center', width: '44px' }}>
                        <input
                          type="checkbox"
                          aria-label={bulk.isAllSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                          checked={bulk.isAllSelected}
                          onChange={bulk.toggleAll}
                          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                        />
                      </th>
                    )}
                    {[
                      { label: 'Cliente', secondary: false },
                      { label: 'Fecha', secondary: true },
                      { label: 'Cargo ('+moneda+')', secondary: false },
                      { label: 'Abonado', secondary: true },
                      { label: 'Saldo', secondary: false },
                      { label: 'Estado', secondary: false },
                      { label: 'Factura', secondary: true },
                      { label: 'Acciones', secondary: false },
                    ].map(({ label: h, secondary }) => (
                      <th scope="col" key={h} className={secondary ? 'table-col-secondary' : undefined} style={{ padding: '14px 16px', textAlign: h === 'Cargo ('+moneda+')' || h === 'Abonado' || h === 'Saldo' ? 'right' : 'left', fontWeight: 700, color: 'var(--at-ink-2)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {registrosFiltrados.length === 0 ? (
                    <tr><td colSpan={canEdit ? 9 : 8} style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>
                      No hay cargos pendientes
                    </td></tr>
                  ) : registrosFiltrados.map(r => {
                    const cliente = clientes.find(c => c.id === r.cliente_id)
                    const total = getTotal(r)
                    const abonado = r.monto_pagado ?? 0
                    const saldo = getSaldo(r)
                    const isMora = r.estado === 'mora'
                    // Estado de Factura (T4): de la proyección si existe, si no el legacy.
                    const estadoFactura = facturaById.get(r.id)?.factura_estado ?? r.estado
                    const puedeEmitir = puedeTransicionarFactura(estadoFactura, 'emitir').ok
                    const puedeAnular = puedeTransicionarFactura(estadoFactura, 'anular').ok
                    const puedePagar = puedeTransicionarFactura(estadoFactura, 'pagar').ok
                    const procesando = accionFacturaId === r.id
                    // serv:S11 — estatus de timbrado del comprobante de esta factura.
                    const docFiscal = docFiscalByRegistro.get(r.id)
                    // Timbrar tiene sentido sobre una factura YA emitida (emitida/
                    // vencida/pagada), y solo si el último comprobante lo permite
                    // (sin documento o rechazado → reintento). El gate real lo
                    // revalida el edge.
                    const facturaEmitida = ['emitida', 'vencida', 'pagada'].includes(
                      normalizarEstadoFactura(estadoFactura),
                    )
                    const puedeTimbrarFactura =
                      facturaEmitida && puedeDispararTimbrado(docFiscal?.estado)
                    const timbrando = timbrandoId === r.id
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--at-chip)', background: bulk.isSelected(r.id) ? 'var(--at-primary-tint)' : undefined }}
                        onMouseEnter={e => { if (!bulk.isSelected(r.id)) (e.currentTarget as HTMLTableRowElement).style.background = 'var(--at-surface-2)' }}
                        onMouseLeave={e => { if (!bulk.isSelected(r.id)) (e.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}>
                        {canEdit && (
                          <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar fila ${cliente?.nombre ?? r.cliente_nombre ?? r.id}`}
                              checked={bulk.isSelected(r.id)}
                              onChange={() => bulk.toggle(r.id)}
                              style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                            />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{cliente?.nombre ?? r.cliente_nombre}</div>
                          <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{cliente?.codigo}</div>
                        </td>
                        <td className="table-col-secondary" style={{ padding: '14px 16px', color: 'var(--at-ink-2)', whiteSpace: 'nowrap' }}>
                          {new Date(r.fecha).toLocaleDateString('es-GT')}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--at-ink)' }}>
                          {total.toFixed(2)}
                        </td>
                        <td className="table-col-secondary" style={{ padding: '14px 16px', textAlign: 'right', color: abonado > 0 ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                          {abonado > 0 ? abonado.toFixed(2) : '—'}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: isMora ? 'var(--at-danger)' : 'var(--at-warning)', fontSize: '15px' }}>
                          {saldo.toFixed(2)}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                            background: isMora ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)',
                            color: isMora ? 'var(--at-danger)' : 'var(--at-warning-strong)',
                          }}>
                            {isMora ? '⚠ Mora' : '⏳ Pendiente'}
                          </span>
                        </td>
                        <td className="table-col-secondary" style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <FacturaEstadoBadge estado={estadoFactura} />
                            {/* serv:S11 — estatus de timbrado (solo si ya hay comprobante). */}
                            <TimbradoEstadoBadge estado={docFiscal?.estado} />
                          </div>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          {canEdit && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                              {/* Emitir: solo cuando la factura está pendiente. */}
                              {puedeEmitir && (
                                <button onClick={() => void handleEmitir(r)} disabled={procesando} title="Emitir factura (fija vencimiento e IVA)" style={{
                                  padding: '8px 12px', minHeight: '36px', borderRadius: '8px', border: '1.5px solid var(--at-primary)', cursor: procesando ? 'not-allowed' : 'pointer',
                                  background: 'var(--at-surface)', color: 'var(--at-primary-hover)', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', opacity: procesando ? 0.6 : 1,
                                }}>
                                  📤 Emitir
                                </button>
                              )}
                              {/* Registrar pago: abre el modal de pago (gated por puedePagar
                                  para facturas emitidas; los registros legacy sin emitir
                                  siguen siendo cobrables por el flujo existente). */}
                              {(puedePagar || !puedeEmitir) && (
                                <button onClick={() => setPagoModal(r)} style={{
                                  padding: '8px 14px', minHeight: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                  background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white',
                                  fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap',
                                }}>
                                  💰 Aplicar Pago
                                </button>
                              )}
                              {/* Anular: pendiente|emitida|vencida → anulada (terminal). */}
                              {puedeAnular && (
                                <button onClick={() => void handleAnular(r)} disabled={procesando} title="Anular factura" style={{
                                  padding: '8px 12px', minHeight: '36px', borderRadius: '8px', border: '1.5px solid var(--at-danger)', cursor: procesando ? 'not-allowed' : 'pointer',
                                  background: 'var(--at-surface)', color: 'var(--at-danger)', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', opacity: procesando ? 0.6 : 1,
                                }}>
                                  🚫 Anular
                                </button>
                              )}
                              {/* serv:S11 — Timbrar (FEL/CFDI): gated a facturas emitidas
                                  cuyo último comprobante no esté ya timbrado/en vuelo.
                                  Corre contra el Sandbox vía el edge timbrar-documento. */}
                              {puedeTimbrarFactura && (
                                <button onClick={() => void handleTimbrar(r)} disabled={timbrando}
                                  title={docFiscal?.estado === 'rechazado' ? 'Reintentar timbrado (sandbox)' : 'Timbrar comprobante fiscal (sandbox)'} style={{
                                  padding: '8px 12px', minHeight: '36px', borderRadius: '8px', border: '1.5px solid var(--at-success-strong)', cursor: timbrando ? 'not-allowed' : 'pointer',
                                  background: 'var(--at-surface)', color: 'var(--at-success-strong)', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', opacity: timbrando ? 0.6 : 1,
                                }}>
                                  {timbrando ? '⏳ Timbrando…' : docFiscal?.estado === 'rechazado' ? '🔁 Reintentar' : '🧾 Timbrar'}
                                </button>
                              )}
                            </div>
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
                  background: 'var(--at-surface-2)',
                  borderRadius: '12px',
                  padding: '48px 24px',
                  textAlign: 'center',
                  border: '1px solid var(--at-line)',
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>✅</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '4px' }}>
                    Sin verificaciones pendientes
                  </div>
                  <div style={{ color: 'var(--at-ink-3)', fontSize: '14px' }}>
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
                        background: 'var(--at-surface)',
                        borderRadius: '12px',
                        padding: '16px',
                        border: '2px solid var(--at-warning)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'start' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>
                                {cliente?.nombre ?? 'Cliente desconocido'}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                                Lectura: {registro ? new Date(registro.fecha).toLocaleDateString('es-GT') : 'N/A'}
                              </div>
                            </div>
                            <span style={{
                              padding: '4px 12px',
                              borderRadius: '20px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: 'var(--at-warning-tint)',
                              color: 'var(--at-warning-strong)',
                            }}>
                              ⏳ Pendiente de verificación
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', fontSize: '13px', marginTop: '12px' }}>
                            <div>
                              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Monto Pagado</div>
                              <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {pago.monto.toFixed(2)}</div>
                            </div>
                            <div>
                              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Forma de Pago</div>
                              <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{FORMA_PAGO_LABELS[pago.metodo] ?? pago.metodo}</div>
                            </div>
                            <div>
                              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Comprobante</div>
                              <div style={{ fontWeight: 700, color: pago.numero_documento ? 'var(--at-ink)' : 'var(--at-ink-3)' }}>
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
                              background: verificando === pago.id ? 'var(--at-line-strong)' : 'var(--at-success)',
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
                              border: '1.5px solid var(--at-danger)',
                              background: 'var(--at-surface)',
                              color: 'var(--at-danger)',
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
          factura={facturaById.get(pagoModal.id)}
          documentoFiscal={docFiscalByRegistro.get(pagoModal.id) ?? null}
          onClose={() => setPagoModal(null)}
          onSuccess={(registroId, nuevoEstado, montoPagado) => {
            onEstadoUpdated(registroId, nuevoEstado)
            if (onRegistroUpdated) onRegistroUpdated(registroId, { monto_pagado: montoPagado })
            // Refresca la proyección de Factura (estado/abonado) tras el pago.
            void qc.invalidateQueries({ queryKey: facturacionKeys.facturas(companyId) })
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
            bulk.clear()
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
    activo:     { label: 'Activo',      bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
    completado: { label: 'Completado',  bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
    incumplido: { label: 'Incumplido',  bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
    cancelado:  { label: 'Cancelado',   bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
  }

  async function cambiarEstado(id: string, estado: string) {
    const { error } = await supabase.from('convenios_pago').update({ estado }).eq('id', id)
    if (!error) {
      onRefresh()
      notify({ variant: 'success', title: 'Estado actualizado', duration: 1200 })
    }
  }

  if (convenios.length === 0) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: 'var(--at-ink-3)', background: 'var(--at-surface)', borderRadius: '12px' }}>
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
          <div key={conv.id} style={{ background: 'var(--at-surface)', borderRadius: '12px', padding: '20px', border: '1px solid var(--at-line)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-ink)', marginBottom: '4px' }}>
                  {cliente?.nombre ?? '—'}
                  <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 400 }}>
                    Convenio #{conv.numero_convenio}
                  </span>
                </div>
                {conv.descripcion && <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginBottom: '8px' }}>{conv.descripcion}</div>}
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--at-ink-2)' }}>
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
                    <button onClick={() => cambiarEstado(conv.id, 'completado')} style={{ padding: '5px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', fontSize: '12px', fontWeight: 600 }}>
                      ✓ Completar
                    </button>
                    <button onClick={() => cambiarEstado(conv.id, 'incumplido')} style={{ padding: '5px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontSize: '12px', fontWeight: 600 }}>
                      ✗ Incumplido
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Barra de progreso */}
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                <span style={{ color: 'var(--at-ink-3)' }}>Pagado: <strong style={{ color: 'var(--at-success)' }}>{moneda} {conv.monto_pagado.toFixed(2)}</strong></span>
                <span style={{ color: 'var(--at-ink-3)' }}>Total: <strong style={{ color: 'var(--at-ink)' }}>{moneda} {conv.monto_total.toFixed(2)}</strong></span>
              </div>
              <div style={{ height: '8px', background: 'var(--at-line)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: pct >= 100 ? 'var(--at-success)' : 'var(--at-primary)', borderRadius: '4px', transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '4px', textAlign: 'right' }}>{pct.toFixed(1)}% completado</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
