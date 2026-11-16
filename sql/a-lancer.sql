-- Lecture seule : vérification après la version 7 (rien n'est modifié)
select 'membres' k, string_agg(nom||'='||role||(case when actif then '' else ' (coupé)' end), ', ') v from public.membres
union all select 'triggers', string_agg(trigger_name, ', ') from information_schema.triggers where trigger_schema='public'
union all select 'policies', string_agg(tablename||':'||policyname, ' | ') from pg_policies where schemaname in ('public','storage')
union all select 'maj_champ secdef', prosecdef::text from pg_proc where proname='maj_champ'
union all select 'grants machines', string_agg(grantee||':'||privilege_type, ', ') from information_schema.role_table_grants where table_schema='public' and table_name='machines' and grantee in ('anon','authenticated');
