const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const adminOnly = requireRole(['admin']);

// GET /api/users — list all app users (admin only)
router.get('/', requireAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, email, full_name, role, created_at')
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'Error al obtener usuarios' });
  res.json({ users: data });
});

// POST /api/users — create a new user (admin only)
router.post('/', requireAuth, adminOnly, async (req, res) => {
  const { email, password, full_name, role } = req.body;

  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'email, password, full_name y role son requeridos' });
  }

  const validRoles = ['admin', 'operador', 'visor'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Rol inválido. Debe ser: ${validRoles.join(', ')}` });
  }

  const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!passwordRegex.test(password)) {
    return res.status(400).json({
      error: 'La contraseña debe tener mínimo 8 caracteres, 1 mayúscula y 1 número'
    });
  }

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: email.toLowerCase().trim(),
    password,
    email_confirm: true
  });

  if (authError) {
    if (authError.message?.includes('already registered')) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    }
    console.error('Auth create error:', authError);
    return res.status(500).json({ error: 'Error al crear usuario en autenticación' });
  }

  // Insert profile into app_users
  const { error: profileError } = await supabase
    .from('app_users')
    .insert({
      id: authData.user.id,
      email: authData.user.email,
      full_name: full_name.trim(),
      role
    });

  if (profileError) {
    // Rollback: delete the auth user
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
    console.error('Profile insert error:', profileError);
    return res.status(500).json({ error: 'Error al guardar perfil del usuario' });
  }

  await supabase.from('security_logs').insert({
    user_id: req.session.user.id,
    event_type: 'user_created',
    details: { created_email: authData.user.email, role },
    ip_address: req.ip,
    user_agent: req.headers['user-agent']
  }).catch(() => {});

  res.status(201).json({
    user: {
      id: authData.user.id,
      email: authData.user.email,
      full_name: full_name.trim(),
      role
    }
  });
});

// DELETE /api/users/:id — delete a user (admin only, cannot delete self)
router.delete('/:id', requireAuth, adminOnly, async (req, res) => {
  const { id } = req.params;

  if (id === req.session.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(id);
  if (authError) {
    console.error('Delete user error:', authError);
    return res.status(500).json({ error: 'Error al eliminar usuario' });
  }

  // app_users will cascade delete via FK if configured, otherwise delete manually
  await supabase.from('app_users').delete().eq('id', id).catch(() => {});

  await supabase.from('security_logs').insert({
    user_id: req.session.user.id,
    event_type: 'user_deleted',
    details: { deleted_user_id: id },
    ip_address: req.ip,
    user_agent: req.headers['user-agent']
  }).catch(() => {});

  res.json({ ok: true });
});

module.exports = router;
