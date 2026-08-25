import { hoyLocalISO, mesLocalISO } from '../../../lib/format'
import { useState, useRef, useMemo, useCallback, type ChangeEvent} from 'react'
import { notify, confirm } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { configurarCierreAutomatico } from '../../shared/cierreAutomaticoDialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { SelectionToolbar, type BulkAction } from '../../shared/SelectionToolbar'
import { useBulkSelection } from '../../../hooks/useBulkSelection'
import { useQueryClient } from '@tanstack/react-query'
import { createCondominioRow, updateCondominioRowsByIds, marcarCuotasMorosas, cerrarCicloCuotas } from '../../../domain/condominios/tabMutations'
import { condominiosKeys } from '../../../domain/condominios/keys'
import { countRecibosByProyecto } from '../../../domain/condominios/tabQueries'
import { validatedInsert, validatedInsertMany, esDuplicadoLlaveNatural } from '../../../lib/validatedInsert'
import { cuotaInputSchema } from '../../../domain/condominios/schemas'
import { softDelete } from '../../../lib/softDelete'
import type { CuotaCondominio, ConceptoCuota, EstadoCuota, Unidad, Proyecto, RubroDetalle, TipoResidente } from '../../../types'
import { exportarExcel, exportarPDFRecibo } from '../exportUtils'
// T4 · cond:C4 — capa de datos del agregado Cuota (estado/mora) + máquina de
// estados. La tabla recibe `CuotaCondominio[]` (legacy, sin campos de
// facturación) por props; aquí leemos esos campos vía la capa de datos T4 y los
// cruzamos por id, igual que CobrosSection hace con useFacturasQuery en agua.
import { useCuotasPorProyectoConEstadoQuery, type CuotaConEstado } from '../../../domain/condominios/queries'
import { useReglasMoraConfigQuery } from '../../../domain/facturacion/mutations'
import {
  useEmitirCuotaMutation,
  usePagarCuotaMutation,
  useAnularCuotaMutation,
} from '../../../domain/condominios/mutations'
import { puedeTransicionarCuota } from '../../../lib/businessCondominios'
import { CuotaEstadoBadge, ResponsableCuotaBadge, ROLES_RESPONSABLE_CUOTA, rolResponsableLabel } from './CuotasUi'

interface CSVRow {
  rawUnidad: string
  rawConcepto: string
  rawMonto: string
  rawPeriodo: string
  rawVencimiento: string
  rawNotas: string
  rawResponsable: string
  unidadId: string | null
  concepto: ConceptoCuota | null
  monto: number | null
  rolResponsable: TipoResidente | null
  status: 'ok' | 'warn' | 'error'
  errores: string[]
}

