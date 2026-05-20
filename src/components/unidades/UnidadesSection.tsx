import { useState, useEffect, useMemo, lazy, Suspense, type CSSProperties} from 'react'
import Swal from 'sweetalert2'
import type { Unidad, TipoUnidad, TipoRegimen, EstadoOcupacional, ContratoSuministro, UserRole, UserSession, Contador, Proyecto, MaxUnidadesPorTipo, Cliente } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'
import { EditModal } from '../shared/EditModal'
import { EmptyState } from '../shared'
import { formatDate, formatNumber } from '../../lib/format'
import { getEditedTagInfo } from '../../lib/timeUtils'

const ImportUnidadesModal = lazy(() => import('./ImportUnidadesModal').then(m => ({ default: m.ImportUnidadesModal })))

interface Props {
  unidades: Unidad[]
  contadores: Contador[]
  clientes: Cliente[]
  proyectos: Proyecto[]
  userRole: UserRole
  currentUser: UserSession
  maxUnidadesPorTipo?: MaxUnidadesPorTipo | null
  onUnidadAdded: (unidad: Unidad) => void
  onUnidadUpdated: (id: string, partial: Partial<Unidad>) => void
  onUnidadDeleted: (id: string) => void
  onContadorUpdated: (id: string, partial: Partial<Contador>) => void
  canCreate?: boolean
  canEdit?: boolean
}

const TIPOS_UNIDAD: { value: TipoUnidad; label: string; icon: string }[] = [
  { value: 'apartamento',    label: 'Apartamento',     icon: '🏢' },
  { value: 'casa',           label: 'Casa',            icon: '🏠' },
  { value: 'bodega',         label: 'Bodega',          icon: '🏭' },
  { value: 'local_comercial',label: 'Local Comercial', icon: '🏪' },
  { value: 'oficina',        label: 'Oficina',         icon: '🏛️' },
  { value: 'parqueadero',    label: 'Parqueadero',     icon: '🅿️' },
  { value: 'otro',           label: 'Otro',            icon: '📦' },
]

const TIPOS_REGIMEN: { value: TipoRegimen; label: string }[] = [
  { value: 'no_sujeto',            label: 'No Sujeto' },
  { value: 'urbanizacion',         label: 'Urbanización' },
  { value: 'condominio',           label: 'Condominio' },
  { value: 'propiedad_horizontal', label: 'Propiedad Horizontal' },
  { value: 'otro',                 label: 'Otro' },
]

const ESTADOS_OCUPACIONALES: { value: EstadoOcupacional; label: string }[] = [
  { value: 'en_construccion',       label: 'En Construcción' },
  { value: 'habitado',              label: 'Habitado' },
  { value: 'en_remodelacion',       label: 'En Remodelación' },
  { value: 'desabitado',            label: 'Deshabitado' },
  { value: 'en_proceso_de_mudanza', label: 'En Proceso de Mudanza' },
  { value: 'desocupada',            label: 'Desocupada' },
  { value: 'disponible_venta',      label: 'Disponible para Venta' },
  { value: 'disponible_renta',      label: 'Disponible para Renta' },
  { value: 'en_mantenimiento',      label: 'En Mantenimiento' },
  { value: 'problemas_legales',     label: 'Problemas Legales' },
  { value: 'activo_extraordinario', label: 'Activo Extraordinario de Entidad Financiera' },
]

const CONTRATOS_SUMINISTRO: { value: ContratoSuministro; label: string }[] = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
  { value: 'na', label: 'N/A' },
]

const TIPO_AGUA_LABELS: Record<string, string> = {
  potable:             '💧 Potable',
  rehuso:              '♻️ Reúso',
  piscina:             '🏊 Piscina',
  desalinada:          '🌊 Desalinada',
  riego:               '🌱 Riego',
  jacuzzi:             '🛁 Jacuzzi',
  consumo_humano:      '🚰 Consumo Humano',
  desmineralizada:     '🧪 Desmineralizada',
  residuales_tratadas: '🔄 Residuales Tratadas',
}

const TIPO_COLORES: Record<TipoUnidad, { bg: string; color: string }> = {
  apartamento:     { bg: '#D9E2DC', color: '#102622' },
  casa:            { bg: '#dcfce7', color: '#166534' },
  bodega:          { bg: '#fef9c3', color: '#854d0e' },
  local_comercial: { bg: '#ffedd5', color: '#c2410c' },
  oficina:         { bg: '#F4EBE3', color: '#5E3417' },
  parqueadero:     { bg: '#EAE6D8', color: '#3E5A4C' },
  otro:            { bg: '#fce7f3', color: '#9d174d' },
}

