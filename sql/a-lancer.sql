-- Changer le numéro d'une machine : la fiche, l'historique et les pannes suivent la machine
create or replace function public.renommer_machine(p_old text, p_new text)
returns public.machines
language plpgsql
security definer
set search_path = ''
as $$
declare r public.machines;
begin
  if auth.role() is distinct from 'authenticated' then raise exception 'non autorisé'; end if;
  p_new := upper(trim(p_new));
  if p_new = '' then raise exception 'numéro vide'; end if;
  if not exists (select 1 from public.machines where id = p_old) then raise exception 'machine inconnue: %', p_old; end if;
  if p_new = p_old then select * into r from public.machines where id = p_old; return r; end if;
  if exists (select 1 from public.machines where id = p_new) then raise exception 'numéro déjà pris: %', p_new; end if;
  insert into public.machines (id, famille, modele, equipe, affectation, statut, lieu, reparateur, depuis, controle, motif, notes, actif, ordre,
                               field_ts, updated_at, updated_by, depose_par, depose_le, recupere_par, recupere_le, photo, pret_a, pret_le)
    select p_new, famille, modele, equipe, affectation, statut, lieu, reparateur, depuis, controle, motif, notes, actif, ordre,
           field_ts, now(), auth.uid(), depose_par, depose_le, recupere_par, recupere_le, photo, pret_a, pret_le
    from public.machines where id = p_old;
  update public.historique set machine_id = p_new where machine_id = p_old;
  update public.historique set nouveau = jsonb_set(nouveau::jsonb, '{id}', to_jsonb(p_new))::text
    where machine_id = p_new and champ = 'evenement';
  insert into public.historique(machine_id, champ, ancien, nouveau, par) values (p_new, 'numero', p_old, p_new, auth.uid());
  delete from public.machines where id = p_old;
  select * into r from public.machines where id = p_new;
  return r;
end;
$$;
revoke all on function public.renommer_machine(text, text) from public, anon;
grant execute on function public.renommer_machine(text, text) to authenticated;
