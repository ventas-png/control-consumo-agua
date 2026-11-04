// «Eliminar mi cuenta» — la persona borra su propia cuenta desde la app (App Store Review 5.1.1 v y Google Play «Account deletion»; ver
// docs/PUBLICACION_TIENDAS.md bloqueante #1 y docs/ELIMINACION_CUENTA.md). Se monta en Mi perfil (panel de empresa) y en los dos portales
// de residentes/clientes, por eso es autocontenido: trae su propio estado, sus diálogos y su salida.
//
// Flujo en dos pasos, con el servidor delante:
//   1. previewDeleteOwnAccount() (dry_run): el edge evalúa sus compuertas sin borrar nada. Si responde 409 (único propietario con equipo) se
//      muestra ese mensaje y no se pide nada más; si responde que la empresa quedará suspendida, el aviso lo dice.
//   2. confirm() con las consecuencias → openPromptDialog(): contraseña actual (sólo cuentas con contraseña; las de Google no la tienen) y la
//      palabra ELIMINAR. La contraseña se verifica con signInWithPassword ANTES de llamar al borrado, igual que al cambiar la contraseña.
//   3. deleteOwnAccount('ELIMINAR') → éxito: aviso breve y salida (signOutAfterOwnAccountDeleted: limpia el rastro local y recarga en /).
import { useEffect, useState, type CSSProperties } from 'react'
import type { UserSession } from '../../types'
import { confirm } from '../shared/Dialog'
import { openPromptDialog, type PromptFieldDef } from '../shared/PromptDialog'
import {
  DELETE_OWN_ACCOUNT_CONFIRM_WORD,
  deleteOwnAccount,
  fetchCurrentAuthProvider,
  previewDeleteOwnAccount,
  signInWithPassword,
  signOutAfterOwnAccountDeleted,
} from '../../domain/auth/account'
import { RUTA_PUBLICA_ELIMINAR_CUENTA } from '../../lib/routes'

export const PALABRA_CONFIRMACION = DELETE_OWN_ACCOUNT_CONFIRM_WORD

interface Props {
  currentUser: Pick<UserSession, 'email' | 'role'>
  /**
   * 'contenido': sólo el cuerpo (va dentro de la <Card> de Mi perfil, que pone el título).
   * 'seccion':   tarjeta completa con título (portales de residentes).
   * 'enlace':    un enlace discreto (pantallas sin pestañas, pie de los portales).
   */
  variant?: 'contenido' | 'seccion' | 'enlace'
  /** Qué hacer tras el borrado. Por omisión limpia la sesión local y recarga en el inicio. */
  onDeleted?: () => void | Promise<void>
  /** Milisegundos que se muestra el aviso de éxito antes de salir. */
  demoraSalidaMs?: number
}

/** Texto del primer aviso. Exportado para que la prueba fije lo que la persona lee en cada caso. */
export function textoConsecuencias(role: string, suspendeEmpresa: boolean): string {
  const partes = [
    'Se borrarán tu acceso, tu perfil, tus sesiones, tus notificaciones y tus preferencias. Esta acción es definitiva y no se puede deshacer.',
  ]
  if (suspendeEmpresa) {
    partes.push('Eres el único propietario: tu empresa quedará suspendida, su suscripción (si la hay) se cancelará y sus datos se eliminarán definitivamente al terminar el periodo de gracia.')
  } else if (role === 'cliente') {
    partes.push('Los datos que tu administradora o empresa de agua conserva sobre tu unidad o servicio (lecturas, pagos, cuotas) son de esa empresa y no se borran con tu cuenta.')
  } else {
    partes.push('Los registros que creaste en la empresa (lecturas, pagos, tickets, pólizas) se conservan sin tu nombre, como exige la contabilidad.')
  }
  return partes.join(' ')
}

const parrafo: CSSProperties = { fontSize: '13px', color: 'var(--at-ink-2)', margin: '0 0 12px', lineHeight: 1.5 }
const botonPeligro: CSSProperties = {
  border: '1px solid var(--at-danger)', background: 'var(--at-danger)', color: 'white', fontWeight: 600, fontSize: '13px',
  padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
}
const botonEnlace: CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--at-danger)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: '13px',
  textDecoration: 'underline',
}
const cajaError: CSSProperties = {
  marginTop: '10px', padding: '9px 14px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.5,
  background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', border: '1px solid var(--at-danger-border)',
}
const cajaExito: CSSProperties = {
  marginTop: '10px', padding: '9px 14px', borderRadius: '8px', fontSize: '13px', lineHeight: 1.5,
  background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: '1px solid var(--at-success-border)',
}
const tarjeta: CSSProperties = {
  background: 'var(--at-surface)', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', maxWidth: '520px',
}

type Estado = 'inactivo' | 'comprobando' | 'eliminando' | 'eliminada'

