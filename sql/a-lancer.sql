-- Nouvelles catégories de machines (version 3) — lancé par le robot
alter table public.machines drop constraint if exists machines_famille_check;
alter table public.machines add constraint machines_famille_check
  check (famille in ('tondeuse','debroussailleuse','souffleur','taillehaie','tronconneuse','autoportee','motoculteur','scarificateur','outillage'));
