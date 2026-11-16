-- Lecture seule : contraintes et détails (rien n'est modifié)
select 'con' k, conrelid::regclass::text n, conname||' '||pg_get_constraintdef(oid) v from pg_constraint where connamespace='public'::regnamespace
union all
select 'col', table_name||'.'||column_name, is_nullable||' '||coalesce(column_default,'')||' '||coalesce(identity_generation,'') from information_schema.columns where table_schema='public'
union all
select 'pub', pubname, schemaname||'.'||tablename from pg_publication_tables
union all
select 'idx', tablename, indexdef from pg_indexes where schemaname='public'
union all
select 'own', p.proname, pg_get_userbyid(p.proowner)||' secdef='||p.prosecdef from pg_proc p where p.pronamespace='public'::regnamespace
union all
select 'fnacl', p.proname, coalesce(array_to_string(p.proacl, ','),'(defaut)') from pg_proc p where p.pronamespace='public'::regnamespace
union all
select 'bucket', id, public::text from storage.buckets
union all
select 'rls', relname, relrowsecurity::text||' force='||relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r';
