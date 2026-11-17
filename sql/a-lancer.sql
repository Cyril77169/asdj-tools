-- ASDJ - Tools, version 9 : les véhicules (rangés avec les machines, famille « vehicule »).
-- Peut être relancé sans danger.
begin;

-- 1. nouvelle famille « vehicule » et nouvel état « revision » (attente de révision)
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.machines'::regclass and contype = 'c'
           and (pg_get_constraintdef(oid) like '%famille%' or pg_get_constraintdef(oid) like '%statut%') loop
    execute format('alter table public.machines drop constraint %I', c);
  end loop;
end $$;
alter table public.machines add constraint machines_famille_check check (famille = any (array['tondeuse','debroussailleuse','souffleur','taillehaie','tronconneuse','autoportee','motoculteur','scarificateur','outillage','vehicule']));
alter table public.machines add constraint machines_statut_check check (statut = any (array['operationnelle','controle','disponible','probleme','reparation','hs','revision']));

-- 2. infos propres aux véhicules
alter table public.machines add column if not exists plaque text not null default '';
alter table public.machines add column if not exists type_vehicule text not null default '';
alter table public.machines add column if not exists km integer;
alter table public.machines add column if not exists km_le date;
alter table public.machines add column if not exists ct_le date;
alter table public.machines add column if not exists ct_mois integer;
alter table public.machines add column if not exists pol_le date;
alter table public.machines add column if not exists pol_mois integer;
alter table public.machines add column if not exists rev_le date;
alter table public.machines add column if not exists rev_km integer;
alter table public.machines add column if not exists rev_mois integer;
alter table public.machines add column if not exists probleme_type text not null default '';

-- 3. écriture d'un champ : nouveaux types
create or replace function public._ecrire(p_id text, p_champ text, p_valeur text, p_ts timestamptz, p_annule bigint)
returns public.machines
language plpgsql security definer set search_path = '' as $$
declare r public.machines; ancien text; dernier timestamptz; typ text; v text;
begin
  select * into r from public.machines where id = p_id for update;
  if not found then raise exception 'machine inconnue: %', p_id; end if;
  dernier := (r.field_ts ->> p_champ)::timestamptz;
  if p_annule is null and dernier is not null and dernier >= p_ts then return r; end if;
  if p_annule is not null and dernier is not null and dernier >= p_ts then p_ts := dernier + interval '1 millisecond'; end if;
  typ := case when p_champ in ('equipe', 'km', 'rev_km', 'ct_mois', 'pol_mois', 'rev_mois') then 'int'
              when p_champ in ('depuis', 'controle', 'depose_le', 'recupere_le', 'pret_le', 'km_le', 'ct_le', 'pol_le', 'rev_le') then 'date'
              when p_champ = 'actif' then 'boolean' else 'text' end;
  v := case when typ = 'text' then coalesce(p_valeur, '') else nullif(p_valeur, '') end;
  ancien := to_jsonb(r) ->> p_champ;
  execute format(
    'update public.machines set %I = $1::%s, field_ts = field_ts || jsonb_build_object(%L, $2::text), updated_at = now(), updated_by = auth.uid() where id = $3 returning *',
    p_champ, typ, p_champ)
  into r using v, p_ts, p_id;
  if ancien is distinct from v or p_annule is not null then
    insert into public.historique (machine_id, champ, ancien, nouveau, annule) values (p_id, p_champ, ancien, v, p_annule);
  end if;
  return r;
end $$;
revoke all on function public._ecrire(text, text, text, timestamptz, bigint) from public, anon, authenticated;

create or replace function public.maj_champ(p_id text, p_champ text, p_valeur text, p_ts timestamptz)
returns public.machines
language plpgsql security definer set search_path = '' as $$
begin
  if not public.acces_ok() then raise exception 'acces coupe'; end if;
  if p_champ not in ('modele','famille','equipe','affectation','statut','lieu','reparateur','depuis','controle','motif','notes','actif',
                     'depose_par','depose_le','recupere_par','recupere_le','photo','pret_a','pret_le',
                     'plaque','type_vehicule','km','km_le','ct_le','ct_mois','pol_le','pol_mois','rev_le','rev_km','rev_mois','probleme_type') then
    raise exception 'champ interdit: %', p_champ;
  end if;
  if p_champ in ('famille', 'actif', 'plaque', 'type_vehicule', 'ct_mois', 'pol_mois', 'rev_mois') and not public.est_chef() then
    raise exception 'reserve aux chefs: %', p_champ;
  end if;
  return public._ecrire(p_id, p_champ, p_valeur, p_ts, null);
