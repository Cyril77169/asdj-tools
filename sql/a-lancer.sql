-- Lecture seule : état actuel de la base (rien n'est modifié)
select 'fn' k, p.proname n, pg_get_functiondef(p.oid) v from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'
union all
select 'col', table_name, string_agg(column_name||' '||data_type||coalesce(' def '||column_default,''), ', ' order by ordinal_position) from information_schema.columns where table_schema='public' group by table_name
union all
select 'pol', schemaname||'.'||tablename, policyname||' | '||cmd||' | '||array_to_string(roles,',')||' | '||coalesce(qual,'')||' | '||coalesce(with_check,'') from pg_policies where schemaname in ('public','storage')
union all
select 'trg', event_object_table, trigger_name||' '||action_timing||' '||event_manipulation||' '||action_statement from information_schema.triggers where trigger_schema='public'
union all
select 'users', email, id::text||' '||coalesce(raw_user_meta_data::text,'') from auth.users
union all
select 'grant', table_name, string_agg(grantee||':'||privilege_type, ', ') from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') group by table_name;
