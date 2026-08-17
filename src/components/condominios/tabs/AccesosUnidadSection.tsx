import { useCallback, useEffect, useState } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import { ModalPortal } from '../../shared/ModalPortal'
import {
  fetchAccesosDeUnidad,
  registrarFamiliar,
  quitarFamiliar,
  type AccesoDeUnidad,
} from '../../../domain/portal/inquilinos'

/**
 * "Accesos de mi unidad" — el PROPIETARIO gestiona los accesos familiares
 * (portal propietario/inquilino · 20260825000000). Reglas de producto:
 * sin renta activa da hasta 3 accesos a SU familia; con arrendatario activo la
 * familia propia se inhabilita y los hasta 3 accesos son del NÚCLEO del
 * inquilino. El servidor decide el núcleo y aplica el límite; aquí solo se
 * refleja. El inquilino titular se gestiona desde el tab Rentas.
 */

const MAX_POR_NUCLEO = 3

interface FamiliarForm {
  nombre: string
  email: string
  cuiDui: string
  fechaNacimiento: string
  telefono: string
}

const blankFamiliar = (): FamiliarForm => ({
  nombre: '', email: '', cuiDui: '', fechaNacimiento: '', telefono: '',
})

export function AccesosUnidadSection({ unidadId }: { unidadId: string }) {
  const [accesos, setAccesos] = useState<AccesoDeUnidad[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState<FamiliarForm>(blankFamiliar())
  const [saving, setSaving]     = useState(false)

  const cargar = useCallback(async () => {
    if (!unidadId) { setAccesos([]); return }
    const { data } = await fetchAccesosDeUnidad(unidadId)
    setAccesos(data)
  }, [unidadId])

  useEffect(() => { cargar() }, [cargar])

  const inquilino = accesos.find(a => a.tipo === 'arrendatario' && a.activo) ?? null
  const enRenta   = inquilino !== null
  // Núcleo vigente: con renta, el del inquilino; sin renta, el del propietario
  // (todo familiar cuyo núcleo NO sea el inquilino). Filas legacy (núcleo NULL,
  // asignadas por staff) se listan pero no cuentan para el límite — igual que
  // en el servidor.
  const familiares = accesos.filter(a => a.tipo === 'familiar' && a.activo)
  const familiaresNucleo = familiares.filter(f =>
    enRenta ? f.nucleo_cliente_id === inquilino?.cliente_id : f.nucleo_cliente_id !== null,
  )
  const cupoLleno = familiaresNucleo.length >= MAX_POR_NUCLEO

  async function guardar() {
    if (!form.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'El nombre es requerido.' }); return }
    if (!form.email.trim()) { notify({ variant: 'error', title: 'Error', text: 'El email es requerido.' }); return }
    if (!form.cuiDui.trim()) { notify({ variant: 'error', title: 'Error', text: 'El DPI/CUI es requerido.' }); return }
    if (!form.fechaNacimiento) { notify({ variant: 'error', title: 'Error', text: 'La fecha de nacimiento es requerida.' }); return }
    setSaving(true)
    const { error } = await registrarFamiliar({
      unidadId,
      nombre: form.nombre.trim(),
      email: form.email.trim(),
      cuiDui: form.cuiDui.trim(),
      fechaNacimiento: form.fechaNacimiento,
      telefono: form.telefono,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo dar acceso', text: error }); return }
    setShowForm(false); setForm(blankFamiliar())
    notify({
      variant: 'success',
      title: 'Acceso otorgado',
      text: 'Ya puede crear su cuenta en la app con su DPI/CUI, fecha de nacimiento y email, y verá únicamente esta unidad.',
      duration: 5000,
    })
    cargar()
  }

  async function quitar(a: AccesoDeUnidad) {
    const r = await confirm({
      title: '¿Quitar este acceso?',
      text: `${a.cliente_nombre} dejará de ver esta unidad en su portal de inmediato. Su cuenta no se elimina.`,
      icon: 'warning', variant: 'danger', confirmText: 'Quitar acceso',
    })
    if (!r.isConfirmed) return
    const { error } = await quitarFamiliar(unidadId, a.cliente_id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error }); return }
    notify({ variant: 'success', title: 'Acceso revocado', duration: 1400 })
    cargar()
  }

  function badge(a: AccesoDeUnidad): { label: string; bg: string; color: string } {
    if (a.tipo === 'arrendatario') return { label: 'Inquilino', bg: 'var(--at-accent-tint-2)', color: 'var(--at-accent-dark)' }
    if (enRenta && a.nucleo_cliente_id === inquilino!.cliente_id) return { label: 'Familia del inquilino', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' }
    return { label: 'Mi familia', bg: 'var(--at-success-tint)', color: 'var(--at-success)' }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: '13.5px',
    border: '1.5px solid var(--at-line)', borderRadius: '8px', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ border: '1.5px solid var(--at-line)', borderRadius: '14px', padding: '16px', marginBottom: '22px', background: 'var(--at-surface-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>👨‍👩‍👧 Accesos de mi unidad</div>
          <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
            {enRenta
              ? 'Tu inmueble está en renta: los accesos familiares corresponden al núcleo de tu inquilino (máx. 3).'
              : 'Da acceso a tu familia (esposa/o, hijos…) para gestionar el inmueble contigo (máx. 3).'}
          </div>
        </div>
        <button
          onClick={() => { setForm(blankFamiliar()); setShowForm(true) }}
          disabled={cupoLleno}
          title={cupoLleno ? `Límite de ${MAX_POR_NUCLEO} accesos alcanzado` : undefined}
          style={{
            padding: '8px 16px', background: cupoLleno ? 'var(--at-chip)' : 'var(--at-accent-hover)',
            color: cupoLleno ? 'var(--at-ink-3)' : 'white', border: 'none', borderRadius: '8px',
            fontSize: '13px', fontWeight: 600, cursor: cupoLleno ? 'not-allowed' : 'pointer', flexShrink: 0,
          }}
        >
          {enRenta ? '+ Agregar familiar del inquilino' : '+ Dar acceso a mi familia'} ({familiaresNucleo.length}/{MAX_POR_NUCLEO})
        </button>
      </div>

      {accesos.filter(a => a.activo).length === 0 ? (
        <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '10px' }}>
          Aún no has dado ningún acceso en esta unidad.
        </div>
      ) : accesos.filter(a => a.activo).map(a => {
        const b = badge(a)
        return (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '10px', padding: '10px 14px', marginTop: '10px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--at-ink)' }}>
                👤 {a.cliente_nombre}
                <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: b.bg, color: b.color }}>{b.label}</span>
                <span style={{
                  marginLeft: 6, padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                  background: a.tiene_cuenta ? 'var(--at-success-tint)' : 'var(--at-warning-tint)',
                  color: a.tiene_cuenta ? 'var(--at-success)' : 'var(--at-warning-strong)',
                }}>{a.tiene_cuenta ? '✓ Con cuenta' : 'Cuenta pendiente'}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '2px' }}>
                {a.cliente_email && <>✉️ {a.cliente_email}</>}{a.cliente_email && a.cliente_telefono && '  ·  '}{a.cliente_telefono && <>📞 {a.cliente_telefono}</>}
              </div>
            </div>
            {a.tipo === 'familiar' ? (
              <button
                onClick={() => quitar(a)}
                style={{ padding: '7px 14px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
              >Quitar acceso</button>
            ) : (
              <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', flexShrink: 0 }}>Se gestiona en Rentas</span>
            )}
          </div>
        )
      })}

      {showForm && (
        <ModalPortal>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
          <div style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                {enRenta ? 'Agregar familiar del inquilino' : 'Dar acceso a mi familia'}
              </h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'var(--at-ink-3)' }}>✕</button>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: '12.5px', color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
              Con estos datos la persona creará su cuenta en la app (validando DPI/CUI + fecha de nacimiento + email) y verá <strong>solo esta unidad</strong>. Verifícalos con su documento.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Nombre completo *</label>
                <input style={fieldStyle} value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Como aparece en su documento" />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Email *</label>
                <input style={fieldStyle} type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="correo@ejemplo.com" />
              </div>
              <div>
                <label style={labelStyle}>DPI / CUI *</label>
                <input style={fieldStyle} value={form.cuiDui} onChange={e => setForm(p => ({ ...p, cuiDui: e.target.value }))} placeholder="Número de documento" />
              </div>
              <div>
                <label style={labelStyle}>Fecha de nacimiento *</label>
                <input style={fieldStyle} type="date" value={form.fechaNacimiento} onChange={e => setForm(p => ({ ...p, fechaNacimiento: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Teléfono</label>
                <input style={fieldStyle} value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} placeholder="+502 0000-0000" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '9px 20px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--at-ink-2)' }}>Cancelar</button>
              <button onClick={guardar} disabled={saving} style={{ padding: '9px 22px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Guardando…' : 'Dar acceso'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
