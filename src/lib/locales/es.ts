// F3.17: Diccionario en español (default).
// Estructura: agrupar por feature/sección para que la inferencia de
// TranslationKey sea natural (`login.title`, `topbar.logout`, etc).
//
// Convención:
//   - Keys lowercase + snake_case
//   - Strings completos (sin string interpolation; usar {{var}})
//   - Comentarios en español dentro del objeto cuando ayude al traductor

export interface Translations {
  common: Record<string, string>
  auth: Record<string, string>
  topbar: Record<string, string>
  sidebar: Record<string, string>
  empty_states: Record<string, string>
  errors: Record<string, string>
  portal: Record<string, string>
  wizard: Record<string, string>
}

export const es: Translations = {
  common: {
    save: 'Guardar',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    edit: 'Editar',
    create: 'Crear',
    close: 'Cerrar',
    confirm: 'Confirmar',
    loading: 'Cargando…',
    saving: 'Guardando…',
    search: 'Buscar',
    filter: 'Filtrar',
    actions: 'Acciones',
    yes: 'Sí',
    no: 'No',
    next: 'Siguiente',
    back: 'Atrás',
    finish: 'Finalizar',
    optional: 'Opcional',
    required: 'Requerido',
    welcome: 'Hola {{name}}',
  },
  auth: {
    login_title: 'Iniciar sesión',
    login_email: 'Correo electrónico',
    login_password: 'Contraseña',
    login_submit: 'Entrar',
    login_with_google: 'Entrar con Google',
    forgot_password: '¿Olvidaste tu contraseña?',
    register_title: 'Crear cuenta',
    logout: 'Cerrar sesión',
    welcome_back: 'Bienvenido de vuelta',
  },
  topbar: {
    logout: 'Cerrar sesión',
    profile: 'Mi perfil',
    company: 'Mi empresa',
    notifications: 'Notificaciones',
  },
  sidebar: {
    dashboard: 'Panel',
    clientes: 'Clientes',
    lecturas: 'Lecturas',
    cobros: 'Cobros',
    rutas: 'Rutas',
    historial: 'Historial',
    calidad: 'Calidad',
    contadores: 'Contadores',
    tarifas: 'Tarifas',
    unidades: 'Unidades',
    condominios: 'Condominios',
    comunicacion: 'Comunicación',
    servicios_energia: 'Servicios de energía',
    empresa: 'Mi empresa',
    perfil: 'Mi perfil',
    configuracion: 'Configuración',
    superadmin: 'Super admin',
  },
  empty_states: {
    no_results: 'Sin resultados',
    no_data: 'No hay datos para mostrar',
    no_data_for_filter: 'No hay datos con los filtros seleccionados',
  },
  errors: {
    generic: 'Ocurrió un error inesperado',
    network: 'Sin conexión. Verifica tu internet.',
    unauthorized: 'No tienes permisos para esta acción',
    not_found: 'Recurso no encontrado',
    required_field: 'Este campo es obligatorio',
  },
  portal: {
    my_unit: 'Mi unidad',
    reservations: 'Reservas',
    account: 'Mi cuenta',
    maintenance: 'Mantenimiento',
    visitors: 'Visitantes',
    packages: 'Paquetería',
    announcements: 'Anuncios',
    assemblies: 'Asambleas',
    transparency: 'Transparencia',
    rentals: 'Rentas',
    moves: 'Mudanzas',
  },
  wizard: {
    title: 'Configurar tu empresa',
    welcome_greeting: 'Hola {{name}}, te ayudaremos a configurar tu empresa en menos de 3 minutos.',
    step_type: 'Tipo de proyecto',
    step_project: 'Crear primer proyecto',
    step_done: '¡Listo!',
    start: 'Empezar',
    create_project: 'Crear proyecto',
  },
}
