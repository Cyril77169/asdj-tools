-- ASDJ - Tools, version 10 : infos des véhicules (cartes grises) + prochaines dates « avant le ».
-- Chaque info est écrite par la voie normale : elle apparaît dans le journal de chaque véhicule.
begin;

alter table public.machines add column if not exists ct_avant date;
alter table public.machines add column if not exists pol_avant date;
alter table public.machines add column if not exists rev_avant date;
alter table public.machines add column if not exists mise_circulation date;

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
              when p_champ in ('depuis', 'controle', 'depose_le', 'recupere_le', 'pret_le', 'km_le', 'ct_le', 'pol_le', 'rev_le', 'ct_avant', 'pol_avant', 'rev_avant', 'mise_circulation') then 'date'
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
                     'ct_avant','pol_avant','rev_avant','mise_circulation') then
    raise exception 'champ interdit: %', p_champ;
  end if;
  if p_champ in ('famille', 'actif', 'plaque', 'type_vehicule', 'ct_mois', 'pol_mois', 'rev_mois') and not public.est_chef() then
    raise exception 'reserve aux chefs: %', p_champ;
  end if;
  return public._ecrire(p_id, p_champ, p_valeur, p_ts, null);
end $$;
revoke all on function public.maj_champ(text, text, text, timestamptz) from public, anon;
grant execute on function public.maj_champ(text, text, text, timestamptz) to authenticated;


-- le Master noir (nouveau)
insert into public.machines (id, famille, modele, plaque, type_vehicule, statut, lieu, equipe, affectation, ct_mois, pol_mois, rev_mois, depuis, ordre)
values ('VH12', 'vehicule', 'Renault Master (noir)', 'GK-533-MB', 'utilitaire', 'operationnelle', 'depot', null, '', 24, 12, 12, current_date, 12)
on conflict (id) do nothing;

