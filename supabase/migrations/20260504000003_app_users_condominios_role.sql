alter table app_users
  add column if not exists condominios_role text
    check (condominios_role in (
      'administrador_general',
      'junta_directiva',
      'finanzas',
      'operaciones',
      'seguridad',
      'comunidad',
      'recepcion',
      'visualizador'
    ));
