export function SinProyectoAsignado() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '12px',
        padding: '48px 24px',
        minHeight: '320px',
      }}
    >
      <div style={{ fontSize: '48px', lineHeight: 1 }}>🔒</div>
      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#15291F' }}>
        No tienes ningún proyecto asignado
      </h2>
      <p style={{ margin: 0, fontSize: '14px', color: '#7E9389', maxWidth: '420px' }}>
        Ponte en contacto con tu administrador para que te asigne acceso a un proyecto.
      </p>
    </div>
  )
}
