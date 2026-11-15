# ASDJ - Tools

Appli installable (PWA) de « Au service des jardins » : suivi du matériel (état, localisation) et des équipes.

- **Appli** : `index.html`, `app.js`, `config.js`, `sw.js` (hors ligne), `manifest.webmanifest` — sans framework ni compilation.
- **Données** : projet Supabase « Asdj - tools » (organisation ASDJ, région Paris), protégé par compte (RLS), bucket privé `photos`.
- **Robot** `.github/workflows/keepalive.yml` « Garder Supabase éveillé » : chaque jour une petite requête (fonction SQL `keepalive`),
  relance du projet s'il est en pause (secret `SUPABASE_ACCESS_TOKEN`), bilan dans `status.json` lu par l'appli.
