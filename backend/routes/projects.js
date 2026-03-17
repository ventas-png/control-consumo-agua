// Project management. Accessible by superadmin and company_owner.
const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const canManage = [requireAuth, requireRole(['superadmin', 'company_owner'])];

// Build a company_id filter based on session role.
function companyFilter(user) {
  if (user.role === 'superadmin') return null; // no filter
  return user.company_id;
}

// GET /api/projects
router.get('/', requireAuth, async (req, res) => {
  const user = req.session.user;
  let query = supabase.from('projects').select('*, companies(nombre)').order('created_at');

  if (user.role === 'superadmin') {
    // all projects
  } else if (user.role === 'company_owner') {
    query = query.eq('company_id', user.company_id);
  } else if (user.role === 'admin') {
    query = query.eq('id', user.project_id);
  } else if (user.role === 'user') {
    // get assigned project ids
    const { data: assignments } = await supabase
      .from('user_project_assignments')
      .select('project_id')
      .eq('user_id', user.id);
    const ids = (assignments || []).map(a => a.project_id);
    if (ids.length === 0) return res.json({ projects: [] });
    query = query.in('id', ids);
  } else {
    return res.json({ projects: [] });
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Error al listar proyectos' });
  res.json({ projects: data });
});

// POST /api/projects
router.post('/', ...canManage, async (req, res) => {
  const user = req.session.user;
  const { nombre, descripcion, company_id } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const cid = user.role === 'superadmin' ? company_id : user.company_id;
  if (!cid) return res.status(400).json({ error: 'company_id es requerido' });
  const { data, error } = await supabase
    .from('projects')
    .insert({ nombre: nombre.trim(), descripcion, company_id: cid })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Error al crear proyecto' });
  res.status(201).json({ project: data });
});

// PATCH /api/projects/:id
router.patch('/:id', ...canManage, async (req, res) => {
  const user = req.session.user;
  const { id } = req.params;
  const allowed = ['nombre', 'descripcion', 'activo'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  let query = supabase.from('projects').update(updates).eq('id', id);
  if (user.role === 'company_owner') query = query.eq('company_id', user.company_id);
  const { data, error } = await query.select().single();
  if (error || !data) return res.status(500).json({ error: 'Error al actualizar proyecto' });
  res.json({ project: data });
});

// DELETE /api/projects/:id
router.delete('/:id', ...canManage, async (req, res) => {
  const user = req.session.user;
  const { id } = req.params;
  let query = supabase.from('projects').delete().eq('id', id);
  if (user.role === 'company_owner') query = query.eq('company_id', user.company_id);
  const { error } = await query;
  if (error) return res.status(500).json({ error: 'Error al eliminar proyecto' });
  res.json({ ok: true });
});

module.exports = router;
