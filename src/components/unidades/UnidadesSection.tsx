import { useState, useEffect, useMemo, Suspense } from 'react'
import { lazySafe as lazy } from '../../lib/lazyWithPreload'
import { confirm, notify } from '../shared/Dialog'
import { promptUpgrade } from '../shared/promptUpgrade'
import type { Unidad, TipoUnidad, Contador, Proyecto, MaxUnidadesPorTipo, Cliente } from '../../types'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import { resolveUnidadProjectCompany, checkUnidadesLimit } from '../../domain/unidades/queries'
import { createUnidad, updateUnidad, setUnidadActiva, deleteUnidad, assignContadoresToUnidad, unlinkContadores } from '../../domain/unidades/mutations'
import { sanitizeInput } from '../../lib/validation'
import { EmptyState } from '../shared'

import { EMPTY_FORM, type FormState, type UnidadesCtx } from './ctx'
import { TIPOS_UNIDAD, TIPO_COLORES, inputStyle } from './ui'
import { UnidadFormModal } from './UnidadFormModal'
import { UnidadCard, pageBtnStyle } from './UnidadCard'
import { UnidadResidentesModal } from './UnidadResidentesModal'

const ImportUnidadesModal = lazy(() => import('./ImportUnidadesModal').then(m => ({ default: m.ImportUnidadesModal })))

interface Props {
  unidades: Unidad[]
  contadores: Contador[]
  clientes: Cliente[]
  proyectos: Proyecto[]
  maxUnidadesPorTipo?: MaxUnidadesPorTipo | null
  onUnidadAdded: (unidad: Unidad) => void
  onUnidadUpdated: (id: string, partial: Partial<Unidad>) => void
  onUnidadDeleted: (id: string) => void
  onContadorUpdated: (id: string, partial: Partial<Contador>) => void
}

