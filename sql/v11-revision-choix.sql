-- ASDJ - Tools, version 11 : révision « dès que possible » (rendez-vous) ou « attendre un kilométrage ».
-- Peut être relancé sans danger.
begin;
alter table public.machines add column if not exists rev_mode text not null default '';
alter table public.machines add column if not exists rev_cible_km integer;
alter table public.machines add column if not exists rev_rdv date;
alter table public.machines add column if not exists rev_garage text not null default '';
alter table public.machines add column if not exists rev_choix text not null default '';

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
              when p_champ in ('depuis', 'controle', 'depose_le', 'recupere_le', 'pret_le', 'km_le', 'ct_le', 'pol_le', 'rev_le', 'ct_avant', 'pol_avant', 'rev_avant', 'mise_circulation', 'rev_rdv') then 'date'
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
                     'rev_mode','rev_cible_km','rev_rdv','rev_garage','rev_choix') then
    raise exception 'champ interdit: %', p_champ;
  end if;
  if p_champ in ('famille', 'actif', 'plaque', 'type_vehicule', 'ct_mois', 'pol_mois', 'rev_mois') and not public.est_chef() then
    raise exception 'reserve aux chefs: %', p_champ;
  end if;
  return public._ecrire(p_id, p_champ, p_valeur, p_ts, null);
end $$;
revoke all on function public.maj_champ(text, text, text, timestamptz) from public, anon;
grant execute on function public.maj_champ(text, text, text, timestamptz) to authenticated;



commit;
notify pgrst, 'reload schema';
select 'version 11 en place' as resultat;
