-- ASDJ - Tools, version 15 : les tenues (tailles du personnel), visibles seulement par les chefs.
-- Peut être relancé sans danger.
begin;
create table if not exists public.personnel (
  id text primary key default ('P' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  prenom text not null,
  equipe integer references public.equipes(numero) on delete set null,
  actif boolean not null default true,
  t_tshirt text not null default '', t_pantalon text not null default '', t_sweat text not null default '', t_chaussures text not null default '',
  t_hiver text not null default '', t_misaison text not null default '', t_orange text not null default '', t_pluie text not null default '',
  maj timestamptz not null default now(),
  maj_par uuid default auth.uid()
);
alter table public.personnel enable row level security;
revoke all on public.personnel from anon, authenticated;
grant select on public.personnel to authenticated;
drop policy if exists "chefs voient le personnel" on public.personnel;
create policy "chefs voient le personnel" on public.personnel for select to authenticated using (public.est_chef());

-- historique des tailles (comme celui des machines : on ne peut ni le modifier ni l'effacer)
create table if not exists public.personnel_historique (
  id bigint generated always as identity primary key,
  personne_id text not null,
  champ text not null, ancien text, nouveau text,
  at timestamptz not null default now(),
  par uuid default auth.uid()
);
alter table public.personnel_historique enable row level security;
revoke all on public.personnel_historique from anon, authenticated;
grant select on public.personnel_historique to authenticated;
drop policy if exists "chefs voient l'historique des tenues" on public.personnel_historique;
create policy "chefs voient l'historique des tenues" on public.personnel_historique for select to authenticated using (public.est_chef());
create or replace function public.personnel_historique_verrou() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'historique verrouillé : on ne peut ni modifier ni effacer une ligne de l''historique'; end $$;
drop trigger if exists personnel_historique_verrou on public.personnel_historique;
create trigger personnel_historique_verrou before update or delete on public.personnel_historique for each row execute function public.personnel_historique_verrou();
drop trigger if exists personnel_historique_verrou_vider on public.personnel_historique;
create trigger personnel_historique_verrou_vider before truncate on public.personnel_historique for each statement execute function public.personnel_historique_verrou();
-- une personne ne s'efface pas (on la retire de la liste)
create or replace function public.personnel_verrou() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'on ne peut pas effacer une personne (utilise « Retirer de la liste »)'; end $$;
drop trigger if exists personnel_verrou on public.personnel;
create trigger personnel_verrou before delete on public.personnel for each row execute function public.personnel_verrou();

-- ajouter une personne (chefs)
create or replace function public.personne_ajouter(p_prenom text, p_equipe integer) returns public.personnel
language plpgsql security definer set search_path = '' as $$
declare r public.personnel;
begin
  if not public.est_chef() then raise exception 'reserve aux chefs: tenues'; end if;
  p_prenom := trim(p_prenom);
  if p_prenom = '' then raise exception 'prénom vide'; end if;
  insert into public.personnel (prenom, equipe) values (p_prenom, p_equipe) returning * into r;
  insert into public.personnel_historique (personne_id, champ, ancien, nouveau) values (r.id, 'creation', null, p_prenom);
  return r;
end $$;
revoke all on function public.personne_ajouter(text, integer) from public, anon;
grant execute on function public.personne_ajouter(text, integer) to authenticated;

-- changer une taille, le prénom, l'équipe, ou retirer (chefs) ; tout est noté
create or replace function public.personne_maj(p_id text, p_champ text, p_valeur text) returns public.personnel
language plpgsql security definer set search_path = '' as $$
declare r public.personnel; ancien text; typ text; v text;
begin
  if not public.est_chef() then raise exception 'reserve aux chefs: tenues'; end if;
  if p_champ not in ('prenom','equipe','actif','t_tshirt','t_pantalon','t_sweat','t_chaussures','t_hiver','t_misaison','t_orange','t_pluie') then raise exception 'champ interdit: %', p_champ; end if;
  select * into r from public.personnel where id = p_id for update;
  if not found then raise exception 'personne inconnue'; end if;
  typ := case when p_champ = 'equipe' then 'int' when p_champ = 'actif' then 'boolean' else 'text' end;
  v := case when typ = 'text' then trim(coalesce(p_valeur, '')) else nullif(p_valeur, '') end;
  if p_champ = 'prenom' and v = '' then raise exception 'prénom vide'; end if;
  ancien := to_jsonb(r) ->> p_champ;
  execute format('update public.personnel set %I = $1::%s, maj = now(), maj_par = auth.uid() where id = $2 returning *', p_champ, typ) into r using v, p_id;
  if ancien is distinct from v then
    insert into public.personnel_historique (personne_id, champ, ancien, nouveau) values (p_id, p_champ, ancien, v);
  end if;
  return r;
end $$;
revoke all on function public.personne_maj(text, text, text) from public, anon;
grant execute on function public.personne_maj(text, text, text) to authenticated;
commit;
notify pgrst, 'reload schema';
select 'version 15 en place' as resultat;
