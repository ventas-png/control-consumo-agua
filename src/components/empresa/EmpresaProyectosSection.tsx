// T7 / plat:P12 — Extraído de EmpresaSection.
// Sección de proyectos del tenant: card de uso del plan (PlanUsageCard), botón
// de alta y la grilla de tarjetas con edición / cambio de estado / logo. Posee
// sus mutaciones de proyecto y refresca vía `onReload`. El gating por límite de
// plan usa `effectiveMaxProjects`, calculado en el contenedor.
import { notify } from '../shared/Dialog'
import { openTextPrompt, openPromptDialog } from '../shared/PromptDialog'
import { supabase } from '../../lib/supabase'
import type { Proyecto } from '../../types'
import { MONEDAS } from '../../types'
import { SecureImage } from '../shared/SecureImage'
import { promptUpgrade } from '../shared/promptUpgrade'
import { PlanUsageCard } from './PlanUsageCard'
import type { EmpresaInfo } from '../../domain/empresa/queries'

const ESTADO_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  activo:     { label: 'Activo',     bg: 'rgba(34,197,94,0.15)',  color: 'var(--at-success)' },
  inactivo:   { label: 'Inactivo',   bg: 'rgba(100,116,139,0.2)', color: 'var(--at-ink-3)' },
  suspendido: { label: 'Suspendido', bg: 'rgba(245,158,11,0.15)', color: 'var(--at-warning)' },
}

const TIPOS_UNIDAD_LABELS: { key: keyof Proyecto; label: string }[] = [
  { key: 'max_unidades_apartamento',     label: 'Apartamentos' },
  { key: 'max_unidades_casa',            label: 'Casas' },
  { key: 'max_unidades_bodega',          label: 'Bodegas' },
  { key: 'max_unidades_local_comercial', label: 'Locales Comerciales' },
  { key: 'max_unidades_oficina',         label: 'Oficinas' },
  { key: 'max_unidades_parqueadero',     label: 'Parqueaderos' },
  { key: 'max_unidades_otro',            label: 'Otros' },
]

interface Props {
  empresa: EmpresaInfo | null
  proyectos: Proyecto[]
  companyId: string | null | undefined
  effectiveMaxProjects: number
  onReload: () => void
}

