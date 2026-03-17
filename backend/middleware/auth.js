// Role hierarchy (highest → lowest):
//   superadmin > company_owner > admin > user(total) > user(administrativo)
//                                                    > user(financiero)
//                                                    > user(lectura)
//                                      > cliente

const ROLE_RANK = {
  superadmin:    100,
  company_owner: 80,
  admin:         60,
  user:          40,
  cliente:       10
};

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// Check that the session user has one of the listed roles.
// Pass 'user:total', 'user:lectura', 'user:financiero', 'user:administrativo'
// to also constrain permission_type for the 'user' role.
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Authentication required' });
    const { role, permission_type } = req.session.user;
    const allowed = roles.some(r => {
      // superadmin passes everything
      if (role === 'superadmin') return true;
      // exact match for compound 'user:permission' spec
      if (r.startsWith('user:')) {
        const required = r.split(':')[1];
        return role === 'user' && permission_type === required;
      }
      // company_owner satisfies 'admin' requirement within their company
      if (r === 'admin') return role === 'admin' || role === 'company_owner';
      // 'user_any' matches any user regardless of permission_type
      if (r === 'user_any') return role === 'user';
      return role === r;
    });
    if (!allowed) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

// Verify the session user belongs to the given company.
// superadmin bypasses this check.
function requireCompany(req, res, next) {
  const { role, company_id } = req.session.user;
  if (role === 'superadmin') return next();
  const targetCompanyId = req.params.company_id || req.body.company_id || req.query.company_id;
  if (targetCompanyId && company_id !== targetCompanyId) {
    return res.status(403).json({ error: 'Access denied to this company' });
  }
  next();
}

// Verify the session user has access to the given project.
// Resolution order: superadmin > company_owner (any of their projects) >
//   admin (their single project) > user (their assigned projects).
async function requireProject(supabase) {
  return async (req, res, next) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (user.role === 'superadmin') return next();

    const projectId = req.params.project_id || req.body.project_id || req.query.project_id;
    if (!projectId) return next(); // route doesn't scope to a project

    if (user.role === 'company_owner') {
      // verify the project belongs to their company
      const { data } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('company_id', user.company_id)
        .single();
      if (!data) return res.status(403).json({ error: 'Project not in your company' });
      return next();
    }

    if (user.role === 'admin') {
      if (user.project_id !== projectId) {
        return res.status(403).json({ error: 'Access denied to this project' });
      }
      return next();
    }

    if (user.role === 'user') {
      const { data } = await supabase
        .from('user_project_assignments')
        .select('id')
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .single();
      if (!data) return res.status(403).json({ error: 'Not assigned to this project' });
      return next();
    }

    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

module.exports = { requireAuth, requireRole, requireCompany, requireProject };
