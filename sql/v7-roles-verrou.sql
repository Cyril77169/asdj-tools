-- ASDJ - Tools, version 7 : rôles Chef / Équipier, historique verrouillé, annulations, frein, accès coupable.
-- Peut être relancé sans danger (tout est « si n'existe pas » / « remplacer »).
begin;

-- ========== 1. Les membres et leur rôle ==========
create table if not exists public.membres (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nom text not null default '',
  role text not null default 'equipier' check (role in ('chef', 'equipier')),
  actif boolean not null default true,
  pause_levee timestamptz
);
alter table public.membres enable row level security;

-- rôle de la personne connectée : 'chef', 'equipier' (par défaut pour tout nouveau compte) ou 'coupe'
create or replace function public.mon_role() returns text
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null
              when m.user_id is null then 'equipier'
              when not m.actif then 'coupe'
              else m.role end
  from (select 1) x left join public.membres m on m.user_id = auth.uid()
$$;
create or replace function public.acces_ok() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(public.mon_role() in ('chef', 'equipier'), false) $$;
create or replace function public.est_chef() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(public.mon_role() = 'chef', false) $$;

insert into public.membres (user_id, nom, role)
  select id, coalesce(raw_user_meta_data ->> 'nom', ''), 'chef' from auth.users where email in ('cyril.vog77@gmail.com', 'asdj.maury@gmail.com')
  on conflict (user_id) do update set role = 'chef', actif = true;
insert into public.membres (user_id, nom, role)
  select id, 'Eric', 'equipier' from auth.users where email = 'berruyer.eric78@gmail.com'
  on conflict (user_id) do nothing;

revoke all on public.membres from anon, authenticated;
grant select on public.membres to authenticated;
drop policy if exists "membres lisent membres" on public.membres;
create policy "membres lisent membres" on public.membres for select to authenticated using (public.acces_ok());

-- ========== 2. Colonne « annule » : une annulation est une NOUVELLE ligne qui pointe vers la ligne annulée ==========
alter table public.historique add column if not exists annule bigint;
create index if not exists historique_annule_idx on public.historique (annule) where annule is not null;
create index if not exists historique_par_idx on public.historique (par, at desc);
create index if not exists historique_at_idx on public.historique (at desc);

-- ========== 3. Le frein : 20 actions par heure maximum pour un équipier ==========
-- une « action » = une série de lignes sur une même machine à moins de 2 minutes d'écart
create or replace function public.pause_jusqua(p_uid uuid) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare lev timestamptz; n int; t timestamptz;
begin
  if p_uid is null then return null; end if;
  if exists (select 1 from public.membres where user_id = p_uid and role = 'chef') then return null; end if;
  select pause_levee into lev from public.membres where user_id = p_uid;
  select count(*), min(at) into n, t from (
    select at from (
      select at, lag(at) over (partition by machine_id order by at) prev
      from public.historique where par = p_uid and at > now() - interval '62 minutes'
    ) x
    where (prev is null or at - prev > interval '2 minutes')
      and at > greatest(now() - interval '1 hour', coalesce(lev, '-infinity'::timestamptz))
    order by at desc limit 20
  ) y;
  if n >= 20 then return t + interval '1 hour'; end if;
  return null;
end $$;

-- ========== 4. Historique : date et auteur imposés par le serveur, frein, accès ==========
create or replace function public.historique_avant_ajout() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p timestamptz;
begin
  new.at := now();
  if auth.uid() is not null then new.par := auth.uid(); end if;
  if auth.uid() is null or current_setting('asdj.renommage', true) = '1' then return new; end if;
  if not public.acces_ok() then raise exception 'acces coupe'; end if;
  -- la suite d'une action déjà commencée sur la même machine passe toujours
  if exists (select 1 from public.historique where par = new.par and machine_id = new.machine_id and at > now() - interval '2 minutes') then return new; end if;
  p := public.pause_jusqua(new.par);
  if p is not null then raise exception 'pause:%', to_char(p at time zone 'Europe/Paris', 'HH24:MI'); end if;
  return new;
end $$;
drop trigger if exists historique_avant_ajout on public.historique;
create trigger historique_avant_ajout before insert on public.historique for each row execute function public.historique_avant_ajout();

-- ========== 5. VERROU : personne ne modifie ni n'efface une ligne d'historique ==========
-- seule exception : quand une machine change de numéro, ses lignes suivent le nouveau numéro (contenu inchangé)
create or replace function public.historique_verrou() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_setting('asdj.renommage', true) = '1'
     and new.id = old.id and new.champ = old.champ and new.at = old.at
     and new.ancien is not distinct from old.ancien and new.par is not distinct from old.par and new.annule is not distinct from old.annule
     and (new.nouveau is not distinct from old.nouveau or old.champ = 'evenement') then
    return new;
  end if;
  raise exception 'historique verrouillé : on ne peut ni modifier ni effacer une ligne de l''historique';
end $$;
drop trigger if exists historique_verrou on public.historique;
create trigger historique_verrou before update or delete on public.historique for each row execute function public.historique_verrou();
drop trigger if exists historique_verrou_vider on public.historique;
create trigger historique_verrou_vider before truncate on public.historique for each statement execute function public.historique_verrou();

-- une machine ne s'efface jamais (seul le changement de numéro remplace l'ancienne fiche par la nouvelle)
create or replace function public.machines_verrou() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('asdj.renommage', true) = '1' then return old; end if;
  raise exception 'on ne peut pas effacer une machine (utilise « Retirer du parc »)';
