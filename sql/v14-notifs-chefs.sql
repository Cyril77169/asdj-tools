-- ASDJ - Tools, version 14 : notifications réservées aux chefs (Cyril et Nico). Peut être relancé sans danger.
begin;
drop policy if exists "chacun ajoute ses telephones" on public.push_abonnements;
create policy "chacun ajoute ses telephones" on public.push_abonnements for insert to authenticated with check (user_id = auth.uid() and public.est_chef());
-- téléphones d'équipiers déjà abonnés : retirés
delete from public.push_abonnements a where not exists (select 1 from public.membres m where m.user_id = a.user_id and m.role = 'chef' and m.actif);
commit;
select 'version 14 en place' as resultat, (select count(*) from public.push_abonnements) as telephones_abonnes;
