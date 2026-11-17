-- Lecture seule : état des véhicules (rien n'est modifié)
select id, plaque, modele, type_vehicule, statut, equipe, km, ct_le, pol_le, rev_le, rev_km, ct_mois, pol_mois, rev_mois, actif,
  (select count(*) from public.historique h where h.machine_id = m.id and h.champ <> 'creation') as modifs
from public.machines m where famille = 'vehicule' order by id;