end $$;
drop trigger if exists machines_verrou on public.machines;
create trigger machines_verrou before delete on public.machines for each row execute function public.machines_verrou();
drop trigger if exists machines_verrou_vider on public.machines;
create trigger machines_verrou_vider before truncate on public.machines for each statement execute function public.machines_verrou();

-- une machine ajoutée laisse une trace (pour savoir qui l'a ajoutée et pouvoir l'annuler)
create or replace function public.machines_apres_ajout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('asdj.renommage', true) = '1' then return null; end if;
  insert into public.historique (machine_id, champ, ancien, nouveau) values (new.id, 'creation', null, new.famille);
  return null;
end $$;
drop trigger if exists machines_apres_ajout on public.machines;
create trigger machines_apres_ajout after insert on public.machines for each row execute function public.machines_apres_ajout();

-- ========== 6. Écriture d'un champ (commune aux modifs et aux annulations) ==========
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
  typ := case when p_champ = 'equipe' then 'int'
              when p_champ in ('depuis', 'controle', 'depose_le', 'recupere_le', 'pret_le') then 'date'
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

-- modifier un champ depuis l'appli (famille et « dans le parc » réservés aux chefs)
create or replace function public.maj_champ(p_id text, p_champ text, p_valeur text, p_ts timestamptz)
returns public.machines
language plpgsql security definer set search_path = '' as $$
begin
  if not public.acces_ok() then raise exception 'acces coupe'; end if;
  if p_champ not in ('modele','famille','equipe','affectation','statut','lieu','reparateur','depuis','controle','motif','notes','actif',
                     'depose_par','depose_le','recupere_par','recupere_le','photo','pret_a','pret_le') then
    raise exception 'champ interdit: %', p_champ;
  end if;
  if p_champ in ('famille', 'actif') and not public.est_chef() then raise exception 'reserve aux chefs: %', p_champ; end if;
  return public._ecrire(p_id, p_champ, p_valeur, p_ts, null);
end $$;
revoke all on function public.maj_champ(text, text, text, timestamptz) from public, anon;
grant execute on function public.maj_champ(text, text, text, timestamptz) to authenticated;

-- changer le numéro : réservé aux chefs ; la fiche, l'historique et les pannes suivent la machine
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
  insert into public.machines (id, famille, modele, equipe, affectation, statut, lieu, reparateur, depuis, controle, motif, notes, actif, ordre,
                               field_ts, updated_at, updated_by, depose_par, depose_le, recupere_par, recupere_le, photo, pret_a, pret_le)
    select p_new, famille, modele, equipe, affectation, statut, lieu, reparateur, depuis, controle, motif, notes, actif, ordre,
           field_ts, now(), auth.uid(), depose_par, depose_le, recupere_par, recupere_le, photo, pret_a, pret_le
    from public.machines where id = p_old;
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

