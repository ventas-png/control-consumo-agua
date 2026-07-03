import { useState, useMemo, lazy, Suspense } from 'react'
import { confirm, notify } from '../shared/Dialog'
import type { Contador, Tarifa, TipoAgua, Unidad } from '../../types'
import { useSession } from '../shared/SessionContext'
import { updateContador, setContadorActivo, deleteContador } from '../../domain/contadores/mutations'
import { validatedInsert } from '../../lib/validatedInsert'
import { contadorInputSchema } from '../../domain/agua/schemas'
import { sanitizeInput } from '../../lib/validation'
import { DataTable } from '../shared'
import {
  construirPayloadContador,
  filtrarContadores,
  resumenPorTipo,
  validarContador,
  type ContadorForm,
} from '../../lib/contadoresReglas'
import { EMPTY_FORM, type ContadoresCtx } from './ctx'
import { inputStyle, TIPO_COLORES, TIPOS_AGUA } from './ui'
import { ContadorFormModal } from './ContadorFormModal'
import { buildContadoresColumns } from './columnas'

const ImportContadoresModal = lazy(() => import('./ImportContadoresModal').then(m => ({ default: m.ImportContadoresModal })))

interface Props {
  contadores: Contador[]
  tarifas: Tarifa[]
  unidades: Unidad[]
  moneda?: string
  onContadorAdded: (contador: Contador) => void
  onContadorUpdated: (id: string, partial: Partial<Contador>) => void
  onContadorDeleted: (id: string) => void
  canDelete?: boolean
}

export function ContadoresSection({
  contadores,
  tarifas,
  unidades,
  moneda = 'Q',
  onContadorAdded,
  onContadorUpdated,
  onContadorDeleted,
  canDelete: canDeleteProp = true,
}: Props) {
  const currentUser = useSession()
  const [form, setForm] = useState<ContadorForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoAgua | ''>('')
  const [filterUnidad, setFilterUnidad] = useState<string>('')
  const [showImport, setShowImport] = useState(false)

  const canEdit = !['viewer', 'visor', 'cliente'].includes(currentUser.role)
  // Eliminar conserva la condición de rol y además exige el permiso granular (RBAC)
  const canDelete = canEdit && canDeleteProp

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

    const errors = validarContador(numero_serie, lectura_inicial)
    if (errors.length > 0) {
      notify({ variant: 'error', title: 'Error de validación', text: errors.join('<br>') })
      return
    }

    setLoading(true)
    const payloadBase = construirPayloadContador(form, numero_serie, lectura_inicial)

    if (editingId) {
      // Re-derive project/company from the (possibly changed) unit so they stay in sync
      const selectedUnidad = unidades.find(u => u.id === form.unidad_id)
      const updatedProjectId = selectedUnidad?.project_id ?? null
      const updatedCompanyId = selectedUnidad?.company_id ?? null

      const { data, error } = await updateContador(editingId, {
          ...payloadBase,
          ...(updatedProjectId && { project_id: updatedProjectId }),
          ...(updatedCompanyId && { company_id: updatedCompanyId }),
          updated_at: new Date().toISOString(),
          updated_by: currentUser.user_id,
          updated_by_name: currentUser.name || currentUser.email,
        })

      if (!error && data) {
        onContadorUpdated(editingId, data as Contador)
        cancelForm()
        notify({ variant: 'success', title: 'Contador actualizado', duration: 1800 })
      } else {
        notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo actualizar el contador.' })
      }
    } else {
      // Derive project_id and company_id from the selected unidad, not from the current user.
      // This ensures the contador always belongs to the same project as its unit,
      // regardless of which project the creator is primarily assigned to.
      const selectedUnidad = unidades.find(u => u.id === form.unidad_id)
      const projectId: string | null = selectedUnidad?.project_id ?? null
      const companyId: string | null = selectedUnidad?.company_id ?? currentUser.company_id ?? null

      if (!projectId || !companyId) {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo determinar el proyecto o empresa. Contacte al administrador.' })
        setLoading(false)
        return
      }

      // agua:C6 — pre-validación Zod en boundary de persistencia.
      // `.passthrough()` preserva los campos físicos del medidor (medida,
      // material, válvula, etc.) que no están en el schema de input.
      const { data, error } = await validatedInsert(
        'contadores',
        contadorInputSchema.passthrough(),
        {
          ...payloadBase,
          project_id: projectId,
          company_id: companyId,
        },
        { returning: true },
      )

      const insertedContador = data?.[0]
      if (!error && insertedContador) {
        // El schema infiere shape sin `id` (system-generated); el row real
        // viene completo desde Supabase via .select(). Cast vía unknown.
        onContadorAdded(insertedContador as unknown as Contador)
        cancelForm()
        notify({ variant: 'success', title: 'Contador creado', duration: 1800 })
      } else {
        notify({ variant: 'error', title: 'Error', text: error?.message ?? 'No se pudo guardar el contador.' })
      }
    }

    setLoading(false)
  }

  async function handleToggleActivo(c: Contador) {
    const { error } = await setContadorActivo(c.id, !c.activo)

    if (!error) {
      onContadorUpdated(c.id, { activo: !c.activo })
    } else {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
    }
  }

  async function handleEliminar(c: Contador) {
    const conf = await confirm({
      title: '¿Eliminar contador?',
      text: `${c.numero_serie} será eliminado permanentemente.`,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, eliminar',
    })
    if (!conf.isConfirmed) return

    const { error } = await deleteContador(c.id)
    if (!error) {
      onContadorDeleted(c.id)
      notify({ variant: 'success', title: 'Contador eliminado', duration: 1500 })
    } else {
      notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo eliminar el contador.' })
    }
  }

  const filtered = filtrarContadores(contadores, search, filterTipo, filterUnidad)

  const ctx: ContadoresCtx = {
    tarifas, unidades, moneda, canEdit, canDelete,
    form, setForm, editingId, loading,
    cancelForm, handleGuardar, startEdit, handleEliminar, handleToggleActivo,
  }

  // Columnas de la tabla de contadores. Memoizar evita re-build cada render
  // del padre y permite que React.memo en sub-componentes funcione.
  const columns = useMemo(() => buildContadoresColumns(ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, canDelete, unidades, tarifas])

  // Summary by tipo_agua
  const resumen = resumenPorTipo(contadores, TIPOS_AGUA)

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
                  background: filterTipo === r.value ? col.bg : 'var(--at-surface)',
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
      {isModalOpen && canEdit && <ContadorFormModal ctx={ctx} />}

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
