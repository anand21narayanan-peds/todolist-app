/*
  Your Supabase project's address and public key.

  Supabase dashboard → Project Settings → API:
    Project URL        -> SUPABASE_URL   (the base URL, with no /rest/v1 suffix —
                                          supabase-js appends its own paths)
    Publishable / anon -> SUPABASE_ANON_KEY

  This key is meant to be public. It ships in every Supabase web app and
  identifies the project, not you; row level security is what actually protects
  the data, which is why most of schema.sql is policies. The secret /
  service_role key is the dangerous one — it bypasses RLS. Never put it here.
*/
window.SUPABASE_URL = 'https://jscpzvlyitzlxznpvifx.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_JG_1eyeWTgwb4ATi2YhZuA_WSqYMxsv';
