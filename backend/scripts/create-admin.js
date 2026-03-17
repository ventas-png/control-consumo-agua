#!/usr/bin/env node
// One-time script to create the first admin user.
// Usage: cd backend && node scripts/create-admin.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const USER = {
  email: 'ventas@mayanresidenciales.com',
  password: 'Mayan2025',
  full_name: 'Carlos Garcia',
  role: 'admin'
};

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: USER.email.toLowerCase(),
    password: USER.password,
    email_confirm: true
  });

  if (authError) {
    console.error('❌ Auth error:', authError.message);
    process.exit(1);
  }

  const userId = authData.user.id;
  console.log(`   Auth user created: ${userId}`);

  // 2. Insert profile
  const { error: profileError } = await supabase
    .from('app_users')
    .insert({ id: userId, full_name: USER.full_name, role: USER.role });

  if (profileError) {
    console.error('❌ Profile insert error:', profileError.message);
    // Rollback
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    console.error('   Auth user rolled back.');
    process.exit(1);
  }

  console.log(`✅ Admin user created: ${USER.email} (id: ${userId})`);
}

main();