-- ========== 7. Annuler des modifs (chefs) ==========
-- p_ids : des lignes précises ; sinon tout depuis p_depuis (d'une personne p_par, ou de tout le monde)
-- p_essai = true : calcule ce qui serait fait sans rien changer (pour le récapitulatif)
create or replace function public.annuler(p_ids bigint[] default null, p_par uuid default null, p_depuis timestamptz default null, p_essai boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  h record; cur text; qui text; nb int := 0; mach text[] := '{}'; garde jsonb := '[]'; liste jsonb := '[]'; ev jsonb;
begin
  if not public.est_chef() then raise exception 'reserve aux chefs: annulation'; end if;
  if p_ids is null and p_depuis is null then raise exception 'rien a annuler'; end if;
  begin
    for h in
      select x.* from public.historique x
      where (case when p_ids is not null then x.id = any (p_ids) else x.at >= p_depuis and (p_par is null or x.par = p_par) end)
        and x.champ not in ('numero', 'annulation') and x.annule is null
        and not exists (select 1 from public.historique y where y.annule = x.id)
      order by x.at desc, x.id desc
    loop
      if h.champ = 'evenement' then
        insert into public.historique (machine_id, champ, ancien, nouveau, annule) values (h.machine_id, 'annulation', null, 'evenement', h.id);
        begin ev := h.nouveau::jsonb; exception when others then ev := '{}'; end;
        liste := liste || jsonb_build_object('m', h.machine_id, 'c', 'evenement', 'type', ev ->> 'type', 'motif', ev ->> 'motif');
      elsif h.champ = 'creation' then
        select to_jsonb(m) ->> 'actif' into cur from public.machines m where m.id = h.machine_id;
        if cur is null then garde := garde || jsonb_build_object('m', h.machine_id, 'c', h.champ, 'raison', 'machine introuvable'); continue; end if;
        if cur = 'true' then perform public._ecrire(h.machine_id, 'actif', 'false', now(), h.id);
        else insert into public.historique (machine_id, champ, ancien, nouveau, annule) values (h.machine_id, 'annulation', null, 'creation', h.id); end if;
        liste := liste || jsonb_build_object('m', h.machine_id, 'c', 'creation');
      else
        select to_jsonb(m) ->> h.champ into cur from public.machines m where m.id = h.machine_id;
        if not found then garde := garde || jsonb_build_object('m', h.machine_id, 'c', h.champ, 'raison', 'machine introuvable'); continue; end if;
        if coalesce(cur, '') is distinct from coalesce(h.nouveau, '') then
          -- quelqu'un est passé derrière : on ne touche pas à sa modif
          select coalesce(nullif(mb.nom, ''), 'quelqu''un') into qui from public.historique y left join public.membres mb on mb.user_id = y.par
            where y.machine_id = h.machine_id and y.champ = h.champ and y.at >= h.at and y.id <> h.id order by y.at desc, y.id desc limit 1;
          garde := garde || jsonb_build_object('m', h.machine_id, 'c', h.champ, 'raison', 'changé ensuite', 'par', coalesce(qui, 'quelqu''un'));
          continue;
        end if;
        perform public._ecrire(h.machine_id, h.champ, h.ancien, now(), h.id);
        liste := liste || jsonb_build_object('m', h.machine_id, 'c', h.champ, 'de', h.nouveau, 'vers', h.ancien);
      end if;
      nb := nb + 1;
      if not (h.machine_id = any (mach)) then mach := mach || h.machine_id; end if;
    end loop;
    if p_essai then raise exception 'ASDJ_ESSAI'; end if;
  exception when raise_exception then
    if sqlerrm <> 'ASDJ_ESSAI' then raise; end if;
  end;
  return jsonb_build_object('fait', nb, 'machines', coalesce(array_length(mach, 1), 0), 'garde', garde, 'liste', liste, 'essai', p_essai);
end $$;
revoke all on function public.annuler(bigint[], uuid, timestamptz, boolean) from public, anon;
grant execute on function public.annuler(bigint[], uuid, timestamptz, boolean) to authenticated;

-- ========== 8. Comptes : présence, liste, couper / rendre l'accès, lever la pause ==========
create or replace function public.je_suis_la() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n text;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  n := coalesce(auth.jwt() -> 'user_metadata' ->> 'nom', '');
  insert into public.membres (user_id, nom) values (auth.uid(), n)
    on conflict (user_id) do update set nom = case when excluded.nom <> '' then excluded.nom else public.membres.nom end;
  return jsonb_build_object('role', public.mon_role(), 'pause', public.pause_jusqua(auth.uid()));
end $$;
revoke all on function public.je_suis_la() from public, anon;
grant execute on function public.je_suis_la() to authenticated;

create or replace function public.membres_liste() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.est_chef() then raise exception 'reserve aux chefs: comptes'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'nom', m.nom, 'role', m.role, 'actif', m.actif,
      'pause', public.pause_jusqua(m.user_id),
      'aujourdhui', (select count(distinct (h.machine_id, date_trunc('minute', h.at))) from public.historique h
                     where h.par = m.user_id and h.at >= date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris'))
    order by (m.role = 'chef') desc, m.nom) from public.membres m), '[]');
