-- Le Ford (DG-813-MV) et le Master noir (GK-533-MB) sont des camions bennes : on le précise dans leur modèle
-- (la silhouette « benne » suit toute seule). Écrit par la voie normale : visible dans le journal des véhicules.
do $$ begin
  if exists (select 1 from public.machines where id = 'VH06' and modele = 'Ford') then perform public._ecrire('VH06', 'modele', 'Ford benne', now(), null); end if;
  if exists (select 1 from public.machines where id = 'VH12' and modele = 'Renault Master (noir)') then perform public._ecrire('VH12', 'modele', 'Renault Master benne (noir)', now(), null); end if;
end $$;
select id, plaque, modele from public.machines where id in ('VH06', 'VH12') order by id;
