// User management: create/list/delete/update platform users.
// superadmin   → manages all users
// company_owner → manages users within their company
// admin        → manages users within their project
const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const canManage = [requireAuth, requireRole(['superadmin', 'company_owner', 'admin'])];

const VALID_ROLES        = ['superadmin', 'company_owner', 'admin', 'user', 'cliente'];
const VALID_PERMISSIONS  = ['total', 'lectura', 'financiero', 'administrativo'];
const PASSWORD_REGEX     = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

// ── GET /api/users ────────────────────────────────────────────────────────────
router.get('/', requireAuth, requireRole(['superadmin', 'company_owner', 'admin']), async (req, res) => {
  const user = req.session.user;

  let profileQuery = supabase
    .from('app_users')
    .select('id, company_id, full_name, role, permission_type, project_id, cliente_id, activo, created_at')
    .order('created_at');

  if (user.role === 'company_owner') {
    profileQuery = profileQuery.eq('company_id', user.company_id);
  } else if (user.role === 'admin') {
    profileQuery = profileQuery.eq('project_id', user.project_id);
  }
  // superadmin gets all

  const [profilesRes, authRes] = await Promise.all([
    profileQuery,
    supabase.auth.admin.listUsers()
  ]);

  if (profilesRes.error) return res.status(500).json({ error: 'Error al obtener usuarios' });

  const emailMap = {};
  (authRes.data?.users || []).forEach(u => { emailMap[u.id] = u.email; });

  const users = profilesRes.data.map(p => ({ ...p, email: emailMap[p.id] || '' }));
  res.json({ users });
});

// ── POST /api/users ───────────────────────────────────────────────────────────
router.post('/', ...canManage, async (req, res) => {
  const actor = req.session.user;
  const { email, password, full_name, role, permission_type, project_id, company_id } = req.body;

  // Basic validation
  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'email, password, full_name y role son requeridos' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Rol inválido. Opciones: ${VALID_ROLES.join(', ')}` });
  }
  if (role === 'user' && !VALID_PERMISSIONS.includes(permission_type)) {
    return res.status(400).json({ error: `permission_type requerido para rol 'user'. Opciones: ${VALID_PERMISSIONS.join(', ')}` });
  }
  if (role === 'admin' && !project_id) {
    return res.status(400).json({ error: "project_id requerido para rol 'admin'" });
  }
  if (!PASSWORD_REGEX.test(password)) {
    return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres, 1 mayúscula y 1 número' });
  }

  // Scope enforcement: non-superadmins cannot create superadmins
  if (role === 'superadmin' && actor.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo superadmin puede crear otros superadmins' });
  }

  // Resolve company_id for the new user
  let targetCompanyId = null;
  if (actor.role === 'superadmin') {
    targetCompanyId = company_id || null;
  } else {
    targetCompanyId = actor.company_id;
  }

  // Admins can only create users within their project
  let targetProjectId = project_id || null;
  if (actor.role === 'admin') {
    if (role !== 'user') return res.status(403).json({ error: 'Admins solo pueden crear usuarios' });
    targetProjectId = actor.project_id;
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

  const profilePayload = {
    id:              authData.user.id,
    company_id:      targetCompanyId,
    full_name:       full_name.trim(),
    role,
    permission_type: role === 'user' ? permission_type : null,
    project_id:      (role === 'admin' || role === 'user') ? targetProjectId : null
  };

  const { error: profileError } = await supabase.from('app_users').insert(profilePayload);
  if (profileError) {
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
    console.error('Profile insert error:', profileError);
    return res.status(500).json({ error: 'Error al guardar perfil del usuario' });
  }

  // For 'user' role with a project, also create the assignment
  if (role === 'user' && targetProjectId) {
    await supabase.from('user_project_assignments').insert({
      user_id:         authData.user.id,
      project_id:      targetProjectId,
      permission_type
    }).catch(() => {});
  }

  await supabase.from('security_logs').insert({
    user_id:    actor.id,
    event_type: 'user_created',
    details:    { created_email: authData.user.email, role, permission_type },
    ip_address: req.ip,
    user_agent: req.headers['user-agent']
  }).catch(() => {});

  res.status(201).json({
    user: { ...profilePayload, email: authData.user.email }
  });
});

// ── PATCH /api/users/:id ──────────────────────────────────────────────────────
router.patch('/:id', ...canManage, async (req, res) => {
  const actor = req.session.user;
  const { id } = req.params;
  const allowed = ['full_name', 'role', 'permission_type', 'project_id', 'activo'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

  let query = supabase.from('app_users').update(updates).eq('id', id);
  if (actor.role === 'company_owner') query = query.eq('company_id', actor.company_id);
  if (actor.role === 'admin') query = query.eq('project_id', actor.project_id);

  const { data, error } = await query.select().single();
  if (error || !data) return res.status(500).json({ error: 'Error al actualizar usuario' });
  res.json({ user: data });
});

// ── DELETE /api/users/:id ─────────────────────────────────────────────────────
router.delete('/:id', ...canManage, async (req, res) => {
  const actor = req.session.user;
  const { id } = req.params;
  if (id === actor.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

  const { error: authError } = await supabase.auth.admin.deleteUser(id);
  if (authError) {
    console.error('Delete user error:', authError);
    return res.status(500).json({ error: 'Error al eliminar usuario' });
  }
  await supabase.from('app_users').delete().eq('id', id).catch(() => {});

  await supabase.from('security_logs').insert({
    user_id:    actor.id,
    event_type: 'user_deleted',
    details:    { deleted_user_id: id },
    ip_address: req.ip,
    user_agent: req.headers['user-agent']
  }).catch(() => {});
  res.json({ ok: true });
});

// ── GET /api/users/:id/project-assignments ────────────────────────────────────
router.get('/:id/project-assignments', requireAuth, requireRole(['superadmin', 'company_owner', 'admin']), async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('user_project_assignments')
    .select('*, projects(nombre)')
    .eq('user_id', id);
  if (error) return res.status(500).json({ error: 'Error al obtener asignaciones' });
  res.json({ assignments: data });
});

// ── POST /api/users/:id/project-assignments ───────────────────────────────────
router.post('/:id/project-assignments', ...canManage, async (req, res) => {
  const { id } = req.params;
  const { project_id, permission_type } = req.body;
  if (!project_id || !VALID_PERMISSIONS.includes(permission_type)) {
    return res.status(400).json({ error: 'project_id y permission_type son requeridos' });
  }
  const { data, error } = await supabase
    .from('user_project_assignments')
    .upsert({ user_id: id, project_id, permission_type }, { onConflict: 'user_id,project_id' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Error al asignar proyecto' });
  res.status(201).json({ assignment: data });
});

// ── DELETE /api/users/:id/project-assignments/:project_id ─────────────────────
router.delete('/:id/project-assignments/:project_id', ...canManage, async (req, res) => {
  const { id, project_id } = req.params;
  const { error } = await supabase
    .from('user_project_assignments')
    .delete()
    .eq('user_id', id)
    .eq('project_id', project_id);
  if (error) return res.status(500).json({ error: 'Error al remover asignación' });
  res.json({ ok: true });
});

module.exports = router;
