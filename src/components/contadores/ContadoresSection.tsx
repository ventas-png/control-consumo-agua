import { useState, useMemo, lazy, Suspense, type CSSProperties} from 'react'
import Swal from 'sweetalert2'
import type { Contador, Tarifa, TipoAgua, UserRole, UserSession, Unidad } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput } from '../../lib/validation'
import { EditModal } from '../shared/EditModal'
import { DataTable, type DataTableColumn } from '../shared'
import { formatDate, formatNumber } from '../../lib/format'
import { getEditedTagInfo } from '../../lib/timeUtils'

const ImportContadoresModal = lazy(() => import('./ImportContadoresModal').then(m => ({ default: m.ImportContadoresModal })))

interface Props {
  contadores: Contador[]
  tarifas: Tarifa[]
  unidades: Unidad[]
  userRole: UserRole
  currentUser: UserSession
  moneda?: string
  onContadorAdded: (contador: Contador) => void
  onContadorUpdated: (id: string, partial: Partial<Contador>) => void
  onContadorDeleted: (id: string) => void
  canCreate?: boolean
  canEdit?: boolean
}

const TIPOS_AGUA: { value: TipoAgua; label: string }[] = [
  { value: 'potable', label: 'Potable' },
  { value: 'rehuso', label: 'Rehúso' },
  { value: 'piscina', label: 'Piscina' },
  { value: 'desalinada', label: 'Desalinada' },
  { value: 'riego', label: 'Riego' },
  { value: 'jacuzzi', label: 'Jacuzzi' },
  { value: 'consumo_humano', label: 'Consumo Humano' },
  { value: 'desmineralizada', label: 'Desmineralizada' },
  { value: 'residuales_tratadas', label: 'Residuales Tratadas' },
]