end $$;
revoke all on function public.maj_champ(text, text, text, timestamptz) from public, anon;
grant execute on function public.maj_champ(text, text, text, timestamptz) to authenticated;

-- 4. changement de numéro : recopie aussi les nouvelles colonnes
create or replace function public.renommer_machine(p_old text, p_new text)
returns public.machines
language plpgsql security definer set search_path = '' as $$
declare r public.machines;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'non autorisé'; end if;
  if not public.est_chef() then raise exception 'reserve aux chefs: numero'; end if;
  p_new := upper(trim(p_new));
  if p_new = '' then raise exception 'numéro vide'; end if;
  if not exists (select 1 from public.machines where id = p_old) then raise exception 'machine inconnue: %', p_old; end if;
  if p_new = p_old then select * into r from public.machines where id = p_old; return r; end if;
  if exists (select 1 from public.machines where id = p_new) then raise exception 'numéro déjà pris: %', p_new; end if;
  perform set_config('asdj.renommage', '1', true);
  insert into public.machines select (jsonb_populate_record(null::public.machines, to_jsonb(m) || jsonb_build_object('id', p_new, 'updated_at', now(), 'updated_by', auth.uid()))).*
    from public.machines m where m.id = p_old;
  update public.historique set machine_id = p_new where machine_id = p_old;
  update public.historique set nouveau = jsonb_set(nouveau::jsonb, '{id}', to_jsonb(p_new))::text
    where machine_id = p_new and champ = 'evenement';
  insert into public.historique (machine_id, champ, ancien, nouveau) values (p_new, 'numero', p_old, p_new);
  delete from public.machines where id = p_old;
  perform set_config('asdj.renommage', '', true);
  select * into r from public.machines where id = p_new;
  return r;
end $$;
revoke all on function public.renommer_machine(text, text) from public, anon;
grant execute on function public.renommer_machine(text, text) to authenticated;

-- 5. les 11 véhicules (au dépôt, en circulation ; dates à remplir dans l'appli)
insert into public.machines (id, famille, modele, plaque, type_vehicule, statut, lieu, equipe, affectation, ct_mois, pol_mois, rev_mois, depuis, ordre)
values
  ('VH01', 'vehicule', 'Renault Master',       'CV-313-AN', 'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 1),
  ('VH02', 'vehicule', 'Renault Master',       'GA-448-RC', 'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 2),
  ('VH03', 'vehicule', 'Renault Master',       'FQ-763-DJ', 'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 3),
  ('VH04', 'vehicule', 'Renault Master benne', 'GP-542-YZ', 'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 4),
  ('VH05', 'vehicule', 'Nissan benne',         '',          'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 5),
  ('VH06', 'vehicule', 'Ford',                 '',          'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 6),
  ('VH07', 'vehicule', 'Renault Master benne', '',          'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 7),
  ('VH08', 'vehicule', 'Renault Kangoo',       '',          'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 8),
  ('VH09', 'vehicule', 'Renault Clio',         '',          'voiture',    'operationnelle', 'depot', null, '', 24, null, 12, current_date, 9),
  ('VH10', 'vehicule', 'DS 7',                 '',          'voiture',    'operationnelle', 'depot', null, '', 24, null, 12, current_date, 10),
  ('VH11', 'vehicule', 'Peugeot 308',          'GT-100-GY', 'voiture',    'operationnelle', 'depot', null, '', 24, null, 12, current_date, 11)
on conflict (id) do nothing;

commit;
notify pgrst, 'reload schema';
select 'version 9 en place' as resultat, (select count(*) from public.machines where famille = 'vehicule') as vehicules;