export function UnidadesSection({
  unidades,
  contadores,
  clientes,
  proyectos,
  maxUnidadesPorTipo,
  onUnidadAdded,
  onUnidadUpdated,
  onUnidadDeleted,
  onContadorUpdated,
}: Props) {
  const currentUser = useSession()
  const perms = usePermissionsContext()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [selectedContadorIds, setSelectedContadorIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<TipoUnidad | ''>('')
  const [filterProyecto, setFilterProyecto] = useState<string>('')
  const [showImportModal, setShowImportModal] = useState(false)
  // Portal propietario/inquilino (fase 3): unidad cuyos residentes se gestionan.
  const [residentesModal, setResidentesModal] = useState<Unidad | null>(null)
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

  const canEdit = !['viewer', 'visor', 'cliente'].includes(currentUser.role)
  // RBAC granular: eliminar unidad requiere el permiso delete del módulo
  // (además de la condición de rol existente). Crear/editar no cambian.
  const canDelete = canEdit && perms.canDelete('unidades')

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
      const { error } = await assignContadoresToUnidad(savedUnitId, toAdd)
      if (!error) toAdd.forEach(id => onContadorUpdated(id, { unidad_id: savedUnitId }))
    }
    if (toRemove.length > 0) {
      const { error } = await unlinkContadores(toRemove)
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
      notify({ variant: 'error', title: 'Error de validación', text: errors.join('<br>') })
      return
    }

    // Check per-type unit limit (only for new units, not edits)
    if (!editingId && effectiveMax) {
      const max = effectiveMax[form.tipo as TipoUnidad]
      if (max !== null && max !== undefined) {
        const currentCount = unidades.filter(u => u.project_id === form.project_id && u.tipo === form.tipo).length
        if (currentCount >= max) {
          const tipoLabel = TIPOS_UNIDAD.find(t => t.value === form.tipo)?.label ?? form.tipo
          notify({
            variant: 'warning',
            title: 'Límite alcanzado',
            text: `Este proyecto tiene un máximo de ${max} unidad${max !== 1 ? 'es' : ''} de tipo "${tipoLabel}". Ya se han registrado ${currentCount}.`,
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
      const { data, error } = await updateUnidad(editingId, {
        ...payload,
        ...(form.project_id && { project_id: form.project_id }),
        ...(selectedProject?.company_id && { company_id: selectedProject.company_id }),
      })

      if (!error && data) {
        onUnidadUpdated(editingId, data as Unidad)
        await batchUpdateContadores(editingId)
        cancelForm()
        notify({ variant: 'success', title: 'Unidad actualizada', duration: 1800 })
      } else {
        notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo actualizar la unidad.' })
      }
    } else {
      // Resolve project_id and company_id
      const { projectId, companyId } = await resolveUnidadProjectCompany(
        currentUser.user_id,
        form.project_id || null,
        currentUser.company_id ?? null,
      )

      if (!projectId || !companyId) {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo determinar el proyecto o empresa. Contacte al administrador.' })
        setLoading(false)
        return
      }

      // Verificar limite de unidades de la empresa. F4.1.2: si esta al limite,
      // mostrar prompt con CTA "Ver planes" en lugar de un notify que solo
      // dirigia al usuario a contactar al superadmin.
      const { maxUnits, total: totalUnidades } = await checkUnidadesLimit(companyId)
      if (totalUnidades >= maxUnits) {
        await promptUpgrade({
          resource: 'unit',
          current: totalUnidades,
          limit: maxUnits,
        })
        setLoading(false)
        return
      }

      const { data, error } = await createUnidad({ ...payload, project_id: projectId, company_id: companyId })

      if (!error && data) {
        const newUnit = data as Unidad
        onUnidadAdded(newUnit)
        await batchUpdateContadores(newUnit.id)
        cancelForm()
        notify({ variant: 'success', title: 'Unidad creada', duration: 1800 })
      } else {
        notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo guardar la unidad.' })
      }
    }

    setLoading(false)
  }

  async function handleToggleActivo(u: Unidad) {
    const { error } = await setUnidadActiva(u.id, !u.activo)

    if (!error) {
      onUnidadUpdated(u.id, { activo: !u.activo })
    } else {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
    }
  }

  async function handleEliminar(u: Unidad) {
    const contadoresAsignados = contadores.filter(c => c.unidad_id === u.id).length
    const detalle = contadoresAsignados > 0
      ? `La unidad ${u.nombre} tiene ${contadoresAsignados} contador${contadoresAsignados !== 1 ? 'es' : ''} asociado${contadoresAsignados !== 1 ? 's' : ''}. Los contadores quedarán sin unidad asignada.`
      : `${u.nombre} será eliminada permanentemente.`

    const conf = await confirm({
      title: '¿Eliminar unidad?',
      text: detalle,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, eliminar',
    })
    if (!conf.isConfirmed) return

    const { error } = await deleteUnidad(u.id)
    if (!error) {
      onUnidadDeleted(u.id)
      notify({ variant: 'success', title: 'Unidad eliminada', duration: 1500 })
    } else {
      notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo eliminar la unidad.' })
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

  const ctx: UnidadesCtx = {
    contadores, clientes, proyectos, canEdit,
    form, setForm, selectedContadorIds, setSelectedContadorIds, editingId, loading,
    cancelForm, handleGuardar,
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)' }}>Unidades del Proyecto</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--at-ink-3)' }}>
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
                  background: 'var(--at-primary-tint)',
                  color: 'var(--at-primary-hover)',
                  border: '1px solid var(--at-primary-soft-2)',
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
                  background: isSelected ? col.bg : 'var(--at-surface)',
                  border: `2px solid ${isSelected ? col.color : 'var(--at-line)'}`,
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
                <div style={{ fontSize: '22px', fontWeight: 700, color: r.max !== null && r.total >= r.max ? 'var(--at-danger)' : 'var(--at-ink)', margin: '2px 0' }}>
                  {r.total}{r.max !== null ? <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--at-ink-3)' }}>/{r.max}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Form Modal */}
      {isModalOpen && canEdit && <UnidadFormModal ctx={ctx} />}

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div style={{ background: 'var(--at-surface)', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
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
                canDelete={canDelete}
                onEdit={() => startEdit(u)}
                onToggleActivo={() => handleToggleActivo(u)}
                onEliminar={() => handleEliminar(u)}
                onResidentes={() => setResidentesModal(u)}
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
              <span style={{ color: 'var(--at-ink-2)', fontWeight: 600 }}>
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

      <div style={{ marginTop: 16, color: 'var(--at-ink-3)', fontSize: 12 }}>
        {filtered.length} unidad{filtered.length !== 1 ? 'es' : ''}{' '}
        {search || filterTipo ? 'encontradas' : 'registradas'} ·{' '}
        {unidades.filter(u => u.activo).length} activa{unidades.filter(u => u.activo).length !== 1 ? 's' : ''}
      </div>

      {residentesModal && (
        <UnidadResidentesModal
          unidad={residentesModal}
          clientes={clientes}
          onClose={() => setResidentesModal(null)}
        />
      )}

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
