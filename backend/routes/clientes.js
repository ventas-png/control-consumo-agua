const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

// Helper: build project_id filter for the session user
async function getProjectFilter(user) {
  if (user.role === 'superadmin') return null;
  if (user.role === 'company_owner') {
    const { data } = await supabase.from('projects').select('id').eq('company_id', user.company_id);
    return (data || []).map(p => p.id);
  }
  if (user.role === 'admin') return [user.project_id];
  if (user.role === 'user') {
    const { data } = await supabase
      .from('user_project_assignments').select('project_id').eq('user_id', user.id);
    return (data || []).map(a => a.project_id);
  }
  return [];
}

// GET /api/clientes
router.get('/', requireAuth, async (req, res) => {
  const user = req.session.user;
  // clientes are not accessible from the portal (portal has /api/portal/me)
  if (user.role === 'cliente') return res.status(403).json({ error: 'Use el portal de clientes' });

  let query = supabase.from('clientes').select('*').order('nombre');
  const projectIds = await getProjectFilter(user);
  if (projectIds !== null) {
    if (projectIds.length === 0) return res.json([]);
    query = query.in('project_id', projectIds);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/clientes
// Allowed: superadmin, company_owner, admin, user:total, user:administrativo
router.post('/', requireAuth, requireRole(['superadmin', 'company_owner', 'admin', 'user:total', 'user:administrativo']), async (req, res) => {
  const user = req.session.user;
  const { nombre, codigo, medidor, email, direccion, telefono, tarifa, canon, lectura_inicial, project_id } = req.body;

  if (!nombre || nombre.length < 2) return res.status(400).json({ error: 'Nombre debe tener al menos 2 caracteres' });
  if (!codigo || codigo.length < 3) return res.status(400).json({ error: 'Código debe tener al menos 3 caracteres' });

  // Resolve project_id from body or session
  let resolvedProjectId = project_id || null;
  if (!resolvedProjectId) {
    if (user.role === 'admin') resolvedProjectId = user.project_id;
    else if (user.role === 'user') {
      const { data: a } = await supabase
        .from('user_project_assignments').select('project_id').eq('user_id', user.id).limit(1).single();
      resolvedProjectId = a?.project_id || null;
    }
  }

  const { data, error } = await supabase
    .from('clientes')
    .insert({
      nombre: nombre.trim(),
      codigo: codigo.trim(),
      medidor:          medidor?.trim() || null,
      email:            email?.trim() || null,
      direccion:        direccion?.trim() || null,
      telefono:         telefono?.trim() || null,
      tarifa:           parseFloat(tarifa) || 0,
      canon:            parseFloat(canon) || 0,
      lectura_inicial:  parseFloat(lectura_inicial) || 0,
      project_id:       resolvedProjectId
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('security_logs').insert({
    user_id: user.id, event_type: 'client_created',
    details: { cliente_codigo: codigo }, ip_address: req.ip
  }).catch(() => {});

  res.status(201).json(data);
});

// PATCH /api/clientes/:id
router.patch('/:id', requireAuth, requireRole(['superadmin', 'company_owner', 'admin', 'user:total', 'user:administrativo']), async (req, res) => {
  const { id } = req.params;
  const allowed = ['nombre', 'medidor', 'email', 'direccion', 'telefono', 'tarifa', 'canon'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  const { data, error } = await supabase.from('clientes').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/clientes/:id
router.delete('/:id', requireAuth, requireRole(['superadmin', 'company_owner', 'admin', 'user:total', 'user:administrativo']), async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('clientes').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('security_logs').insert({
    user_id: req.session.user.id, event_type: 'client_deleted',
    details: { cliente_id: id }, ip_address: req.ip
  }).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
