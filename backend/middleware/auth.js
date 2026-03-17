function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { role } = req.session.user;
    const allowed = roles.some(r => {
      if (r === 'admin') return role === 'admin' || role === 'super_admin';
      if (r === 'operator') return role === 'operator' || role === 'admin' || role === 'super_admin';
      return role === r;
    });
    if (!allowed) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