const EMPTY_FORM = {
  nombre: '',
  tipo: 'apartamento' as TipoUnidad,
  descripcion: '',
  piso: '',
  area_m2: '',
  alicuota_pct: '',
  propietario_nombre: '',
  propietario_telefono: '',
  propietario_email: '',
  activo: true,
  cliente_id: '',
  project_id: '',
  // Datos del inmueble
  direccion: '',
  datos_registrales: '',
  tipo_regimen: '' as TipoRegimen | '',
  fecha_construccion: '',
  // Estado ocupacional
  estado_ocupacional: '' as EstadoOcupacional | '',
  // Contrato de suministro
  contrato_suministro: '' as ContratoSuministro | '',
  fecha_firma_contrato: '',
  numero_contrato_suministro: '',
  fecha_vencimiento_contrato: '',
}

type FormState = typeof EMPTY_FORM

export function UnidadesSection({
  unidades,
  contadores,
  clientes,
  proyectos,
  userRole,
  currentUser,
  maxUnidadesPorTipo,
  onUnidadAdded,
  onUnidadUpdated,
  onUnidadDeleted,
  onContadorUpdated,
  canCreate: _canCreate = true,
  canEdit: _canEdit = true,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [selectedContadorIds, setSelectedContadorIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoUnidad | ''>('')
  const [filterProyecto, setFilterProyecto] = useState<string>('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const PAGE_SIZE = 24  // cards grandes, 24 ≈ 4 filas × 6 columnas en pantalla XL

  // Compute effective max per type based on the selected project filter.
  // When a specific project is selected use its limits; when showing all projects
  // sum the limits across all active projects so the counter is accurate.
  const effectiveMax = useMemo((): MaxUnidadesPorTipo | null => {
    const activeProyectos = proyectos.filter(p => p.estado === 'activo')
    if (activeProyectos.length === 0) return maxUnidadesPorTipo ?? null
    if (filterProyecto) {
      const p = activeProyectos.find(pr => pr.id === filterProyecto)
      if (!p) return null
      return {
        apartamento: p.max_unidades_apartamento,
        casa: p.max_unidades_casa,
        bodega: p.max_unidades_bodega,
        local_comercial: p.max_unidades_local_comercial,
        oficina: p.max_unidades_oficina,
        parqueadero: p.max_unidades_parqueadero,
        otro: p.max_unidades_otro,
      }
    }
    // All projects: sum each type's limits (null means unlimited, any null makes the total null)
    const sumField = (field: 'max_unidades_apartamento' | 'max_unidades_casa' | 'max_unidades_bodega' | 'max_unidades_local_comercial' | 'max_unidades_oficina' | 'max_unidades_parqueadero' | 'max_unidades_otro'): number | null => {
      let total: number | null = 0
      for (const p of activeProyectos) {
        const v = p[field]
        if (v === null) return null
        total += v
      }
      return total
    }
    return {
      apartamento: sumField('max_unidades_apartamento'),
      casa: sumField('max_unidades_casa'),
      bodega: sumField('max_unidades_bodega'),
      local_comercial: sumField('max_unidades_local_comercial'),
      oficina: sumField('max_unidades_oficina'),
      parqueadero: sumField('max_unidades_parqueadero'),
      otro: sumField('max_unidades_otro'),
    }
  }, [filterProyecto, proyectos, maxUnidadesPorTipo])

  const canEdit = !['viewer', 'visor', 'cliente'].includes(userRole)

  function startCreate() {
    setForm({ ...EMPTY_FORM, project_id: proyectos.length === 1 ? proyectos[0].id : '' })
    setSelectedContadorIds([])
    setEditingId(null)
    setIsModalOpen(true)
  }

  function startEdit(u: Unidad) {
    setForm({
      nombre: u.nombre,
      tipo: u.tipo,
      descripcion: u.descripcion ?? '',
      piso: u.piso != null ? String(u.piso) : '',
      area_m2: u.area_m2 != null ? String(u.area_m2) : '',
      alicuota_pct: u.alicuota_pct != null ? String(u.alicuota_pct) : '',
      propietario_nombre: u.propietario_nombre ?? '',
      propietario_telefono: u.propietario_telefono ?? '',
      propietario_email: u.propietario_email ?? '',
      activo: u.activo,
      cliente_id: u.cliente_id ?? '',
      project_id: u.project_id ?? '',
      direccion: u.direccion ?? '',
      datos_registrales: u.datos_registrales ?? '',
      tipo_regimen: u.tipo_regimen ?? '',
      fecha_construccion: u.fecha_construccion ?? '',
      estado_ocupacional: u.estado_ocupacional ?? '',
      contrato_suministro: u.contrato_suministro ?? '',
      fecha_firma_contrato: u.fecha_firma_contrato ?? '',
      numero_contrato_suministro: u.numero_contrato_suministro ?? '',
      fecha_vencimiento_contrato: u.fecha_vencimiento_contrato ?? '',
    })
    setSelectedContadorIds(contadores.filter(c => c.unidad_id === u.id).map(c => c.id))
    setEditingId(u.id)
    setIsModalOpen(true)
  }

  function cancelForm() {
    setIsModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setSelectedContadorIds([])
  }

  async function batchUpdateContadores(savedUnitId: string) {
    const previouslyAssigned = contadores
      .filter(c => c.unidad_id === savedUnitId)
      .map(c => c.id)
    const toAdd = selectedContadorIds.filter(id => !previouslyAssigned.includes(id))
    const toRemove = previouslyAssigned.filter(id => !selectedContadorIds.includes(id))
    if (toAdd.length > 0) {
      const { error } = await supabase
        .from('contadores')
        .update({ unidad_id: savedUnitId, updated_at: new Date().toISOString() })
        .in('id', toAdd)
      if (!error) toAdd.forEach(id => onContadorUpdated(id, { unidad_id: savedUnitId }))
    }
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from('contadores')
        .update({ unidad_id: null, updated_at: new Date().toISOString() })
        .in('id', toRemove)
      if (!error) toRemove.forEach(id => onContadorUpdated(id, { unidad_id: null }))
    }
  }

  async function handleGuardar() {
    const nombre = sanitizeInput(form.nombre)
    const errors: string[] = []
    if (!nombre || nombre.length < 1)
      errors.push('El nombre de la unidad es obligatorio')
    if (form.area_m2 && isNaN(parseFloat(form.area_m2)))
      errors.push('El área debe ser un número válido')
    if (form.piso && isNaN(parseInt(form.piso)))
      errors.push('El piso debe ser un número entero')

    if (errors.length > 0) {
      Swal.fire('Error de validación', errors.join('<br>'), 'error')
      return
    }

    // Check per-type unit limit (only for new units, not edits)
    if (!editingId && effectiveMax) {
      const max = effectiveMax[form.tipo as TipoUnidad]
      if (max !== null && max !== undefined) {
        const currentCount = unidades.filter(u => u.project_id === form.project_id && u.tipo === form.tipo).length
        if (currentCount >= max) {
          const tipoLabel = TIPOS_UNIDAD.find(t => t.value === form.tipo)?.label ?? form.tipo
          Swal.fire({
            icon: 'warning',
            title: 'Límite alcanzado',
            text: `Este proyecto tiene un máximo de ${max} unidad${max !== 1 ? 'es' : ''} de tipo "${tipoLabel}". Ya se han registrado ${currentCount}.`,
            confirmButtonText: 'Entendido',
          })
          return
        }
      }
    }

    setLoading(true)

    const payload = {
      nombre,
      tipo: form.tipo,
      descripcion: form.descripcion || null,
      piso: form.piso ? parseInt(form.piso) : null,
      area_m2: form.area_m2 ? parseFloat(form.area_m2) : null,
      alicuota_pct: form.alicuota_pct ? parseFloat(form.alicuota_pct) : null,
      propietario_nombre: form.propietario_nombre || null,
      propietario_telefono: form.propietario_telefono || null,
      propietario_email: form.propietario_email || null,
      activo: form.activo,
      cliente_id: form.cliente_id || null,
      updated_at: new Date().toISOString(),
      updated_by: currentUser.user_id,
      updated_by_name: currentUser.name || currentUser.email,
      direccion: form.direccion || null,
      datos_registrales: form.datos_registrales || null,
      tipo_regimen: form.tipo_regimen || null,
      fecha_construccion: form.fecha_construccion || null,
      estado_ocupacional: form.estado_ocupacional || null,
      contrato_suministro: form.contrato_suministro || null,
      fecha_firma_contrato: form.fecha_firma_contrato || null,
      numero_contrato_suministro: form.numero_contrato_suministro || null,
      fecha_vencimiento_contrato: form.fecha_vencimiento_contrato || null,
    }

    if (editingId) {
      // Keep company_id in sync when project changes
      const selectedProject = proyectos.find(p => p.id === form.project_id)
      const { data, error } = await supabase
        .from('unidades')
        .update({
          ...payload,
          ...(form.project_id && { project_id: form.project_id }),
          ...(selectedProject?.company_id && { company_id: selectedProject.company_id }),
        })
        .eq('id', editingId)
        .select()
        .single()

      if (!error && data) {
        onUnidadUpdated(editingId, data as Unidad)
        await batchUpdateContadores(editingId)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Unidad actualizada', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo actualizar la unidad.', 'error')
      }
    } else {
      // Resolve project_id and company_id
      const { data: userData } = await supabase
        .from('app_users')
        .select('project_id, company_id')
        .eq('id', currentUser.user_id)
        .single()

      // Use project selected in form; fallback to auto-resolve
      let projectId: string | null =
        form.project_id ||
        (userData as { project_id?: string } | null)?.project_id ||
        null
      let companyId: string | null =
        (userData as { company_id?: string } | null)?.company_id ??
        currentUser.company_id ??
        null

      if (!projectId) {
        const { data: assignment } = await supabase
          .from('user_project_assignments')
          .select('project_id')
          .eq('user_id', currentUser.user_id)
          .limit(1)
          .single()
        if (assignment) projectId = (assignment as { project_id: string }).project_id
      }

      if (!projectId && companyId) {
        const { data: proj } = await supabase
          .from('projects')
          .select('id')
          .eq('company_id', companyId)
          .limit(1)
          .single()
        if (proj) projectId = (proj as { id: string }).id
      }

      if (!projectId || !companyId) {
        Swal.fire('Error', 'No se pudo determinar el proyecto o empresa. Contacte al administrador.', 'error')
        setLoading(false)
        return
      }

      // Verificar límite de unidades de la empresa
      const [{ data: empresaData }, { count: unidadesCount }] = await Promise.all([
        supabase.from('companies').select('max_units').eq('id', companyId).single(),
        supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      ])
      const maxUnits = (empresaData as { max_units?: number } | null)?.max_units ?? 50
      const totalUnidades = unidadesCount ?? 0
      if (totalUnidades >= maxUnits) {
        Swal.fire({
          icon: 'warning',
          title: 'Límite de unidades alcanzado',
          html: `Tu empresa ha alcanzado el límite de <b>${maxUnits}</b> unidades.<br>Contacta al superadministrador para aumentar el cupo.`,
          confirmButtonText: 'Entendido',
        })
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('unidades')
        .insert({ ...payload, project_id: projectId, company_id: companyId })
        .select()
        .single()

      if (!error && data) {
        const newUnit = data as Unidad
        onUnidadAdded(newUnit)
        await batchUpdateContadores(newUnit.id)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Unidad creada', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo guardar la unidad.', 'error')
      }
    }

    setLoading(false)
  }

  async function handleToggleActivo(u: Unidad) {
    const { error } = await supabase
      .from('unidades')
      .update({ activo: !u.activo, updated_at: new Date().toISOString() })
      .eq('id', u.id)

    if (!error) {
      onUnidadUpdated(u.id, { activo: !u.activo })
    } else {
      Swal.fire('Error', 'No se pudo cambiar el estado.', 'error')
    }
  }

  async function handleEliminar(u: Unidad) {
    const contadoresAsignados = contadores.filter(c => c.unidad_id === u.id).length
    const html = contadoresAsignados > 0
      ? `La unidad <b>${u.nombre}</b> tiene <b>${contadoresAsignados}</b> contador${contadoresAsignados !== 1 ? 'es' : ''} asociado${contadoresAsignados !== 1 ? 's' : ''}.<br>Los contadores quedarán sin unidad asignada.`
      : `<b>${u.nombre}</b> será eliminada permanentemente.`

    const confirm = await Swal.fire({
      title: '¿Eliminar unidad?',
      html,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#7E9389',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return

    const { error } = await supabase.from('unidades').delete().eq('id', u.id)
    if (!error) {
      onUnidadDeleted(u.id)
      Swal.fire({ icon: 'success', title: 'Unidad eliminada', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', error.message ?? 'No se pudo eliminar la unidad.', 'error')
    }
  }

  const tipoInfo = (value: TipoUnidad) =>
    TIPOS_UNIDAD.find(t => t.value === value) ?? { label: value, icon: '📦' }

  const contadoresDeUnidad = (id: string) =>
    contadores.filter(c => c.unidad_id === id).length

  const filtered = useMemo(() => unidades.filter(u => {
    const matchSearch =
      u.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (u.propietario_nombre ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (u.descripcion ?? '').toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === '' || u.tipo === filterTipo
    const matchProyecto = filterProyecto === '' || u.project_id === filterProyecto
    return matchSearch && matchTipo && matchProyecto
  }), [unidades, search, filterTipo, filterProyecto])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = useMemo(
    () => filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [filtered, currentPage]
  )

  // Reset paginación cuando los filtros cambian o se reduce el dataset.
  useEffect(() => {
    if (currentPage > 0 && currentPage >= totalPages) setCurrentPage(0)
  }, [currentPage, totalPages])

  // Summary by tipo
  const baseUnidades = filterProyecto === '' ? unidades : unidades.filter(u => u.project_id === filterProyecto)
  const resumen = TIPOS_UNIDAD.map(t => ({
    ...t,
    total: baseUnidades.filter(u => u.tipo === t.value).length,
    max: effectiveMax?.[t.value as TipoUnidad] ?? null,
  })).filter(t => t.total > 0 || (t.max !== null))

  const inputStyle: CSSProperties = {
    padding: '10px 14px',
    border: '2px solid #E1DDD0',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }
  const labelStyle: CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: '#4a5568',
    marginBottom: '5px',
    display: 'block',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#15291F' }}>Unidades del Proyecto</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#7E9389' }}>
            Apartamentos, casas, bodegas, locales y más — luego se les asignan contadores
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {proyectos.length > 1 && (
            <select
              value={filterProyecto}
              onChange={e => setFilterProyecto(e.target.value)}
              style={{ ...inputStyle, width: '180px' }}
            >
              <option value="">Todos los proyectos</option>
              {proyectos.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          )}
          <select
            value={filterTipo}
            onChange={e => setFilterTipo(e.target.value as TipoUnidad | '')}
            style={{ ...inputStyle, width: '180px' }}
          >
            <option value="">Todos los tipos</option>
            {TIPOS_UNIDAD.map(t => (
              <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Buscar unidad o propietario..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '220px' }}
          />
          {canEdit && (
            <>
              <button
                onClick={() => setShowImportModal(true)}
                style={{
                  padding: '10px 20px',
                  background: '#EEF2EC',
                  color: '#102622',
                  border: '1px solid #C2D2CA',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                ⬆ Importar Excel
              </button>
              <button
                onClick={startCreate}
                style={{
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, #1B3B36, #577B69)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                + Nueva Unidad
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {resumen.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
          {resumen.map(r => {
            const col = TIPO_COLORES[r.value as TipoUnidad]
            const isSelected = filterTipo === r.value
            return (
              <div
                key={r.value}
                onClick={() => setFilterTipo(isSelected ? '' : r.value as TipoUnidad)}
                style={{
                  background: isSelected ? col.bg : 'white',
                  border: `2px solid ${isSelected ? col.color : '#E1DDD0'}`,
                  borderRadius: '12px',
                  padding: '12px 18px',
                  cursor: 'pointer',
                  minWidth: '120px',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '20px', marginBottom: '4px' }}>{r.icon}</div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: col.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {r.label}
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: r.max !== null && r.total >= r.max ? '#ef4444' : '#15291F', margin: '2px 0' }}>
                  {r.total}{r.max !== null ? <span style={{ fontSize: '13px', fontWeight: 500, color: '#7E9389' }}>/{r.max}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Form Modal */}
      {isModalOpen && canEdit && (
        <EditModal title={editingId ? 'Editar Unidad' : 'Nueva Unidad'} onClose={cancelForm} maxWidth="820px">
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Datos de la Unidad
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              {proyectos.length > 1 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Proyecto *</label>
                  <select
                    style={inputStyle}
                    value={form.project_id}
                    onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                  >
                    <option value="">— Seleccionar proyecto —</option>
                    {proyectos.map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle}>Nombre / Número *</label>
                <input
                  style={inputStyle}
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej: Apto 101, Casa 5, Local A..."
                  maxLength={100}
                />
              </div>
              <div>
                <label style={labelStyle}>Tipo de Unidad *</label>
                <select
                  style={inputStyle}
                  value={form.tipo}
                  onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoUnidad }))}
                >
                  {TIPOS_UNIDAD.map(t => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Piso</label>
                <input
                  style={inputStyle}
                  type="number"
                  value={form.piso}
                  onChange={e => setForm(f => ({ ...f, piso: e.target.value }))}
                  placeholder="Ej: 1, 2, -1 (sótano)..."
                />
              </div>
              <div>
                <label style={labelStyle}>Área (m²)</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.area_m2}
                  onChange={e => setForm(f => ({ ...f, area_m2: e.target.value }))}
                  placeholder="Ej: 85.50"
                />
              </div>
              <div>
                <label style={labelStyle} title="Porcentaje de participación en gastos comunes (0-100). Si no se define, se calcula proporcionalmente por área.">Alícuota % <span style={{ color: '#7E9389', fontWeight: 400 }}>(opcional)</span></label>
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  max="100"
                  step="0.0001"
                  value={form.alicuota_pct}
                  onChange={e => setForm(f => ({ ...f, alicuota_pct: e.target.value }))}
                  placeholder="Ej: 3.2500"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Descripción</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '56px', resize: 'vertical' }}
                  value={form.descripcion}
                  onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                  placeholder="Notas adicionales sobre la unidad..."
                  maxLength={500}
                />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Datos del Propietario / Ocupante
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Nombre</label>
                <input
                  style={inputStyle}
                  value={form.propietario_nombre}
                  onChange={e => setForm(f => ({ ...f, propietario_nombre: e.target.value }))}
                  placeholder="Nombre del propietario..."
                  maxLength={150}
                />
              </div>
              <div>
                <label style={labelStyle}>Teléfono</label>
                <input
                  style={inputStyle}
                  type="tel"
                  value={form.propietario_telefono}
                  onChange={e => setForm(f => ({ ...f, propietario_telefono: e.target.value }))}
                  placeholder="Teléfono de contacto..."
                  maxLength={20}
                />
              </div>
              <div>
                <label style={labelStyle}>Correo Electrónico</label>
                <input
                  style={inputStyle}
                  type="email"
                  value={form.propietario_email}
                  onChange={e => setForm(f => ({ ...f, propietario_email: e.target.value }))}
                  placeholder="email@ejemplo.com"
                  maxLength={150}
                />
              </div>
            </div>
          </div>

          {/* Datos del Inmueble */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Datos del Inmueble
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Dirección</label>
                <input
                  style={inputStyle}
                  value={form.direccion}
                  onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                  placeholder="Dirección de la unidad..."
                  maxLength={255}
                />
              </div>
              <div>
                <label style={labelStyle}>Tipo de Régimen</label>
                <select
                  style={inputStyle}
                  value={form.tipo_regimen}
                  onChange={e => setForm(f => ({ ...f, tipo_regimen: e.target.value as TipoRegimen | '' }))}
                >
                  <option value="">— Sin especificar —</option>
                  {TIPOS_REGIMEN.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Fecha de Construcción</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.fecha_construccion}
                  onChange={e => setForm(f => ({ ...f, fecha_construccion: e.target.value }))}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Datos Registrales</label>
                <textarea
                  style={{ ...inputStyle, minHeight: '72px', resize: 'vertical' }}
                  value={form.datos_registrales}
                  onChange={e => setForm(f => ({ ...f, datos_registrales: e.target.value }))}
                  placeholder="Número de finca, tomo, folio, inscripción, etc..."
                  maxLength={1000}
                />
              </div>
            </div>
          </div>

          {/* Estado Ocupacional */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Estado Ocupacional
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Estado</label>
                <select
                  style={inputStyle}
                  value={form.estado_ocupacional}
                  onChange={e => setForm(f => ({ ...f, estado_ocupacional: e.target.value as EstadoOcupacional | '' }))}
                >
                  <option value="">— Sin especificar —</option>
                  {ESTADOS_OCUPACIONALES.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Contrato de Suministro */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Contrato de Suministro
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>¿Tiene Contrato?</label>
                <select
                  style={inputStyle}
                  value={form.contrato_suministro}
                  onChange={e => setForm(f => ({ ...f, contrato_suministro: e.target.value as ContratoSuministro | '' }))}
                >
                  <option value="">— Sin especificar —</option>
                  {CONTRATOS_SUMINISTRO.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Número de Contrato</label>
                <input
                  style={inputStyle}
                  value={form.numero_contrato_suministro}
                  onChange={e => setForm(f => ({ ...f, numero_contrato_suministro: e.target.value }))}
                  placeholder="Ej: CONT-2025-001..."
                  maxLength={100}
                />
              </div>
              <div>
                <label style={labelStyle}>Fecha de Firma</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.fecha_firma_contrato}
                  onChange={e => setForm(f => ({ ...f, fecha_firma_contrato: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>Fecha de Vencimiento</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.fecha_vencimiento_contrato}
                  onChange={e => setForm(f => ({ ...f, fecha_vencimiento_contrato: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
              Cliente Asignado
            </div>
            <select
              style={inputStyle}
              value={form.cliente_id}
              onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}
            >
              <option value="">— Sin cliente asignado —</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>
              ))}
            </select>
          </div>

          {/* Contadores Asignados */}
          {(() => {
            const disponibles = contadores.filter(c => c.unidad_id === null || c.unidad_id === editingId)
            return (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#7E9389', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
                  Contadores Asignados
                </div>
                {disponibles.length === 0 ? (
                  <div style={{ fontSize: '13px', color: '#7E9389', padding: '12px', background: '#FAF7EF', borderRadius: '8px', border: '1px solid #E1DDD0' }}>
                    No hay contadores disponibles para asignar.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '8px' }}>
                    {disponibles.map(c => {
                      const checked = selectedContadorIds.includes(c.id)
                      return (
                        <label
                          key={c.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: `2px solid ${checked ? '#1B3B36' : '#E1DDD0'}`,
                            background: checked ? '#EEF2EC' : '#FAF7EF',
                            cursor: 'pointer',
                            userSelect: 'none',
                            transition: 'all 0.1s',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => {
                              if (e.target.checked) setSelectedContadorIds(prev => [...prev, c.id])
                              else setSelectedContadorIds(prev => prev.filter(id => id !== c.id))
                            }}
                            style={{ width: '16px', height: '16px', accentColor: '#1B3B36', flexShrink: 0 }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '13px', color: '#15291F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              🔧 {c.numero_serie}
                            </div>
                            <div style={{ fontSize: '11px', color: '#7E9389' }}>
                              {TIPO_AGUA_LABELS[c.tipo_agua] ?? c.tipo_agua}
                              {c.marca && ` · ${c.marca}`}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
                {selectedContadorIds.length > 0 && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#102622' }}>
                    {selectedContadorIds.length} contador{selectedContadorIds.length !== 1 ? 'es' : ''} seleccionado{selectedContadorIds.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )
          })()}

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Estado:</label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, activo: !f.activo }))}
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '13px',
                background: form.activo ? '#dcfce7' : '#fee2e2',
                color: form.activo ? '#166534' : '#991b1b',
              }}
            >
              {form.activo ? 'Activa' : 'Inactiva'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{
                padding: '10px 24px',
                background: loading ? '#7E9389' : 'linear-gradient(135deg, #1B3B36, #577B69)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              {loading ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}
            </button>
            <button
              onClick={cancelForm}
              style={{
                padding: '10px 24px',
                background: '#EAE6D8',
                color: '#3E5A4C',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancelar
            </button>
          </div>
        </EditModal>
      )}

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
          <EmptyState
            icon="🏗️"
            title={search || filterTipo ? 'Sin resultados' : 'No hay unidades registradas'}
            description={search || filterTipo
              ? 'Intenta con otro término o tipo'
              : canEdit
                ? 'Crea la primera unidad con el botón "+ Nueva Unidad"'
                : 'No hay unidades configuradas aún'}
          />
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {paginated.map(u => (
              <UnidadCard
                key={u.id}
                unidad={u}
                tipo={tipoInfo(u.tipo)}
                tipoColor={TIPO_COLORES[u.tipo]}
                nContadores={contadoresDeUnidad(u.id)}
                proyectoNombre={proyectos.length > 1 ? proyectos.find(p => p.id === u.project_id)?.nombre : undefined}
                clienteAsignado={u.cliente_id ? clientes.find(c => c.id === u.cliente_id) : undefined}
                canEdit={canEdit}
                onEdit={() => startEdit(u)}
                onToggleActivo={() => handleToggleActivo(u)}
                onEliminar={() => handleEliminar(u)}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13 }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                style={pageBtnStyle(currentPage === 0)}
              >
                ← Anterior
              </button>
              <span style={{ color: '#3E5A4C', fontWeight: 600 }}>
                Página {currentPage + 1} de {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                style={pageBtnStyle(currentPage >= totalPages - 1)}
              >
                Siguiente →
              </button>
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 16, color: '#7E9389', fontSize: 12 }}>
        {filtered.length} unidad{filtered.length !== 1 ? 'es' : ''}{' '}
        {search || filterTipo ? 'encontradas' : 'registradas'} ·{' '}
        {unidades.filter(u => u.activo).length} activa{unidades.filter(u => u.activo).length !== 1 ? 's' : ''}
      </div>

      {showImportModal && (
        <Suspense fallback={null}>
        <ImportUnidadesModal
          currentUser={currentUser}
          onClose={() => setShowImportModal(false)}
          onImportado={(nuevas) => {
            nuevas.forEach(u => onUnidadAdded(u))
            setShowImportModal(false)
          }}
        />
        </Suspense>
      )}
    </div>
  )
}

// ── Sub-componente UnidadCard ────────────────────────────────────────────
// Extraído del render principal para reducir el cuerpo de UnidadesSection
// y dejar la card como una unidad de UI testeable / memoizable a futuro.

function UnidadCard({
  unidad: u,
  tipo,
  tipoColor: col,
  nContadores,
  proyectoNombre,
  clienteAsignado,
  canEdit,
  onEdit,
  onToggleActivo,
  onEliminar,
}: {
  unidad: Unidad
  tipo: { icon: string; label: string }
  tipoColor: { bg: string; color: string }
  nContadores: number
  proyectoNombre?: string
  clienteAsignado?: Cliente
  canEdit: boolean
  onEdit: () => void
  onToggleActivo: () => void
  onEliminar: () => void
}) {
  const tag = getEditedTagInfo(u.updated_at, u.updated_by_name)
  return (
    <div
      style={{
        background: 'white',
        borderRadius: 14,
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        overflow: 'hidden',
        border: u.activo ? '1px solid #E1DDD0' : '1px solid #fca5a5',
        opacity: u.activo ? 1 : 0.75,
      }}
    >
      {/* Top stripe color por tipo */}
      <div style={{ height: 4, background: col.color }} />

      <div style={{ padding: 18 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{tipo.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F' }}>{u.nombre}</div>
              <span style={{
                display: 'inline-block', padding: '2px 9px',
                borderRadius: 10, background: col.bg, color: col.color,
                fontSize: 11, fontWeight: 600, marginTop: 2,
              }}>
                {tipo.label}
              </span>
              {proyectoNombre && (
                <div style={{ fontSize: 11, color: '#7E9389', marginTop: 3 }}>🏗️ {proyectoNombre}</div>
              )}
            </div>
          </div>
          <span style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
            background: u.activo ? '#dcfce7' : '#fee2e2',
            color: u.activo ? '#166534' : '#991b1b', flexShrink: 0,
          }}>
            {u.activo ? 'Activa' : 'Inactiva'}
          </span>
        </div>

        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, fontSize: 13, color: '#3E5A4C' }}>
          {(u.piso != null || u.area_m2 != null) && (
            <div style={{ display: 'flex', gap: 16 }}>
              {u.piso != null && <span>🏢 Piso {u.piso}</span>}
              {u.area_m2 != null && <span>📐 {formatNumber(Number(u.area_m2))} m²</span>}
            </div>
          )}
          {u.propietario_nombre && <div>👤 {u.propietario_nombre}</div>}
          {u.propietario_telefono && <div>📞 {u.propietario_telefono}</div>}
          {u.propietario_email && (
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ✉️ {u.propietario_email}
            </div>
          )}
          {u.descripcion && <div style={{ color: '#7E9389', fontStyle: 'italic' }}>{u.descripcion}</div>}
          {u.direccion && <div>📍 {u.direccion}</div>}
          {u.estado_ocupacional && (
            <div>
              <span style={{
                display: 'inline-block', padding: '2px 9px', borderRadius: 10,
                background: '#EEF2EC', color: '#102622', fontSize: 11, fontWeight: 600,
              }}>
                {ESTADOS_OCUPACIONALES.find(e => e.value === u.estado_ocupacional)?.label ?? u.estado_ocupacional}
              </span>
            </div>
          )}
          {u.contrato_suministro && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                background: u.contrato_suministro === 'si' ? '#dcfce7' : u.contrato_suministro === 'no' ? '#fee2e2' : '#EAE6D8',
                color:      u.contrato_suministro === 'si' ? '#166534' : u.contrato_suministro === 'no' ? '#991b1b' : '#3E5A4C',
              }}>
                📄 Contrato: {CONTRATOS_SUMINISTRO.find(c => c.value === u.contrato_suministro)?.label ?? u.contrato_suministro}
              </span>
              {u.numero_contrato_suministro && (
                <span style={{ fontSize: 11, color: '#7E9389' }}>#{u.numero_contrato_suministro}</span>
              )}
              {u.fecha_vencimiento_contrato && (
                <span style={{ fontSize: 11, color: '#7E9389' }}>Vence: {formatDate(u.fecha_vencimiento_contrato)}</span>
              )}
            </div>
          )}
        </div>

        {/* Cliente asignado */}
        {clienteAsignado && (
          <div style={{ marginBottom: 8, fontSize: 13, color: '#102622', fontWeight: 600 }}>
            👤 {clienteAsignado.nombre} <span style={{ fontWeight: 400, color: '#7E9389' }}>({clienteAsignado.codigo})</span>
          </div>
        )}

        {/* Contadores badge + edited tag */}
        <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            padding: '4px 12px', borderRadius: 20,
            background: nContadores > 0 ? '#EEF2EC' : '#FAF7EF',
            color: nContadores > 0 ? '#102622' : '#7E9389',
            fontSize: 12, fontWeight: 600,
            border: `1px solid ${nContadores > 0 ? '#C2D2CA' : '#E1DDD0'}`,
          }}>
            🔧 {nContadores} contador{nContadores !== 1 ? 'es' : ''} asignado{nContadores !== 1 ? 's' : ''}
          </span>
          {tag && (
            <span
              title={tag.tooltip}
              style={{
                padding: '3px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                color: tag.color, background: tag.bg, cursor: 'default',
              }}
            >
              {tag.label}
            </span>
          )}
        </div>

        {/* Actions */}
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onEdit}
              style={{
                flex: 1, padding: '7px 0', background: '#EEF2EC', color: '#102622',
                border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >
              Editar
            </button>
            <button
              onClick={onToggleActivo}
              style={{
                flex: 1, padding: '7px 0',
                background: u.activo ? '#fef9c3' : '#f0fdf4',
                color: u.activo ? '#854d0e' : '#166534',
                border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >
              {u.activo ? 'Desactivar' : 'Activar'}
            </button>
            <button
              onClick={onEliminar}
              style={{
                padding: '7px 12px', background: '#fef2f2', color: '#dc2626',
                border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function pageBtnStyle(disabled: boolean): CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 8,
    border: '1px solid #E1DDD0',
    background: disabled ? '#EAE6D8' : 'white',
    color: disabled ? '#C7C2B0' : '#3E5A4C',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600, fontSize: 12,
  }
}
