import { EmptyState } from '../shared/EmptyState'

interface Props {
  /** Email del soporte/administrador para que el residente lo contacte. Default 'soporte@administratodo.com'. */
  contactoEmail?: string
  /** Mensaje contextual opcional — ej: 'Tu cuenta fue creada pero aún no se te asignaron permisos'. */
  contexto?: string
}

/**
 * F3.15: Empty state mejorado para usuarios sin proyectos asignados.
 *
 * Adoptado el componente `<EmptyState>` shared para consistencia visual
 * con el resto de la app. Agrega CTA accionable (mailto) que reduce la
 * fricción para que el usuario reciba acceso sin que el flujo sea opaco.
 */
export function SinProyectoAsignado({
  contactoEmail = 'soporte@administratodo.com',
  contexto,
}: Props = {}) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <EmptyState
        icon="🔒"
        title="No tienes ningún proyecto asignado"
        description={
          contexto ?? 'Ponte en contacto con tu administrador para que te asigne acceso a un proyecto.'
        }
        action={
          <a
            href={`mailto:${contactoEmail}?subject=Solicitud de acceso al portal&body=Hola, necesito que me asignen acceso a un proyecto del condominio. Gracias.`}
            style={{
              display: 'inline-block',
              padding: '10px 18px',
              borderRadius: '10px',
              border: 'none',
              background: 'var(--at-primary)',
              color: 'white',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            ✉️ Contactar al administrador
          </a>
        }
      />
    </div>
  )
}
