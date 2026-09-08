/*
  Your Supabase project's address and public key.

  Supabase dashboard → Project Settings → Data API (or API):
    Project URL   -> SUPABASE_URL
    anon / public -> SUPABASE_ANON_KEY

  The anon key is meant to be public — it ships in every Supabase web app and
  identifies the project, not you. Row level security is what actually protects
  the data, which is why schema.sql spends most of its length on policies.
  The service_role key is the dangerous one: it bypasses RLS. Never put it here.
*/
window.SUPABASE_URL = 'REPLACE_WITH_YOUR_PROJECT_URL';
window.SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_ANON_KEY';