-- les infos des cartes grises (seulement si le véhicule n'a pas encore été rempli à la main)
do $$ begin
  if exists (select 1 from public.machines where famille = 'vehicule' and (ct_le is not null or rev_le is not null or km is not null)) then
    raise notice 'véhicules déjà remplis : rien n''est écrasé'; return;
  end if;
  perform public._ecrire('VH01', 'plaque', 'CV-313-AN', now(), null);
  perform public._ecrire('VH01', 'modele', 'Renault Master (vieux)', now(), null);
  perform public._ecrire('VH01', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH01', 'mise_circulation', '2013-04-12', now(), null);
  perform public._ecrire('VH01', 'ct_le', '2026-07-14', now(), null);
  perform public._ecrire('VH01', 'pol_avant', '2027-07-15', now(), null);
  perform public._ecrire('VH01', 'rev_le', '2025-09-15', now(), null);
  perform public._ecrire('VH01', 'rev_km', '144166', now(), null);
  perform public._ecrire('VH01', 'km', '144166', now(), null);
  perform public._ecrire('VH01', 'km_le', '2025-09-15', now(), null);
  perform public._ecrire('VH02', 'plaque', 'GA-448-RC', now(), null);
  perform public._ecrire('VH02', 'modele', 'Renault Master (Nico)', now(), null);
  perform public._ecrire('VH02', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH02', 'mise_circulation', '2021-07-09', now(), null);
  perform public._ecrire('VH02', 'ct_avant', '2027-09-11', now(), null);
  perform public._ecrire('VH02', 'pol_le', '2026-09-11', now(), null);
  perform public._ecrire('VH02', 'rev_le', '2025-06-13', now(), null);
  perform public._ecrire('VH02', 'rev_km', '62745', now(), null);
  perform public._ecrire('VH02', 'km', '62745', now(), null);
  perform public._ecrire('VH02', 'km_le', '2025-06-13', now(), null);
  perform public._ecrire('VH03', 'plaque', 'FQ-763-DJ', now(), null);
  perform public._ecrire('VH03', 'modele', 'Renault Master (Couilly)', now(), null);
  perform public._ecrire('VH03', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH03', 'mise_circulation', '2020-06-02', now(), null);
  perform public._ecrire('VH03', 'ct_avant', '2028-09-09', now(), null);
  perform public._ecrire('VH03', 'pol_avant', '2027-09-10', now(), null);
  perform public._ecrire('VH03', 'rev_le', '2025-09-10', now(), null);
  perform public._ecrire('VH03', 'rev_km', '74580', now(), null);
  perform public._ecrire('VH03', 'km', '74580', now(), null);
  perform public._ecrire('VH03', 'km_le', '2025-09-10', now(), null);
  perform public._ecrire('VH04', 'plaque', 'GP-542-YZ', now(), null);
  perform public._ecrire('VH04', 'modele', 'Citroën Jumper', now(), null);
  perform public._ecrire('VH04', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH04', 'mise_circulation', '2023-06-30', now(), null);
  perform public._ecrire('VH04', 'ct_avant', '2027-06-30', now(), null);
  perform public._ecrire('VH04', 'pol_avant', '2028-06-30', now(), null);
  perform public._ecrire('VH04', 'rev_le', '2025-07-28', now(), null);
  perform public._ecrire('VH04', 'rev_km', '19241', now(), null);
  perform public._ecrire('VH04', 'km', '19241', now(), null);
  perform public._ecrire('VH04', 'km_le', '2025-07-28', now(), null);
  perform public._ecrire('VH05', 'plaque', 'FF-185-WA', now(), null);
  perform public._ecrire('VH05', 'modele', 'Nissan benne', now(), null);
  perform public._ecrire('VH05', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH05', 'mise_circulation', '2019-04-30', now(), null);
  perform public._ecrire('VH05', 'ct_avant', '2028-10-15', now(), null);
  perform public._ecrire('VH05', 'pol_avant', '2027-10-15', now(), null);
  perform public._ecrire('VH05', 'rev_le', '2025-09-09', now(), null);
  perform public._ecrire('VH05', 'rev_km', '70894', now(), null);
  perform public._ecrire('VH05', 'km', '70894', now(), null);
  perform public._ecrire('VH05', 'km_le', '2025-09-09', now(), null);
  perform public._ecrire('VH06', 'plaque', 'DG-813-MV', now(), null);
  perform public._ecrire('VH06', 'modele', 'Ford', now(), null);
  perform public._ecrire('VH06', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH06', 'ct_avant', '2028-10-13', now(), null);
  perform public._ecrire('VH06', 'pol_avant', '2027-10-13', now(), null);
  perform public._ecrire('VH06', 'rev_le', '2025-03-04', now(), null);
  perform public._ecrire('VH06', 'rev_km', '128180', now(), null);
  perform public._ecrire('VH06', 'km', '128180', now(), null);
  perform public._ecrire('VH06', 'km_le', '2025-03-04', now(), null);
  perform public._ecrire('VH06', 'notes', 'Date de la dernière révision à vérifier (04/03/25 ?).', now(), null);
  perform public._ecrire('VH07', 'plaque', 'HJ-873-LZ', now(), null);
  perform public._ecrire('VH07', 'modele', 'Renault benne', now(), null);
  perform public._ecrire('VH07', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH07', 'mise_circulation', '2026-03-03', now(), null);
  perform public._ecrire('VH07', 'ct_avant', '2030-03-02', now(), null);
  perform public._ecrire('VH08', 'plaque', 'EJ-784-ZX', now(), null);
  perform public._ecrire('VH08', 'modele', 'Renault Kangoo', now(), null);
  perform public._ecrire('VH08', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH08', 'mise_circulation', '2016-12-08', now(), null);
  perform public._ecrire('VH08', 'ct_le', '2025-01-31', now(), null);
  perform public._ecrire('VH08', 'rev_le', '2024-02-22', now(), null);
  perform public._ecrire('VH08', 'rev_km', '98636', now(), null);
  perform public._ecrire('VH08', 'km', '98636', now(), null);
  perform public._ecrire('VH08', 'km_le', '2024-02-22', now(), null);
  perform public._ecrire('VH08', 'notes', 'Date du dernier contrôle pollution inconnue : à vérifier.', now(), null);
  perform public._ecrire('VH09', 'plaque', 'EN-870-QL', now(), null);
  perform public._ecrire('VH09', 'modele', 'Renault Clio', now(), null);
  perform public._ecrire('VH09', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH09', 'pol_mois', '12', now(), null);
  perform public._ecrire('VH09', 'mise_circulation', '2017-06-26', now(), null);
  perform public._ecrire('VH09', 'ct_le', '2025-07-23', now(), null);
  perform public._ecrire('VH09', 'pol_le', '2025-07-23', now(), null);
  perform public._ecrire('VH09', 'rev_le', '2025-11-19', now(), null);
  perform public._ecrire('VH09', 'rev_km', '157311', now(), null);
  perform public._ecrire('VH09', 'km', '157311', now(), null);
  perform public._ecrire('VH09', 'km_le', '2025-11-19', now(), null);
  perform public._ecrire('VH10', 'plaque', 'HE-762-VW', now(), null);
  perform public._ecrire('VH10', 'modele', 'DS 7', now(), null);
  perform public._ecrire('VH10', 'type_vehicule', 'voiture', now(), null);
  perform public._ecrire('VH10', 'mise_circulation', '2025-07-24', now(), null);
  perform public._ecrire('VH10', 'ct_avant', '2029-07-24', now(), null);
  perform public._ecrire('VH11', 'plaque', 'GT-100-GY', now(), null);
  perform public._ecrire('VH11', 'modele', 'Peugeot 308', now(), null);
  perform public._ecrire('VH11', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH11', 'pol_mois', '12', now(), null);
  perform public._ecrire('VH11', 'mise_circulation', '2023-12-27', now(), null);
  perform public._ecrire('VH11', 'ct_avant', '2027-12-27', now(), null);
  perform public._ecrire('VH12', 'plaque', 'GK-533-MB', now(), null);
  perform public._ecrire('VH12', 'modele', 'Renault Master (noir)', now(), null);
  perform public._ecrire('VH12', 'type_vehicule', 'utilitaire', now(), null);
  perform public._ecrire('VH12', 'mise_circulation', '2022-11-10', now(), null);
  perform public._ecrire('VH12', 'ct_le', '2026-11-10', now(), null);
  perform public._ecrire('VH12', 'pol_avant', '2027-11-10', now(), null);
  perform public._ecrire('VH12', 'rev_le', '2024-10-22', now(), null);
  perform public._ecrire('VH12', 'rev_km', '39548', now(), null);
  perform public._ecrire('VH12', 'km', '39548', now(), null);
  perform public._ecrire('VH12', 'km_le', '2024-10-22', now(), null);
end $$;

commit;
notify pgrst, 'reload schema';
select id, plaque, modele, ct_le, ct_avant, pol_le, pol_avant, rev_le, rev_km from public.machines where famille = 'vehicule' order by id;
