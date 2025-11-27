-- Security Enhancement Migration Script
-- Purpose: Create new security tables and implement proper authentication system

-- ==========================================
-- 1. CREATE USER MANAGEMENT TABLES
-- ==========================================

-- Users table for authentication and role-based access
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'operator', 'viewer')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login TIMESTAMP WITH TIME ZONE,
  login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP WITH TIME ZONE
);

-- Login attempts tracking for rate limiting
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address TEXT,
  attempted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  success BOOLEAN DEFAULT false
);

-- Session logging for audit trail
CREATE TABLE IF NOT EXISTS session_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  login_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  logout_time TIMESTAMP WITH TIME ZONE,
  ip_address TEXT,
  user_agent TEXT
);

-- Security events logging
CREATE TABLE IF NOT EXISTS security_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 2. ENABLE ROW LEVEL SECURITY ON EXISTING TABLES
-- ==========================================

-- Enable RLS on clientes table
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

-- Enable RLS on registros table
ALTER TABLE registros ENABLE ROW LEVEL SECURITY;

-- Enable RLS on empresa table
ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 3. CREATE ROW LEVEL SECURITY POLICIES
-- ==========================================

-- Policies for clientes table
CREATE POLICY "super_admin_full_access_clientes" ON clientes
  FOR ALL USING (
    auth.jwt() ->> 'role' = 'super_admin'
  );

CREATE POLICY "admin_full_access_clientes" ON clientes
  FOR ALL USING (
    auth.jwt() ->> 'role' = 'admin'
  );

CREATE POLICY "operator_read_clientes" ON clientes
  FOR SELECT USING (
    auth.jwt() ->> 'role' IN ('operator', 'viewer')
  );

CREATE POLICY "viewer_read_only_clientes" ON clientes
  FOR SELECT USING (
    auth.jwt() ->> 'role' = 'viewer'
  );

-- Policies for registros table
CREATE POLICY "super_admin_full_access_registros" ON registros
  FOR ALL USING (
    auth.jwt() ->> 'role' = 'super_admin'
  );

CREATE POLICY "admin_full_access_registros" ON registros
  FOR ALL USING (
    auth.jwt() ->> 'role' = 'admin'
  );

CREATE POLICY "operator_operations_registros" ON registros
  FOR ALL USING (
    auth.jwt() ->> 'role' = 'operator'
  );

CREATE POLICY "viewer_read_registros" ON registros
  FOR SELECT USING (
    auth.jwt() ->> 'role' = 'viewer'
  );

-- Policies for empresa table
CREATE POLICY "admin_access_empresa" ON empresa
  FOR ALL USING (
    auth.jwt() ->> 'role' IN ('super_admin', 'admin')
  );

-- ==========================================
-- 4. CREATE SECURITY FUNCTIONS
-- ==========================================

-- Function to hash passwords using bcrypt-like approach
CREATE OR REPLACE FUNCTION hash_password(password TEXT)
RETURNS TEXT AS $$
DECLARE
  salt TEXT := encode(gen_random_bytes(16), 'hex');
  hash TEXT;
BEGIN
  -- Simple hash for demonstration - in production use proper bcrypt
  hash := encode(sha256(password::bytea || salt::bytea), 'hex');
  := salt || '$' || hash;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Secure login function with rate limiting
