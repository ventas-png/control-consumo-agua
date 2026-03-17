const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendReciboEmail } = require('../services/email');

function calcularTotalPagar(consumo, tarifa, canon) {
  const c = parseFloat(consumo);
  if (c >= 0 && c <= 0.99) return { total: parseFloat(canon || 0), tipo_cobro: 'Canon Fijo' };
  if (c > 0.99) return { total: c * parseFloat(tarifa || 0), tipo_cobro: 'Consumo' };
  return { total: 0, tipo_cobro: 'Cero/Error' };
}

async function getProjectIds(user) {
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

// GET /api/registros
router.get('/', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role === 'cliente') return res.status(403).json({ error: 'Use el portal de clientes' });

  let query = supabase.from('registros').select('*').order('fecha', { ascending: false });
  const pids = await getProjectIds(user);
  if (pids !== null) {
    if (pids.length === 0) return res.json([]);
    query = query.in('project_id', pids);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/registros
// lectura role: only add readings
// administrativo role: can add + request re-readings
// total / admin / company_owner / superadmin: full access
router.post('/', requireAuth,
  requireRole(['superadmin', 'company_owner', 'admin', 'user:total', 'user:lectura', 'user:administrativo']),
  async (req, res) => {
    const user = req.session.user;
    const { cliente_id, lectura_actual, estado, mes, notas, gps, foto } = req.body;

    if (!cliente_id || lectura_actual === undefined || lectura_actual === null) {
      return res.status(400).json({ error: 'cliente_id y lectura_actual son obligatorios' });
    }

    const { data: cliente, error: clientError } = await supabase
      .from('clientes').select('*').eq('id', cliente_id).single();
    if (clientError || !cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    // Verify the user has access to this client's project
    if (user.role === 'admin' && cliente.project_id !== user.project_id) {
      return res.status(403).json({ error: 'Cliente no pertenece a tu proyecto' });
    }
    if (user.role === 'user') {
      const { data: a } = await supabase
        .from('user_project_assignments')
        .select('id').eq('user_id', user.id).eq('project_id', cliente.project_id).single();
      if (!a) return res.status(403).json({ error: 'No tienes acceso al proyecto de este cliente' });
    }

    const { data: lastRegistro } = await supabase
      .from('registros').select('lectura_actual').eq('cliente_id', cliente_id)
      .order('fecha', { ascending: false }).limit(1).single();

    const lectura_anterior = lastRegistro?.lectura_actual ?? cliente.lectura_inicial ?? 0;
    const consumo = parseFloat(lectura_actual) - parseFloat(lectura_anterior);
    if (consumo < 0) {
      return res.status(400).json({ error: 'La lectura actual no puede ser menor que la lectura anterior' });
    }

    const { total: monto_calculado, tipo_cobro } = calcularTotalPagar(consumo, cliente.tarifa, cliente.canon);
    const mesFacturacion = (!mes || mes === 'auto') ? String(new Date().getMonth() + 1) : String(mes);

    // 'lectura' role can only add readings with estado=pendiente
    const resolvedEstado = user.role === 'user' && user.permission_type === 'lectura'
      ? 'pendiente'
      : (estado || 'pendiente');

    const registro = {
      cliente_id,
      cliente_nombre: cliente.nombre,
      project_id:     cliente.project_id || null,
      fecha:          new Date().toISOString(),
      lectura_anterior: parseFloat(lectura_anterior),
      lectura_actual:   parseFloat(lectura_actual),
      consumo,
      tarifa_aplicada:  cliente.tarifa,
      canon_aplicado:   cliente.canon,
      monto_calculado,
      tipo_cobro,
      estado: resolvedEstado,
      mes: mesFacturacion,
      notas: notas || null,
      gps:   gps   || null,
      foto:  foto  || null
    };

    const { data, error } = await supabase.from('registros').insert(registro).select().single();
    if (error) return res.status(500).json({ error: error.message });

    if (cliente.email) {
      const { data: empresa } = await supabase.from('empresa').select('nombre').limit(1).single();
      sendReciboEmail(cliente.email, data, empresa?.nombre).catch(err =>
        console.error('Receipt email failed:', err)
      );
    }

    res.status(201).json(data);
  }
);

// PATCH /api/registros/:id/estado
// Only financiero, total, admin, company_owner, superadmin can change payment status
router.patch('/:id/estado', requireAuth,
  requireRole(['superadmin', 'company_owner', 'admin', 'user:financiero', 'user:total']),
  async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    if (!['pendiente', 'pagado', 'mora'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    const { data, error } = await supabase
      .from('registros').update({ estado }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  }
);

// POST /api/registros/:id/solicitar-relecura
// administrativo, total, admin, company_owner, superadmin can request a re-reading
router.post('/:id/solicitar-relectura', requireAuth,
  requireRole(['superadmin', 'company_owner', 'admin', 'user:total', 'user:administrativo']),
  async (req, res) => {
    const { id } = req.params;
    const { notas } = req.body;
    const { data, error } = await supabase
      .from('registros')
      .update({ estado: 'pendiente', notas: notas ? `[RELECTURA] ${notas}` : '[RELECTURA SOLICITADA]' })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, registro: data });
  }
);

module.exports = router;
