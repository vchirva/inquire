# Setup guide

End-to-end setup of Inquire: Supabase project, schema migration, frontend wiring, GitHub Pages deploy.

## 1. Create Supabase project

1. Go to [supabase.com](https://supabase.com) → sign in → **New project**
2. Name: `inquire` · Database password: generate & save somewhere safe · Region: closest to you (Frankfurt for EU)
3. Wait ~2 minutes for provisioning

## 2. Run the migration

1. Open the project → **SQL Editor** (left sidebar)
2. Click **New query**
3. Copy the entire contents of `supabase/migrations/0001_initial_schema.sql`
4. Paste and click **Run** (bottom right)
5. You should see "Success. No rows returned"

Verify: go to **Table Editor** → you should see all 12 tables (profiles, clients, questionnaires, questions, link_groups, response_sessions, responses, etc.)

## 3. Get your API credentials

1. Project Settings → **API**
2. Copy:
   - **Project URL** (e.g. `https://xxxxx.supabase.co`)
   - **anon / public** key (the long JWT — safe to expose in frontend)

You'll paste these into the frontend in step 5.

## 4. Create the first admin user

Supabase Auth signups default to `role = 'client'`. The very first admin needs to be promoted manually.

1. Project → **Authentication** → **Users** → **Add user** → **Create new user**
2. Email: your admin email · Password: set one · **Auto Confirm User**: ✅
3. Go to **SQL Editor** and run:
   ```sql
   update profiles set role = 'admin' where id = (
     select id from auth.users where email = 'your-admin-email@example.com'
   );
   ```
4. Verify in Table Editor → `profiles` → your user has `role = admin`

## 5. Wire up the frontend

The frontend reads its Supabase config from `config.js` at the repo root. Create it from the example:

```bash
cp config.example.js config.js
```

Then edit `config.js`:

```js
window.INQUIRE_CONFIG = {
  supabaseUrl: 'https://xxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGc...your-anon-key...'
};
```

> **Note:** the anon key is *meant* to be public — RLS policies are what actually secures the data. Committing `config.js` is fine for this project. If you ever need to keep it out of the repo, see "Deploying config.js" below.

## 6. Configure auth redirects

Project Settings → **Authentication** → **URL Configuration**:
- **Site URL:** `https://vchirva.github.io/inquire/`
- **Redirect URLs:** add `https://vchirva.github.io/inquire/**`

This lets Supabase redirect users back to your site after auth flows.

## 7. Deploy

```bash
git add .
git commit -m "Add Supabase schema and setup"
git push
```

GitHub Pages serves from `/ (root)` on the `main` branch, so `index.html` and `config.js` at the repo root will be live within ~30 seconds at https://vchirva.github.io/inquire/.

## 8. Test the setup

Open the live site, open DevTools console, and run:
```js
console.log(window.INQUIRE_CONFIG);
```
Should print your config object with the URL and anon key.

---

## Common issues

**"Permission denied for table xyz"** when querying — RLS is blocking you. Either you're not logged in, or your user doesn't have the right role. Check `profiles` table.

**"Invalid login credentials"** at sign-in — Supabase by default requires email confirmation. Either confirm via the link Supabase emails, or in Auth settings disable email confirmation for development.

**Auth redirects to `localhost`** — you forgot step 6. Update Site URL.

**Migration fails on re-run** — the migration isn't idempotent. To re-run from scratch: SQL Editor → run `drop schema public cascade; create schema public;` then re-run the migration. ⚠️ This wipes all data.
