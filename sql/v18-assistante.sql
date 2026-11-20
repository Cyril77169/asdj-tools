-- ASDJ - Tools, version 18 : 3e grade « Assistante » (droits d'un équipier + les tenues complètes).
-- Un nouveau compte reste équipier ; un chef le passe Assistante dans Paramètres → Accès.
-- Peut être relancé sans danger.
begin;
alter table public.membres drop constraint if exists membres_role_check;
alter table public.membres add constraint membres_role_check check (role in ('chef', 'equipier', 'assistante'));

create or replace function public.acces_ok() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(public.mon_role() in ('chef', 'equipier', 'assistante'), false) $$;
create or replace function public.voit_tenues() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(public.mon_role() in ('chef', 'assistante'), false) $$;
revoke all on function public.voit_tenues() from public, anon;
grant execute on function public.voit_tenues() to authenticated;

drop policy if exists "chefs voient le personnel" on public.personnel;
drop policy if exists "chefs et assistante voient le personnel" on public.personnel;
create policy "chefs et assistante voient le personnel" on public.personnel for select to authenticated using (public.voit_tenues());
drop policy if exists "chefs voient l'historique des tenues" on public.personnel_historique;
drop policy if exists "chefs et assistante voient l'historique des tenues" on public.personnel_historique;
create policy "chefs et assistante voient l'historique des tenues" on public.personnel_historique for select to authenticated using (public.voit_tenues());

create or replace function public.personne_ajouter(p_prenom text, p_equipe integer) returns public.personnel
language plpgsql security definer set search_path = '' as $$
declare r public.personnel;
begin
  if not public.voit_tenues() then raise exception 'reserve aux chefs: tenues'; end if;
  p_prenom := trim(p_prenom);
  if p_prenom = '' then raise exception 'prénom vide'; end if;
  insert into public.personnel (prenom, equipe) values (p_prenom, p_equipe) returning * into r;
  insert into public.personnel_historique (personne_id, champ, ancien, nouveau) values (r.id, 'creation', null, p_prenom);
  return r;
end $$;

create or replace function public.personne_maj(p_id text, p_champ text, p_valeur text) returns public.personnel
language plpgsql security definer set search_path = '' as $$
declare r public.personnel; ancien text; typ text; v text;
begin
  if not public.voit_tenues() then raise exception 'reserve aux chefs: tenues'; end if;
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

-- comptes : un chef peut passer un équipier Assistante (et l'inverse) ; un chef ne change pas de grade ici
create or replace function public.membre_action(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if not public.est_chef() then raise exception 'reserve aux chefs: comptes'; end if;
  select role into r from public.membres where user_id = p_id;
  if r is null then raise exception 'compte inconnu'; end if;
  if p_action = 'couper' then
    if r = 'chef' then raise exception 'on ne peut pas couper l''acces d''un chef'; end if;
    update public.membres set actif = false where user_id = p_id;
  elsif p_action = 'rendre' then update public.membres set actif = true where user_id = p_id;
  elsif p_action = 'lever_pause' then update public.membres set pause_levee = now() where user_id = p_id;
  elsif p_action in ('assistante', 'equipier') then
    if r = 'chef' then raise exception 'on ne change pas le grade d''un chef'; end if;
    update public.membres set role = p_action where user_id = p_id;
  else raise exception 'action inconnue';
  end if;
  return public.membres_liste();
end $$;
revoke all on function public.membre_action(uuid, text) from public, anon;
grant execute on function public.membre_action(uuid, text) to authenticated;
commit;
notify pgrst, 'reload schema';
select 'version 18 en place' as resultat;
