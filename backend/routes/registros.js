const router = require('express').Router();
const { supabase } = require('../services/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendReciboEmail } = require('../services/email');

function calcularTotalPagar(consumo, tarifa, canon) {
  const c = parseFloat(consumo);
  if (c >= 0 && c <= 0.99) {
    return { total: parseFloat(canon || 0), tipo_cobro: 'Canon Fijo' };
  } else if (c > 0.99) {
    return { total: c * parseFloat(tarifa || 0), tipo_cobro: 'Consumo' };
  }
  return { total: 0, tipo_cobro: 'Cero/Error' };
}

// GET /api/registros
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('registros')
    .select('*')
    .order('fecha', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/registros
router.post('/', requireAuth, requireRole(['admin', 'operator']), async (req, res) => {
  const { cliente_id, lectura_actual, estado, mes, notas, gps, foto } = req.body;

  if (!cliente_id || lectura_actual === undefined || lectura_actual === null) {
    return res.status(400).json({ error: 'cliente_id y lectura_actual son obligatorios' });
  }

  // Fetch client data
  const { data: cliente, error: clientError } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', cliente_id)
    .single();

  if (clientError || !cliente) {
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }

  // Get last reading to calculate lectura_anterior
  const { data: lastRegistro } = await supabase
    .from('registros')
    .select('lectura_actual')
    .eq('cliente_id', cliente_id)
    .order('fecha', { ascending: false })
    .limit(1)
    .single();

  const lectura_anterior = lastRegistro?.lectura_actual ?? cliente.lectura_inicial ?? 0;
  const consumo = parseFloat(lectura_actual) - parseFloat(lectura_anterior);

  if (consumo < 0) {
    return res.status(400).json({
      error: 'La lectura actual no puede ser menor que la lectura anterior'
    });
  }

  const { total: monto_calculado, tipo_cobro } = calcularTotalPagar(consumo, cliente.tarifa, cliente.canon);
  const mesFacturacion = (!mes || mes === 'auto')
    ? String(new Date().getMonth() + 1)
    : String(mes);

  const registro = {
    cliente_id,
    cliente_nombre: cliente.nombre,
    fecha: new Date().toISOString(),
    lectura_anterior: parseFloat(lectura_anterior),
    lectura_actual: parseFloat(lectura_actual),
    consumo,
    tarifa_aplicada: cliente.tarifa,
    canon_aplicado: cliente.canon,
    monto_calculado,
    tipo_cobro,
    estado: estado || 'pendiente',
    mes: mesFacturacion,
    notas: notas || null,
    gps: gps || null,
    foto: foto || null
  };

  const { data, error } = await supabase.from('registros').insert(registro).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Send receipt email (non-blocking)
  if (cliente.email) {
    const { data: empresa } = await supabase.from('empresa').select('nombre').limit(1).single();
    sendReciboEmail(cliente.email, data, empresa?.nombre).catch(err =>
      console.error('Receipt email failed:', err)
    );
  }

  res.status(201).json(data);
});

// PATCH /api/registros/:id/estado
router.patch('/:id/estado', requireAuth, requireRole(['admin', 'operator']), async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!['pendiente', 'pagado', 'mora'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  const { data, error } = await supabase
    .from('registros')
    .update({ estado })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