CREATE OR REPLACE FUNCTION secure_login(email_input TEXT, password_input TEXT, ip_address TEXT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  user_record RECORD;
  login_result JSON;
  attempt_count INTEGER;
BEGIN
  -- Check rate limiting (max 3 failed attempts per 5 minutes)
  SELECT COUNT(*) INTO attempt_count FROM login_attempts
  WHERE email = email_input
    AND attempted_at > NOW() - INTERVAL '5 minutes'
    AND success = false;

  IF attempt_count >= 3 THEN
    INSERT INTO login_attempts (email, ip_address, success)
    VALUES (email_input, ip_address, false);
    RETURN json_build_object('success', false, 'message', 'Too many login attempts. Please try again later.');
  END IF;

  -- Find active user
  SELECT * INTO user_record FROM users
  WHERE email = email_input AND is_active = true;

  -- Check if user exists
  IF NOT FOUND THEN
    INSERT INTO login_attempts (email, ip_address, success)
    VALUES (email_input, ip_address, false);
    RETURN json_build_object('success', false, 'message', 'Invalid email or password');
  END IF;

  -- Check if account is locked
  IF user_record.locked_until > NOW() THEN
    RETURN json_build_object('success', false, 'message', 'Account temporarily locked due to multiple failed attempts');
  END IF;

  -- Verify password (simplified for demonstration)
  -- In production, use proper password verification
  IF password_input != user_record.password_hash THEN
    -- Update failed login attempts
    UPDATE users SET
      login_attempts = login_attempts + 1,
      locked_until = CASE
        WHEN login_attempts >= 2 THEN NOW() + INTERVAL '15 minutes'
        ELSE NULL
      END
    WHERE id = user_record.id;

    INSERT INTO login_attempts (email, ip_address, success)
    VALUES (email_input, ip_address, false);

    RETURN json_build_object('success', false, 'message', 'Invalid email or password');
  END IF;

  -- Successful login - reset counters and update last login
  UPDATE users SET
    login_attempts = 0,
    locked_until = NULL,
    last_login = NOW()
  WHERE id = user_record.id;

  -- Log successful login attempt
  INSERT INTO login_attempts (email, ip_address, success)
  VALUES (email_input, ip_address, true);

  -- Create session log entry
  INSERT INTO session_logs (user_id, ip_address, user_agent)
  VALUES (user_record.id, ip_address, NULL); -- user_agent would be passed from client

  -- Return success with user data and session info
  RETURN json_build_object(
    'success', true,
    'user_id', user_record.id,
    'email', user_record.email,
    'name', user_record.name,
    'role', user_record.role,
    'session_expires', NOW() + INTERVAL '8 hours'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create initial users (run this manually)
CREATE OR REPLACE FUNCTION create_initial_users()
RETURNS VOID AS $$
BEGIN
  -- Create super admin user
  INSERT INTO users (email, password_hash, name, role) VALUES
  ('admin@agua.local', 'temp_change_me', 'System Administrator', 'super_admin')
  ON CONFLICT (email) DO NOTHING;

  -- Create demo admin user
  INSERT INTO users (email, password_hash, name, role) VALUES
  ('demo@agua.local', 'demo123', 'Demo Admin', 'admin')
  ON CONFLICT (email) DO NOTHING;

  -- Create demo operator user
  INSERT INTO users (email, password_hash, name, role) VALUES
  ('operator@agua.local', 'operator123', 'Demo Operator', 'operator')
  ON CONFLICT (email) DO NOTHING;

  -- Create demo viewer user
  INSERT INTO users (email, password_hash, name, role) VALUES
  ('viewer@agua.local', 'viewer123', 'Demo Viewer', 'viewer')
  ON CONFLICT (email) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 5. CREATE INDEXES FOR PERFORMANCE
-- ==========================================

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Indexes for login_attempts table
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempted_at);

-- Indexes for session_logs table
CREATE INDEX IF NOT EXISTS idx_session_logs_user_id ON session_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_session_logs_time ON session_logs(login_time);

-- Indexes for security_logs table
CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_time ON security_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_security_logs_event_type ON security_logs(event_type);

-- ==========================================
-- 6. GRANT PERMISSIONS
-- ==========================================

-- Grant access to authenticated users for security functions
GRANT EXECUTE ON FUNCTION secure_login TO authenticated;
GRANT EXECUTE ON FUNCTION create_initial_users TO authenticated; -- Only run manually

-- Grant read access to security tables for audit purposes (admin+)
GRANT SELECT ON login_attempts TO authenticated;
GRANT SELECT ON session_logs TO authenticated;
GRANT SELECT ON security_logs TO authenticated;

-- Grant proper table access based on roles
-- These will be enforced by RLS policies above