export function EmpresaProyectosSection({ empresa, proyectos, companyId, effectiveMaxProjects, onReload }: Props) {
  async function editarProyecto(proyecto: Proyecto) {
    const monedaOptions = MONEDAS.map(m => ({ value: m.simbolo, label: `${m.simbolo} — ${m.nombre}` }))

    const fields: Array<Parameters<typeof openPromptDialog>[0]['fields'][number]> = [
      { name: 'nombre', label: 'Nombre', required: true, initialValue: proyecto.nombre, autoFocus: true },
      { name: 'descripcion', label: 'Descripción', control: 'textarea', rows: 3, initialValue: proyecto.descripcion ?? '' },
      { name: 'direccion', label: 'Dirección', placeholder: 'Ej: Calle 123 #45-67', initialValue: proyecto.direccion ?? '' },
      { name: 'latitud', label: 'Latitud', placeholder: '0.000000', initialValue: proyecto.latitud != null ? String(proyecto.latitud) : '' },
      { name: 'longitud', label: 'Longitud', placeholder: '0.000000', initialValue: proyecto.longitud != null ? String(proyecto.longitud) : '' },
      { name: 'moneda', label: '💧 Moneda Agua', control: 'select', initialValue: proyecto.moneda, options: monedaOptions },
      { name: 'moneda_condominios', label: '🏢 Moneda Condominios', control: 'select', initialValue: proyecto.moneda_condominios ?? proyecto.moneda, options: monedaOptions },
      {
        name: 'estado',
        label: 'Estado',
        control: 'select',
        initialValue: proyecto.estado ?? 'activo',
        options: [
          { value: 'activo', label: '✅ Activo' },
          { value: 'inactivo', label: '⏸ Inactivo' },
          { value: 'suspendido', label: '🚫 Suspendido' },
        ],
      },
    ]
    TIPOS_UNIDAD_LABELS.forEach(t => {
      const val = proyecto[t.key] as number | null | undefined
      fields.push({
        name: t.key,
        label: `${t.label} (límite)`,
        type: 'number',
        min: 0,
        step: 1,
        placeholder: '∞',
        initialValue: val != null ? String(val) : '',
        helpText: 'Dejar vacío = sin límite',
      })
    })

    const result = await openPromptDialog({
      title: 'Editar Proyecto',
      fields,
      submitText: 'Guardar',
      validate: (data) => data.nombre?.trim() ? null : 'El nombre es obligatorio',
    })

    if (!result) return
    const getLimit = (key: string): number | null => {
      const v = (result[key] ?? '').trim()
      if (!v) return null
      const n = parseInt(v, 10)
      return isNaN(n) || n < 0 ? null : n
    }
    const formValues = {
      nombre: result.nombre.trim(),
      descripcion: result.descripcion?.trim() || null,
      direccion: result.direccion?.trim() || null,
      latitud: result.latitud?.trim() ? parseFloat(result.latitud) : null,
      longitud: result.longitud?.trim() ? parseFloat(result.longitud) : null,
      moneda: result.moneda,
      moneda_condominios: result.moneda_condominios,
      estado: result.estado,
      max_unidades_apartamento: getLimit('max_unidades_apartamento'),
      max_unidades_casa: getLimit('max_unidades_casa'),
      max_unidades_bodega: getLimit('max_unidades_bodega'),
      max_unidades_local_comercial: getLimit('max_unidades_local_comercial'),
      max_unidades_oficina: getLimit('max_unidades_oficina'),
      max_unidades_parqueadero: getLimit('max_unidades_parqueadero'),
      max_unidades_otro: getLimit('max_unidades_otro'),
    }
    const { error } = await supabase.from('projects').update(formValues).eq('id', proyecto.id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar el proyecto.' })
    } else {
      notify({ variant: 'success', title: 'Proyecto actualizado', duration: 1200 })
      onReload()
    }
  }

  async function cambiarEstadoProyecto(proyecto: Proyecto) {
    const estados: Proyecto['estado'][] = ['activo', 'inactivo', 'suspendido']
    const actual = proyecto.estado ?? 'activo'
    const config = ESTADO_CONFIG[actual]

    const result = await openPromptDialog({
      title: 'Cambiar estado del proyecto',
      description: `Estado actual: ${config.label}`,
      fields: [{
        name: 'estado',
        label: 'Nuevo estado',
        control: 'select',
        required: true,
        options: estados.filter(e => e !== actual).map(e => ({
          value: e ?? 'activo',
          label: ESTADO_CONFIG[e ?? 'activo'].label,
        })),
        autoFocus: true,
      }],
      submitText: 'Cambiar estado',
    })
    if (!result) return
    const nuevoEstado = result.estado as Proyecto['estado']
    if (!nuevoEstado) return
    await aplicarCambioEstado(proyecto.id, nuevoEstado)
  }

  async function aplicarCambioEstado(id: string, estado: Proyecto['estado']) {
    const { error } = await supabase.from('projects').update({ estado }).eq('id', id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
    } else {
      onReload()
    }
  }

  async function subirLogoProyecto(proyectoId: string, file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${proyectoId}/logo-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('project-logos')
      .upload(path, file, { contentType: file.type })
    if (uploadError) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo subir el logo del proyecto.' })
      return
    }
    await supabase.from('projects').update({ logo_url: path }).eq('id', proyectoId)
    onReload()
  }

  async function crearProyecto() {
    if (!empresa) return
    if (proyectos.length >= effectiveMaxProjects) {
      // F4.1.2: en lugar de un notify informativo, modal con CTA "Ver planes"
      // que navega a Perfil → Mi plan con auto-scroll y plan picker abierto.
      await promptUpgrade({
        resource: 'project',
        current: proyectos.length,
        limit: effectiveMaxProjects,
      })
      return
    }

    // F3.4b: openTextPrompt accesible — antes Swal.fire con input:'text'
    // y inputValidator. Devuelve string|null sin que el caller maneje
    // formValues.value.
    const nombre = await openTextPrompt({
      title: 'Nuevo Proyecto',
      label: 'Nombre del proyecto',
      placeholder: 'Ej: Proyecto Norte',
      required: true,
      validate: (v) => !v.trim() ? 'El nombre es obligatorio' : null,
    })

    if (!nombre) return

    const { error } = await supabase.from('projects').insert({
      nombre: nombre.trim(),
      company_id: companyId,
    })

    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo crear el proyecto.' })
    } else {
      notify({ variant: 'success', title: 'Proyecto creado', duration: 1500 })
      onReload()
    }
  }

  return (
    <>
      {/* F4.2.2: card de uso del plan con barras de proyectos y unidades */}
      <div style={{ marginBottom: '24px' }}>
        <PlanUsageCard companyId={companyId ?? null} />
      </div>

      {/* Proyectos */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: 'var(--at-ink)', fontSize: '16px', fontWeight: 600, margin: 0 }}>Proyectos</h2>
          <button
            onClick={() => void crearProyecto()}
            disabled={proyectos.length >= effectiveMaxProjects}
            title={proyectos.length >= effectiveMaxProjects ? 'Límite del plan alcanzado. Actualiza desde Perfil → Mi plan.' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '9px 16px', borderRadius: '8px', border: 'none',
              background: proyectos.length >= effectiveMaxProjects
                ? 'var(--at-ink-2)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
              color: proyectos.length >= effectiveMaxProjects ? 'var(--at-ink-3)' : 'white',
              cursor: proyectos.length >= effectiveMaxProjects ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: 600,
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo Proyecto
          </button>
        </div>

        {proyectos.length === 0 ? (
          <div style={{
            background: 'var(--at-surface-2)', border: '1px dashed var(--at-line)',
            borderRadius: '12px', padding: '32px', textAlign: 'center',
          }}>
            <p style={{ color: 'var(--at-ink-2)', margin: 0 }}>No hay proyectos. Crea el primero.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '14px' }}>
            {proyectos.map(p => {
              const estadoCfg = ESTADO_CONFIG[p.estado ?? 'activo']
              return (
              <div key={p.id} className="proyecto-card" style={{
                background: 'var(--at-surface)', borderRadius: '14px',
                border: '1px solid var(--at-line)',
                overflow: 'hidden',
                borderTop: `3px solid ${estadoCfg.color}`,
              }}>
                {/* Input oculto para logo de este proyecto */}
                <input
                  id={`proj-logo-${p.id}`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void subirLogoProyecto(p.id, f) }}
                />
                {/* Cabecera de la tarjeta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px 12px' }}>
                  {/* Avatar/logo del proyecto */}
                  <div
                    onClick={() => document.getElementById(`proj-logo-${p.id}`)?.click()}
                    title="Clic para cambiar logo"
                    style={{
                      width: 42, height: 42, borderRadius: 10, overflow: 'hidden',
                      cursor: 'pointer', flexShrink: 0,
                      border: '1px solid var(--at-line)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    {p.logo_url
                      ? <SecureImage bucket="project-logos" src={p.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{
                          background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))',
                          width: '100%', height: '100%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'white', fontSize: 16, fontWeight: 700,
                        }}>
                          {p.nombre[0]?.toUpperCase()}
                        </div>
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '3px' }}>
                      <span style={{ color: 'var(--at-ink)', fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.nombre}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* Estado badge */}
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                        background: estadoCfg.bg, color: estadoCfg.color, whiteSpace: 'nowrap',
                      }}>
                        {estadoCfg.label}
                      </span>
                      {/* Moneda badge */}
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                        background: 'var(--at-primary-tint)', color: 'var(--at-accent-2)', whiteSpace: 'nowrap',
                      }}>
                        {p.moneda ?? 'Q'}
                      </span>
                      <span style={{ color: 'var(--at-ink-2)', fontSize: '10px', fontFamily: 'monospace' }}>
                        {p.id.slice(0, 6)}…
                      </span>
                    </div>
                  </div>
                  {/* Side buttons (hidden on mobile) */}
                  <div className="proyecto-btn-side" style={{ flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                    <button
                      onClick={() => void editarProyecto(p)}
                      title="Editar proyecto"
                      style={{
                        padding: '5px 12px', borderRadius: '7px', border: '1px solid var(--at-line-strong)',
                        background: 'var(--at-surface-2)', color: 'var(--at-ink-3)',
                        cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                      }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => void cambiarEstadoProyecto(p)}
                      title="Cambiar estado"
                      style={{
                        padding: '4px 12px', borderRadius: '7px',
                        border: `1px solid ${estadoCfg.color}44`,
                        background: estadoCfg.bg,
                        color: estadoCfg.color,
                        cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                      }}
                    >
                      Estado
                    </button>
                  </div>
                </div>
                {/* Datos del proyecto */}
                {(p.descripcion || p.direccion || (p.latitud && p.longitud)) && (
                  <div style={{
                    padding: '10px 16px 12px',
                    borderTop: '1px solid var(--at-line)',
                  }}>
                    {p.descripcion && (
                      <p style={{ color: 'var(--at-ink-3)', fontSize: '12px', margin: '0 0 6px', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {p.descripcion}
                      </p>
                    )}
                    {p.direccion && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--at-ink-2)', fontSize: '11px', marginBottom: '3px' }}>
                        <span>📍</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.direccion}</span>
                      </div>
                    )}
                    {p.latitud && p.longitud && (
                      <div style={{ color: 'var(--at-ink-2)', fontSize: '10px', fontFamily: 'monospace' }}>
                        {p.latitud.toFixed(5)}, {p.longitud.toFixed(5)}
                      </div>
                    )}
                  </div>
                )}
                {/* Footer buttons (shown on mobile only) */}
                <div className="proyecto-btn-footer" style={{
                  gap: '8px', padding: '10px 14px',
                  borderTop: '1px solid var(--at-line)',
                  background: 'var(--at-surface-2)',
                }}>
                  <button
                    onClick={() => void editarProyecto(p)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: '8px',
                      border: '1px solid var(--at-line-strong)',
                      background: 'var(--at-surface-2)', color: 'var(--at-ink-2)',
                      cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => void cambiarEstadoProyecto(p)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: '8px',
                      border: `1px solid ${estadoCfg.color}55`,
                      background: estadoCfg.bg,
                      color: estadoCfg.color,
                      cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    }}
                  >
                    Estado
                  </button>
                </div>
              </div>
            )})}
          </div>
        )}
      </div>
    </>
  )
}
