-- ASDJ - Tools, version 12 : notifications sur les téléphones + rendez-vous pour le CT et la pollution.
-- Peut être relancé sans danger.
begin;
alter table public.machines add column if not exists ct_rdv date;
alter table public.machines add column if not exists ct_lieu text not null default '';
alter table public.machines add column if not exists pol_rdv date;
alter table public.machines add column if not exists pol_lieu text not null default '';

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
  typ := case when p_champ in ('equipe', 'km', 'rev_km', 'ct_mois', 'pol_mois', 'rev_mois', 'rev_cible_km') then 'int'
              when p_champ in ('depuis', 'controle', 'depose_le', 'recupere_le', 'pret_le', 'km_le', 'ct_le', 'pol_le', 'rev_le', 'ct_avant', 'pol_avant', 'rev_avant', 'mise_circulation', 'rev_rdv', 'ct_rdv', 'pol_rdv') then 'date'
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
                     'plaque','type_vehicule','km','km_le','ct_le','ct_mois','pol_le','pol_mois','rev_le','rev_km','rev_mois','probleme_type',
                     'ct_avant','pol_avant','rev_avant','mise_circulation',
                     'rev_mode','rev_cible_km','rev_rdv','rev_garage','rev_choix',
                     'ct_rdv','ct_lieu','pol_rdv','pol_lieu') then
    raise exception 'champ interdit: %', p_champ;
  end if;
  if p_champ in ('famille', 'actif', 'plaque', 'type_vehicule', 'ct_mois', 'pol_mois', 'rev_mois') and not public.est_chef() then
    raise exception 'reserve aux chefs: %', p_champ;
  end if;
  return public._ecrire(p_id, p_champ, p_valeur, p_ts, null);
end $$;
revoke all on function public.maj_champ(text, text, text, timestamptz) from public, anon;
grant execute on function public.maj_champ(text, text, text, timestamptz) to authenticated;




-- téléphones abonnés aux notifications (chacun gère les siens)
create table if not exists public.push_abonnements (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  appareil text not null default '',
  cree_le timestamptz not null default now()
);
alter table public.push_abonnements enable row level security;
revoke all on public.push_abonnements from anon, authenticated;
grant select, insert, delete on public.push_abonnements to authenticated;
drop policy if exists "chacun voit ses telephones" on public.push_abonnements;
drop policy if exists "chacun ajoute ses telephones" on public.push_abonnements;
drop policy if exists "chacun retire ses telephones" on public.push_abonnements;
create policy "chacun voit ses telephones" on public.push_abonnements for select to authenticated using (user_id = auth.uid());
create policy "chacun ajoute ses telephones" on public.push_abonnements for insert to authenticated with check (user_id = auth.uid() and public.acces_ok());
create policy "chacun retire ses telephones" on public.push_abonnements for delete to authenticated using (user_id = auth.uid());

-- ce que le robot a déjà envoyé (pour le rythme : tous les 2 jours, 2 fois par jour…)
create table if not exists public.push_journal (
  id bigint generated always as identity primary key,
  cle text not null,
  le timestamptz not null default now()
);
create index if not exists push_journal_cle_idx on public.push_journal (cle, le desc);
alter table public.push_journal enable row level security;
revoke all on public.push_journal from anon, authenticated;

-- réglages : la clé PUBLIQUE des notifications (la clé secrète reste dans les Secrets GitHub)
create table if not exists public.reglages (cle text primary key, valeur text not null default '');
alter table public.reglages enable row level security;
revoke all on public.reglages from anon, authenticated;

create or replace function public.push_cle_publique() returns text
language sql stable security definer set search_path = '' as $$ select valeur from public.reglages where cle = 'vapid_public' $$;
revoke all on function public.push_cle_publique() from public, anon;
grant execute on function public.push_cle_publique() to authenticated;

commit;
notify pgrst, 'reload schema';
select 'version 12 en place' as resultat;
