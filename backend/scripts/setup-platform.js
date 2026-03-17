#!/usr/bin/env node
/**
 * setup-platform.js
 * ─────────────────
 * One-time platform initialization script. Run AFTER the SQL migrations.
 *
 * What it does:
 *   1. Creates the superadmin auth user in Supabase Auth
 *   2. Creates the first company
 *   3. Creates the superadmin app_users profile linked to that company
 *
 * Usage (run from the backend/ folder):
 *   node scripts/setup-platform.js
 *
 * Or customize via env vars before running:
 *   SA_EMAIL=... SA_PASSWORD=... SA_NAME=... COMPANY_NAME=... node scripts/setup-platform.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

// ── Configuration — override via env vars if needed ──────────────────────────
const CONFIG = {
  superadmin: {
    email:     process.env.SA_EMAIL    || 'superadmin@plataforma.com',
    password:  process.env.SA_PASSWORD || 'Admin2025!',
    full_name: process.env.SA_NAME     || 'Super Administrador'
  },
  company: {
    nombre:  process.env.COMPANY_NAME  || 'Mi Empresa Agua S.A.',
    plan:    process.env.COMPANY_PLAN  || 'profesional',
    email:   process.env.COMPANY_EMAIL || '',
    nit:     process.env.COMPANY_NIT   || ''
  }
};

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

async function main() {
  // ── Validate env ────────────────────────────────────────────────────────────
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
  }
  if (!PASSWORD_REGEX.test(CONFIG.superadmin.password)) {
    console.error('❌  SA_PASSWORD must be at least 8 chars with 1 uppercase and 1 number');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  console.log('\n🚀  Platform Setup');
  console.log('─'.repeat(50));

  // ── Step 1: Create company ───────────────────────────────────────────────────
  console.log('\n[1/3] Creating company...');
  let companyId;
  const { data: existingCompany } = await supabase
    .from('companies')
    .select('id, nombre')
    .eq('nombre', CONFIG.company.nombre)
    .maybeSingle();

  if (existingCompany) {
    companyId = existingCompany.id;
    console.log(`     ⚠️  Company already exists: ${existingCompany.nombre} (${companyId})`);
  } else {
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({
        nombre: CONFIG.company.nombre,
        plan:   CONFIG.company.plan,
        email:  CONFIG.company.email || null,
        nit:    CONFIG.company.nit   || null,
        activa: true
      })
      .select()
      .single();

    if (companyError) {
      console.error('❌  Company insert error:', companyError.message);
      console.error('    → Make sure you ran the SQL migrations first (supabase_migrations.sql)');
      process.exit(1);
    }
    companyId = company.id;
    console.log(`     ✅  Company created: "${company.nombre}" (${companyId})`);
  }

  // ── Step 2: Create auth user ─────────────────────────────────────────────────
  console.log('\n[2/3] Creating superadmin auth user...');
  let userId;
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: CONFIG.superadmin.email.toLowerCase().trim(),
    password: CONFIG.superadmin.password,
    email_confirm: true
  });

  if (authError) {
    if (authError.message?.includes('already registered') || authError.message?.includes('already been registered')) {
      // User already exists — look up the existing user
      const { data: usersData } = await supabase.auth.admin.listUsers();
      const existing = usersData?.users?.find(u => u.email === CONFIG.superadmin.email.toLowerCase());
      if (!existing) {
        console.error('❌  Auth error:', authError.message);
        process.exit(1);
      }
      userId = existing.id;
      console.log(`     ⚠️  Auth user already exists: ${existing.email} (${userId})`);
    } else {
      console.error('❌  Auth error:', authError.message);
      process.exit(1);
    }
  } else {
    userId = authData.user.id;
    console.log(`     ✅  Auth user created: ${authData.user.email} (${userId})`);
  }

  // ── Step 3: Create app_users profile ─────────────────────────────────────────
  console.log('\n[3/3] Creating superadmin profile...');
  const { data: existingProfile } = await supabase
    .from('app_users')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();

  if (existingProfile) {
    console.log(`     ⚠️  Profile already exists (role: ${existingProfile.role})`);
    if (existingProfile.role !== 'superadmin') {
      const { error: updateError } = await supabase
        .from('app_users')
        .update({ role: 'superadmin', company_id: companyId })
        .eq('id', userId);
      if (updateError) console.error('     ⚠️  Could not update role:', updateError.message);
      else console.log('     ✅  Role updated to superadmin');
    }
  } else {
    const { error: profileError } = await supabase
      .from('app_users')
      .insert({
        id:         userId,
        company_id: companyId,
        full_name:  CONFIG.superadmin.full_name,
        role:       'superadmin',
        activo:     true
      });

    if (profileError) {
      console.error('❌  Profile insert error:', profileError.message);
      // Rollback auth user
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
      console.error('    Auth user rolled back.');
      process.exit(1);
    }
    console.log(`     ✅  Superadmin profile created`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('✅  Setup complete!\n');
  console.log('   Superadmin credentials:');
  console.log(`     Email:    ${CONFIG.superadmin.email}`);
  console.log(`     Password: ${CONFIG.superadmin.password}`);
  console.log(`\n   Company: "${CONFIG.company.nombre}" (ID: ${companyId})`);
  console.log('\n   Next steps:');
  console.log('   1. Start the backend: npm start');
  console.log('   2. Log in with the superadmin credentials');
  console.log('   3. Create company_owner users from the Usuarios panel');
  console.log('   4. Create projects for each company from the Proyectos panel');
  console.log('');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