end $$;
revoke all on function public.membres_liste() from public, anon;
grant execute on function public.membres_liste() to authenticated;

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
  else raise exception 'action inconnue';
  end if;
  return public.membres_liste();
end $$;
revoke all on function public.membre_action(uuid, text) from public, anon;
grant execute on function public.membre_action(uuid, text) to authenticated;

-- ========== 9. Droits sur les tables ==========
revoke all on public.machines, public.equipes, public.historique from anon;
revoke truncate, references, trigger, update, delete on public.machines, public.equipes, public.historique from authenticated;
grant select, insert on public.machines, public.historique to authenticated;
grant select, insert, update on public.equipes to authenticated;

drop policy if exists "membres lisent machines" on public.machines;
drop policy if exists "membres ajoutent machines" on public.machines;
drop policy if exists "membres modifient machines" on public.machines;
create policy "membres lisent machines" on public.machines for select to authenticated using (public.acces_ok());
create policy "membres ajoutent machines" on public.machines for insert to authenticated with check (public.acces_ok());

drop policy if exists "membres lisent equipes" on public.equipes;
drop policy if exists "membres ajoutent equipes" on public.equipes;
drop policy if exists "membres modifient equipes" on public.equipes;
drop policy if exists "chefs ajoutent equipes" on public.equipes;
drop policy if exists "chefs modifient equipes" on public.equipes;
create policy "membres lisent equipes" on public.equipes for select to authenticated using (public.acces_ok());
create policy "chefs ajoutent equipes" on public.equipes for insert to authenticated with check (public.est_chef());
create policy "chefs modifient equipes" on public.equipes for update to authenticated using (public.est_chef()) with check (public.est_chef());

drop policy if exists "membres lisent historique" on public.historique;
drop policy if exists "membres ecrivent historique" on public.historique;
drop policy if exists "membres notent evenements" on public.historique;
create policy "membres lisent historique" on public.historique for select to authenticated using (public.acces_ok());
create policy "membres notent evenements" on public.historique for insert to authenticated with check (public.acces_ok() and champ = 'evenement' and annule is null);

-- photos : une photo envoyée ne peut plus être remplacée ni effacée
drop policy if exists "membres remplacent photos" on storage.objects;
drop policy if exists "membres ajoutent photos" on storage.objects;
drop policy if exists "membres voient photos" on storage.objects;
create policy "membres ajoutent photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.acces_ok());
create policy "membres voient photos" on storage.objects for select to authenticated using (bucket_id = 'photos' and public.acces_ok());

revoke all on function public.mon_role() from public, anon; grant execute on function public.mon_role() to authenticated;
revoke all on function public.acces_ok() from public, anon; grant execute on function public.acces_ok() to authenticated;
revoke all on function public.est_chef() from public, anon; grant execute on function public.est_chef() to authenticated;
revoke all on function public.pause_jusqua(uuid) from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
select 'version 7 en place' as resultat, (select count(*) from public.membres) as membres;