export function EliminarCuenta({ currentUser, variant = 'contenido', onDeleted = signOutAfterOwnAccountDeleted, demoraSalidaMs = 1500 }: Props) {
  // Cuentas que entraron con Google no tienen contraseña que re-introducir: se les pide sólo la palabra.
  const [pideContrasena, setPideContrasena] = useState(true)
  useEffect(() => {
    let alive = true
    void fetchCurrentAuthProvider().then((provider) => {
      if (alive && provider && provider !== 'email') setPideContrasena(false)
    })
    return () => { alive = false }
  }, [])

  const [estado, setEstado] = useState<Estado>('inactivo')
  const [error, setError] = useState<string | null>(null)

  async function iniciar() {
    setError(null)
    setEstado('comprobando')

    const vista = await previewDeleteOwnAccount()
    if (vista.error) {
      setError(vista.error)
      setEstado('inactivo')
      return
    }
    const suspendeEmpresa = vista.data?.suspendeEmpresa === true

    const paso1 = await confirm({
      title: '¿Eliminar tu cuenta?',
      text: textoConsecuencias(currentUser.role, suspendeEmpresa),
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Continuar',
      cancelText: 'Cancelar',
    })
    if (!paso1.isConfirmed) {
      setEstado('inactivo')
      return
    }

    const fields: PromptFieldDef[] = [
      ...(pideContrasena
        ? [{ name: 'password', label: 'Tu contraseña actual', type: 'password' as const, autoComplete: 'current-password', required: true, placeholder: '••••••••' }]
        : []),
      {
        name: 'confirmacion',
        label: `Escribe ${PALABRA_CONFIRMACION} para confirmar`,
        placeholder: PALABRA_CONFIRMACION,
        autoComplete: 'off',
        required: true,
      },
    ]
    const datos = await openPromptDialog({
      title: 'Confirma la eliminación definitiva',
      description: pideContrasena
        ? `Para continuar, escribe tu contraseña y la palabra ${PALABRA_CONFIRMACION} en mayúsculas.`
        : `Para continuar, escribe la palabra ${PALABRA_CONFIRMACION} en mayúsculas.`,
      fields,
      submitText: 'Eliminar mi cuenta definitivamente',
      cancelText: 'Cancelar',
      validate: async (d) => {
        if ((d.confirmacion ?? '').trim() !== PALABRA_CONFIRMACION) return `Escribe ${PALABRA_CONFIRMACION} (en mayúsculas) para confirmar.`
        if (pideContrasena) {
          const { error: signInErr } = await signInWithPassword(currentUser.email, d.password ?? '')
          if (signInErr) return 'La contraseña es incorrecta.'
        }
        return null
      },
    })
    if (!datos) {
      setEstado('inactivo')
      return
    }

    setEstado('eliminando')
    const { error: delErr } = await deleteOwnAccount(datos.confirmacion.trim())
    if (delErr) {
      setError(delErr)
      setEstado('inactivo')
      return
    }
    setEstado('eliminada')
    window.setTimeout(() => { void onDeleted() }, demoraSalidaMs)
  }

  const ocupado = estado === 'comprobando' || estado === 'eliminando'
  const etiqueta = estado === 'comprobando' ? 'Comprobando…' : estado === 'eliminando' ? 'Eliminando…' : 'Eliminar mi cuenta'

  const mensajes = (
    <>
      {error && <div role="alert" style={cajaError}>{error}</div>}
      {estado === 'eliminada' && <div role="status" style={cajaExito}>Tu cuenta se eliminó. Cerrando sesión…</div>}
    </>
  )

  if (variant === 'enlace') {
    return (
      <div>
        <button type="button" onClick={() => void iniciar()} disabled={ocupado || estado === 'eliminada'} style={botonEnlace}>
          {etiqueta}
        </button>
        {mensajes}
      </div>
    )
  }

  const cuerpo = (
    <>
      <p style={parrafo}>
        Puedes borrar tu cuenta de AdministraTodo en cualquier momento. Te pediremos confirmarlo en dos pasos. También puedes pedirlo sin la
        app en{' '}
        <a href={RUTA_PUBLICA_ELIMINAR_CUENTA} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--at-primary)', fontWeight: 600 }}>
          administratodo.com{RUTA_PUBLICA_ELIMINAR_CUENTA}
        </a>
        .
      </p>
      <button type="button" onClick={() => void iniciar()} disabled={ocupado || estado === 'eliminada'} style={{ ...botonPeligro, opacity: ocupado ? 0.7 : 1 }}>
        {etiqueta}
      </button>
      {mensajes}
    </>
  )

  if (variant === 'seccion') {
    return (
      <section aria-labelledby="eliminar-cuenta-titulo" style={tarjeta}>
        <h2 id="eliminar-cuenta-titulo" style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Eliminar mi cuenta</h2>
        {cuerpo}
      </section>
    )
  }
  return <div>{cuerpo}</div>
}