const CONCEPTOS_VALIDOS: ConceptoCuota[] = ['mantenimiento', 'extraordinaria', 'CAM', 'otro']

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  proyectos: Proyecto[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CONCEPTOS: { value: ConceptoCuota; label: string }[] = [
  { value: 'mantenimiento', label: 'Mantenimiento ordinario' },
  { value: 'extraordinaria', label: 'Cuota extraordinaria' },
  { value: 'CAM', label: 'Cargo de Área Común (CAM)' },
  { value: 'otro', label: 'Otro' },
]

export function CuotasTab({ cuotas, unidades, proyectos, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [csvRows, setCsvRows] = useState<CSVRow[] | null>(null)
  const [importando, setImportando] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCuota | 'todos'>('todos')
  // Filtro por rol responsable: 'todos' | 'sin' (no diferenciadas) | un rol.
  const [filtroResponsable, setFiltroResponsable] = useState<TipoResidente | 'todos' | 'sin'>('todos')
  const [expandidasRubros, setExpandidasRubros] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({
    unidad_id: '',
    concepto: 'mantenimiento' as ConceptoCuota,
    monto: '',
    periodo: mesLocalISO(),
    fecha_vencimiento: '',
    rol_responsable: '',
    notas: '',
  })

  // T4 · cond:C4 — proyección de Cuota (estado/mora) del proyecto activo,
  // cruzada por id. Las reglas de mora dan los días de vencimiento al emitir.
  const { data: cuotasConEstado = [] } = useCuotasPorProyectoConEstadoQuery(companyId, proyectoId)
  const { data: reglasMora = [] } = useReglasMoraConfigQuery(companyId)
  const cuotaEstadoById = useMemo(() => {
    const m = new Map<string, CuotaConEstado>()
    for (const c of cuotasConEstado) m.set(c.id, c)
    return m
  }, [cuotasConEstado])

  // Estado canónico de la cuota: el de la proyección (`cuota_estado`) si existe;
  // si no, el legacy `estado` (normalizarEstadoCuota lo mapea pagado→pagada,
  // moroso→vencida). Centraliza la lectura para badge + gating de acciones.
  const estadoCanonicoDe = useCallback(
    (c: CuotaCondominio) => cuotaEstadoById.get(c.id)?.cuota_estado ?? c.estado,
    [cuotaEstadoById],
  )

  // Días de vencimiento: de la regla activa del proyecto si existe, si no 30.
  const diasVencimiento = useMemo(() => {
    const regla = reglasMora.find(r => r.project_id === proyectoId && r.activa)
      ?? reglasMora.find(r => r.project_id === proyectoId)
      ?? reglasMora[0]
    return regla?.dias_vencimiento ?? 30
  }, [reglasMora, proyectoId])

  const emitirMut = useEmitirCuotaMutation()
  const pagarMut = usePagarCuotaMutation()
  const anularMut = useAnularCuotaMutation()
  const [accionCuotaId, setAccionCuotaId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Cierre de ciclo (P1 · facturación masiva): emite TODAS las cuotas pendientes
  // de un período en un solo RPC staff-gated y avisa al residente responsable en
  // su portal (outbox). El conteo local es orientativo; el server es la verdad.
  async function cerrarCiclo() {
    const emitibles = cuotas.filter(c => puedeTransicionarCuota(estadoCanonicoDe(c), 'emitir').ok)
    const periodosEmitibles = emitibles.map(c => c.periodo).sort()
    const periodoDefault = periodosEmitibles[periodosEmitibles.length - 1]
      ?? mesLocalISO()
    const datos = await openPromptDialog({
      title: '📤 Emitir período (cerrar ciclo)',
      description: 'Emite todas las cuotas pendientes del período y avisa a los residentes responsables en su portal.',
      fields: [{ name: 'periodo', label: 'Período (YYYY-MM)', type: 'month', initialValue: periodoDefault, required: true, autoFocus: true }],
      submitText: 'Continuar',
    })
    const periodo = datos?.periodo
    if (!periodo) return
    const candidatas = emitibles.filter(c => c.periodo === periodo)
    if (candidatas.length === 0) {
      notify({ variant: 'info', title: 'Sin cuotas por emitir', text: `No hay cuotas pendientes de emisión en ${periodo}.` })
      return
    }
    const { isConfirmed } = await confirm({
      title: `¿Emitir ${candidatas.length} cuota${candidatas.length > 1 ? 's' : ''} de ${periodo}?`,
      text: `Se emitirán con vencimiento a ${diasVencimiento} días y se avisará a los residentes responsables en su portal.`,
      icon: 'question',
      confirmText: '📤 Emitir período',
    })
    if (!isConfirmed) return
    const { data, error } = await cerrarCicloCuotas(proyectoId, periodo)
    if (error) { notify({ variant: 'error', title: 'No se pudo cerrar el ciclo', text: error.message }); return }
    notify({
      variant: 'success',
      title: `${data?.emitidas ?? 0} cuota${(data?.emitidas ?? 0) !== 1 ? 's' : ''} emitida${(data?.emitidas ?? 0) !== 1 ? 's' : ''}`,
      text: `${data?.avisos ?? 0} aviso(s) al portal del residente.`,
      duration: 2500,
    })
    void queryClient.invalidateQueries({ queryKey: condominiosKeys.all })
    onRefresh()
  }

  async function handleEmitir(cuota: CuotaCondominio) {
    setAccionCuotaId(cuota.id)
    try {
      const proj = cuotaEstadoById.get(cuota.id)
      await emitirMut.mutateAsync({
        cuota: {
          id: cuota.id,
          cuota_estado: proj?.cuota_estado ?? cuota.estado,
          monto: cuota.monto,
          mora_monto: proj?.mora_monto,
        },
        diasVencimiento,
      })
      notify({ variant: 'success', title: '📤 Cuota emitida', duration: 1600 })
      onRefresh()
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo emitir', text: (err as Error).message })
    } finally {
      setAccionCuotaId(null)
    }
  }

  async function handlePagar(cuota: CuotaCondominio) {
    const hoy = hoyLocalISO()
    const datos = await openPromptDialog({
      title: 'Registrar pago',
      fields: [
        { name: 'fecha_pago', label: 'Fecha de pago', type: 'date', initialValue: hoy, required: true, autoFocus: true },
        {
          name: 'metodo_pago', label: 'Método de pago', control: 'select', initialValue: 'efectivo',
          options: [
            { value: 'efectivo', label: 'Efectivo' },
            { value: 'transferencia', label: 'Transferencia bancaria' },
            { value: 'cheque', label: 'Cheque' },
            { value: 'tarjeta', label: 'Tarjeta' },
            { value: 'deposito', label: 'Depósito' },
            { value: 'otro', label: 'Otro' },
          ],
        },
        { name: 'referencia_pago', label: 'Referencia / No. transacción', placeholder: 'Opcional' },
      ],
      submitText: 'Confirmar pago',
    })
    if (!datos) return
    setAccionCuotaId(cuota.id)
    try {
      const proj = cuotaEstadoById.get(cuota.id)
      await pagarMut.mutateAsync({
        cuota: { id: cuota.id, cuota_estado: proj?.cuota_estado ?? cuota.estado, monto: cuota.monto },
        fechaPago: datos.fecha_pago,
        metodoPago: datos.metodo_pago,
        referenciaPago: datos.referencia_pago || null,
      })
      notify({ variant: 'success', title: '✅ Cuota pagada', duration: 1600 })
      onRefresh()
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo registrar el pago', text: (err as Error).message })
    } finally {
      setAccionCuotaId(null)
    }
  }

  async function handleAnular(cuota: CuotaCondominio) {
    const { isConfirmed } = await confirm({
      title: '¿Anular cuota?',
      text: 'La cuota quedará anulada (estado terminal). Esta acción no se puede revertir.',
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, anular',
    })
    if (!isConfirmed) return
    setAccionCuotaId(cuota.id)
    try {
      const proj = cuotaEstadoById.get(cuota.id)
      await anularMut.mutateAsync({
        cuota: { id: cuota.id, cuota_estado: proj?.cuota_estado ?? cuota.estado },
      })
      notify({ variant: 'success', title: '🚫 Cuota anulada', duration: 1600 })
      onRefresh()
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo anular', text: (err as Error).message })
    } finally {
      setAccionCuotaId(null)
    }
  }

  const cuotasFiltradas = cuotas.filter(c => {
    if (filtroEstado !== 'todos' && c.estado !== filtroEstado) return false
    if (filtroResponsable === 'sin') return !c.rol_responsable
    if (filtroResponsable !== 'todos' && c.rol_responsable !== filtroResponsable) return false
    return true
  })

  const cuotasPagables = cuotasFiltradas.filter(c => c.estado !== 'pagado')

  // Bulk selection — solo cuotas pagables son seleccionables (pagadas se excluyen)
  const bulk = useBulkSelection(cuotasPagables, c => c.id)
  const seleccionadas = bulk.selected
  const toggleSeleccion = bulk.toggle
  const toggleTodas = bulk.toggleAll

  const totales = {
    pendiente: cuotas.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0),
    moroso:    cuotas.filter(c => c.estado === 'moroso').reduce((s, c) => s + c.monto, 0),
    pagado:    cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
  }

  function parsearCSV(text: string): CSVRow[] {
    const lineas = text.trim().split('\n').filter(l => l.trim())
    if (lineas.length < 2) return []
    // skip header row
    return lineas.slice(1).map(linea => {
      const cols = linea.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      const [rawUnidad = '', rawConcepto = '', rawMonto = '', rawPeriodo = '', rawVencimiento = '', rawNotas = '', rawResponsable = ''] = cols
      const errores: string[] = []

      const unidadMatch = unidades.find(u => u.nombre.toLowerCase() === rawUnidad.toLowerCase())
      if (!rawUnidad) errores.push('Unidad vacía')
      else if (!unidadMatch) errores.push(`Unidad "${rawUnidad}" no encontrada`)

      const conceptoNorm = rawConcepto.toLowerCase()
      const concepto = CONCEPTOS_VALIDOS.includes(conceptoNorm as ConceptoCuota)
        ? (conceptoNorm as ConceptoCuota)
        : rawConcepto === '' ? null : null
      if (!concepto) errores.push(`Concepto "${rawConcepto}" inválido (usa: ${CONCEPTOS_VALIDOS.join(', ')})`)

      const monto = parseFloat(rawMonto)
      if (!rawMonto || isNaN(monto) || monto <= 0) errores.push('Monto inválido')

      if (!rawPeriodo.match(/^\d{4}-\d{2}$/)) errores.push('Período debe ser AAAA-MM')

      // Responsable (columna opcional al final): vacío → sin diferenciar; acepta el
      // valor ('arrendatario') o la etiqueta ('Inquilino'), sin distinguir mayúsculas.
      let rolResponsable: TipoResidente | null = null
      if (rawResponsable.trim()) {
        const t = rawResponsable.trim().toLowerCase()
        const match = ROLES_RESPONSABLE_CUOTA.find(r => r.value === t || r.label.toLowerCase() === t)
        if (match) rolResponsable = match.value
        else errores.push(`Responsable "${rawResponsable}" inválido (propietario, inquilino, familiar, otro o vacío)`)
      }

      const status: CSVRow['status'] = errores.length === 0 ? 'ok'
        : errores.some(e => e.includes('no encontrada')) ? 'warn'
        : 'error'

      return {
        rawUnidad, rawConcepto, rawMonto, rawPeriodo, rawVencimiento, rawNotas, rawResponsable,
        unidadId: unidadMatch?.id ?? null,
        concepto: errores.length === 0 || !errores.some(e => e.includes('Concepto')) ? concepto : null,
        monto: isNaN(monto) ? null : monto,
        rolResponsable,
        status,
        errores,
      }
    })
  }

  function handleCSVFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const filas = parsearCSV(text)
      if (filas.length === 0) {
        notify({ variant: 'error', title: 'Error', text: 'El archivo CSV no tiene filas válidas. Verifique el formato.' })
      } else {
        setCsvRows(filas)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function confirmarImportCSV() {
    if (!csvRows) return
    const validas = csvRows.filter(r => r.status === 'ok' && r.unidadId && r.concepto && r.monto)
    if (validas.length === 0) {
      notify({ variant: 'warning', title: 'Sin filas válidas', text: 'Corrija los errores antes de importar.' })
      return
    }
    const { isConfirmed } = await confirm({
      title: `Importar ${validas.length} cuota${validas.length > 1 ? 's' : ''}`,
      text: `${csvRows.length - validas.length > 0 ? `${csvRows.length - validas.length} fila(s) con errores serán omitidas. ` : ''}Se insertarán ${validas.length} cuotas con estado pendiente.`,
      icon: 'question',
      confirmText: '📥 Importar',
    })
    if (!isConfirmed) return
    setImportando(true)
    const inserts = validas.map(r => ({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: r.unidadId,
      concepto: r.concepto!,
      monto: r.monto!,
      periodo: r.rawPeriodo,
      fecha_vencimiento: r.rawVencimiento || null,
      rol_responsable: r.rolResponsable,
      notas: r.rawNotas || null,
      estado: 'pendiente' as EstadoCuota,
    }))
    // cond:C2 — batch insert (CSV import) con pre-validación Zod por fila.
    const { error } = await validatedInsertMany('cuotas_condominio', cuotaInputSchema, inserts)
    setImportando(false)
    // E1: llave natural — el CSV trae cuotas que ya existen (unidad+período+concepto).
    if (esDuplicadoLlaveNatural(error)) {
      notify({ variant: 'warning', title: 'Cuotas duplicadas en el CSV', text: 'Alguna fila ya existe (misma unidad, período y concepto). No se importó nada — depurá el archivo y reintentá.' })
      return
    }
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: `${validas.length} cuotas importadas`, duration: 1800 })
    setCsvRows(null)
    onRefresh()
  }

  function resetForm() {
    setForm({ unidad_id: '', concepto: 'mantenimiento', monto: '', periodo: mesLocalISO(), fecha_vencimiento: '', rol_responsable: '', notas: '' })
    setShowForm(false)
  }

  function toggleRubros(id: string) {
    setExpandidasRubros(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  function whatsappRecordatorio(cuota: CuotaCondominio) {
    const unidadNombre = cuota.unidad_nombre ?? 'su unidad'
    const venc = cuota.fecha_vencimiento ? ` con vencimiento el ${cuota.fecha_vencimiento}` : ''
    const msg = `Estimado(a) residente de ${unidadNombre},\n\nLe recordamos que tiene una cuota de *${cuota.concepto}* por *${moneda} ${cuota.monto.toFixed(2)}* correspondiente al período ${cuota.periodo}${venc}.\n\nPor favor comuníquese con la administración para regularizar su situación.\n\nGracias,\nAdministración del Condominio`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function handleGuardar() {
    if (!form.monto || isNaN(Number(form.monto)) || Number(form.monto) <= 0) {
      notify({ variant: 'error', title: 'Error', text: 'Ingrese un monto válido.' }); return
    }
    if (!form.periodo) {
      notify({ variant: 'error', title: 'Error', text: 'Seleccione el período.' }); return
    }
    setSaving(true)
    // cond:C2 — pre-validación Zod. La regla "concepto != CAM requiere
    // unidad_id" la atrapa el schema antes del round trip a DB.
    const { error } = await validatedInsert('cuotas_condominio', cuotaInputSchema, {
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      concepto: form.concepto,
      monto: Number(form.monto),
      periodo: form.periodo,
      fecha_vencimiento: form.fecha_vencimiento || null,
      rol_responsable: form.rol_responsable || null,
      notas: form.notas || null,
      estado: 'pendiente',
    })
    setSaving(false)
    // E1: llave natural — la unidad ya tiene una cuota de este período/concepto.
    if (esDuplicadoLlaveNatural(error)) {
      notify({ variant: 'warning', title: 'Cuota ya existe', text: `La unidad ya tiene una cuota de "${form.concepto}" para ${form.periodo}. No se duplicó.` })
      return
    }
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: 'Cuota registrada', duration: 1500 })
    resetForm()
    onRefresh()
  }

  async function pagoMasivo() {
    const ids = [...seleccionadas]
    const items = cuotas.filter(c => ids.includes(c.id))
    const totalMonto = items.reduce((s, c) => s + c.monto, 0)
    const hoy = hoyLocalISO()

    const datos = await openPromptDialog({
      title: `Registrar pago para ${ids.length} cuota${ids.length > 1 ? 's' : ''}`,
      description: `Total: ${moneda} ${totalMonto.toFixed(2)}`,
      fields: [
        { name: 'fecha_pago', label: 'Fecha de pago', type: 'date', initialValue: hoy, required: true, autoFocus: true },
        {
          name: 'metodo_pago',
          label: 'Método de pago',
          control: 'select',
          initialValue: 'efectivo',
          options: [
            { value: 'efectivo', label: 'Efectivo' },
            { value: 'transferencia', label: 'Transferencia bancaria' },
            { value: 'cheque', label: 'Cheque' },
            { value: 'tarjeta', label: 'Tarjeta' },
            { value: 'deposito', label: 'Depósito' },
            { value: 'otro', label: 'Otro' },
          ],
        },
        { name: 'referencia_pago', label: 'Referencia / No. transacción', placeholder: 'Opcional' },
      ],
      submitText: `✅ Confirmar ${ids.length} pago${ids.length > 1 ? 's' : ''}`,
    })
    if (!datos) return

    const { error } = await updateCondominioRowsByIds('cuotas_condominio', ids, {
      estado: 'pagado',
      fecha_pago: datos.fecha_pago,
      metodo_pago: datos.metodo_pago,
      referencia_pago: datos.referencia_pago || null,
    })

    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: `${ids.length} cuotas marcadas como pagadas`, text: `Total: ${moneda} ${totalMonto.toFixed(2)}`, duration: 2000 })
    bulk.clear()
    onRefresh()
  }

  async function eliminar(id: string) {
    const result = await confirm({ title: '¿Eliminar cuota?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!result.isConfirmed) return
    await softDelete('cuotas_condominio', { id })
    onRefresh()
  }

  async function aplicarMoraMasiva() {
    const hoy = hoyLocalISO()
    const vencidas = cuotas.filter(c => c.estado === 'pendiente' && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
    if (vencidas.length === 0) {
      notify({ variant: 'success', title: '¡Sin vencidas!', text: 'No hay cuotas pendientes con fecha de vencimiento pasada.', duration: 2000 })
      return
    }
    const { isConfirmed } = await confirm({
      title: `¿Marcar ${vencidas.length} cuota${vencidas.length > 1 ? 's' : ''} como morosas?`,
      text: 'Cuotas pendientes cuya fecha de vencimiento ya pasó. Esta acción se puede revertir cambiando el estado individualmente.',
      icon: 'warning',
      variant: 'danger',
      confirmText: '⚡ Aplicar mora',
    })
    if (!isConfirmed) return
    const { error } = await marcarCuotasMorosas(vencidas.map(c => c.id))
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: `${vencidas.length} cuotas marcadas como morosas`, duration: 1500 })
    onRefresh()
  }

  async function crearRecibo(cuota: CuotaCondominio) {
    const count = await countRecibosByProyecto(proyectoId)
    const numero = `REC-${String(count + 1).padStart(4, '0')}`

    const { error } = await createCondominioRow('recibos_digitales', {
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: cuota.unidad_id ?? null,
      cuota_id: cuota.id,
      numero_recibo: numero,
      monto: cuota.monto,
      concepto: `${cuota.concepto} — Período ${cuota.periodo}`,
      fecha_emision: cuota.fecha_pago ?? hoyLocalISO(),
      estado: 'generado',
    })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }

    const { isConfirmed: descargar } = await confirm({
      icon: 'question', title: `Recibo ${numero} creado`,
      text: '¿Desea descargar el PDF ahora?',
      confirmText: 'Descargar PDF',
      cancelText: 'Cerrar',
    })
    if (descargar) {
      exportarPDFRecibo({
        numero_recibo: numero,
        concepto: `${cuota.concepto} — Período ${cuota.periodo}`,
        monto: cuota.monto,
        fecha_emision: cuota.fecha_pago ?? hoyLocalISO(),
        unidadNombre: cuota.unidad_nombre,
        metodo_pago: cuota.metodo_pago,
        referencia_pago: cuota.referencia_pago,
      }, moneda)
    }
    onRefresh()
  }

  const montoSeleccionado = cuotas.filter(c => seleccionadas.has(c.id)).reduce((s, c) => s + c.monto, 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Cuotas de Mantenimiento</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>{cuotas.length} cuotas registradas</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => exportarExcel(`cuotas-${hoyLocalISO()}`, [{
              name: 'Cuotas',
              headers: ['Unidad', 'Concepto', 'Responsable', 'Período', 'Monto', 'Vencimiento', 'Estado', 'Método pago', 'Fecha pago'],
              rows: cuotas.map(c => [c.unidad_nombre ?? 'General', c.concepto, rolResponsableLabel(c.rol_responsable), c.periodo, c.monto, c.fecha_vencimiento ?? '', c.estado, c.metodo_pago ?? '', c.fecha_pago ?? '']),
            }])}
            style={{ padding: '10px 16px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📊 Excel
          </button>
          {canEdit && (
            <button onClick={() => void cerrarCiclo()}
              title="Emitir todas las cuotas pendientes de un período y avisar a los residentes (cerrar ciclo)"
              style={{ padding: '10px 16px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              📤 Emitir período
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => void configurarCierreAutomatico({
                companyId,
                projectId: proyectoId,
                projectNombre: proyectos.find(p => p.id === proyectoId)?.nombre,
                modulo: 'condominios',
              })}
              title="Programar el cierre de ciclo mensual automático (emite el período anterior a partir del día elegido)"
              style={{ padding: '10px 16px', background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              🗓️ Automático
            </button>
          )}
          {canEdit && (
            <button onClick={aplicarMoraMasiva}
              title="Marcar como morosas todas las cuotas pendientes con vencimiento pasado"
              style={{ padding: '10px 16px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1.5px solid var(--at-danger-border)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              ⚡ Mora
            </button>
          )}
          {canCreate && (
            <>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVFile} />
              <button onClick={() => fileInputRef.current?.click()}
                style={{ padding: '10px 16px', background: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)', border: '1.5px solid var(--at-accent-soft)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                📥 Importar CSV
              </button>
              <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}>
                + Nueva cuota
              </button>
            </>
          )}
        </div>
      </div>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {([['pendiente', 'var(--at-primary)', 'var(--at-primary-tint)'], ['moroso', 'var(--at-danger)', 'var(--at-danger-tint)'], ['pagado', 'var(--at-success)', 'var(--at-success-tint)']] as const).map(([estado, color, bg]) => (
          <button key={estado} onClick={() => { setFiltroEstado(filtroEstado === estado ? 'todos' : estado); bulk.clear() }}
            style={{ padding: '14px', background: filtroEstado === estado ? bg : 'var(--at-surface)', border: `1.5px solid ${filtroEstado === estado ? color : 'var(--at-line)'}`, borderRadius: '12px', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color }}>{moneda} {totales[estado].toFixed(2)}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px', textTransform: 'capitalize' }}>{cuotas.filter(c => c.estado === estado).length} cuotas {estado}s</div>
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva cuota</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label htmlFor="cuota-unidad" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad (opcional)</label>
              <select id="cuota-unidad" value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Todas las unidades</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cuota-concepto" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Concepto</label>
              <select id="cuota-concepto" value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value as ConceptoCuota }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                {CONCEPTOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cuota-responsable" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Responsable</label>
              <select id="cuota-responsable" value={form.rol_responsable} onChange={e => setForm(f => ({ ...f, rol_responsable: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Sin diferenciar</option>
                {ROLES_RESPONSABLE_CUOTA.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cuota-monto" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Monto ({moneda})</label>
              <input id="cuota-monto" type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label htmlFor="cuota-periodo" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Período</label>
              <input id="cuota-periodo" type="month" value={form.periodo} onChange={e => setForm(f => ({ ...f, periodo: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label htmlFor="cuota-vencimiento" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha de vencimiento</label>
              <input id="cuota-vencimiento" type="date" value={form.fecha_vencimiento} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label htmlFor="cuota-notas" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input id="cuota-notas" type="text" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* CSV Preview */}
      {csvRows && (
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-accent-soft)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>Vista previa del CSV</h3>
              <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                {csvRows.filter(r => r.status === 'ok').length} filas válidas · {csvRows.filter(r => r.status !== 'ok').length} con errores
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmarImportCSV} disabled={importando || csvRows.filter(r => r.status === 'ok').length === 0}
                style={{ padding: '9px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
                {importando ? 'Importando...' : `📥 Confirmar (${csvRows.filter(r => r.status === 'ok').length})`}
              </button>
              <button onClick={() => setCsvRows(null)}
                style={{ padding: '9px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '9px', cursor: 'pointer', fontSize: '13px' }}>
                Cancelar
              </button>
            </div>
          </div>
          <div className="table-scroll-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)' }}>
                  {['', 'Unidad', 'Concepto', 'Responsable', 'Monto', 'Período', 'Vencimiento', 'Notas'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--at-ink-3)', fontSize: '11px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--at-chip)', background: r.status === 'error' ? 'var(--at-danger-tint)' : r.status === 'warn' ? 'var(--at-warning-tint)' : undefined }}>
                    <td style={{ padding: '7px 12px', fontSize: '14px' }}>
                      {r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : '❌'}
                    </td>
                    <td style={{ padding: '7px 12px', color: r.unidadId ? 'var(--at-ink-2)' : 'var(--at-danger)' }}>{r.rawUnidad || '—'}</td>
                    <td style={{ padding: '7px 12px', color: r.concepto ? 'var(--at-ink-2)' : 'var(--at-danger)' }}>{r.rawConcepto || '—'}</td>
                    <td style={{ padding: '7px 12px', color: r.rawResponsable && !r.rolResponsable ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{r.rolResponsable ? rolResponsableLabel(r.rolResponsable) : '—'}</td>
                    <td style={{ padding: '7px 12px', color: r.monto ? 'var(--at-ink-2)' : 'var(--at-danger)' }}>{r.rawMonto || '—'}</td>
                    <td style={{ padding: '7px 12px', color: 'var(--at-ink-2)' }}>{r.rawPeriodo || '—'}</td>
                    <td style={{ padding: '7px 12px', color: 'var(--at-ink-2)' }}>{r.rawVencimiento || '—'}</td>
                    <td style={{ padding: '7px 12px', color: 'var(--at-ink-2)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rawNotas || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {csvRows.some(r => r.errores.length > 0) && (
            <div style={{ marginTop: '10px', padding: '10px 14px', background: 'var(--at-danger-tint)', borderRadius: '8px', fontSize: '12px', color: 'var(--at-danger)' }}>
              <strong>Errores detectados:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {csvRows.flatMap((r, i) => r.errores.map(e => <li key={`${i}-${e}`}>Fila {i + 2}: {e}</li>))}
              </ul>
            </div>
          )}
          <div style={{ marginTop: '10px', padding: '8px 12px', background: 'var(--at-primary-tint)', borderRadius: '8px', fontSize: '11.5px', color: 'var(--at-primary-hover)' }}>
            Formato esperado: <code>unidad,concepto,monto,periodo,vencimiento,notas,responsable</code> — ejemplo: <code>Apto 101,mantenimiento,350.00,2026-04,2026-04-30,,inquilino</code>. La columna <code>responsable</code> es opcional (propietario / inquilino / familiar / otro; vacío = sin diferenciar).
          </div>
        </div>
      )}

      {/* Filtro por responsable — visible solo cuando hay cuotas diferenciadas */}
      {cuotas.some(c => c.rol_responsable) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13 }}>
          <span style={{ color: 'var(--at-ink-3)', fontWeight: 600 }}>Responsable:</span>
          <select value={filtroResponsable} onChange={e => { setFiltroResponsable(e.target.value as TipoResidente | 'todos' | 'sin'); bulk.clear() }}
            style={{ padding: '6px 10px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, background: 'var(--at-surface)' }}>
            <option value="todos">Todos</option>
            <option value="sin">Sin diferenciar</option>
            {ROLES_RESPONSABLE_CUOTA.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      )}

      {/* Lista */}
      {/* F3.9.2: migrado a <DataTable> shared con expandedContent */}
      <DataTable<CuotaCondominio>
        data={cuotasFiltradas}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'periodo', direction: 'desc' }}
        searchableKeys={[
          c => c.unidad_nombre ?? '',
          c => c.concepto,
          c => c.periodo,
        ]}
        searchPlaceholder="Buscar unidad, concepto, período…"
        emptyState={
          <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>💳</div>
            <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay cuotas {filtroEstado !== 'todos' ? `con estado "${filtroEstado}"` : 'registradas'}</p>
          </div>
        }
        rowStyle={c => seleccionadas.has(c.id) ? { background: 'var(--at-success-tint)' } : {}}
        isRowExpanded={c => expandidasRubros.has(c.id)}
        expandedContent={c => {
          const rubrosDetalle = c.rubros_detalle as RubroDetalle[] | null | undefined
          if (!rubrosDetalle || rubrosDetalle.length === 0) return null
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 12px', marginLeft: 34, background: 'var(--at-primary-tint)', borderRadius: 8, border: '1px solid var(--at-accent-soft-2)' }}>
              {rubrosDetalle.map((rd, ri) => (
                <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--at-ink-2)' }}>
                  <span>
                    {rd.nombre}
                    <span style={{ marginLeft: 6, color: 'var(--at-ink-3)', fontSize: 11 }}>
                      ({rd.metodo === 'fijo' ? 'fijo' : rd.metodo === 'por_m2' ? `${moneda} ${rd.valor}/m²` : `alíc. ${rd.valor.toLocaleString('es')}`})
                    </span>
                  </span>
                  <span style={{ fontWeight: 600 }}>{moneda} {rd.monto_calculado.toLocaleString('es', { minimumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          )
        }}
        columns={[
          ...(canEdit ? [{
            key: 'select',
            header: (
              <input type="checkbox"
                checked={cuotasPagables.length > 0 && seleccionadas.size === cuotasPagables.length}
                onChange={toggleTodas}
                aria-label="Seleccionar todas las pagables"
              />
            ),
            width: 36,
            render: (c: CuotaCondominio) => c.estado !== 'pagado' ? (
              <input type="checkbox" checked={seleccionadas.has(c.id)} onChange={() => toggleSeleccion(c.id)} aria-label="Seleccionar cuota" />
            ) : null,
          }] : []),
          {
            key: 'unidad', header: 'Unidad', sortable: true,
            accessor: c => c.unidad_nombre ?? '',
            render: c => (
              <span style={{ color: 'var(--at-ink-2)' }}>
                {c.unidad_nombre || <span style={{ color: 'var(--at-ink-3)', fontStyle: 'italic' }}>General</span>}
              </span>
            ),
          },
          {
            key: 'concepto', header: 'Concepto', sortable: true,
            accessor: c => c.concepto,
            render: c => <span style={{ color: 'var(--at-ink-2)' }}>{CONCEPTOS.find(x => x.value === c.concepto)?.label || c.concepto}</span>,
          },
          {
            key: 'responsable', header: 'Responsable', sortable: true,
            accessor: c => c.rol_responsable ?? '',
            render: c => c.rol_responsable
              ? <ResponsableCuotaBadge rol={c.rol_responsable} />
              : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
            hideOnMobile: true,
          },
          {
            key: 'periodo', header: 'Período', sortable: true,
            accessor: c => c.periodo,
            render: c => <span style={{ color: 'var(--at-ink-2)' }}>{c.periodo}</span>,
          },
          {
            key: 'monto', header: 'Monto', sortable: true,
            accessor: c => c.monto,
            render: c => {
              // T4 · cond:C4 — desglose monto + mora = total. La mora (cond:C6) y el
              // total los persiste la capa de facturación; si no hay, solo el monto.
              const proj = cuotaEstadoById.get(c.id)
              const mora = proj?.mora_monto ?? 0
              const total = proj?.total_a_pagar ?? null
              return (
                <>
                  <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {c.monto.toFixed(2)}</div>
                  {mora > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--at-danger)', marginTop: '1px' }}>
                      + mora {moneda} {mora.toFixed(2)}
                    </div>
                  )}
                  {total != null && total > c.monto && (
                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-primary-hover)', marginTop: '1px' }}>
                      = {moneda} {total.toFixed(2)}
                    </div>
                  )}
                  {c.estado === 'pagado' && c.metodo_pago && (
                    <div style={{ fontSize: '11px', color: 'var(--at-success)', marginTop: '1px' }}>
                      {c.metodo_pago}{c.fecha_pago ? ` · ${c.fecha_pago}` : ''}
                    </div>
                  )}
                </>
              )
            },
          },
          {
            key: 'vencimiento', header: 'Vencimiento', sortable: true,
            accessor: c => c.fecha_vencimiento ?? '',
            render: c => {
              const hoy = hoyLocalISO()
              const vencida = c.fecha_vencimiento && c.fecha_vencimiento < hoy && c.estado !== 'pagado'
              return <span style={{ color: vencida ? 'var(--at-danger)' : 'var(--at-ink-2)' }}>{c.fecha_vencimiento || '—'}</span>
            },
            hideOnMobile: true,
          },
          {
            key: 'estado', header: 'Estado', sortable: true,
            accessor: c => estadoCanonicoDe(c),
            // T4 · cond:C4 — badge del estado canónico (`cuota_estado`) de la
            // máquina de estados. Sustituye el select legacy: el cambio de estado
            // ahora pasa por las acciones gated (emitir/pagar/anular), única fuente
            // de verdad de las transiciones.
            render: c => <CuotaEstadoBadge estado={estadoCanonicoDe(c)} />,
          },
          {
            key: 'rubros', header: 'Rubros',
            render: c => {
              const rubrosDetalle = c.rubros_detalle as RubroDetalle[] | null | undefined
              const tieneRubros = rubrosDetalle && rubrosDetalle.length > 0
              const expandido = expandidasRubros.has(c.id)
              return tieneRubros ? (
                <button onClick={() => toggleRubros(c.id)}
                  aria-label={expandido ? 'Colapsar rubros' : 'Expandir rubros'}
                  aria-expanded={expandido}
                  style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid var(--at-accent-soft)', borderRadius: '6px', cursor: 'pointer', background: expandido ? 'var(--at-primary-tint)' : 'var(--at-surface-2)', color: 'var(--at-accent-hover)', fontWeight: 600 }}>
                  {expandido ? '▲' : '▼'} {rubrosDetalle!.length}
                </button>
              ) : <span style={{ color: 'var(--at-line-strong)', fontSize: 11 }}>—</span>
            },
            hideOnMobile: true,
          },
          {
            key: 'acciones', header: '',
            render: c => {
              // T4 · cond:C4 — acciones gated por la máquina de estados
              // (businessCondominios.ts es la fuente de verdad). Las acciones
              // inválidas para el estado actual quedan ocultas.
              const estadoCanon = estadoCanonicoDe(c)
              const puedeEmitir = puedeTransicionarCuota(estadoCanon, 'emitir').ok
              const puedePagar = puedeTransicionarCuota(estadoCanon, 'pagar').ok
              const puedeAnular = puedeTransicionarCuota(estadoCanon, 'anular').ok
              const procesando = accionCuotaId === c.id
              return (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                {canEdit && puedeEmitir && (
                  <button onClick={() => void handleEmitir(c)} disabled={procesando} title="Emitir cuota (fija vencimiento y total)"
                    style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-primary)', cursor: procesando ? 'not-allowed' : 'pointer', color: 'var(--at-primary-hover)', fontSize: '12px', padding: '4px 9px', borderRadius: '6px', fontWeight: 600, whiteSpace: 'nowrap', opacity: procesando ? 0.6 : 1 }}>
                    📤 Emitir
                  </button>
                )}
                {canEdit && puedePagar && (
                  <button onClick={() => void handlePagar(c)} disabled={procesando} title="Registrar pago de la cuota"
                    style={{ background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', border: 'none', cursor: procesando ? 'not-allowed' : 'pointer', color: 'white', fontSize: '12px', padding: '4px 10px', borderRadius: '6px', fontWeight: 600, whiteSpace: 'nowrap', opacity: procesando ? 0.6 : 1 }}>
                    💰 Pagar
                  </button>
                )}
                {canEdit && puedeAnular && (
                  <button onClick={() => void handleAnular(c)} disabled={procesando} title="Anular cuota"
                    style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-danger)', cursor: procesando ? 'not-allowed' : 'pointer', color: 'var(--at-danger)', fontSize: '12px', padding: '4px 9px', borderRadius: '6px', fontWeight: 600, whiteSpace: 'nowrap', opacity: procesando ? 0.6 : 1 }}>
                    🚫 Anular
                  </button>
                )}
                {(c.estado === 'pendiente' || c.estado === 'moroso') && (
                  <button onClick={() => whatsappRecordatorio(c)} aria-label="Recordatorio por WhatsApp"
                    style={{ background: 'var(--at-success-tint)', border: 'none', cursor: 'pointer', color: 'var(--at-success)', fontSize: '13px', padding: '3px 7px', borderRadius: '6px', fontWeight: 600 }}>
                    💬
                  </button>
                )}
                {c.estado === 'pagado' && canCreate && (
                  <button onClick={() => crearRecibo(c)} aria-label="Crear recibo digital"
                    style={{ background: 'var(--at-primary-tint)', border: 'none', cursor: 'pointer', color: 'var(--at-primary)', fontSize: '13px', padding: '3px 7px', borderRadius: '6px', fontWeight: 600 }}>
                    🧾
                  </button>
                )}
                <button onClick={() => eliminar(c.id)} aria-label="Eliminar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '16px', padding: '2px 6px', borderRadius: '6px' }}>🗑</button>
              </div>
              )
            },
          },
        ] satisfies DataTableColumn<CuotaCondominio>[]}
      />

      {/* Bulk actions toolbar — aparece cuando hay >=1 cuotas seleccionadas */}
      <SelectionToolbar
        count={bulk.count}
        onClear={bulk.clear}
        entityLabel={{ one: 'cuota', many: 'cuotas' }}
        leftSlot={`Total: ${moneda} ${montoSeleccionado.toFixed(2)}`}
        actions={[
          ...(canEdit ? [{
            id: 'pagar',
            label: `Pagar ${bulk.count}`,
            icon: '✅',
            variant: 'primary',
            onClick: () => void pagoMasivo(),
          } satisfies BulkAction] : []),
          {
            id: 'exportar',
            label: 'Exportar',
            icon: '📊',
            onClick: () => exportarExcel(`cuotas-seleccion-${hoyLocalISO()}`, [{
              name: 'Cuotas',
              headers: ['Unidad', 'Concepto', 'Responsable', 'Período', 'Monto', 'Vencimiento', 'Estado'],
              rows: bulk.selectedItems.map(c => [c.unidad_nombre ?? 'General', c.concepto, rolResponsableLabel(c.rol_responsable), c.periodo, c.monto, c.fecha_vencimiento ?? '', c.estado]),
            }]),
          },
        ]}
      />
    </div>
  )
}
