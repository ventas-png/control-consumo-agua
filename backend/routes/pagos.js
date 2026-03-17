// Payment management for internal staff (financiero, admin, company_owner, superadmin).
// Financiero: verify/reject boletas submitted by clients.
// Admin/company_owner: full view.
const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const canView = [requireAuth, requireRole(['superadmin', 'company_owner', 'admin', 'user:financiero', 'user:total', 'user:administrativo'])];
const canVerify = [requireAuth, requireRole(['superadmin', 'company_owner', 'admin', 'user:financiero', 'user:total'])];

// GET /api/pagos — list payments (scoped by role)
router.get('/', ...canView, async (req, res) => {
  const user = req.session.user;
  const { estado, cliente_id, project_id } = req.query;

  let query = supabase
    .from('pagos')
    .select('*, clientes(nombre, codigo), registros(mes, fecha)')
    .order('created_at', { ascending: false });

  if (user.role === 'admin') {
    // Scope to clients in this project
    const { data: clientIds } = await supabase
      .from('clientes').select('id').eq('project_id', user.project_id);
    const ids = (clientIds || []).map(c => c.id);
    if (ids.length === 0) return res.json({ pagos: [] });
    query = query.in('cliente_id', ids);
  } else if (user.role === 'user') {
    const { data: assignments } = await supabase
      .from('user_project_assignments').select('project_id').eq('user_id', user.id);
    const pids = (assignments || []).map(a => a.project_id);
    if (pids.length === 0) return res.json({ pagos: [] });
    query = query.in('project_id', pids);
  } else if (user.role === 'company_owner') {
    const { data: projects } = await supabase
      .from('projects').select('id').eq('company_id', user.company_id);
    const pids = (projects || []).map(p => p.id);
    if (pids.length > 0) query = query.in('project_id', pids);
  }

  if (estado)     query = query.eq('estado', estado);
  if (cliente_id) query = query.eq('cliente_id', cliente_id);
  if (project_id) query = query.eq('project_id', project_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Error al obtener pagos' });
  res.json({ pagos: data });
});

// PATCH /api/pagos/:id — verify or reject a payment boleta
router.patch('/:id', ...canVerify, async (req, res) => {
  const { id } = req.params;
  const { estado, notas } = req.body;
  if (!['verificado', 'rechazado'].includes(estado)) {
    return res.status(400).json({ error: "estado debe ser 'verificado' o 'rechazado'" });
  }

  const { data: pago, error: fetchError } = await supabase
    .from('pagos').select('*').eq('id', id).single();
  if (fetchError || !pago) return res.status(404).json({ error: 'Pago no encontrado' });

  const { data, error } = await supabase
    .from('pagos')
    .update({ estado, notas: notas || pago.notas })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Error al actualizar pago' });

  // If verified and linked to a registro, mark it as paid
  if (estado === 'verificado' && pago.registro_id) {
    await supabase.from('registros').update({ estado: 'pagado' }).eq('id', pago.registro_id);
  }

  res.json({ pago: data });
});

module.exports = router;