const TIPO_COLORES: Record<TipoAgua, { bg: string; color: string }> = {
  potable:             { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  rehuso:              { bg: '#dcfce7', color: '#166534' },
  piscina:             { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  desalinada:          { bg: '#fef9c3', color: '#854d0e' },
  riego:               { bg: '#d1fae5', color: '#065f46' },
  jacuzzi:             { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-darker)' },
  consumo_humano:      { bg: '#ffedd5', color: '#c2410c' },
  desmineralizada:     { bg: '#fce7f3', color: '#9d174d' },
  residuales_tratadas: { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
}

const MEDIDAS_CONTADOR = [
  '1/2"  (½") — 15 mm',
  '3/4"  (¾") — 20 mm',
  '1"    — 25 mm',
  '1 1/4" — 32 mm',
  '1 1/2" — 40 mm',
  '2"    — 50 mm',
  '2 1/2" — 63 mm',
  '3"    — 75 mm',
  '4"    — 110 mm',
  '5"    — 140 mm',
  '6"    — 160 mm',
]
const MATERIALES_CONTADOR = [
  'Bronce',
  'Latón',
  'Hierro fundido',
  'Hierro galvanizado',
  'Acero inoxidable',
  'Cobre',
  'Plástico (PVC)',
  'Plástico (polipropileno)',
  'Plástico (nylon reforzado)',
  'Composite (plástico/metal)',
]
const TIPOS_CONTADOR = ['Analógico velocimétrico', 'Analógico volumétrico', 'Digital', 'Ultrasónico', 'Electromagnético', 'Otro']
const OPCIONES_SIN = ['Sí', 'No', 'N/A']
const OPCIONES_SI_NO = ['Sí', 'No']
const TIPOS_LLAVE = ['Compuerta', 'Bola', 'Mariposa', 'Globo', 'Aguja', 'Otra']

const EMPTY_FORM = {
  numero_serie: '',
  tipo_agua: 'potable' as TipoAgua,
  descripcion: '',
  marca: '',
  modelo: '',
  fecha_instalacion: '',
  lectura_inicial: '0',
  activo: true,
  tarifa_id: '' as string,
  unidad_id: '' as string,
  medida: '',
  material: '',
  tipo_contador: '',
  valvula_cheque: '',
  tipo_llave: '',
  llave_antifraude: '',
  valvula_aire: '',
  fecha_reemplazo_sugerida: '',
  numero_derecho_servicio: '',
  cantidad_derecho_servicio_m3: '',
  periodicidad_lectura_dias: '',
  contratista_instalador: '',
  garantia_instalacion_vence: '',
}

type FormState = typeof EMPTY_FORM

export function ContadoresSection({
  contadores,
  tarifas,
  unidades,
  userRole,
  currentUser,
  moneda = 'Q',
  onContadorAdded,
  onContadorUpdated,
  onContadorDeleted,
  canCreate: _canCreate = true,
  canEdit: _canEdit = true,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoAgua | ''>('')
  const [filterUnidad, setFilterUnidad] = useState<string>('')
  const [showImport, setShowImport] = useState(false)

  const canEdit = !['viewer', 'visor', 'cliente'].includes(userRole)

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setIsModalOpen(true)
  }

  function startEdit(c: Contador) {
    setForm({
      numero_serie: c.numero_serie,
      tipo_agua: c.tipo_agua,
      descripcion: c.descripcion ?? '',
      marca: c.marca ?? '',
      modelo: c.modelo ?? '',
      fecha_instalacion: c.fecha_instalacion ?? '',
      lectura_inicial: String(c.lectura_inicial),
      activo: c.activo,
      tarifa_id: c.tarifa_id ?? '',
      unidad_id: c.unidad_id ?? '',
      medida: c.medida ?? '',
      material: c.material ?? '',
      tipo_contador: c.tipo_contador ?? '',
      valvula_cheque: c.valvula_cheque ?? '',
      tipo_llave: c.tipo_llave ?? '',
      llave_antifraude: c.llave_antifraude ?? '',
      valvula_aire: c.valvula_aire ?? '',
      fecha_reemplazo_sugerida: c.fecha_reemplazo_sugerida ?? '',
      numero_derecho_servicio: c.numero_derecho_servicio ?? '',
      cantidad_derecho_servicio_m3: c.cantidad_derecho_servicio_m3 != null ? String(c.cantidad_derecho_servicio_m3) : '',
      periodicidad_lectura_dias: c.periodicidad_lectura_dias != null ? String(c.periodicidad_lectura_dias) : '',
      contratista_instalador: c.contratista_instalador ?? '',
      garantia_instalacion_vence: c.garantia_instalacion_vence ?? '',
    })
    setEditingId(c.id)
    setIsModalOpen(true)
  }

  function cancelForm() {
    setIsModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleGuardar() {
    const numero_serie = sanitizeInput(form.numero_serie)
    const lectura_inicial = parseFloat(form.lectura_inicial)

    const errors: string[] = []
    if (!numero_serie || numero_serie.length < 2)
      errors.push('Número de serie debe tener al menos 2 caracteres')
    if (isNaN(lectura_inicial) || lectura_inicial < 0)
      errors.push('Lectura inicial debe ser un número mayor o igual a 0')

    if (errors.length > 0) {
      Swal.fire('Error de validación', errors.join('<br>'), 'error')
      return
    }

    setLoading(true)

    if (editingId) {
      // Re-derive project/company from the (possibly changed) unit so they stay in sync
      const selectedUnidad = unidades.find(u => u.id === form.unidad_id)
      const updatedProjectId = selectedUnidad?.project_id ?? null
      const updatedCompanyId = selectedUnidad?.company_id ?? null

      const { data, error } = await supabase
        .from('contadores')
        .update({
          numero_serie,
          tipo_agua: form.tipo_agua,
          descripcion: form.descripcion || null,
          marca: form.marca || null,
          modelo: form.modelo || null,
          fecha_instalacion: form.fecha_instalacion || null,
          lectura_inicial,
          activo: form.activo,
          tarifa_id: form.tarifa_id || null,
          unidad_id: form.unidad_id || null,
          ...(updatedProjectId && { project_id: updatedProjectId }),
          ...(updatedCompanyId && { company_id: updatedCompanyId }),
          medida: form.medida || null,
          material: form.material || null,
          tipo_contador: form.tipo_contador || null,
          valvula_cheque: form.valvula_cheque || null,
          tipo_llave: form.tipo_llave || null,
          llave_antifraude: form.llave_antifraude || null,
          valvula_aire: form.valvula_aire || null,
          fecha_reemplazo_sugerida: form.fecha_reemplazo_sugerida || null,
          numero_derecho_servicio: form.numero_derecho_servicio || null,
          cantidad_derecho_servicio_m3: form.cantidad_derecho_servicio_m3 ? parseFloat(form.cantidad_derecho_servicio_m3) : null,
          periodicidad_lectura_dias: form.periodicidad_lectura_dias ? parseInt(form.periodicidad_lectura_dias) : null,
          contratista_instalador: form.contratista_instalador || null,
          garantia_instalacion_vence: form.garantia_instalacion_vence || null,
          updated_at: new Date().toISOString(),
          updated_by: currentUser.user_id,
          updated_by_name: currentUser.name || currentUser.email,
        })
        .eq('id', editingId)
        .select()
        .single()

      if (!error && data) {
        onContadorUpdated(editingId, data as Contador)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Contador actualizado', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo actualizar el contador.', 'error')
      }
    } else {
      // Derive project_id and company_id from the selected unidad, not from the current user.
      // This ensures the contador always belongs to the same project as its unit,
      // regardless of which project the creator is primarily assigned to.
      const selectedUnidad = unidades.find(u => u.id === form.unidad_id)
      const projectId: string | null = selectedUnidad?.project_id ?? null
      const companyId: string | null = selectedUnidad?.company_id ?? currentUser.company_id ?? null

      if (!projectId || !companyId) {
        Swal.fire('Error', 'No se pudo determinar el proyecto o empresa. Contacte al administrador.', 'error')
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('contadores')
        .insert({
          numero_serie,
          tipo_agua: form.tipo_agua,
          descripcion: form.descripcion || null,
          marca: form.marca || null,
          modelo: form.modelo || null,
          fecha_instalacion: form.fecha_instalacion || null,
          lectura_inicial,
          activo: form.activo,
          tarifa_id: form.tarifa_id || null,
          unidad_id: form.unidad_id || null,
          medida: form.medida || null,
          material: form.material || null,
          tipo_contador: form.tipo_contador || null,
          valvula_cheque: form.valvula_cheque || null,
          tipo_llave: form.tipo_llave || null,
          llave_antifraude: form.llave_antifraude || null,
          valvula_aire: form.valvula_aire || null,
          fecha_reemplazo_sugerida: form.fecha_reemplazo_sugerida || null,
          numero_derecho_servicio: form.numero_derecho_servicio || null,
          cantidad_derecho_servicio_m3: form.cantidad_derecho_servicio_m3 ? parseFloat(form.cantidad_derecho_servicio_m3) : null,
          periodicidad_lectura_dias: form.periodicidad_lectura_dias ? parseInt(form.periodicidad_lectura_dias) : null,
          contratista_instalador: form.contratista_instalador || null,
          garantia_instalacion_vence: form.garantia_instalacion_vence || null,
          project_id: projectId,
          company_id: companyId,
        })
        .select()
        .single()

      if (!error && data) {
        onContadorAdded(data as Contador)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Contador creado', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo guardar el contador.', 'error')
      }
    }

    setLoading(false)
  }

  async function handleToggleActivo(c: Contador) {
    const { error } = await supabase
      .from('contadores')
      .update({ activo: !c.activo, updated_at: new Date().toISOString() })
      .eq('id', c.id)

    if (!error) {
      onContadorUpdated(c.id, { activo: !c.activo })
    } else {
      Swal.fire('Error', 'No se pudo cambiar el estado.', 'error')
    }
  }

  async function handleEliminar(c: Contador) {
    const confirm = await Swal.fire({
      title: '¿Eliminar contador?',
      html: `<b>${c.numero_serie}</b> será eliminado permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: 'var(--at-ink-3)',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return

    const { error } = await supabase.from('contadores').delete().eq('id', c.id)
    if (!error) {
      onContadorDeleted(c.id)
      Swal.fire({ icon: 'success', title: 'Contador eliminado', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', error.message ?? 'No se pudo eliminar el contador.', 'error')
    }
  }

  const tipoLabel = (value: TipoAgua) =>
    TIPOS_AGUA.find(t => t.value === value)?.label ?? value

  const tarifasParaTipo = (tipo: TipoAgua) =>
    tarifas.filter(t => t.tipo_agua === tipo && t.activa)

  const tarifaNombre = (id: string | null | undefined) =>
    id ? (tarifas.find(t => t.id === id)?.nombre ?? 'Tarifa desconocida') : null

  const unidadNombre = (id: string | null | undefined) =>
    id ? (unidades.find(u => u.id === id)?.nombre ?? 'Unidad desconocida') : null

  const filtered = contadores.filter(c => {
    const matchSearch =
      c.numero_serie.toLowerCase().includes(search.toLowerCase()) ||
      (c.marca ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.modelo ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (c.descripcion ?? '').toLowerCase().includes(search.toLowerCase())
    const matchTipo = filterTipo === '' || c.tipo_agua === filterTipo
    const matchUnidad = filterUnidad === '' || c.unidad_id === filterUnidad
    return matchSearch && matchTipo && matchUnidad
  })

  // Columnas de la tabla de contadores. Memoizar evita re-build cada render
  // del padre y permite que React.memo en sub-componentes funcione.
  const columns: DataTableColumn<Contador>[] = useMemo(() => {
    const cols: DataTableColumn<Contador>[] = [
      {
        key: 'serie', header: 'N° Serie', sortable: true,
        accessor: c => c.numero_serie,
        render: c => <SerieCell contador={c} />,
      },
      {
        key: 'tipo', header: 'Tipología', sortable: true,
        accessor: c => c.tipo_agua,
        render: c => {
          const col = TIPO_COLORES[c.tipo_agua]
          return (
            <span style={{
              padding: '3px 10px', borderRadius: 12,
              background: col.bg, color: col.color,
              fontSize: 12, fontWeight: 600,
            }}>
              {tipoLabel(c.tipo_agua)}
            </span>
          )
        },
      },
      {
        key: 'marcaModelo', header: 'Marca / Modelo',
        accessor: c => `${c.marca ?? ''} ${c.modelo ?? ''}`.trim(),
        render: c => {
          if (!c.marca && !c.modelo) return <span style={{ color: 'var(--at-line-strong)' }}>—</span>
          return (
            <span style={{ color: 'var(--at-ink-2)' }}>
              {c.marca && <span style={{ fontWeight: 500 }}>{c.marca}</span>}
              {c.marca && c.modelo && ' / '}
              {c.modelo && <span style={{ color: 'var(--at-ink-3)' }}>{c.modelo}</span>}
            </span>
          )
        },
      },
      {
        key: 'caracteristicas', header: 'Características', hideOnMobile: true,
        render: c => <CaracteristicasCell contador={c} />,
      },
      {
        key: 'lecturaInicial', header: 'Lect. Inicial', sortable: true, align: 'right',
        accessor: c => Number(c.lectura_inicial),
        render: c => (
          <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>
            {formatNumber(Number(c.lectura_inicial), 4)}
          </span>
        ),
      },
      {
        key: 'unidad', header: 'Unidad',
        accessor: c => unidadNombre(c.unidad_id) ?? '',
        render: c => {
          const nombre = unidadNombre(c.unidad_id)
          return nombre
            ? (
              <span style={{
                padding: '3px 10px', borderRadius: 12,
                background: '#f0fdf4', color: '#065f46',
                fontSize: 12, fontWeight: 600,
              }}>
                🏠 {nombre}
              </span>
            )
            : <span style={{ color: 'var(--at-line-strong)', fontSize: 13 }}>Sin unidad</span>
        },
      },
      {
        key: 'tarifa', header: 'Tarifa',
        accessor: c => tarifaNombre(c.tarifa_id) ?? '',
        render: c => {
          const nombre = tarifaNombre(c.tarifa_id)
          return nombre
            ? (
              <span style={{
                padding: '3px 10px', borderRadius: 12,
                background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)',
                fontSize: 12, fontWeight: 600,
              }}>
                {nombre}
              </span>
            )
            : <span style={{ color: 'var(--at-line-strong)', fontSize: 13 }}>Sin tarifa</span>
        },
      },
      {
        key: 'estado', header: 'Estado', sortable: true, align: 'center',
        accessor: c => c.activo ? 1 : 0,
        render: c => {
          const baseStyle: CSSProperties = {
            padding: '4px 14px', borderRadius: 20, fontWeight: 600, fontSize: 12,
            background: c.activo ? '#dcfce7' : '#fee2e2',
            color: c.activo ? '#166534' : '#991b1b',
          }
          if (canEdit) {
            return (
              <button
                onClick={() => handleToggleActivo(c)}
                title="Clic para cambiar estado"
                style={{ ...baseStyle, border: 'none', cursor: 'pointer' }}
              >
                {c.activo ? 'Activo' : 'Inactivo'}
              </button>
            )
          }
          return <span style={baseStyle}>{c.activo ? 'Activo' : 'Inactivo'}</span>
        },
      },
    ]
    if (canEdit) {
      cols.push({
        key: 'acciones', header: 'Acciones', align: 'center',
        render: c => (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            <button
              onClick={() => startEdit(c)}
              style={{
                padding: '5px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >Editar</button>
            <button
              onClick={() => handleEliminar(c)}
              style={{
                padding: '5px 12px', background: '#fef2f2', color: '#dc2626',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >Eliminar</button>
          </div>
        ),
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, unidades, tarifas])

  const inputStyle: CSSProperties = {
    padding: '10px 14px',
    border: '2px solid var(--at-line)',
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

  // Summary by tipo_agua
  const resumen = TIPOS_AGUA.map(t => ({
    ...t,
    total: contadores.filter(c => c.tipo_agua === t.value).length,
    conTarifa: contadores.filter(c => c.tipo_agua === t.value && c.tarifa_id).length,
  })).filter(t => t.total > 0)

  return (
    <>
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)' }}>Contadores</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--at-ink-3)' }}>
            Gestiona los contadores de agua por tipología
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {unidades.length > 0 && (
            <select
              value={filterUnidad}
              onChange={e => setFilterUnidad(e.target.value)}
              style={{ ...inputStyle, width: '180px' }}
            >
              <option value="">Todas las unidades</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          )}
          <select
            value={filterTipo}
            onChange={e => setFilterTipo(e.target.value as TipoAgua | '')}
            style={{ ...inputStyle, width: '180px' }}
          >
            <option value="">Todas las tipologías</option>
            {TIPOS_AGUA.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Buscar contador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '200px' }}
          />
          {canEdit && (
            <>
              <button
                onClick={() => setShowImport(true)}
                style={{
                  padding: '10px 18px',
                  background: 'var(--at-surface)',
                  color: 'var(--at-primary)',
                  border: '2px solid var(--at-primary)',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Importar Excel
              </button>
              <button
                onClick={startCreate}
                style={{
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                + Nuevo Contador
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {resumen.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
          {resumen.map(r => {
            const col = TIPO_COLORES[r.value as TipoAgua]
            return (
              <div
                key={r.value}
                onClick={() => setFilterTipo(filterTipo === r.value ? '' : r.value as TipoAgua)}
                style={{
                  background: filterTipo === r.value ? col.bg : 'white',
                  border: `2px solid ${filterTipo === r.value ? col.color : 'var(--at-line)'}`,
                  borderRadius: '12px',
                  padding: '12px 18px',
                  cursor: 'pointer',
                  minWidth: '130px',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, color: col.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {r.label}
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)', margin: '4px 0 2px' }}>
                  {r.total}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                  {r.conTarifa} con tarifa
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Form Modal */}
      {isModalOpen && canEdit && (
        <EditModal title={editingId ? 'Editar Contador' : 'Nuevo Contador'} onClose={cancelForm} maxWidth="820px">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={labelStyle}>Número de Serie *</label>
              <input
                style={inputStyle}
                value={form.numero_serie}
                onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))}
                placeholder="Ej: CTR-2024-001"
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Tipología / Tipo de Agua *</label>
              <select
                style={inputStyle}
                value={form.tipo_agua}
                onChange={e => setForm(f => ({ ...f, tipo_agua: e.target.value as TipoAgua, tarifa_id: '' }))}
              >
                {TIPOS_AGUA.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tarifa aplicable</label>
              <select
                style={inputStyle}
                value={form.tarifa_id}
                onChange={e => setForm(f => ({ ...f, tarifa_id: e.target.value }))}
              >
                <option value="">— Sin tarifa asignada —</option>
                {tarifasParaTipo(form.tipo_agua).map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} — {t.precio_m3} {moneda}/m³{Number(t.precio_m3_exceso ?? 0) > 0 ? ` (exceso: ${t.precio_m3_exceso} ${moneda}/m³)` : ''}{t.canon_fijo > 0 ? ` + ${t.canon_fijo} ${moneda} canon` : ''}
                  </option>
                ))}
                {tarifasParaTipo(form.tipo_agua).length === 0 && (
                  <option disabled value="">No hay tarifas activas para este tipo</option>
                )}
              </select>
            </div>
            {unidades.length > 0 && (
              <div>
                <label style={labelStyle}>Unidad asignada</label>
                <select
                  style={inputStyle}
                  value={form.unidad_id}
                  onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                >
                  <option value="">— Sin unidad asignada —</option>
                  {unidades.filter(u => u.activo).map(u => (
                    <option key={u.id} value={u.id}>{u.nombre}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Marca</label>
              <input
                style={inputStyle}
                value={form.marca}
                onChange={e => setForm(f => ({ ...f, marca: e.target.value }))}
                placeholder="Ej: Sensus, Elster, Itron..."
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Modelo</label>
              <input
                style={inputStyle}
                value={form.modelo}
                onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))}
                placeholder="Ej: 620M, V200, HR-E..."
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Fecha de Instalación</label>
              <input
                style={inputStyle}
                type="date"
                value={form.fecha_instalacion}
                onChange={e => setForm(f => ({ ...f, fecha_instalacion: e.target.value }))}
              />
            </div>
            <div>
              <label style={labelStyle}>Lectura Inicial (m³)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.0001"
                value={form.lectura_inicial}
                onChange={e => setForm(f => ({ ...f, lectura_inicial: e.target.value }))}
                placeholder="0.0000"
              />
            </div>
            {/* Technical fields — separator */}
            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--at-line)', paddingTop: '16px', marginTop: '4px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-primary)', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Características Técnicas e Instalación
              </div>
            </div>
            <div>
              <label style={labelStyle}>Medida del Contador</label>
              <select
                style={inputStyle}
                value={form.medida}
                onChange={e => setForm(f => ({ ...f, medida: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {MEDIDAS_CONTADOR.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Material del Contador</label>
              <select
                style={inputStyle}
                value={form.material}
                onChange={e => setForm(f => ({ ...f, material: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {MATERIALES_CONTADOR.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tipo de Contador</label>
              <select
                style={inputStyle}
                value={form.tipo_contador}
                onChange={e => setForm(f => ({ ...f, tipo_contador: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {TIPOS_CONTADOR.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Válvula de Cheque instalada</label>
              <select
                style={inputStyle}
                value={form.valvula_cheque}
                onChange={e => setForm(f => ({ ...f, valvula_cheque: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {OPCIONES_SIN.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tipo de Llave instalada</label>
              <select
                style={inputStyle}
                value={form.tipo_llave}
                onChange={e => setForm(f => ({ ...f, tipo_llave: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {TIPOS_LLAVE.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Llave Antifraude instalada</label>
              <select
                style={inputStyle}
                value={form.llave_antifraude}
                onChange={e => setForm(f => ({ ...f, llave_antifraude: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {OPCIONES_SI_NO.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Válvula Liberadora de Aire</label>
              <select
                style={inputStyle}
                value={form.valvula_aire}
                onChange={e => setForm(f => ({ ...f, valvula_aire: e.target.value }))}
              >
                <option value="">— Seleccionar —</option>
                {OPCIONES_SIN.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha Sugerida de Reemplazo</label>
              <input
                style={inputStyle}
                type="date"
                value={form.fecha_reemplazo_sugerida}
                onChange={e => setForm(f => ({ ...f, fecha_reemplazo_sugerida: e.target.value }))}
              />
            </div>
            <div>
              <label style={labelStyle}>Contratista / Instalador</label>
              <input
                style={inputStyle}
                value={form.contratista_instalador}
                onChange={e => setForm(f => ({ ...f, contratista_instalador: e.target.value }))}
                placeholder="Nombre del instalador o empresa"
                maxLength={150}
              />
            </div>
            <div>
              <label style={labelStyle}>Garantía de Instalación Vence</label>
              <input
                style={inputStyle}
                type="date"
                value={form.garantia_instalacion_vence}
                onChange={e => setForm(f => ({ ...f, garantia_instalacion_vence: e.target.value }))}
              />
            </div>
            <div>
              <label style={labelStyle}>N° Derecho de Servicio (Título de Agua)</label>
              <input
                style={inputStyle}
                value={form.numero_derecho_servicio}
                onChange={e => setForm(f => ({ ...f, numero_derecho_servicio: e.target.value }))}
                placeholder="Ej: DS-2024-00123"
                maxLength={100}
              />
            </div>
            <div>
              <label style={labelStyle}>Cantidad Derecho de Servicio (m³)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={form.cantidad_derecho_servicio_m3}
                onChange={e => setForm(f => ({ ...f, cantidad_derecho_servicio_m3: e.target.value }))}
                placeholder="Ej: 15.00"
              />
            </div>
            <div>
              <label style={labelStyle}>Periodicidad de Lectura (días)</label>
              <input
                style={inputStyle}
                type="number"
                min="1"
                step="1"
                value={form.periodicidad_lectura_dias}
                onChange={e => setForm(f => ({ ...f, periodicidad_lectura_dias: e.target.value }))}
                placeholder="Ej: 30"
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea
                style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción opcional del contador..."
                maxLength={500}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                {form.activo ? 'Activo' : 'Inactivo'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{
                padding: '10px 24px',
                background: loading ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
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
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
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

      {/* Table */}
      <DataTable<Contador>
        data={filtered}
        columns={columns}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'serie', direction: 'asc' }}
        emptyState={{
          icon: '🔧',
          title: search || filterTipo ? 'Sin resultados' : 'No hay contadores registrados',
          description: search || filterTipo
            ? 'Intenta con otro término o tipología'
            : canEdit
              ? 'Crea el primer contador con el botón "+ Nuevo Contador"'
              : 'No hay contadores configurados aún',
        }}
      />

      {/* Stats compactos abajo de la tabla */}
      <div style={{ padding: '8px 16px', color: 'var(--at-ink-3)', fontSize: 12 }}>
        {filtered.length} contador{filtered.length !== 1 ? 'es' : ''}{' '}
        {search || filterTipo || filterUnidad ? 'encontrados' : 'registrados'} ·{' '}
        {contadores.filter(c => c.unidad_id).length} con unidad ·{' '}
        {contadores.filter(c => c.tarifa_id).length} con tarifa asignada
      </div>
    </div>

    {showImport && (
      <Suspense fallback={null}>
      <ImportContadoresModal
        currentUser={currentUser}
        onClose={() => setShowImport(false)}
        onImportado={(nuevos) => {
          nuevos.forEach(c => onContadorAdded(c))
          setShowImport(false)
        }}
      />
      </Suspense>
    )}
    </>
  )
}

// ── Sub-componentes de celdas para la tabla de contadores ────────────────
// Extraídos para mantener el cuerpo de ContadoresSection más legible.

function SerieCell({ contador: c }: { contador: Contador }) {
  const tag = getEditedTagInfo(c.updated_at, c.updated_by_name)
  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{c.numero_serie}</div>
      {c.descripcion && (
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', fontWeight: 400, marginTop: 2 }}>
          {c.descripcion}
        </div>
      )}
      {c.fecha_instalacion && (
        <div style={{ fontSize: 11, color: 'var(--at-line-strong)', marginTop: 1 }}>
          Inst: {formatDate(c.fecha_instalacion)}
        </div>
      )}
      {tag && (
        <span
          title={tag.tooltip}
          style={{
            display: 'inline-block', marginTop: 4, padding: '2px 8px',
            borderRadius: 10, fontSize: 11, fontWeight: 500,
            color: tag.color, background: tag.bg, cursor: 'default',
          }}
        >
          {tag.label}
        </span>
      )}
    </div>
  )
}

function CaracteristicasCell({ contador: c }: { contador: Contador }) {
  const hasAny = c.medida || c.tipo_contador || c.material || c.valvula_cheque ||
    c.tipo_llave || c.llave_antifraude || c.valvula_aire ||
    c.fecha_reemplazo_sugerida || c.numero_derecho_servicio ||
    c.cantidad_derecho_servicio_m3 != null || c.periodicidad_lectura_dias != null ||
    c.contratista_instalador || c.garantia_instalacion_vence
  if (!hasAny) return <span style={{ color: 'var(--at-line-strong)' }}>—</span>

  const now = new Date()
  const reemplazoVencido = c.fecha_reemplazo_sugerida
    ? new Date(c.fecha_reemplazo_sugerida + 'T12:00:00') <= now
    : false
  const garantiaVencida = c.garantia_instalacion_vence
    ? new Date(c.garantia_instalacion_vence + 'T12:00:00') <= now
    : false

  return (
    <div style={{ fontSize: 12, color: 'var(--at-ink-2)' }}>
      {c.medida && <Field label="Medida" value={c.medida} />}
      {c.tipo_contador && <Field label="Tipo" value={c.tipo_contador} />}
      {c.material && <Field label="Material" value={c.material} />}
      {c.valvula_cheque && <Field label="V. Cheque" value={c.valvula_cheque} />}
      {c.tipo_llave && <Field label="Llave" value={c.tipo_llave} />}
      {c.llave_antifraude && <Field label="Antifraude" value={c.llave_antifraude} />}
      {c.valvula_aire && <Field label="V. Aire" value={c.valvula_aire} />}
      {c.fecha_reemplazo_sugerida && (
        <div style={{ color: reemplazoVencido ? '#dc2626' : 'var(--at-primary-hover)', fontWeight: 600 }}>
          Reemplazo: {formatDate(c.fecha_reemplazo_sugerida)}
        </div>
      )}
      {c.numero_derecho_servicio && <Field label="Derecho" value={c.numero_derecho_servicio} />}
      {c.cantidad_derecho_servicio_m3 != null && (
        <Field label="Caudal" value={`${Number(c.cantidad_derecho_servicio_m3).toFixed(2)} m³`} />
      )}
      {c.periodicidad_lectura_dias != null && (
        <Field label="Lectura c/" value={`${c.periodicidad_lectura_dias} días`} />
      )}
      {c.contratista_instalador && <Field label="Instalador" value={c.contratista_instalador} />}
      {c.garantia_instalacion_vence && (
        <div style={{ color: garantiaVencida ? '#dc2626' : '#059669', fontWeight: 600 }}>
          Garantía: {formatDate(c.garantia_instalacion_vence)}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><span style={{ color: 'var(--at-ink-3)' }}>{label}:</span> {value}</div>
}
