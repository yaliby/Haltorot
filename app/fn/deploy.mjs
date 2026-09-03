// Builds the importer bundle and pushes it to Supabase Edge Functions.
//
// Needs a personal access token (https://supabase.com/dashboard/account/tokens)
// in .env.admin as SUPABASE_ACCESS_TOKEN — the secret key does not authorise
// deploys. The project ref is read off the URL the app already uses.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');

function envFile(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    /* An absent file is one more place the value simply is not. */
  }
  return env;
}

const client = envFile(resolve(app, '.env'));
const prod = envFile(resolve(app, '.env.production'));
const admin = envFile(resolve(app, '..', '.env.admin'));

const url = client.VITE_SUPABASE_URL || prod.VITE_SUPABASE_URL || admin.SUPABASE_URL;
const ref = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\./)?.[1];
if (!ref) throw new Error('no Supabase project URL in app/.env, .env.production or .env.admin');

const token = process.env.SUPABASE_ACCESS_TOKEN || admin.SUPABASE_ACCESS_TOKEN;
if (!token) {
  throw new Error(
    'SUPABASE_ACCESS_TOKEN missing — create one at\n' +
    '  https://supabase.com/dashboard/account/tokens\n' +
    'and add it to .env.admin (see .env.admin.example).'
  );
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, {
    cwd: app,
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(process.execPath, [resolve(here, 'build.mjs')]);
run('npx', ['--yes', 'supabase@latest', 'functions', 'deploy', 'import', '--project-ref', ref]);

console.log(`\ndeployed → ${url}/functions/v1/import`);
