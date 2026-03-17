// Routes only for role='superadmin'.
// Manages companies (create, list, toggle active, delete).
const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const superOnly = [requireAuth, requireRole(['superadmin'])];

// GET /api/superadmin/companies
router.get('/companies', ...superOnly, async (req, res) => {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Error al listar empresas' });
  res.json({ companies: data });
});

// POST /api/superadmin/companies
router.post('/companies', ...superOnly, async (req, res) => {
  const { nombre, nit, email, telefono, plan } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const validPlans = ['basico', 'profesional', 'enterprise'];
  const selectedPlan = plan && validPlans.includes(plan) ? plan : 'basico';
  const { data, error } = await supabase
    .from('companies')
    .insert({ nombre: nombre.trim(), nit, email, telefono, plan: selectedPlan })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Error al crear empresa' });
  res.status(201).json({ company: data });
});

// PATCH /api/superadmin/companies/:id
router.patch('/companies/:id', ...superOnly, async (req, res) => {
  const { id } = req.params;
  const allowed = ['nombre', 'nit', 'email', 'telefono', 'plan', 'activa'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  const { data, error } = await supabase
    .from('companies')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Error al actualizar empresa' });
  res.json({ company: data });
});

// DELETE /api/superadmin/companies/:id
router.delete('/companies/:id', ...superOnly, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('companies').delete().eq('id', id);
  if (error) return res.status(500).json({ error: 'Error al eliminar empresa' });
  res.json({ ok: true });
});

module.exports = router;
