import { useState, useEffect, useCallback, useMemo } from 'react'
import { notify, confirm } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { configurarCierreAutomatico } from '../shared/cierreAutomaticoDialog'
import { fetchPagosYConvenios } from '../../domain/cobros/queries'
import { verifyPago, rejectPago, setConvenioEstado } from '../../domain/cobros/mutations'
import { updateRegistro, marcarRegistrosMora } from '../../domain/agua/mutations'
import type { Registro, Cliente, Pago, ConvenioPago, FormaPago, Proyecto } from '../../types'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
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
  particionarEmitibles,
  cerrarCicloAgua,
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
  /** Proyectos del tenant — para el selector del cierre de ciclo por período. */
  proyectos?: Proyecto[]
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

export function CobrosSection({ registros, clientes, moneda = 'Q', proyectos = [], onEstadoUpdated, onRegistroUpdated }: Props) {
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
  // RBAC por acción: verificar/rechazar pagos es un flujo de aprobación
  // (agua.cobros.approve), separado del edit/change_status genérico.
  const canApprove = usePermissionsContext().canApprove('cobros')
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
  const [emitiendoLote, setEmitiendoLote] = useState(false)
  const [cerrandoCiclo, setCerrandoCiclo] = useState(false)

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
    const { pagos, convenios } = await fetchPagosYConvenios()
    setPagos(pagos)
    setConvenios(convenios)
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
    const { error } = await marcarRegistrosMora(ids)
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

  // Facturación masiva "por ciclo": emite en lote las facturas seleccionadas que
  // están pendientes de emisión (fija vencimiento + snapshot de IVA por fila,
  // reusando la mutación de emisión ya testeada). El operador acota el ciclo con
  // los filtros (búsqueda/estado) + selección; las no-emitibles se omiten.
  async function emitirLoteSeleccion() {
    if (!bulk.hasSelection || emitiendoLote) return
    const conEstado = bulk.selectedItems.map(r => ({
      r,
      factura_estado: facturaById.get(r.id)?.factura_estado ?? r.estado,
    }))
    const { emitibles, omitidas } = particionarEmitibles(conEstado)
    if (emitibles.length === 0) {
      notify({ variant: 'warning', title: 'Nada para emitir', text: 'Ninguna de las facturas seleccionadas está pendiente de emisión.' })
      return
    }
    const { isConfirmed } = await confirm({
      title: `¿Emitir ${emitibles.length} factura(s)?`,
      text: `Se fijará el vencimiento y el IVA de ${emitibles.length} factura(s).${omitidas.length ? ` ${omitidas.length} seleccionada(s) se omiten (ya emitidas o en estado terminal).` : ''}`,
      icon: 'question',
      confirmText: 'Sí, emitir',
    })
    if (!isConfirmed) return

    setEmitiendoLote(true)
    let ok = 0
    const fallidas: string[] = []
    // Secuencial: reusa la mutación por fila (validación server-side + snapshot)
    // sin saturar la BD; la última invalidación refresca la tabla.
    for (const { r, factura_estado } of emitibles) {
      const factura = facturaById.get(r.id)
      try {
        await emitirMut.mutateAsync({
          factura: {
            id: r.id,
            factura_estado,
            monto_calculado: factura?.monto_calculado ?? r.monto_calculado,
            mora_monto: factura?.mora_monto,
          },
          ivaTasa: factura?.iva_tasa ?? ivaTasaDefault,
          diasVencimiento: diasVencimientoPara(r.project_id),
        })
        ok++
      } catch {
        fallidas.push(r.cliente_nombre ?? r.id)
      }
    }
    setEmitiendoLote(false)
    bulk.clear()
    notify({
      variant: fallidas.length ? 'warning' : 'success',
      title: `📤 ${ok} factura(s) emitida(s)`,
      text: fallidas.length
        ? `${fallidas.length} no se pudieron emitir: ${fallidas.slice(0, 3).join(', ')}${fallidas.length > 3 ? '…' : ''}`
        : 'Ciclo de facturación emitido correctamente.',
      duration: 2600,
    })
  }

  // Cierre de ciclo POR PERÍODO (espejo de condominios_cerrar_ciclo): emite en un
  // solo RPC staff-gated TODOS los recibos pendientes de un proyecto+mes y avisa a
  // cada cliente (campana + email). Complementa el lote por selección de arriba —
  // aquí el operador no selecciona filas, elige proyecto y período.
  async function cerrarCicloPeriodo() {
    if (cerrandoCiclo) return
    const opciones = (proyectos ?? []).map(p => ({ value: p.id, label: p.nombre }))
    if (opciones.length === 0) {
      notify({ variant: 'info', title: 'Sin proyectos', text: 'No hay proyectos para cerrar el ciclo de agua.' })
      return
    }
    const datos = await openPromptDialog({
      title: '📤 Emitir período (cerrar ciclo de agua)',
      description: 'Emite todos los recibos de agua pendientes del proyecto y período elegidos, y avisa a cada cliente (campana + email si tiene correo).',
      fields: [
        { name: 'project_id', label: 'Proyecto', control: 'select', required: true, autoFocus: true, options: opciones },
        { name: 'periodo', label: 'Período (YYYY-MM)', type: 'month', required: true, initialValue: new Date().toISOString().slice(0, 7) },
      ],
      submitText: 'Continuar',
    })
    const projectId = datos?.project_id
    const periodo = datos?.periodo
    if (!projectId || !periodo) return
    // Conteo local orientativo (el server es la verdad): registros del proyecto en
    // ese mes cuya Factura admite 'emitir' — mismo predicado que el RPC.
    const candidatas = facturas.filter(f =>
      f.project_id === projectId &&
      f.fecha.slice(0, 7) === periodo &&
      puedeTransicionarFactura(f.factura_estado ?? f.estado, 'emitir').ok,
    )
    if (candidatas.length === 0) {
      notify({ variant: 'info', title: 'Sin recibos por emitir', text: `No hay recibos de agua pendientes de emisión en ${periodo}.` })
      return
    }
    const { isConfirmed } = await confirm({
      title: `¿Emitir ${candidatas.length} recibo${candidatas.length > 1 ? 's' : ''} de ${periodo}?`,
      text: 'Se fijará el vencimiento y el IVA de cada recibo y se avisará a los clientes (campana + email).',
      icon: 'question',
      confirmText: '📤 Emitir período',
    })
    if (!isConfirmed) return
    setCerrandoCiclo(true)
    const { data, error } = await cerrarCicloAgua(projectId, periodo)
    setCerrandoCiclo(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo cerrar el ciclo', text: error.message }); return }
    const n = data?.emitidas ?? 0
    notify({
      variant: 'success',
      title: `📤 ${n} recibo${n !== 1 ? 's' : ''} emitido${n !== 1 ? 's' : ''}`,
      text: `Avisos: ${data?.avisos ?? 0} en la campana, ${data?.emails ?? 0} por email.`,
      duration: 2600,
    })
    void qc.invalidateQueries({ queryKey: facturacionKeys.all })
  }

  // F3: programación del cierre automático (cron server-side). Si hay más de un
  // proyecto, se elige primero cuál configurar; el diálogo compartido hace el resto.
  async function configurarCierreAutomaticoAgua() {
    if (!companyId) return
    const opciones = (proyectos ?? []).map(p => ({ value: p.id, label: p.nombre }))
    if (opciones.length === 0) {
      notify({ variant: 'info', title: 'Sin proyectos', text: 'No hay proyectos para programar el cierre de agua.' })
      return
    }
    let seleccion = opciones[0]
    if (opciones.length > 1) {
      const datos = await openPromptDialog({
        title: '🗓️ Cierre de ciclo automático',
        description: 'Elige el proyecto cuya programación quieres ver o editar.',
        fields: [
          { name: 'project_id', label: 'Proyecto', control: 'select', required: true, autoFocus: true, options: opciones },
        ],
        submitText: 'Continuar',
      })
      const elegido = opciones.find(o => o.value === datos?.project_id)
      if (!elegido) return
      seleccion = elegido
    }
    await configurarCierreAutomatico({
      companyId,
      projectId: seleccion.value,
      projectNombre: seleccion.label,
      modulo: 'agua',
    })
  }

  const bulkActions: BulkAction[] = useMemo(() => [
    {
      id: 'emitir-facturas',
      label: emitiendoLote ? 'Emitiendo…' : 'Emitir facturas',
      icon: '📤',
      variant: 'primary',
      onClick: emitirLoteSeleccion,
    },
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
  ], [bulk.selectedItems, emitiendoLote])

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
        const { error } = await verifyPago(pagoId, currentUser.user_id)

        if (error) throw new Error(error)

        // Update the registro monto_pagado if needed
        if (pago.registro_id) {
          const registro = registros.find(r => r.id === pago.registro_id)
          if (registro) {
            const nuevoMontoPagado = (registro.monto_pagado ?? 0) + pago.monto
            // El saldo se mide contra el TOTAL de la factura (incluye IVA + mora),
            // no contra monto_calculado (subtotal). Si no hay factura emitida, se
            // cae al subtotal como antes. Tolerancia de medio centavo por floats.
            const total = facturaById.get(pago.registro_id)?.total_a_pagar ?? registro.monto_calculado ?? 0
            const saldo = total - nuevoMontoPagado
            const nuevoEstado: Registro['estado'] = saldo <= 0.005 ? 'pagado' : 'pendiente'

            // Update registro state and status
            const { error: updateError } = await updateRegistro(pago.registro_id, {
              monto_pagado: nuevoMontoPagado,
              estado: nuevoEstado,
            })

            if (updateError) throw new Error(updateError)

            if (onRegistroUpdated) {
              onRegistroUpdated(pago.registro_id, {
                monto_pagado: nuevoMontoPagado,
                estado: nuevoEstado,
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
          const { error } = await rejectPago(pagoId, currentUser.user_id, razon)

          if (error) throw new Error(error)

          notify({
            variant: 'success',
            title: '❌ Pago rechazado',
            text: 'El cliente será notificado del rechazo',
            duration: 2000,
          })
        }
      }

      void cargarPagosYConvenios()
    } catch (err) {
      notify({
        variant: 'error',
        title: 'Error',
        text: (err as Error).message || 'No se pudo procesar la verificación',
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

            {canEdit && (
              <button
                onClick={() => void cerrarCicloPeriodo()}
                disabled={cerrandoCiclo}
                title="Emitir todos los recibos pendientes de un proyecto y período, y avisar a los clientes (cerrar ciclo)"
                style={{
                  padding: '10px 16px', borderRadius: '8px', border: 'none',
                  background: 'var(--at-primary)', color: 'white', fontSize: '14px', fontWeight: 700,
                  cursor: cerrandoCiclo ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                  opacity: cerrandoCiclo ? 0.7 : 1,
                }}
              >
                {cerrandoCiclo ? 'Emitiendo…' : '📤 Emitir período'}
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => void configurarCierreAutomaticoAgua()}
                title="Programar el cierre de ciclo mensual automático (emite el período anterior a partir del día elegido)"
                style={{
                  padding: '10px 16px', borderRadius: '8px',
                  border: '1.5px solid var(--at-line)', background: 'var(--at-surface)',
                  color: 'var(--at-ink)', fontSize: '14px', fontWeight: 700,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                🗓️ Automático
              </button>
            )}
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

                        {/* Autorizar/denegar el pago: solo con permiso de aprobación (RBAC). */}
                        {canApprove && (
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
                        )}
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
    const { error } = await setConvenioEstado(id, estado)
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
                {conv.cuotas && conv.cuotas.length > 0 && (
                  <details style={{ marginTop: '10px' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '12.5px', color: 'var(--at-primary)', fontWeight: 600 }}>
                      📅 Ver calendario ({conv.cuotas.length} cuota{conv.cuotas.length !== 1 ? 's' : ''})
                    </summary>
                    <div style={{ marginTop: '8px', border: '1px solid var(--at-line)', borderRadius: '8px', overflow: 'hidden', maxWidth: '360px' }}>
                      {conv.cuotas.map((c, i) => (
                        <div key={c.numero} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '6px 12px', fontSize: '12.5px', borderTop: i === 0 ? 'none' : '1px solid var(--at-line)' }}>
                          <span style={{ color: 'var(--at-ink-3)', minWidth: '54px' }}>Cuota {c.numero}</span>
                          <span style={{ color: 'var(--at-ink-2)' }}>{new Date(c.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es-GT')}</span>
                          <span style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {c.monto.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
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
