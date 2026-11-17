/* ASDJ - Tools : suivi du matériel par famille et par équipe.
   Données partagées entre les comptes connectés (Supabase), copie locale + file d'attente pour le hors ligne. */
"use strict";
const APP_V = 13;   // à augmenter à chaque version (avec version.json, ?v=N et le cache de sw.js)
const CFG = window.APP_CONFIG;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- référentiels ---------- */
const FAMILLES = [
  { id: "tondeuse", nom: "Tondeuses", un: "Tondeuse", art: "une" },
  { id: "debroussailleuse", nom: "Débroussailleuses", un: "Débroussailleuse", art: "une" },
  { id: "souffleur", nom: "Souffleurs", un: "Souffleur", art: "un" },
  { id: "taillehaie", nom: "Taille-haies", un: "Taille-haie", art: "un" },
  { id: "tronconneuse", nom: "Tronçonneuses", un: "Tronçonneuse", art: "une" },
  { id: "autoportee", nom: "Autoportées", un: "Autoportée", art: "une" },
  { id: "motoculteur", nom: "Motoculteurs", un: "Motoculteur", art: "un" },
  { id: "scarificateur", nom: "Scarificateurs", un: "Scarificateur", art: "un" },
  { id: "outillage", nom: "Petit outillage", un: "Outil", art: "un", aide: "visseuses, perceuses, meuleuses…" },
];
const FAM = Object.fromEntries(FAMILLES.map(f => [f.id, f]));
/* ordre = priorité d'affichage : ce qui demande une action d'abord, le normal à la fin */
const STATUTS = [
  { id: "probleme", nom: "Problème technique", q: "a un problème technique" },
  { id: "reparation", nom: "En réparation", q: "part en réparation" },
  { id: "hs", nom: "HS", q: "est HS (hors service)" },
  { id: "disponible", nom: "Dépôt", q: "retourne au dépôt (disponible, sans équipe)" },
  { id: "controle", nom: "Contrôle fait", q: "a été contrôlée" },
  { id: "operationnelle", nom: "Opérationnelle", q: "est opérationnelle" },
];
const ST = Object.fromEntries(STATUTS.map(s => [s.id, s]));
const URGENTS = ["probleme", "reparation", "hs"];
const ATTRIB = ["operationnelle", "controle"];
/* état affiché : une machine sans équipe (et sans souci) est au Dépôt (bleu) ; avec une équipe, elle est Attribuée */
const eff = m => URGENTS.includes(m.statut) ? m.statut : m.equipe == null ? "disponible" : (m.statut === "disponible" ? "operationnelle" : m.statut);
const LIEUX = { depot: "Au dépôt", equipe: "Avec l'équipe", reparateur: "Chez le réparateur", pret: "Prêtée" };
const PRIO = { probleme: 0, reparation: 1, hs: 2, disponible: 3, controle: 4, operationnelle: 5, revision: 3 };
/* véhicules : mêmes fiches que les machines (famille « vehicule »), avec leurs propres états */
const VSTATUTS = [
  { id: "operationnelle", nom: "En circulation", q: "est en circulation" },
  { id: "probleme", nom: "Problème", q: "a un problème" },
  { id: "reparation", nom: "En réparation", q: "part en réparation" },
  { id: "disponible", nom: "Au dépôt", q: "reste au dépôt" },
  { id: "revision", nom: "Attente révision", q: "est en attente de révision" },
  { id: "hs", nom: "HS", q: "est hors service" },
];
const VST = Object.fromEntries(VSTATUTS.map(s => [s.id, s]));
const VPRIO = { probleme: 0, reparation: 1, revision: 2, hs: 3, disponible: 4, operationnelle: 5 };
const PB_TYPES = ["Accrochage / carrosserie", "Pare-choc", "Rétroviseur", "Feu / éclairage", "Pneu", "Moteur / voyant", "Freins", "Autre"];
const VTYPES = { utilitaire: "Utilitaire / camionnette", voiture: "Voiture" };
const LIEU = { ct: "ct_lieu", pol: "pol_lieu", rev: "rev_garage" };
const ECH = [
  { k: "ct", nom: "Contrôle technique", le: "ct_le", mois: "ct_mois", f: "fait" },
  { k: "pol", nom: "Contrôle pollution", le: "pol_le", mois: "pol_mois", f: "fait" },
  { k: "rev", nom: "Révision / vidange", le: "rev_le", mois: "rev_mois", f: "faite" },
];
const DELAIS = { 6: "6 mois", 12: "1 an", 24: "2 ans" };
function addMonths(iso, n) { const [y, mo, d] = String(iso).slice(0, 10).split("-").map(Number); const x = new Date(y, mo - 1 + n, d); if (x.getDate() !== d) x.setDate(0); return x; }
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/* échéances d'un véhicule : niveau ok / warn (2 semaines avant) / late (dépassé) / vide (date à remplir) */
function echeances(m) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return ECH.filter(e => +m[e.mois] > 0).map(e => {
    if (e.k === "rev" && m.rev_mode === "km" && +m.rev_cible_km > 0) {          // révision : on attend un kilométrage
      const reste = +m.rev_cible_km - (+m.km || 0);
      return Object.assign({}, e, { mode: "km", reste, due: `km${m.rev_cible_km}`, jours: reste <= 0 ? -1 : reste <= 1000 ? 1 : 999, niveau: reste <= 0 ? "late" : reste <= 1000 ? "warn" : "ok" });
    }
    const rdvd = m[`${e.k}_rdv`];
    if (rdvd) {                                                                // rendez-vous pris (CT, pollution ou révision)
      const [ry, rm, rd] = String(rdvd).slice(0, 10).split("-").map(Number), j = Math.round((new Date(ry, rm - 1, rd) - now) / 864e5);
      return Object.assign({}, e, { mode: "rdv", due: `rdv${String(rdvd).slice(0, 10)}`, jours: j <= 0 ? 0 : 999, niveau: j <= 0 ? "warn" : "ok", rdvj: j, rdv: String(rdvd).slice(0, 10), lieu: m[LIEU[e.k]] || "" });
    }
    const av = m[`${e.k}_avant`]; let due = null;
    if (av) due = String(av).slice(0, 10);                                     // date « avant le » (carte grise)
    else if (e.k === "pol") {                                                   // pollution : 1 an après le dernier CT
      if (m.ct_le && (!m.pol_le || m.ct_le >= m.pol_le)) due = isoOf(addMonths(m.ct_le, +m.pol_mois));
      else if (m.pol_le || m.ct_avant) return Object.assign({}, e, { niveau: "apres" });
      else return Object.assign({}, e, { niveau: "vide" });
    } else if (m[e.le]) due = isoOf(addMonths(m[e.le], +m[e.mois]));
    else return Object.assign({}, e, { niveau: "vide" });
    const [y, mo, d] = due.split("-").map(Number), jours = Math.round((new Date(y, mo - 1, d) - now) / 864e5);
    return Object.assign({}, e, { due, avant: !!av, jours, niveau: jours < 0 ? "late" : jours <= 14 ? "warn" : "ok" });
  });
}
const kmf = n => `${Number(n).toLocaleString("fr-FR")} km`;
const echTxt = x => x.mode === "km" ? (x.reste > 0 ? `dans ${kmf(x.reste)}` : `dépassé de ${kmf(-x.reste)}`) : x.mode === "rdv" ? (x.rdvj > 0 ? `RDV le ${frDate(x.rdv)}` : x.rdvj === 0 ? "RDV aujourd'hui" : `RDV passé : ${x.k === "rev" ? "faite" : "fait"} ?`) : x.niveau === "apres" ? "après le prochain CT" : x.niveau === "vide" ? "date à remplir" : x.niveau === "late" ? `dépassé de ${-x.jours} j` : x.jours === 0 ? "aujourd'hui" : x.niveau === "warn" ? `dans ${x.jours} jour${x.jours > 1 ? "s" : ""}` : "à jour";
function alertes() { const out = []; vehicules().forEach(m => echeances(m).forEach(x => { if (x.niveau === "warn" || x.niveau === "late") out.push(Object.assign({ m }, x)); })); return out.sort((a, b) => a.jours - b.jours); }
const vprio = m => { const a = echeances(m); return (VPRIO[m.statut] ?? 9) * 10 + (a.some(x => x.niveau === "late") ? 0 : a.some(x => x.niveau === "warn") ? 1 : 5); };
const sc = id => `var(--s-${id})`;
const fc = id => `var(--f-${id})`;

/* Pictos des familles (dessins maison, silhouettes pleines) */
const ICONS = {
  tondeuse: `<svg viewBox="0 0 64 64" fill="currentColor"><path d="M4 31 17 25l4 15-13 2z" opacity=".75"/><path d="M15 40c0-8 6-13 15-13h16c6 0 11 4 11 10v3z"/><rect x="29" y="17" width="16" height="10" rx="3"/><rect x="33" y="13" width="7" height="5" rx="1.5"/><path d="M23 28 11 8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M6 8h10" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path fill-rule="evenodd" d="M15 46a7 7 0 1 0 14 0a7 7 0 1 0-14 0zm4.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM43 46a7 7 0 1 0 14 0a7 7 0 1 0-14 0zm4.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z"/><path d="M4 58h56" stroke="currentColor" stroke-width="2.5" stroke-dasharray="3 3" opacity=".7"/></svg>`,
  debroussailleuse: `<svg viewBox="0 0 64 64" fill="currentColor"><rect x="44" y="3" width="16" height="13" rx="4" transform="rotate(45 52 9.5)"/><path d="M46 17 13 50" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><path d="M21 24 37 40" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><circle cx="20" cy="23" r="3.5"/><circle cx="38" cy="41" r="3.5"/><path d="M2 49a12 8 0 0 1 21-4l-5 6z" opacity=".75"/><ellipse cx="12" cy="53" rx="7" ry="3"/><path d="M3 59l5-4M21 59l-5-4M12 61v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  souffleur: `<svg viewBox="0 0 64 64" fill="currentColor"><path fill-rule="evenodd" d="M10 6h14a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6zm1 8v3h12v-3zm0 6v3h12v-3zm0 6v3h12v-3z"/><path d="M8 44 6 50M26 44l2 6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M28 34c12 0 12 14 26 14" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><rect x="36" y="32" width="5" height="10" rx="2"/><path d="M54 44v8l7-2v-4z"/><path d="M57 38l5-3M58 56l5 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".8"/></svg>`,
  taillehaie: `<svg viewBox="0 0 64 64" fill="currentColor"><g transform="rotate(-38 32 32)"><rect x="1" y="25" width="22" height="14" rx="6"/><path d="M5 26c0-8 6-11 13-8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M14 25c0-10 11-10 11 0" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><rect x="22" y="29" width="41" height="6" rx="1.5"/><path d="M26 29l1.6-5 1.6 5z M29 29l1.6-5 1.6 5z M32 29l1.6-5 1.6 5z M35 29l1.6-5 1.6 5z M38 29l1.6-5 1.6 5z M41 29l1.6-5 1.6 5z M44 29l1.6-5 1.6 5z M47 29l1.6-5 1.6 5z M50 29l1.6-5 1.6 5z M53 29l1.6-5 1.6 5z M56 29l1.6-5 1.6 5z M59 29l1.6-5 1.6 5z"/><path d="M26 35l1.6 5 1.6-5z M29 35l1.6 5 1.6-5z M32 35l1.6 5 1.6-5z M35 35l1.6 5 1.6-5z M38 35l1.6 5 1.6-5z M41 35l1.6 5 1.6-5z M44 35l1.6 5 1.6-5z M47 35l1.6 5 1.6-5z M50 35l1.6 5 1.6-5z M53 35l1.6 5 1.6-5z M56 35l1.6 5 1.6-5z M59 35l1.6 5 1.6-5z"/></g></svg>`,
  tronconneuse: `<svg viewBox="0 0 64 64" fill="currentColor"><path d="M8 22h20a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V25a3 3 0 0 1 3-3z"/><path d="M11 23c0-9 6-12 14-12h6v11" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><path d="M5 42H1" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M33 28h22a6 6 0 0 1 0 12H33z"/><path d="M33 25.5h22a8.5 8.5 0 0 1 0 17H33" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="2.2 2"/></svg>`,
  autoportee: `<svg viewBox="0 0 64 64" fill="currentColor"><rect x="5" y="34" width="50" height="8" rx="3"/><path d="M36 24h15a5 5 0 0 1 5 5v7H36z"/><path d="M14 22h13v12H12z"/><path d="M14 12v20" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M37 25 33 14" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="32" cy="13" rx="6" ry="2.2"/><path fill-rule="evenodd" d="M6 48a10 10 0 1 0 20 0a10 10 0 1 0-20 0zm6.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0zM43 50a7 7 0 1 0 14 0a7 7 0 1 0-14 0zm4.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z"/></svg>`,
  motoculteur: `<svg viewBox="0 0 64 64" fill="currentColor"><rect x="12" y="22" width="22" height="16" rx="4"/><rect x="16" y="16" width="12" height="7" rx="2"/><path d="M30 26 56 8M52 6l7 4" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M14 38 8 58" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path fill-rule="evenodd" d="M14 48a10 10 0 1 0 20 0a10 10 0 1 0-20 0zm6 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0z"/><path d="M24 35v4M24 57v4M13 48H9M39 48h-4M16 40l-3-3M32 40l3-3M16 56l-3 3M32 56l3 3" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  scarificateur: `<svg viewBox="0 0 64 64" fill="currentColor"><path d="M8 40c0-7 5-11 13-11h22c6 0 11 4 11 9v2z"/><rect x="22" y="19" width="15" height="10" rx="3"/><path d="M42 30 52 9M47 9h10" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M14 41v8M19 41v8M24 41v8M29 41v8M34 41v8M39 41v8M44 41v8M49 41v8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path fill-rule="evenodd" d="M2 44a5 5 0 1 0 10 0a5 5 0 1 0-10 0zm3 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0zM52 44a5 5 0 1 0 10 0a5 5 0 1 0-10 0zm3 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0z"/><path d="M4 58h56" stroke="currentColor" stroke-width="2.5" stroke-dasharray="2 3" opacity=".7"/></svg>`,
  outillage: `<svg viewBox="0 0 64 64" fill="currentColor"><rect x="6" y="12" width="34" height="16" rx="7"/><rect x="39" y="15" width="9" height="10" rx="2"/><path d="M48 20h12" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M14 26h12l4 20H18z"/><rect x="11" y="45" width="24" height="11" rx="3"/><path d="M28 30h6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
};
const SVG = {
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  team: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.2c2.9.2 5 2.3 5 5.3"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>`,
  out: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4"/></svg>`,
  chev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
};

/* ---------- état + stockage local ---------- */
const LS_CACHE = "asdj_cache_v1", LS_Q = "asdj_queue_v1", LS_REJ = "asdj_rejets_v1";
const S = { machines: {}, equipes: {}, events: [], annul: {}, membres: {}, cacheAt: 0 };
let Q = [];        // modifications pas encore envoyées
let REJ = [];      // modifications refusées par le serveur (gardées, jamais effacées)
let supa = null, USER = null;
let ROLE = (() => { try { return localStorage.getItem("asdj_role") || ""; } catch (e) { return ""; } })();   // chef | equipier | coupe
let PAUSE = "";      // frein : heure de fin de pause (équipier)
const isChef = () => ROLE === "chef";
try {
  const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
  if (c) { S.machines = c.m || {}; S.equipes = c.e || {}; S.events = c.ev || []; S.annul = c.an || {}; S.membres = c.mb || {}; S.cacheAt = c.at || 0; }
  Q = JSON.parse(localStorage.getItem(LS_Q) || "[]");
  REJ = JSON.parse(localStorage.getItem(LS_REJ) || "[]");
} catch (e) { console.warn("cache illisible", e); }
function saveLocal() {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify({ m: S.machines, e: S.equipes, ev: S.events, an: S.annul, mb: S.membres, at: S.cacheAt }));
    localStorage.setItem(LS_Q, JSON.stringify(Q));
    localStorage.setItem(LS_REJ, JSON.stringify(REJ));
  } catch (e) { console.warn("sauvegarde locale impossible", e); }
}

/* ---------- outils ---------- */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const frDate = iso => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const daysSince = iso => { if (!iso) return null; const t = Date.parse(String(iso).slice(0, 10) + "T00:00:00"); return Math.max(0, Math.round((Date.parse(today() + "T00:00:00") - t) / 864e5)); };
const sinceTxt = iso => { const n = daysSince(iso); if (n == null) return ""; return `depuis le ${frDate(iso)}` + (n === 0 ? " (aujourd'hui)" : ` (${n} j)`); };
const chef = n => (S.equipes[n] && S.equipes[n].chef) || "";
const teamLabel = n => n == null || n === "" ? "Dépôt" : `Équipe ${n}` + (chef(n) ? ` · ${chef(n)}` : "");
const natural = (a, b) => a.localeCompare(b, "fr", { numeric: true });
const norm = t => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const prio = m => PRIO[eff(m)] ?? 9;
const byAlert = (a, b) => prio(a) - prio(b) || natural(a.id, b.id);
const isVeh = m => !!m && typeof m === "object" && m.famille === "vehicule";
const actives = () => Object.values(S.machines).filter(m => m.actif !== false && !isVeh(m));
const vehicules = () => Object.values(S.machines).filter(m => isVeh(m) && m.actif !== false);
const teamNums = () => Object.keys(S.equipes).map(Number).sort((a, b) => a - b);
const myName = () => (USER && USER.user_metadata && USER.user_metadata.nom) || "";
const NOMS = () => [...new Set(["Cyril", "Nico", myName(), ...Object.values(S.equipes).map(e => e.chef)].filter(Boolean))];
/* réparateurs habituels (+ ceux déjà saisis à la main) */
const REPARATEURS = ["Cyril Motoculture", "NETP"];
const repList = () => [...new Set([...REPARATEURS, ...Object.values(S.machines).map(m => m.reparateur), ...S.events.map(e => e.reparateur)].filter(Boolean).map(x => x.trim()))];
function repPicker(id, cur, field) {
  const list = repList(), other = !!cur && !list.includes(cur);
  return `<div class="reps" data-for="${id}">${list.map(r => `<button type="button" class="repc ${cur === r ? "on" : ""}" data-act="rep-pick" data-v="${esc(r)}">${esc(r)}</button>`).join("")}
    <button type="button" class="repc plus ${other ? "on" : ""}" data-act="rep-other">+ Autre</button></div>
    <input class="inp ${other ? "" : "hidden"}" id="${id}" ${field ? `data-field="${field}"` : ""} value="${esc(cur || "")}" placeholder="Nom du réparateur" autocomplete="off">`;
}
const noNum = m => String(m.id || m).startsWith("SN-");
const hhmm = d => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dateHeure = iso => { const d = new Date(iso); return `${d.toLocaleDateString("fr-FR")} à ${hhmm(d)}`; };
const nomDe = uid => (uid && S.membres[uid] && S.membres[uid].nom) || "";
function whoHTML(uid, fallback) {
  const n = nomDe(uid) || fallback || ""; if (!n) return "";
  const r = uid && S.membres[uid] ? S.membres[uid].role : "";
  return `<span class="who ${n === "Cyril" ? "c" : n === "Nico" ? "n" : r === "chef" ? "c" : ""}">${esc(n)}</span>`;
}
const evAnnul = e => e && e._hid && S.annul[e._hid];
const ANN = {};      // ligne annulée → { par, at } (vu dans les listes chargées)
const HROWS = {};    // lignes d'historique affichées (pour le menu ⋯)
const disp = m => isVeh(m) ? (m.plaque || `${m.modele || "Véhicule"} (sans plaque)`) : noNum(m) ? "Sans n°" : (m.id || m);
const statMatch = (m, sel) => !sel || (sel === "attribuee" ? ATTRIB.includes(eff(m)) : eff(m) === sel);
function whereTxt(m) {
  if (m.statut === "reparation" || m.lieu === "reparateur") return `Chez ${m.reparateur || "le réparateur"}` + ((m.depose_le || m.depuis) ? ` · ${sinceTxt(m.depose_le || m.depuis)}` : "") + (m.depose_par ? ` · déposée par ${m.depose_par}` : "");
  if (m.lieu === "pret") return `Prêtée à ${m.pret_a || "quelqu'un"}` + (m.pret_le ? ` · ${sinceTxt(m.pret_le)}` : "") + (m.equipe != null ? ` · ${teamLabel(m.equipe)}` : "");
  if (m.lieu === "depot") return "Au dépôt" + (m.equipe != null ? ` · ${teamLabel(m.equipe)}` : "") + (m.statut !== "operationnelle" && m.depuis ? ` · ${sinceTxt(m.depuis)}` : "");
  return teamLabel(m.equipe) + (["probleme", "hs"].includes(m.statut) && m.depuis ? ` · ${sinceTxt(m.depuis)}` : "");
}
function countBy(list) { const c = {}; STATUTS.forEach(s => c[s.id] = 0); list.forEach(m => { const k = eff(m); c[k] = (c[k] || 0) + 1; }); return c; }
function barHTML(list) {
  const c = countBy(list), tot = list.length || 1;
  return `<div class="bar">${STATUTS.filter(s => c[s.id]).map(s => `<i style="width:${c[s.id] / tot * 100}%;background:${sc(s.id)}"></i>`).join("")}</div>`;
}
function dotsHTML(list, only) {
  const c = countBy(list);
  return `<div class="dots">${STATUTS.filter(s => c[s.id] && (!only || only.includes(s.id))).map(s => `<span class="dot" style="--c:${sc(s.id)}">${c[s.id]}</span>`).join("")}</div>`;
}

/* ---------- modifications (copie locale immédiate + envoi) ---------- */
function applyOp(op) {
  if (op.k === "f") {
    const m = S.machines[op.id]; if (!m) return;
    m[op.c] = op.v; m.field_ts = Object.assign({}, m.field_ts, { [op.c]: new Date(op.ts).toISOString() });
  } else if (op.k === "new") {
    if (!S.machines[op.row.id]) S.machines[op.row.id] = Object.assign({ field_ts: {} }, op.row);
  } else if (op.k === "eq") {
    S.equipes[op.n] = Object.assign({}, S.equipes[op.n], { numero: op.n, chef: op.v });
  } else if (op.k === "ev") {
    if (!S.events.some(e => e.uid === op.ev.uid)) S.events.push(op.ev);
  }
}
let tsLast = 0;
const nowTs = () => { const t = Math.max(Date.now(), tsLast + 1); tsLast = t; return t; };
function queue(op) { Q.push(op); applyOp(op); }
function setFields(id, obj, silent) {
  const m = S.machines[id]; if (!m) return;
  for (const [c, v] of Object.entries(obj)) {
    if ((m[c] ?? null) === (v ?? null)) continue;
    // une seule modif en attente par champ : la dernière remplace la précédente
    Q = Q.filter(o => !(o.k === "f" && o.id === id && o.c === c));
    queue({ k: "f", id, c, v, ts: nowTs() });
  }
  saveLocal(); updateStatus(); if (!silent) flushSoon();
}
function addEvent(id, type, data) {
  const m = S.machines[id];
  const ev = Object.assign({ uid: `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, id, type, at: new Date().toISOString(),
    equipe: m.equipe, chef: chef(m.equipe), auteur: myName() }, data);
  queue({ k: "ev", ev, ts: nowTs() }); saveLocal(); updateStatus(); flushSoon();
}
function addMachine(row) { queue({ k: "new", row, ts: nowTs() }); saveLocal(); updateStatus(); flushSoon(); }
function setChef(n, v) {
  Q = Q.filter(o => !(o.k === "eq" && o.n === n));
  queue({ k: "eq", n, v, ts: nowTs() }); saveLocal(); updateStatus(); flushSoon();
}
/* une ligne arrive du serveur : on la prend, puis on remet par-dessus ce qui n'est pas encore envoyé */
function mergeRow(r) {
  S.machines[r.id] = Object.assign({}, r);
  Q.filter(o => (o.k === "f" && o.id === r.id) || (o.k === "new" && o.row.id === r.id)).forEach(applyOp);
}
function mergeEquipe(r) {
  S.equipes[r.numero] = Object.assign({}, r);
  Q.filter(o => o.k === "eq" && o.n === r.numero).forEach(applyOp);
}
const isNetErr = e => !navigator.onLine || /fetch|network|Failed|timeout|Load failed/i.test(String(e && (e.message || e)));
let flushing = false, flushTimer = null, flushGen = 0;
const RENAMES = (() => { try { return JSON.parse(localStorage.getItem("asdj_renames") || "{}"); } catch (e) { return {}; } })();
const resolveId = id => { let c = id, g = 0; while (RENAMES[c] && g++ < 10) c = RENAMES[c]; return c; };
/* retrouve le nouveau numéro d'une machine renumérotée (sur l'autre téléphone) grâce à l'historique */
async function findNewId(old) {
  let cur = resolveId(old);
  for (let g = 0; g < 10; g++) {
    const { data, error } = await supa.from("historique").select("nouveau").eq("champ", "numero").eq("ancien", cur).order("at", { ascending: false }).limit(1);
    if (error || !data || !data.length || !data[0].nouveau) break;
    cur = data[0].nouveau;
  }
  return cur !== old ? cur : null;
}
/* toutes les modifs en attente de l'ancien numéro passent sur le nouveau (rien n'est perdu) */
function retarget(oldId, nid) {
  RENAMES[oldId] = nid; try { localStorage.setItem("asdj_renames", JSON.stringify(RENAMES)); } catch (e) {}
  Q.forEach(o => { if (o.id === oldId) o.id = nid; if (o.ev && o.ev.id === oldId) o.ev.id = nid; if (o.row && o.row.id === oldId) o.row.id = nid; });
  PHOTOS_WAIT.forEach(p => { if (p.id === oldId) p.id = nid; });
  S.events.forEach(e => { if (e.id === oldId) e.id = nid; });
  if (S.machines[oldId] && !S.machines[nid]) { S.machines[nid] = Object.assign({}, S.machines[oldId], { id: nid }); }
  delete S.machines[oldId];
  if (latestLocal[oldId]) { latestLocal[nid] = latestLocal[oldId]; delete latestLocal[oldId]; }
  if (DRAFT && DRAFT.id === oldId) DRAFT.id = nid;
}
function flushSoon() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250); }
async function flush() {
  if (flushing || !supa || !USER) return;
  if (!Q.length) { updateStatus(); return; }
  flushing = true; updateStatus("busy");
  try {
    while (Q.length) {
      const op = Q[0]; let res;
      if (op.k === "f") res = await supa.rpc("maj_champ", { p_id: op.id, p_champ: op.c, p_valeur: op.v == null ? "" : String(op.v), p_ts: new Date(op.ts).toISOString() });
      else if (op.k === "new") {
        const ex = await supa.from("machines").select("id").eq("id", op.row.id).limit(1);
        if (ex.error) throw ex.error;
        if (ex.data && ex.data.length && !op.sent) {   // numéro déjà pris entre-temps : on garde notre machine sous un numéro libre
          let n = 2; while (S.machines[`${op.row.id}-${n}`]) n++;
          const nid = `${op.row.id}-${n}`; const mine = S.machines[op.row.id];
          retarget(op.row.id, nid); if (mine) S.machines[nid] = Object.assign({}, mine, { id: nid });
          op.row = Object.assign({}, op.row, { id: nid, notes: ((op.row.notes || "") + " (numéro déjà pris : renommée automatiquement)").trim() });
        }
        op.sent = true; saveLocal();
        res = await supa.from("machines").upsert(op.row, { onConflict: "id", ignoreDuplicates: true });
      }
      else if (op.k === "eq") res = await supa.from("equipes").upsert({ numero: op.n, chef: op.v, updated_at: new Date(op.ts).toISOString() });
      else if (op.k === "ev") res = await supa.from("historique").insert({ machine_id: op.ev.id, champ: "evenement", nouveau: JSON.stringify(op.ev) });
      if (res && res.error && !isNetErr(res.error) && /machine inconnue|foreign key|23503/i.test(`${res.error.message} ${res.error.code}`)) {
        const oldId = op.k === "ev" ? op.ev.id : op.id, nid = await findNewId(oldId);
        if (nid) { retarget(oldId, nid); saveLocal(); continue; }   // la machine a changé de numéro : on renvoie la modif au bon endroit
      }
      if (res && res.error && !isNetErr(res.error)) {
        const msg = String(res.error.message || "");
        const pm = msg.match(/pause:(\d\d:\d\d)/);
        if (pm) { setPause(pm[1]); break; }                         // frein : on garde tout, on réessaiera plus tard
        if (/acces coupe/.test(msg)) { whoami().then(() => { if (ROLE === "coupe") viewCoupe(); }); break; }
        if (/reserve aux chefs/.test(msg)) { op.msg = msg; REJ.push(Q.shift()); saveLocal(); continue; }   // mis de côté, pas effacé
      }
      if (res && res.error) {
        if (isNetErr(res.error)) throw res.error;
        op.err = (op.err || 0) + 1; op.msg = res.error.message;
        if (op.err >= 4) { REJ.push(Q.shift()); saveLocal(); continue; } // mis de côté, pas effacé
        throw res.error;
      }
      Q.shift(); flushGen++; if (PAUSE) PAUSE = "";
      if (op.k === "f" && res.data && res.data.id) mergeRow(res.data);
      saveLocal();
    }
  } catch (e) { console.warn("envoi reporté", e); }
  finally { flushing = false; updateStatus(); softRender(); }
}

/* ---------- chargement depuis le serveur (paginé : 1000 lignes max par requête) ---------- */
async function fetchAll(table, order, filter) {
  let out = [], from = 0;
  for (;;) {
    let q = supa.from(table).select("*");
    if (filter) q = filter(q);
    const { data, error } = await q.order(order).range(from, from + 999);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}
let refreshing = false;
async function refresh() {
  if (refreshing || !supa || !USER) return false;
  refreshing = true; const gen0 = flushGen;
  try {
    const role0 = ROLE; await whoami();
    if (ROLE === "coupe") { viewCoupe(); return false; }
    if (role0 && role0 !== ROLE) setTimeout(softRender, 0);
    const [ms, es, hs, mb] = await Promise.all([fetchAll("machines", "id"), fetchAll("equipes", "numero"),
      fetchAll("historique", "id", q => q.in("champ", ["evenement", "annulation"])), fetchAll("membres", "user_id").catch(() => null)]);
    S.machines = {}; ms.forEach(r => S.machines[r.id] = r);
    S.equipes = {}; es.forEach(r => S.equipes[r.numero] = r);
    S.events = []; S.annul = {};
    hs.forEach(h => {
      if (h.champ === "annulation") { if (h.annule) S.annul[h.annule] = { par: h.par, at: h.at }; return; }
      try { const e = JSON.parse(h.nouveau); e._hid = h.id; S.events.push(e); } catch (e) {}
    });
    if (mb) { S.membres = {}; mb.forEach(r => S.membres[r.user_id] = { nom: r.nom, role: r.role, actif: r.actif }); }
    Q.forEach(applyOp);
    S.cacheAt = Date.now(); saveLocal();
    if (flushGen !== gen0) setTimeout(() => refresh().then(ok => ok && softRender()), 300);
    return true;
  } catch (e) { console.warn("lecture serveur impossible", e); return false; }
  finally { refreshing = false; updateStatus(); }
}

/* ---------- rôle de la personne connectée (Chef / Équipier / accès coupé) ---------- */
async function whoami() {
  if (!supa || !USER || !navigator.onLine) return;
  try {
    const { data, error } = await supa.rpc("je_suis_la");
    if (error || !data) return;
    ROLE = data.role || "equipier"; try { localStorage.setItem("asdj_role", ROLE); } catch (e) {}
    if (!data.pause && PAUSE) { PAUSE = ""; updateStatus(); if (Q.length) flushSoon(); }
  } catch (e) {}
}
function setPause(t) {
  const fresh = PAUSE !== t; PAUSE = t; updateStatus();
  if (fresh && !MODAL) openModal({ title: "Pause 🛑", center: true, cancel: null, ok: "Compris",
    html: `<p class="mq">Tu as fait <b>20 modifs en moins d'une heure</b>.</p><p class="mq">Pour éviter les erreurs en série, les modifs sont en pause jusqu'à <b>${esc(t)}</b>. Rien n'est perdu : elles partiront toutes seules après.</p><p class="muted">Si c'est normal (gros inventaire…), demande à Cyril ou Nico de lever la pause.</p>` });
}
function viewCoupe() {
  started = true; hideLoader(); closeModal(true);
  const st = $("#status"); if (st) st.classList.add("hidden");
  $("#app").innerHTML = `<div class="login"><div class="brand"><img src="icons/icon-192.png" alt=""><h1>ASDJ - Tools</h1><p class="sub">Au service des jardins</p></div>
    <div class="sect"><p class="mq">⛔ Ton accès à l'appli a été coupé.</p><p class="muted">Demande à Cyril ou Nico de te le rendre, puis touche « Réessayer ».</p>
    <div style="height:12px"></div><button class="btn light" id="cp-retry">Réessayer</button></div></div>`;
  $("#cp-retry").onclick = async () => { await whoami(); if (ROLE !== "coupe") location.reload(); };
}

/* ---------- barre d'état ---------- */
function updateStatus(force) {
  const el = $("#status"); if (!el || !USER) return;
  if (ROLE === "coupe") { el.className = "hidden"; return; }
  let txt, cls = "";
  const n = Q.length, pp = PHOTOS_WAIT.length;
  if (force === "busy" || flushing || sendingPhotos) { cls = "busy"; txt = "Envoi en cours…"; }
  else if (!navigator.onLine) { cls = "off"; txt = n ? `Hors ligne · ${n} modif${n > 1 ? "s" : ""} en attente d'envoi` : "Hors ligne · tout est gardé sur le téléphone"; }
  else if (n) { cls = "off"; txt = `${n} modif${n > 1 ? "s" : ""} en attente d'envoi`; }
  else txt = pp ? "Données sauvegardées en ligne" : "Tout est sauvegardé en ligne";
  if (PAUSE && n) { cls = "off"; txt = `⏸️ Modifs en pause jusqu'à ${PAUSE} · ${n} en attente`; }
  if (pp) { if (!cls) cls = "off"; txt += ` · ${pp} photo${pp > 1 ? "s" : ""} en attente d'envoi`; }
  if (REJ.length) { cls = "err"; txt += ` · ${REJ.length} refusée${REJ.length > 1 ? "s" : ""} (préviens Claude)`; }
  el.className = cls; $("#status-txt").textContent = txt;
}

/* ---------- bandeau du robot (status.json) ---------- */
async function checkRobot() {
  try {
    const r = await fetch("status.json", { cache: "no-cache" }); if (!r.ok) return;
    const s = await r.json(); let msg = "", red = false;
    if (s.server && s.server !== "ok") { msg = "⚠️ Le serveur en ligne ne répond pas. Tes modifs restent gardées sur le téléphone."; red = true; }
    else if (s.token === "expired") msg = "⚠️ Le robot qui garde le serveur éveillé a besoin d'une nouvelle clé. Préviens Claude.";
    else if (s.date && Date.now() - Date.parse(s.date) > 3 * 864e5) msg = "⚠️ Le robot de réveil n'est pas passé depuis 3 jours. Préviens Claude.";
    $("#banner").innerHTML = msg ? `<div class="banner ${red ? "red" : ""}">${esc(msg)}</div>` : "";
  } catch (e) { /* hors ligne : rien */ }
}

/* ---------- mise à jour de l'appli : écran bloquant tant que la nouvelle version n'est pas chargée ---------- */
async function checkVersion() {
  if (!navigator.onLine) return false;   // hors réseau : on garde la version du téléphone
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store", signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) return false;
    const { v } = await r.json();
    if (!(v > APP_V)) { sessionStorage.removeItem("asdj_upd"); return false; }
    const tries = +(sessionStorage.getItem("asdj_upd") || 0);
    if (tries >= 3) return false;          // sécurité : jamais bloqué indéfiniment
    sessionStorage.setItem("asdj_upd", tries + 1);
    showUpdating();
    if (Q.length) await flush();           // on envoie d'abord ce qui attend
    try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
    setTimeout(() => location.reload(), 800);
    return true;
  } catch (e) { return false; }
}
function showUpdating() {
  let l = $("#loader");
  if (!l) { l = document.createElement("div"); l.id = "loader"; document.body.appendChild(l); }
  l.className = ""; l.innerHTML = `<img src="icons/icon-192.png" alt=""><h1>ASDJ - Tools</h1><div class="spin"></div><p>Mise à jour de l'appli…<br>Ça ne prend que quelques secondes.</p>`;
}

/* ---------- navigation (bouton retour du téléphone = écran précédent) ---------- */
const scrolls = {};
let stack = [], replacing = false;
function go(h) { location.hash = h; }
function replaceTo(h) { replacing = true; location.replace(h); }
function back() { if (stack.length > 1) history.back(); else replaceTo("#/"); }
window.addEventListener("hashchange", e => {
  const old = (e.oldURL.split("#")[1] || "/");
  scrolls[old] = window.scrollY;
  const nw = location.hash.slice(1) || "/";
  if (replacing) { stack[stack.length - 1] = nw; replacing = false; }
  else if (stack.length > 1 && stack[stack.length - 2] === nw) stack.pop();
  else stack.push(nw);
  if (nw === "/") stack = ["/"];
  closeModal(true);
  render(true);
});
function parseRoute() {
  const h = (location.hash.slice(1) || "/");
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || ""), key: h };
}

/* ---------- fenêtre de confirmation ---------- */
let MODAL = null;
function openModal({ title, html, ok = "Oui, confirmer", okColor, cancel = "Non, annuler", onOk, onOpen, center }) {
  closeModal(true); closePops();
  const d = document.createElement("div"); d.id = "modal"; if (center) d.className = "center";
  d.innerHTML = `<div class="mback" data-act="m-cancel"></div><div class="mbox" role="dialog" aria-modal="true">
    <h2>${title}</h2><div class="mbody">${html || ""}</div><div id="m-msg"></div>
    <div class="mbtns ${cancel === null ? "one" : ""}">${cancel === null ? "" : `<button class="btn light" data-act="m-cancel">${esc(cancel)}</button>`}<button class="btn" data-act="m-ok" ${okColor ? `style="background:${okColor}"` : ""}>${esc(ok)}</button></div></div>`;
  document.body.appendChild(d); document.body.classList.add("noscroll");
  MODAL = { onOk, el: d };
  if (onOpen) onOpen(d);
}
function closeModal(silent) {
  if (!MODAL) return; MODAL.el.remove(); MODAL = null; document.body.classList.remove("noscroll");
  if (!silent && pendingRender) softRender();
}
function infoModal(title, html) { openModal({ title, html, ok: "Compris", cancel: null, center: true }); }
function closePops() { document.querySelectorAll(".pop").forEach(p => p.remove()); document.querySelectorAll(".dots.on").forEach(b => b.classList.remove("on")); }
const mval = id => { const e = document.getElementById(id); return e ? e.value.trim() : ""; };
const mfile = id => { const e = document.getElementById(id); return e && e.files && e.files[0]; };

/* ---------- rendu ---------- */
const GEAR = () => `<button class="iconbtn" data-act="go" data-h="#/parametres" aria-label="Paramètres"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>`;
function header(title, sub, opts = {}) {
  const left = opts.home
    ? `<img class="logo" src="icons/icon-192.png" alt="">`
    : `<button class="iconbtn" data-act="back" aria-label="Retour">${SVG.back}</button>`;
  const famIc = opts.fam ? `<span class="hfam" style="color:${fc(opts.fam)}">${ICONS[opts.fam]}</span>` : "";
  return `<header class="top"><div class="row">${left}${famIc}<h1>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</h1>${opts.right || ""}</div></header>`;
}
function cardHTML(m) {
  return `<a class="card ${m.actif === false ? "off" : ""}" href="#/machine/${encodeURIComponent(m.id)}" style="--c:${sc(eff(m))}">
    <span class="stripe"></span>
    <span class="body"><span class="num ${noNum(m) ? "nonum" : ""}">${esc(disp(m))}</span><span class="mod">${esc(m.modele)}</span><div class="where">${esc(whereTxt(m))}</div></span>
    <span class="side"><span class="pill">${esc(ST[eff(m)] ? ST[eff(m)].nom : m.statut)}</span></span></a>`;
}
function summaryHTML(list, base) {
  const c = countBy(list), att = c.operationnelle + c.controle;
  const cell = (id, n, label, big) => `<a class="sum ${big ? "big" : ""} ${n ? "" : "zero"}" href="${base}statut=${id}" style="--c:${id === "attribuee" ? sc("operationnelle") : sc(id)}"><b>${n}</b><span>${esc(label)}</span></a>`;
  return `<div class="summary"><div class="sumrow two">${cell("probleme", c.probleme, c.probleme > 1 ? "Problèmes techniques" : "Problème technique", true)}${cell("reparation", c.reparation, "En réparation", true)}</div>
    <div class="sumrow three">${cell("disponible", c.disponible, "Dépôt")}${cell("attribuee", att, att > 1 ? "Attribuées" : "Attribuée")}${cell("hs", c.hs, "HS")}</div></div>`;
}

function viewHome() {
  const all = actives();
  const tiles = FAMILLES.map(f => {
    const l = all.filter(m => m.famille === f.id);
    return `<a class="tile" href="#/famille/${f.id}"><span class="ic" style="background:${fc(f.id)}">${ICONS[f.id]}</span>
      <h2>${esc(f.nom)}</h2><span class="n">${l.length} machine${l.length > 1 ? "s" : ""}</span>${barHTML(l)}${dotsHTML(l, URGENTS)}</a>`;
  }).join("");
  const teams = teamNums();
  return header("ASDJ - Tools", "Au service des jardins", { home: true, right: GEAR() }) +
    `<main>${segHTML("m")}${alertBandHTML(false)}<input class="search" id="home-search" type="search" placeholder="🔍 Code, modèle, chef, type de machine…" autocomplete="off">
    ${summaryHTML(all, "#/tout?")}
    <div class="tiles">${tiles}</div>
    <a class="sechead" href="#/equipes"><span class="tb-ic">${SVG.team}</span><b>Les équipes</b><span class="sp"></span><small>Tout voir</small>${SVG.chev}</a>
    <div class="tgrid">${teams.map(n => teamCard(n, all)).join("")}</div>
    <a class="allband" href="#/tout"><span class="tb-ic">${SVG.list}</span><span class="tb-txt"><b>Toutes les machines</b><small>${all.length} machines</small></span><span class="tb-chev">${SVG.chev}</span></a>
    </main>`;
}

let famSort = "num";
function statusChips(list, sel, base) {
  const c = countBy(list), sep = base.includes("?") ? "&" : "?";
  return `<div class="chips"><a class="chip ${!sel ? "on" : ""}" href="${base}">Toutes · ${list.length}</a>${STATUTS.filter(s => c[s.id]).map(s =>
    `<a class="chip ${sel === s.id ? "on" : ""}" href="${base}${sep}statut=${s.id}"><span class="sw" style="background:${sc(s.id)}"></span>${esc(s.nom)} · ${c[s.id]}</a>`).join("")}</div>`;
}
function viewFamille(fid, q) {
  const f = FAM[fid]; if (!f) return viewHome();
  const all = Object.values(S.machines).filter(m => m.famille === fid);
  const act = all.filter(m => m.actif !== false), off = all.filter(m => m.actif === false);
  const sel = q.get("statut");
  const list = act.filter(m => statMatch(m, sel));
  let body;
  if (famSort === "equipe") {
    const groups = {};
    list.forEach(m => { const k = m.equipe == null ? "z" : String(m.equipe).padStart(3, "0"); (groups[k] = groups[k] || []).push(m); });
    body = Object.keys(groups).sort().map(k => `<div class="group-h">${esc(k === "z" ? "Dépôt" : teamLabel(+k))}</div><div class="list">${groups[k].sort(byAlert).map(cardHTML).join("")}</div>`).join("");
  } else body = `<div class="list">${list.sort((a, b) => natural(a.id, b.id)).map(cardHTML).join("")}</div>`;
  if (!list.length) body = `<div class="empty">Aucune machine ici.</div>`;
  const retired = off.length ? `<details class="retired"><summary>Machines retirées du parc (${off.length})</summary><div class="list">${off.sort((a, b) => natural(a.id, b.id)).map(cardHTML).join("")}</div></details>` : "";
  return header(f.nom, `${act.length} machine${act.length > 1 ? "s" : ""}${f.aide ? ` · ${f.aide}` : ""}`, { fam: fid }) +
    `<main>${summaryHTML(act, `#/famille/${fid}?`)}<div class="seg"><button data-act="sort" data-v="num" class="${famSort === "num" ? "on" : ""}">Par numéro</button><button data-act="sort" data-v="equipe" class="${famSort === "equipe" ? "on" : ""}">Par équipe</button></div>
    ${sel ? `<div class="filtre">Filtre : <b>${esc(sel === "attribuee" ? "Attribuées" : ST[sel].nom)}</b> <a href="#/famille/${fid}">✕ retirer</a></div>` : ""}${body}
    <div class="addbar"><button class="btn light" data-act="add" data-fam="${fid}">+ Ajouter ${f.art || "une"} ${esc(f.un.toLowerCase())}</button></div>${retired}</main>`;
}

function teamCard(n, all) {
  const l = all.filter(m => m.equipe === n).sort(byAlert), bad = l.filter(m => URGENTS.includes(m.statut));
  const worst = bad.length ? bad[0].statut : null;
  const minis = bad.map(m => `<span class="tmini" style="color:${sc(m.statut)}" title="${esc(m.id)} · ${esc(ST[m.statut].nom)}">${ICONS[m.famille] || ""}</span>`).join("");
  // bandeau du haut : une part de couleur par machine en souci (rouge = problème, orange = réparation…)
  const stops = bad.length ? bad.map((m, i) => `${sc(m.statut)} ${i / bad.length * 100}% ${(i + 1) / bad.length * 100}%`).join(",") : "var(--green) 0 100%";
  return `<a class="tcard ${worst ? "bad" : ""}" href="#/equipe/${n}" style="--c:${worst ? sc(worst) : "var(--green)"};background:linear-gradient(90deg,${stops}) top/100% 7px no-repeat,#fff">
    <span class="tnum">${n}</span><b>${esc(chef(n) || "Chef à indiquer")}</b><small>${l.length} machine${l.length > 1 ? "s" : ""}</small>
    ${bad.length ? `<span class="tbad">${bad.length} en souci <span class="tminis">${minis}</span></span>` : `<span class="tok">✓ tout va bien</span>`}</a>`;
}
function teamPannes(n) { return S.events.filter(e => !evAnnul(e) && (e.type === "probleme" || e.type === "hs") && e.equipe === n).length; }
function viewEquipes() {
  const all = actives();
  const cards = `<div class="tgrid">${teamNums().map(n => { const p = teamPannes(n); return teamCard(n, all).replace("</a>", `${p ? `<span class="tpan">${p} panne${p > 1 ? "s" : ""} signalée${p > 1 ? "s" : ""} au total</span>` : ""}</a>`); }).join("")}</div>`;
  const dep = all.filter(m => m.equipe == null);
  return header("Les équipes", "Le matériel de chaque chef") + `<main>${cards}<div class="list" style="margin-top:12px">
    <a class="card" href="#/equipe/depot" style="--c:var(--s-disponible)"><span class="stripe"></span><span class="body team"><span class="badge depot">D</span>
      <span style="flex:1;min-width:0"><span class="num" style="font-size:18px">Dépôt</span><div class="where">${dep.length} machine${dep.length > 1 ? "s" : ""} au dépôt ou en réparation</div>${barHTML(dep)}</span></span></a>
  </div><div class="addbar">${isChef() ? `<button class="btn light" data-act="team-add">+ Ajouter une équipe</button>` : `<div class="lock">🔒 Ajouter une équipe : réservé à Cyril et Nico</div>`}</div></main>`;
}
function viewEquipe(id, q) {
  const isDep = id === "depot", n = isDep ? null : +id;
  const all = actives().filter(m => isDep ? m.equipe == null : m.equipe === n);
  const sel = q.get("statut");
  const list = all.filter(m => statMatch(m, sel));
  const fams = FAMILLES.map(f => ({ f, l: list.filter(m => m.famille === f.id).sort(byAlert) }))
    .sort((x, y) => (x.l.length ? prio(x.l[0]) : 99) - (y.l.length ? prio(y.l[0]) : 99));
  const body = fams.map(({ f, l }) => l.length ? `<div class="group-h"><span style="color:${fc(f.id)}">${ICONS[f.id]}</span>${esc(f.nom)} · ${l.length}</div><div class="list">${l.map(cardHTML).join("")}</div>` : "").join("")
    || `<div class="empty">Aucune machine ici.</div>`;
  const edit = isDep || !isChef() ? "" : `<button class="iconbtn" data-act="chef" data-n="${n}" aria-label="Changer le chef">✎</button>`;
  return header(isDep ? "Dépôt" : `Équipe ${n}`, isDep ? "Au dépôt ou en réparation" : (chef(n) ? `Chef : ${chef(n)}` : "Chef à indiquer"), { right: edit }) +
    `<main>${summaryHTML(all, `#/equipe/${id}?`)}${sel ? `<div class="filtre">Filtre : <b>${esc(sel === "attribuee" ? "Attribuées" : ST[sel].nom)}</b> <a href="#/equipe/${id}">✕ retirer</a></div>` : ""}${body}
    <div class="sect" style="margin-top:18px"><h3>Historique de l'équipe : pannes, réparations, prêts</h3>${teamHistHTML(n)}</div></main>`;
}
function viewTout(q) {
  const sel = q.get("statut"), txt = norm((q.get("q") || "").trim());
  const all = actives();
  const list = all.filter(m => statMatch(m, sel) &&
    (!txt || txt.split(/\s+/).every(w => norm([m.id, m.modele, (m.modele || "").replace(/\s+/g, ""), FAM[m.famille] && FAM[m.famille].un, FAM[m.famille] && FAM[m.famille].nom,
      chef(m.equipe), m.equipe != null ? `equipe ${m.equipe}` : "depot sans equipe", noNum(m) ? "sans numero sans n" : "", ST[eff(m)] && ST[eff(m)].nom, LIEUX[m.lieu], m.reparateur, m.depose_par, m.recupere_par, m.pret_a, m.lieu === "pret" ? "pretee pret" : "", m.notes, m.motif].join(" ")).includes(w))))
    .sort(byAlert);
  const base = `#/tout${txt ? `?q=${encodeURIComponent(q.get("q").trim())}` : ""}`;
  return header("Toutes les machines", `${all.length} machines`) +
    `<main><input class="search" id="search" type="search" placeholder="🔍 Code, modèle, chef, type de machine…" autocomplete="off" value="${esc(q.get("q") || "")}">
    ${statusChips(all, sel === "attribuee" ? "" : sel, base)}${sel === "attribuee" ? `<div class="filtre">Filtre : <b>Attribuées</b> <a href="${base}">✕ retirer</a></div>` : ""}
    <div class="list">${list.map(cardHTML).join("") || `<div class="empty">Aucune machine trouvée.</div>`}</div></main>`;
}

/* ----- fiche machine ----- */
let DRAFT = (() => { try { return JSON.parse(localStorage.getItem("asdj_draft") || "null"); } catch (e) { return null; } })();   // corrections en cours (gardées même si l'appli se ferme)
const saveDraft = () => { try { DRAFT && Object.keys(DRAFT.v).length ? localStorage.setItem("asdj_draft", JSON.stringify(DRAFT)) : localStorage.removeItem("asdj_draft"); } catch (e) {} };
const numSN = m => DRAFT && DRAFT.id === m.id && "_num" in DRAFT.v ? DRAFT.v._num === "__SN__" : noNum(m);
const dv = (m, f) => DRAFT && DRAFT.id === m.id && f in DRAFT.v ? DRAFT.v[f] : m[f];
const EVT = {
  probleme: { nom: "Problème signalé", c: "probleme" },
  reparation: { nom: "Partie en réparation", c: "reparation" },
  retour: { nom: "Revenue de réparation", c: "disponible" },
  hs: { nom: "Déclarée HS", c: "hs" },
  pret: { nom: "Prêtée", c: "controle" },
  rendu: { nom: "Rendue après prêt", c: "operationnelle" },
  ct: { nom: "Contrôle technique fait", c: "operationnelle" },
  pol: { nom: "Contrôle pollution fait", c: "operationnelle" },
  rev: { nom: "Révision / vidange faite", c: "operationnelle" },
  revision: { nom: "En attente de révision", c: "revision" },
  rev_attente: { nom: "Révision : attendre un kilométrage", c: "revision" },
  rev_rdv: { nom: "Révision : rendez-vous pris", c: "revision" },
  ct_rdv: { nom: "Contrôle technique : rendez-vous pris", c: "revision" },
  pol_rdv: { nom: "Contrôle pollution : rendez-vous pris", c: "revision" },
};
function evLines(e) {
  const lines = [];
  if (e.motif) lines.push(`Pourquoi : ${e.motif}`);
  if (e.reparateur) lines.push(`Réparateur : ${e.reparateur}`);
  if (e.pret_a) lines.push(`${e.type === "rendu" ? "Rendue par" : "Prêtée à"} ${e.pret_a}`);
  if (e.depose_par) lines.push(`Déposée par ${e.depose_par}`);
  if (e.recupere_par) lines.push(`Récupérée par ${e.recupere_par}`);
  if (e.auteur) lines.push(`Noté par ${e.auteur}`);
  return lines;
}
function teamHistHTML(n) {
  const evAll = S.events.filter(e => n === null ? e.equipe == null : e.equipe === n).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!evAll.length) return `<p class="muted">Rien d'enregistré pour l'instant.</p>`;
  const ev = evAll.filter(e => !evAnnul(e));
  const np = ev.filter(e => e.type === "probleme" || e.type === "hs").length, nr = ev.filter(e => e.type === "reparation").length, npr = ev.filter(e => e.type === "pret").length;
  const per = {}; ev.filter(e => e.type === "probleme" || e.type === "hs").forEach(e => per[e.id] = (per[e.id] || 0) + 1);
  const top = Object.entries(per).sort((a, b) => b[1] - a[1]).filter(x => x[1] > 1);
  return `<div class="evsum"><span><b>${np}</b> panne${np > 1 ? "s" : ""}</span><span><b>${nr}</b> réparation${nr > 1 ? "s" : ""}</span><span><b>${npr}</b> prêt${npr > 1 ? "s" : ""}</span></div>
    ${top.length ? `<p class="muted">Machines qui tombent le plus en panne : ${top.map(([k, v]) => `<b>${esc(k)}</b> (${v})`).join(", ")}</p>` : ""}
    <ul class="evlist">${evAll.slice(0, 60).map(e => {
      const t = EVT[e.type] || { nom: e.type, c: "hs" }, d = new Date(e.at), mm = S.machines[e.id], an = evAnnul(e);
      return `<li style="--c:${sc(t.c)}" class="${an ? "undone" : ""}"><a class="evtxt" href="#/machine/${encodeURIComponent(e.id)}"><time>${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>
        <span class="evm">${mm ? `<span class="evic" style="color:${fc(mm.famille)}">${ICONS[mm.famille]}</span>` : ""}<b>${esc(mm ? disp(mm) : e.id)}${mm && noNum(mm) ? ` (${esc(mm.modele)})` : ""}</b> · ${esc(t.nom)}</span>${evLines(e).map(l => `<div>${esc(l)}</div>`).join("")}${an ? `<span class="tag">Annulé par ${esc(nomDe(an.par) || "un chef")}</span>` : ""}</a>
        ${e.photo ? `<button class="thumb" data-act="zoom" data-key="${esc(e.photo)}"><img data-photo="${esc(e.photo)}" alt="Photo"></button>` : ""}</li>`;
    }).join("")}</ul>`;
}
function eventsOf(id) { return S.events.filter(e => e.id === id).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
function eventsHTML(id) {
  const evAll = eventsOf(id), ev = evAll.filter(e => !evAnnul(e));
  if (!evAll.length) return `<p class="muted">Aucune panne, réparation ni prêt enregistré pour l'instant.</p>`;
  const np = ev.filter(e => e.type === "probleme" || e.type === "hs").length, nr = ev.filter(e => e.type === "reparation").length;
  const teams = {}; ev.filter(e => e.type === "probleme" || e.type === "hs").forEach(e => { const k = teamLabel(e.equipe); teams[k] = (teams[k] || 0) + 1; });
  const npr = ev.filter(e => e.type === "pret").length;
  return `<div class="evsum"><span><b>${np}</b> panne${np > 1 ? "s" : ""}</span><span><b>${nr}</b> réparation${nr > 1 ? "s" : ""}</span><span><b>${npr}</b> prêt${npr > 1 ? "s" : ""}</span></div>
    ${Object.keys(teams).length ? `<p class="muted">Pannes par équipe : ${Object.entries(teams).map(([k, v]) => `${esc(k)} (${v})`).join(", ")}</p>` : ""}
    <ul class="evlist">${evAll.map(e => {
      const t = EVT[e.type] || { nom: e.type, c: "hs" }, d = new Date(e.at), an = evAnnul(e);
      if (e._hid) HROWS[e._hid] = { id: e._hid, machine_id: id, champ: "evenement", nouveau: JSON.stringify(e), at: e.at, _auteur: e.auteur };
      const can = isChef() && e._hid && !an;
      const lines = [];
      if (e.equipe != null && e.type !== "retour") lines.push(`Équipe : ${teamLabel(e.equipe)}`);
      if (e.probleme_type) lines.push(`Genre : ${e.probleme_type}`);
      if (e.cible_km) lines.push(`Révision prévue à ${Number(e.cible_km).toLocaleString("fr-FR")} km${e.km ? ` (compteur : ${Number(e.km).toLocaleString("fr-FR")} km)` : ""}`);
      if (e.rdv) lines.push(`Rendez-vous le ${frDate(e.rdv)}${e.garage ? ` · ${e.garage}` : ""}`);
      if (e.fait_le) lines.push(`Fait le ${frDate(e.fait_le)}${e.km ? ` à ${Number(e.km).toLocaleString("fr-FR")} km` : ""}`);
      if (e.motif) lines.push(`Pourquoi : ${e.motif}`);
      if (e.reparateur) lines.push(`${isVeh(S.machines[id]) ? "Garage" : "Réparateur"} : ${e.reparateur}`);
      if (e.pret_a) lines.push(`${e.type === "rendu" ? "Rendue par" : "Prêtée à"} ${e.pret_a}${e.pret_le && e.type === "pret" ? ` le ${frDate(e.pret_le)}` : ""}`);
      if (e.type === "rendu" && e.duree != null) lines.push(`Durée du prêt : ${e.duree} j`);
      if (e.depose_par) lines.push(`Déposée par ${e.depose_par}${e.depose_le ? ` le ${frDate(e.depose_le)}` : ""}`);
      if (e.recupere_par || e.recupere_le) lines.push(`Récupérée${e.recupere_par ? ` par ${e.recupere_par}` : ""}${e.recupere_le ? ` le ${frDate(e.recupere_le)}` : ""}`);
      if (e.duree != null && e.type === "retour") lines.push(`Durée chez le réparateur : ${e.duree} j`);
      if (e.auteur) lines.push(`Noté par ${e.auteur}`);
      return `<li style="--c:${sc(t.c)}" class="${an ? "undone" : ""}"><div class="evtxt"><time>${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>
        <b>${esc(t.nom)}</b>${lines.map(l => `<div>${esc(l)}</div>`).join("")}${an ? `<span class="tag">Annulé par ${esc(nomDe(an.par) || "un chef")} le ${dateHeure(an.at)}</span>` : ""}</div>${e.photo ? `<button class="thumb" data-act="zoom" data-key="${esc(e.photo)}"><img data-photo="${esc(e.photo)}" alt="Photo"></button>` : ""}${can ? `<button class="dots" data-act="dots" data-kind="row" data-hid="${e._hid}" aria-label="Options">⋯</button>` : ""}</li>`;
    }).join("")}</ul>`;
}
function viewMachine(id) {
  const m = S.machines[id];
  if (!m) return header("Machine introuvable") + `<main><div class="empty">Cette machine n'existe pas (ou plus).</div></main>`;
  const f = FAM[m.famille] || { un: m.famille };
  const lieu = dv(m, "lieu"), eq = dv(m, "equipe");
  const teamOpts = `<option value="">Dépôt</option>` + teamNums().map(n => `<option value="${n}" ${eq === n ? "selected" : ""}>${esc(teamLabel(n))}</option>`).join("");
  const famOpts = FAMILLES.map(x => `<option value="${x.id}" ${dv(m, "famille") === x.id ? "selected" : ""}>${esc(x.un)}</option>`).join("");
  const inp = (fld, label, type = "text", ph = "", list = "") => `<label class="f" for="f-${fld}">${label}</label><input class="inp" id="f-${fld}" ${type !== "text" ? `type="${type}"` : ""} ${list ? `list="${list}"` : ""} data-field="${fld}" value="${esc(dv(m, fld) || "")}" placeholder="${esc(ph)}">`;
  const dirty = DRAFT && DRAFT.id === id && Object.keys(DRAFT.v).length;
  const otherDraft = DRAFT && DRAFT.id !== id && Object.keys(DRAFT.v).length && S.machines[DRAFT.id];
  return header(`${disp(m)} · ${m.modele}`, f.un) + `<main>
    ${otherDraft ? `<a class="draftwarn" href="#/machine/${encodeURIComponent(DRAFT.id)}">⚠️ Corrections non enregistrées sur <b>${esc(disp(otherDraft))}</b> : touche ici pour les valider.</a>` : ""}
    <div class="hero" style="--c:${sc(eff(m))}"><span class="fam">${ICONS[m.famille] || ""}</span>
      <div class="big">${esc(disp(m))}</div><div class="mod">${esc(f.un)} ${esc(m.modele)}</div>
      <div class="st">${esc(ST[eff(m)] ? ST[eff(m)].nom : m.statut)}</div>
      <div class="since">${esc(whereTxt(m))}</div>${m.motif && URGENTS.includes(m.statut) ? `<div class="since">« ${esc(m.motif)} »</div>` : ""}</div>

    <div class="sect"><h3>Changer l'état</h3><div class="stgrid">
      ${STATUTS.map(s => `<button class="stbtn ${eff(m) === s.id ? "on" : ""}" style="--c:${sc(s.id)}" data-act="statut" data-v="${s.id}">${esc(s.nom)}</button>`).join("")}
    </div><div class="stfoot"><span class="muted">Une confirmation est demandée à chaque changement.</span>
      <button class="pretbtn ${m.lieu === "pret" ? "on" : ""}" data-act="pret">🤝 ${m.lieu === "pret" ? `Rendue ? (${esc(m.pret_a || "prêtée")})` : "Prêter"}</button></div></div>

    <div class="sect"><h3>Photo</h3><div class="photo" id="photo-box" data-main="${esc(id)}">${m.photo || pendingPhoto(m.id, "main") ? "Chargement de la photo…" : "Pas encore de photo"}</div>
      <div class="pickrow"><label class="btn light">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" id="photo-cam" hidden></label>
      <label class="btn light">🖼️ Galerie<input type="file" accept="image/*" id="photo-input" hidden></label></div></div>

    <div class="sect"><h3>Historique : pannes, réparations, prêts</h3>${eventsHTML(id)}</div>

    <div class="sect ${dirty ? "dirty" : ""}"><h3>Infos de la machine</h3><p class="muted" style="margin:0 0 4px">Pour corriger une erreur de saisie. Rien n'est changé tant que tu n'as pas appuyé sur « Enregistrer ».</p>
      ${isChef() ? "" : `<div class="lock">🔒 Numéro et type : réservé à Cyril et Nico</div>`}
      <label class="f" for="f-num">Numéro interne</label>
      <input class="inp" id="f-num" data-field="_num" autocapitalize="characters" autocomplete="off" value="${esc(DRAFT && DRAFT.id === m.id && "_num" in DRAFT.v ? (DRAFT.v._num === "__SN__" ? "" : DRAFT.v._num) : (noNum(m) ? "" : m.id))}" ${numSN(m) ? "disabled placeholder='Sans numéro'" : isChef() ? "" : "disabled"}>
      <label class="check"><input type="checkbox" id="f-nonum" ${numSN(m) ? "checked" : ""} ${isChef() ? "" : "disabled"}><span><b>Sans numéro</b><br><span class="muted">Cet appareil n'a pas de numéro.</span></span></label>
      <label class="f" for="f-famille">Type de machine</label><select class="inp" id="f-famille" data-field="famille" ${isChef() ? "" : "disabled"}>${famOpts}</select>
      ${inp("modele", "Modèle")}
      <label class="f" for="f-equipe">Équipe responsable</label><select class="inp" id="f-equipe" data-field="equipe">${teamOpts}</select>
      <label class="f">Où est-elle ?</label><div class="where3">${Object.entries(LIEUX).map(([k, v]) => `<button class="${lieu === k ? "on" : ""}" data-act="lieu" data-v="${k}">${esc(v)}</button>`).join("")}</div>
      <div class="two"><div>${inp("pret_a", "Prêtée à", "text", "Nom", "noms")}</div><div>${inp("pret_le", "Prêtée le", "date")}</div></div>
      <label class="f">Réparateur</label>${repPicker("f-reparateur", dv(m, "reparateur"), "reparateur")}
      <div class="two"><div>${inp("depose_par", "Déposée par", "text", "Nom", "noms")}</div><div>${inp("depose_le", "Déposée le", "date")}</div></div>
      <div class="two"><div>${inp("recupere_par", "Récupérée par", "text", "Nom", "noms")}</div><div>${inp("recupere_le", "Récupérée le", "date")}</div></div>
      ${inp("depuis", "Dans cet état depuis le", "date")}
      <label class="f" for="f-motif">Pourquoi ? (panne, problème, raison)</label><textarea class="inp" id="f-motif" data-field="motif">${esc(dv(m, "motif"))}</textarea>
      ${inp("controle", "Dernier contrôle", "date")}
      <label class="f" for="f-notes">Notes</label><textarea class="inp" id="f-notes" data-field="notes">${esc(dv(m, "notes"))}</textarea>
      <datalist id="noms">${NOMS().map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    </div>

    <details class="sect journal" ${JOPEN ? "open" : ""}><summary><h3 style="display:inline">Journal de toutes les modifications</h3></summary><ul class="hist" id="hist" data-id="${esc(id)}">${HISTC[id] || "<li>Chargement…</li>"}</ul></details>

    ${isChef() ? `<button class="btn ${m.actif === false ? "light" : "danger"}" data-act="actif">${m.actif === false ? "Remettre dans le parc" : "Retirer du parc (vendue, perdue, détruite…)"}</button>`
      : `<button class="btn dis" disabled>🔒 ${m.actif === false ? "Remettre dans le parc" : "Retirer du parc"} : réservé à Cyril et Nico</button>`}
  </main>
  <div class="savebar ${dirty ? "" : "hidden"}" id="savebar"><span>Modifications non enregistrées</span><button class="btn light" data-act="draft-cancel">Annuler</button><button class="btn" data-act="draft-save">💾 Enregistrer</button></div>`;
}
const CHAMPS = { ct_rdv: "Rendez-vous CT", ct_lieu: "Centre de contrôle (CT)", pol_rdv: "Rendez-vous pollution", pol_lieu: "Centre de contrôle (pollution)", rev_mode: "Choix pour la révision", rev_cible_km: "Révision prévue à (km)", rev_rdv: "Rendez-vous révision", rev_garage: "Garage révision", rev_choix: "Choix fait par", ct_avant: "Prochain CT avant le", pol_avant: "Pollution avant le", rev_avant: "Révision avant le", mise_circulation: "Mise en circulation", plaque: "Plaque", type_vehicule: "Type de véhicule", km: "Kilométrage", km_le: "Kilométrage relevé le", ct_le: "Contrôle technique fait le", ct_mois: "Délai du CT", pol_le: "Contrôle pollution fait le", pol_mois: "Délai pollution", rev_le: "Révision faite le", rev_km: "Km à la révision", rev_mois: "Délai révision", probleme_type: "Genre de problème", creation: "Ajout", _num: "Numéro", numero: "Numéro", pret_a: "Prêtée à", pret_le: "Prêtée le", depose_par: "Déposée par", depose_le: "Déposée le", recupere_par: "Récupérée par", recupere_le: "Récupérée le", photo: "Photo", statut: "État", lieu: "Lieu", reparateur: "Réparateur", depuis: "Depuis", motif: "Pourquoi", equipe: "Équipe", controle: "Contrôle", modele: "Modèle", notes: "Notes", actif: "Dans le parc", affectation: "Affectation", famille: "Type" };
function histVal(c, v, veh) {
  if (v == null || v === "") return "—";
  if (c === "statut") return veh ? (VST[v] ? VST[v].nom : v) : ST[v] ? ST[v].nom : (VST[v] ? VST[v].nom : v);
  if (["km_le", "ct_le", "pol_le", "rev_le", "ct_avant", "pol_avant", "rev_avant", "mise_circulation"].includes(c)) return frDate(v);
  if (c === "rev_mode") return v === "km" ? "attendre un kilométrage" : v === "rdv" ? "rendez-vous" : v;
  if (["rev_rdv", "ct_rdv", "pol_rdv"].includes(c)) return frDate(v);
  if (["km", "rev_km", "rev_cible_km"].includes(c)) return `${Number(v).toLocaleString("fr-FR")} km`;
  if (["ct_mois", "pol_mois", "rev_mois"].includes(c)) return DELAIS[v] || `${v} mois`;
  if (c === "type_vehicule") return VTYPES[v] || v;
  if (c === "lieu") return LIEUX[v] || v;
  if (c === "equipe") return teamLabel(+v);
  if (["depuis", "controle", "depose_le", "recupere_le", "pret_le"].includes(c)) return frDate(v);
  if (c === "actif") return v === "true" ? "oui" : "non";
  if (c === "photo") return "nouvelle photo";
  if (c === "_num" || c === "numero") return v === "__SN__" || String(v).startsWith("SN-") ? "Sans numéro" : v;
  return v;
}
/* une ligne d'historique (journal de la fiche ou écran Activité) */
function histTxt(h) {
  const c = h.champ;
  if (c === "creation") return "➕ a ajouté cette machine";
  if (c === "evenement") { let e = {}; try { e = JSON.parse(h.nouveau); } catch (x) {} const t = EVT[e.type]; return `🔧 a noté : ${esc(t ? t.nom : (e.type || "un événement"))}${e.motif ? ` « ${esc(e.motif)} »` : ""}`; }
  if (c === "annulation") return h.nouveau === "creation" ? "↩️ a annulé l'ajout de cette machine" : "↩️ a annulé une panne / un événement noté";
  const veh = isVeh(S.machines[h.machine_id]);
  if (h.annule) return `↩️ a annulé une modif : ${esc(CHAMPS[c] || c)} remis à <b>${esc(histVal(c, h.nouveau, veh))}</b>`;
  return `${esc(CHAMPS[c] || c)} : ${esc(histVal(c, h.ancien, veh))} → <b>${esc(histVal(c, h.nouveau, veh))}</b>`;
}
const canUndo = h => isChef() && !ANN[h.id] && !S.annul[h.id] && !h.annule && !["numero", "annulation"].includes(h.champ) && !!S.machines[h.machine_id];
/* les lignes d'une même action (même personne, même machine, à moins de 2 min) sont regroupées */
function groupRows(rows) {
  const out = [];
  for (const h of rows) {
    const g = out[out.length - 1], f = g && g[g.length - 1], rev = x => !!(x.annule || x.champ === "annulation");
    if (f && f.machine_id === h.machine_id && f.par === h.par && rev(f) === rev(h) && Math.abs(Date.parse(f.at) - Date.parse(h.at)) <= 120000) g.push(h);
    else out.push([h]);
  }
  return out;
}
function histLi(g, withM) {
  g.forEach(h => HROWS[h.id] = h);
  const h0 = g[0], m = S.machines[h0.machine_id];
  const ans = g.map(h => ANN[h.id] || S.annul[h.id]), an = ans.find(Boolean), all = ans.every(Boolean);
  const hids = g.filter(canUndo).map(h => h.id);
  const ml = withM ? ` · <b>${esc(m ? disp(m) : h0.machine_id)}</b> ${esc(m ? (isVeh(m) ? `🚐 ${m.plaque ? m.modele || "" : ""}` : `${FAM[m.famille] ? FAM[m.famille].un : ""} ${m.modele || ""}`) : "")}` : "";
  const lines = g.map((h, i) => `<div class="${ans[i] ? "undone" : ""}">${histTxt(h)}</div>`).join("");
  return `<li class="hrow"><div class="tx"><div class="${all ? "undone" : ""}"><time>${dateHeure(h0.at)}${ml}</time>${whoHTML(h0.par)}</div>${lines}${an ? `<span class="tag">Annulé par ${esc(nomDe(an.par) || "un chef")} le ${dateHeure(an.at)}</span>` : ""}</div>${hids.length ? `<button class="dots" data-act="dots" data-kind="row" data-hid="${hids.join(",")}" aria-label="Options">⋯</button>` : ""}</li>`;
}
const deNom = n => /^[aeiouyéèêh]/i.test(n || "") ? `d'${n}` : `de ${n}`;
let JOPEN = false; const HISTC = {};
document.addEventListener("toggle", e => { if (e.target.matches && e.target.matches("details.journal")) JOPEN = e.target.open; }, true);
async function loadHist(id) {
  const ul = $("#hist"); if (!ul) return;
  if (!supa || !navigator.onLine) { if (!HISTC[id]) ul.innerHTML = `<li>Visible quand il y a du réseau.</li>`; return; }
  const { data, error } = await supa.from("historique").select("*").eq("machine_id", id).neq("champ", "evenement").order("at", { ascending: false }).order("id", { ascending: false }).limit(80);
  if (error) { const u = $("#hist"); if (u && !HISTC[id]) u.innerHTML = `<li>Journal indisponible pour le moment.</li>`; return; }
  (data || []).forEach(h => { if (h.annule) ANN[h.annule] = { par: h.par, at: h.at }; });
  HISTC[id] = (data || []).length ? groupRows(data).map(g => histLi(g, false)).join("") : `<li>Aucun changement pour l'instant.</li>`;
  const u2 = $("#hist"); if (u2 && u2.dataset.id === id) u2.innerHTML = HISTC[id];
}

/* ---------- annuler des modifs (chefs) ---------- */
const mname = id => { const m = S.machines[id]; return m ? disp(m) : id; };
function undoTxt(h) {
  if (h.champ === "creation") return "la machine ajoutée sera rangée dans « Retirées »";
  if (h.champ === "evenement") { let e = {}; try { e = JSON.parse(h.nouveau); } catch (x) {} return `« ${esc(EVT[e.type] ? EVT[e.type].nom : "Événement")} » sera barré`; }
  const veh = isVeh(S.machines[h.machine_id]);
  return `${esc(CHAMPS[h.champ] || h.champ)} : ${esc(histVal(h.champ, h.nouveau, veh))} → <b>${esc(histVal(h.champ, h.ancien, veh))}</b> (comme avant)`;
}
function listeTxt(x) {
  if (x.c === "creation") return `<b>${esc(mname(x.m))}</b> → rangée dans « Retirées »`;
  if (x.c === "evenement") return `<b>${esc(mname(x.m))}</b> « ${esc(EVT[x.type] ? EVT[x.type].nom : "Événement")} » → barré`;
  const veh = isVeh(S.machines[x.m]);
  return `<b>${esc(mname(x.m))}</b> ${esc(CHAMPS[x.c] || x.c)} : ${esc(histVal(x.c, x.de, veh))} → <b>${esc(histVal(x.c, x.vers, veh))}</b>`;
}
const gardeTxt = g => g.map(x => `<b>${esc(mname(x.m))}</b> (${esc(CHAMPS[x.c] || x.c)}${x.par ? ` : ${esc(x.par)} est passé derrière` : ""})`).join(", ");
async function undoBlocked() {
  if (Q.length && navigator.onLine) await flush();
  if (!navigator.onLine) return "Il faut du réseau pour annuler une modif.";
  if (DRAFT && Object.keys(DRAFT.v).length && S.machines[DRAFT.id]) return `Termine d'abord les corrections de la fiche ${disp(S.machines[DRAFT.id])} (Enregistrer ou Annuler) pour pouvoir annuler une modif.`;
  if (Q.length) return "Des modifs attendent encore d'être envoyées. Attends qu'elles soient parties (barre du bas) pour pouvoir annuler.";
  return "";
}
function afterUndo(d) {
  setTimeout(async () => {
    if (d.garde && d.garde.length) infoModal(d.fait ? "C'est fait, sauf…" : "Rien n'a été annulé",
      `<p class="mq">${d.garde.length > 1 ? `${d.garde.length} modifs gardées` : "Modif gardée"} car changée${d.garde.length > 1 ? "s" : ""} ensuite : ${gardeTxt(d.garde)}.</p><p class="muted">On ne touche pas à ce qui a été fait après.</p>`);
    Object.keys(HISTC).forEach(k => delete HISTC[k]);
    await refresh(); softRender();
    const r = parseRoute(); if (r.parts[0] === "machine") loadHist(r.parts[1]); if (r.parts[0] === "activite") loadActivite(true);
  }, 30);
}
async function askUndoOne(hids) {
  const rows = hids.map(i => HROWS[i]).filter(Boolean); if (!rows.length) return;
  const b = await undoBlocked(); if (b) return infoModal("Pas tout de suite", `<p class="mq">${esc(b)}</p>`);
  const h = rows[0], qui = nomDe(h.par) || h._auteur || "";
  openModal({ title: "Annuler cette modif ?", center: true, ok: "Oui, annuler la modif", okColor: "#c62828", cancel: "Non, garder",
    html: `<p class="mq">Es-tu sûr de vouloir annuler cette modification ?</p><div class="box2"><b>${esc(mname(h.machine_id))}</b>${rows.map(r => `<div style="margin-top:4px">${undoTxt(r)}</div>`).join("")}</div>
      <p class="muted">Modif faite${qui ? ` par ${esc(qui)}` : ""} le ${dateHeure(h.at)}. L'annulation sera notée dans l'historique.</p>`,
    onOk: async () => {
      const { data, error } = await supa.rpc("annuler", { p_ids: rows.map(r => r.id) });
      if (error || !data) { $("#m-msg").innerHTML = `<div class="msg err">${isNetErr(error) ? "Pas de réseau : réessaie dans un instant." : "Le serveur a refusé (" + esc(error && error.message) + ")."}</div>`; return false; }
      afterUndo(data); return true;
    } });
}
async function askUndoAll() {
  const b = await undoBlocked(); if (b) return infoModal("Pas tout de suite", `<p class="mq">${esc(b)}</p>`);
  const f = actFilter(), qui = f.par ? nomDe(f.par) : "";
  const { data, error } = await supa.rpc("annuler", { p_par: f.par, p_depuis: f.depuis, p_essai: true });
  if (error || !data) return infoModal("Impossible pour le moment", `<p class="mq">${isNetErr(error) ? "Pas de réseau : réessaie dans un instant." : esc(error && error.message)}</p>`);
  if (!data.fait) return infoModal("Rien à annuler", `<p class="mq">Aucune modif annulable${qui ? ` ${esc(deNom(qui))}` : ""} sur cette période.</p>${data.garde.length ? `<p class="muted">Gardées car changées ensuite : ${gardeTxt(data.garde)}.</p>` : ""}`);
  const L = data.liste;
  openModal({ title: "Tout annuler ?", center: true, ok: "Oui, tout remettre comme avant", okColor: "#c62828", cancel: "Non, garder",
    html: `<p class="mq">Es-tu sûr de vouloir annuler <b>tout ce ${qui ? `qu${/^[aeiouyéèêh]/i.test(qui) ? "'" : "e "}${esc(qui)} a fait` : "qui a été fait"}</b> (${esc(f.label)}) ? Ça touche <b>${data.machines} machine${data.machines > 1 ? "s" : ""}</b> :</p>
      <ul class="hist" style="font-size:14px">${L.slice(0, 5).map(x => `<li>${listeTxt(x)}</li>`).join("")}${L.length > 5 ? `<li class="muted">… et ${L.length - 5} autre${L.length - 5 > 1 ? "s" : ""}</li>` : ""}</ul>
      ${data.garde.length ? `<div class="warnbox">⚠️ <b>${data.garde.length} modif${data.garde.length > 1 ? "s" : ""} gardée${data.garde.length > 1 ? "s" : ""}</b> : ${gardeTxt(data.garde)}.</div>` : ""}
      <p class="muted">L'annulation sera notée dans l'historique.</p>`,
    onOk: async () => {
      const r2 = await supa.rpc("annuler", { p_par: f.par, p_depuis: f.depuis, p_essai: false });
      if (r2.error || !r2.data) { $("#m-msg").innerHTML = `<div class="msg err">${isNetErr(r2.error) ? "Pas de réseau : réessaie dans un instant." : "Le serveur a refusé (" + esc(r2.error && r2.error.message) + ")."}</div>`; return false; }
      afterUndo(r2.data); return true;
    } });
}

/* ---------- écran Activité (chefs) ---------- */
const ACT = { key: "", rows: [], more: false, tok: 0 };
function actFilter() {
  const q = parseRoute().q, par = q.get("par") || "", p = q.get("p") || "jour", dq = q.get("d") || "";
  const now = new Date(); let d = new Date(now);
  if (p === "1h") d = new Date(now.getTime() - 36e5);
  else if (p === "hier") { d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1); }
  else if (p === "date" && dq && !isNaN(Date.parse(dq))) d = new Date(dq);
  else d.setHours(0, 0, 0, 0);
  const label = p === "1h" ? "la dernière heure" : p === "hier" ? "depuis hier" : p === "date" ? `depuis le ${d.toLocaleDateString("fr-FR")} à ${hhmm(d)}` : "aujourd'hui";
  return { par: par || null, p, d: dq, depuis: d.toISOString(), label, key: `${par}|${p}|${dq}` };
}
function actLink(par, p, d) {
  const u = new URLSearchParams(); if (par) u.set("par", par); if (p && p !== "jour") u.set("p", p); if (p === "date" && d) u.set("d", d);
  const s = u.toString(); return `#/activite${s ? "?" + s : ""}`;
}
function actRowsHTML() {
  if (!ACT.rows.length) return `<p class="muted">Aucune modif sur cette période.</p>`;
  const G = groupRows(ACT.rows), n = G.length, nm = new Set(ACT.rows.map(h => h.machine_id)).size;
  return `<div class="sh"><h3>${n}${ACT.more ? "+" : ""} modif${n > 1 ? "s" : ""} · ${nm} machine${nm > 1 ? "s" : ""}</h3>${isChef() ? `<button class="dots" data-act="dots" data-kind="all" aria-label="Options">⋯</button>` : ""}</div>
    <ul class="hist">${G.map(g => histLi(g, true)).join("")}</ul>${ACT.more ? `<button class="btn light more" data-act="act-more">Voir plus</button>` : ""}`;
}
function viewActivite() {
  if (!isChef()) return viewHome();
  const f = actFilter();
  const people = Object.entries(S.membres).sort((a, b) => (b[1].role === "chef") - (a[1].role === "chef") || natural(a[1].nom || "", b[1].nom || ""));
  const chip = (on, h, txt) => `<button class="chip ${on ? "on" : ""}" data-act="act-f" data-h="${esc(h)}">${txt}</button>`;
  return header("Activité", "Qui a fait quoi", { right: `<button class="smallbtn" data-act="go" data-h="#/acces">👥 Accès</button>` }) + `<main>
    <div class="sect"><h3>Qui ?</h3><div class="chips">${chip(!f.par, actLink("", f.p, f.d), "Tout le monde")}${people.map(([uid, m]) => chip(f.par === uid, actLink(uid, f.p, f.d), esc(m.nom || "Sans prénom"))).join("")}</div>
      <h3>Depuis quand ?</h3><div class="chips" style="padding-bottom:2px">${chip(f.p === "1h", actLink(f.par, "1h"), "1 heure")}${chip(f.p === "jour", actLink(f.par, "jour"), "Aujourd'hui")}${chip(f.p === "hier", actLink(f.par, "hier"), "Depuis hier")}
      <button class="chip ${f.p === "date" ? "on" : ""}" data-act="act-date">📅 ${f.p === "date" ? esc(f.label.replace("depuis le ", "")) : "Choisir…"}</button></div></div>
    <div class="sect" id="act-list">${ACT.key === f.key ? actRowsHTML() : `<p class="muted">Chargement…</p>`}</div></main>`;
}
async function loadActivite(reset) {
  const f = actFilter(), tok = ++ACT.tok;
  const box0 = $("#act-list");
  if (!supa || !navigator.onLine) { if (box0 && ACT.key !== f.key) box0.innerHTML = `<p class="muted">Visible quand il y a du réseau.</p>`; return; }
  const from = reset || ACT.key !== f.key ? 0 : ACT.rows.length;
  let q = supa.from("historique").select("*").gte("at", f.depuis); if (f.par) q = q.eq("par", f.par);
  const { data, error } = await q.order("at", { ascending: false }).order("id", { ascending: false }).range(from, from + 199);
  let an = []; try { an = await fetchAll("historique", "id", x => x.gte("at", f.depuis).not("annule", "is", null)); } catch (e) {}
  if (tok !== ACT.tok) return;
  if (error) { const b = $("#act-list"); if (b) b.innerHTML = `<p class="muted">Activité indisponible pour le moment.</p>`; return; }
  an.forEach(h => ANN[h.annule] = { par: h.par, at: h.at });
  ACT.rows = from ? ACT.rows.concat(data || []) : (data || []); ACT.key = f.key; ACT.more = (data || []).length === 200;
  const b = $("#act-list"); if (b && parseRoute().parts[0] === "activite") b.innerHTML = actRowsHTML();
}

/* ---------- écran Accès à l'appli (chefs) ---------- */
let ACC = null;
function viewAcces() {
  if (!isChef()) return viewHome();
  return header("Accès à l'appli", "Cyril et Nico seulement") + `<main><div class="sect"><h3>Comptes</h3><div id="acc-list">${ACC ? accHTML() : `<p class="muted">Chargement…</p>`}</div></div>
    <div class="sect"><p class="muted" style="margin:0">Couper l'accès déconnecte la personne à la prochaine ouverture de l'appli. Rien n'est effacé, et on peut lui rendre l'accès.</p>
    <p class="muted" style="margin:8px 0 0">Un nouveau compte apparaît ici après sa première connexion, en Équipier.</p></div></main>`;
}
function accHTML() {
  if (!ACC.length) return `<p class="muted">Aucun compte.</p>`;
  return ACC.map(m => {
    const chef = m.role === "chef", pause = m.pause ? hhmm(new Date(m.pause)) : "";
    const badge = !m.actif ? `<span class="role off">Accès coupé</span>` : `<span class="role ${chef ? "chef" : "eq"}">${chef ? "Chef" : "Équipier"}</span>`;
    const info = chef ? "" : ` <span class="muted">· ${m.aujourdhui} modif${m.aujourdhui > 1 ? "s" : ""} aujourd'hui${pause ? ` · ⏸️ en pause jusqu'à ${pause}` : ""}</span>`;
    const right = chef ? (m.nom === "Cyril" ? `<span class="muted">Propriétaire</span>` : "")
      : `<button class="dots" data-act="dots" data-kind="acc" data-uid="${esc(m.id)}" data-actif="${m.actif ? 1 : 0}" data-pause="${esc(pause)}" aria-label="Options">⋯</button>`;
    return `<div class="acc"><div class="nm"><b>${esc(m.nom || "(sans prénom)")}</b><br>${badge}${info}</div>${right}</div>`;
  }).join("");
}
async function loadAcces() {
  const b0 = $("#acc-list");
  if (!supa || !navigator.onLine) { if (b0 && !ACC) b0.innerHTML = `<p class="muted">Visible quand il y a du réseau.</p>`; return; }
  const { data, error } = await supa.rpc("membres_liste");
  if (error || !data) { const b = $("#acc-list"); if (b && !ACC) b.innerHTML = `<p class="muted">Liste indisponible pour le moment.</p>`; return; }
  ACC = data; const b = $("#acc-list"); if (b) b.innerHTML = accHTML();
}
function askAcces(uid, action) {
  const m = (ACC || []).find(x => x.id === uid); if (!m) return;
  const T = {
    couper: { t: `Couper l'accès ${deNom(m.nom)} ?`, h: `Es-tu sûr de vouloir couper l'accès ${esc(deNom(m.nom))} ? ${esc(m.nom)} ne pourra plus rien voir ni modifier. Ses modifs passées restent dans l'historique.</p><p class="muted">Tu pourras lui rendre l'accès quand tu veux.`, ok: "Oui, couper", c: "#c62828" },
    rendre: { t: `Rendre l'accès à ${m.nom} ?`, h: `${esc(m.nom)} pourra de nouveau utiliser l'appli, en Équipier.`, ok: "Oui, rendre l'accès" },
    lever_pause: { t: `Lever la pause ${deNom(m.nom)} ?`, h: `Ses modifs en attente partiront tout de suite, et le compteur repart de zéro.`, ok: "Oui, lever la pause" },
  }[action];
  openModal({ title: esc(T.t), center: true, ok: T.ok, okColor: T.c, cancel: "Non, annuler", html: `<p class="mq">${T.h}</p>`,
    onOk: async () => {
      if (!navigator.onLine) { $("#m-msg").innerHTML = `<div class="msg err">Il faut du réseau pour ça.</div>`; return false; }
      const { data, error } = await supa.rpc("membre_action", { p_id: uid, p_action: action });
      if (error || !data) { $("#m-msg").innerHTML = `<div class="msg err">${isNetErr(error) ? "Pas de réseau : réessaie dans un instant." : "Refusé (" + esc(error && error.message) + ")."}</div>`; return false; }
      ACC = data; setTimeout(() => { const b = $("#acc-list"); if (b) b.innerHTML = accHTML(); }, 0); return true;
    } });
}

function viewAjout(fid) {
  const f = FAM[fid] || FAMILLES[0];
  const teamOpts = `<option value="">Dépôt</option>` + teamNums().map(n => `<option value="${n}">${esc(teamLabel(n))}</option>`).join("");
  return header(`Ajouter : ${f.un}`, "Nouvelle machine", { fam: f.id }) + `<main><div class="sect">
    <label class="f" for="a-num" style="margin-top:0">Numéro interne (ex. : ${({ tondeuse: "T14", debroussailleuse: "D08", souffleur: "S08", taillehaie: "TH08", tronconneuse: "TR11", autoportee: "A01", motoculteur: "MC01", scarificateur: "SC01", outillage: "OU01" })[f.id] || "X01"})</label><input class="inp" id="a-num" autocapitalize="characters" autocomplete="off">
    <label class="check"><input type="checkbox" id="a-nonum"><span><b>Sans numéro</b><br><span class="muted">Cet appareil n'a pas de numéro.</span></span></label>
    <label class="f" for="a-mod">Modèle (ex. : HRX 537)</label><input class="inp" id="a-mod" autocomplete="off">
    <label class="f" for="a-eq">Équipe</label><select class="inp" id="a-eq">${teamOpts}</select>
    <div id="a-msg"></div><div style="height:14px"></div>
    <button class="btn" data-act="save-add" data-fam="${f.id}">Ajouter la machine</button></div></main>`;
}

/* ---------- VÉHICULES ---------- */
const VAN = `<svg viewBox="0 0 64 64" fill="currentColor"><path d="M6 20a5 5 0 0 1 5-5h25a3 3 0 0 1 3 3v6h8.5a4 4 0 0 1 3.1 1.5l7.6 9.5a4 4 0 0 1 .8 2.4V44a3 3 0 0 1-3 3h-3a8 8 0 0 0-16 0H24a8 8 0 0 0-16 0H9a3 3 0 0 1-3-3zm35 9v8h14l-6.4-8z" fill-rule="evenodd"/><path fill-rule="evenodd" d="M10 48a6 6 0 1 0 12 0a6 6 0 1 0-12 0zm3.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM40 48a6 6 0 1 0 12 0a6 6 0 1 0-12 0zm3.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z"/></svg>`;
ICONS.vehicule = VAN;
const plaqueHTML = (m, big) => `<span class="plate ${big ? "big" : ""} ${m.plaque ? "" : "vide"}"><i>F</i><span>${esc(m.plaque || "plaque à compléter")}</span></span>`;
const vsc = id => `var(--s-${id})`;
function segHTML(on) {
  const n = alertes().length;
  return `<div class="seg"><button class="${on === "m" ? "on" : ""}" data-act="go-r" data-h="#/">🔧 Machines</button><button class="${on === "v" ? "on" : ""}" data-act="go-r" data-h="#/vehicules">🚐 Véhicules${n ? ` <span class="due late">${n}</span>` : ""}</button></div>`;
}
function alertBandHTML(detail) {
  const a = alertes(); if (!a.length) return "";
  const nv = new Set(a.map(x => x.m.id)).size;
  const txt = a.slice(0, 2).map(x => `${x.k === "ct" ? "CT" : x.k === "pol" ? "pollution" : "révision"} de ${esc(disp(x.m))} ${x.niveau === "late" ? "dépassé" : `dans ${x.jours} j`}`).join(" · ");
  return `<a class="alertband" href="#/vehicules"><span class="ab-ic">⚠️</span><div><b>${detail ? `${a.length} rendez-vous à prendre` : `${nv} véhicule${nv > 1 ? "s" : ""} : rendez-vous à prendre`}</b><br>${detail ? "Touche un véhicule pour voir le détail" : txt}${!detail && a.length > 2 ? "…" : ""}</div></a>`;
}
function vcardHTML(m) {
  const ech = echeances(m), st = VST[m.statut] ? m.statut : "operationnelle", court = x => x.k === "ct" ? "CT" : x.k === "pol" ? "pollution" : "révision";
  const bad = ech.filter(x => x.niveau === "warn" || x.niveau === "late"), vide = ech.filter(x => x.niveau === "vide");
  const dues = bad.map(x => `<span class="due ${x.niveau}">${court(x).replace(/^./, c => c.toUpperCase())} : ${esc(echTxt(x))}</span>`).join("")
    + (vide.length ? `<span class="due vide">📅 À remplir : ${vide.map(court).join(", ")}</span>` : "")
    || `<span class="due ok">Tout est à jour</span>`;
  return `<a class="vcard ${m.actif === false ? "off" : ""}" href="#/machine/${encodeURIComponent(m.id)}" style="--c:${vsc(st)}"><span class="vi">${VAN}</span>
    <span class="vt">${plaqueHTML(m)}<small><b>${esc(m.modele || "")}</b> · ${esc(teamLabel(m.equipe))}</small><span class="dues">${dues}</span></span><span class="pill">${esc(VST[st].nom)}</span></a>`;
}
function viewVehicules() {
  const all = vehicules().sort((a, b) => vprio(a) - vprio(b) || natural(a.modele || "", b.modele || ""));
  const off = Object.values(S.machines).filter(m => isVeh(m) && m.actif === false);
  const c = {}; VSTATUTS.forEach(s => c[s.id] = 0); all.forEach(m => c[VST[m.statut] ? m.statut : "operationnelle"]++);
  const cell = (id, big) => `<div class="sum ${big ? "big" : ""} ${c[id] ? "" : "zero"}" style="--c:${vsc(id)}"><b>${c[id]}</b><span>${esc(VST[id].nom)}</span></div>`;
  return header("ASDJ - Tools", "Au service des jardins", { home: true, right: GEAR() }) + `<main>
    ${segHTML("v")}${alertBandHTML(true)}
    <div class="summary vsumm"><div class="sumrow two">${cell("probleme", 1)}${cell("reparation", 1)}</div>
    <div class="sumrow three">${cell("operationnelle")}${cell("disponible")}${cell("revision")}</div>${c.hs ? `<div class="sumrow">${cell("hs")}</div>` : ""}</div>
    <div class="vlist">${all.map(vcardHTML).join("") || `<div class="empty">Aucun véhicule.</div>`}</div>
    <div class="addbar"><button class="btn light" data-act="add" data-fam="vehicule">+ Ajouter un véhicule</button></div>
    ${off.length ? `<details class="sect"><summary><h3 style="display:inline">Véhicules retirés (${off.length})</h3></summary><div class="vlist">${off.map(vcardHTML).join("")}</div></details>` : ""}
    </main>`;
}
function viewVehicule(m) {
  const id = m.id, st = VST[m.statut] ? m.statut : "operationnelle", eq = dv(m, "equipe");
  const teamOpts = `<option value="">Dépôt</option>` + teamNums().map(n => `<option value="${n}" ${eq === n ? "selected" : ""}>${esc(teamLabel(n))}</option>`).join("");
  const inp = (fld, label, type = "text", ph = "", list = "", dis = false) => `<label class="f" for="f-${fld}">${label}</label><input class="inp" id="f-${fld}" ${type !== "text" ? `type="${type}"` : ""} ${type === "number" ? `inputmode="numeric" min="0"` : ""} ${list ? `list="${list}"` : ""} data-field="${fld}" value="${esc(dv(m, fld) ?? "")}" placeholder="${esc(ph)}" ${dis ? "disabled" : ""}>`;
  const sel = (fld, label, opts) => `<label class="f" for="f-${fld}">${label}</label><select class="inp" id="f-${fld}" data-field="${fld}" ${isChef() ? "" : "disabled"}>${opts.map(([v, t]) => `<option value="${v}" ${String(dv(m, fld) ?? "") === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const dirty = DRAFT && DRAFT.id === id && Object.keys(DRAFT.v).length;
  const otherDraft = DRAFT && DRAFT.id !== id && Object.keys(DRAFT.v).length && S.machines[DRAFT.id];
  const ech = echeances(m);
  const fait = x => m[x.le] ? `<p>${x.k === "rev" ? "Faite" : "Fait"} le ${frDate(m[x.le])}${x.k === "rev" && m.rev_km ? ` à ${Number(m.rev_km).toLocaleString("fr-FR")} km` : ""}</p>` : "";
  const choix = m.rev_choix ? `<p class="muted">Choix de ${esc(m.rev_choix)}.</p>` : "";
  const report = x => !(x.niveau === "warn" || x.niveau === "late" || x.mode) ? ""
    : x.k === "rev" ? `<button class="btn light" style="margin-top:8px" data-act="rev-report">⏳ Pas tout de suite : rendez-vous ou kilométrage</button>`
    : `<button class="btn light" style="margin-top:8px" data-act="rev-choix" data-c="rdv" data-k="${x.k}" data-id="${esc(id)}">📅 ${x.mode === "rdv" ? "Changer le rendez-vous" : "Rendez-vous pris (noter la date)"}</button>`;
  const echRow = x => `<div class="echrow ${["ok", "apres"].includes(x.niveau) ? "" : x.niveau}"><h4>${esc(x.nom)} <span class="due ${x.niveau === "apres" ? "ok" : x.niveau}">${esc(echTxt(x))}</span></h4>
      ${x.mode === "km" ? `${fait(x)}<p>Prévue à <b>${kmf(m.rev_cible_km)}</b> · compteur : ${m.km ? kmf(m.km) : "?"}${m.km_le ? ` (relevé le ${frDate(m.km_le)})` : ""}</p>${choix}`
        : x.mode === "rdv" ? `${fait(x)}<p>Rendez-vous le <b>${frDate(x.rdv)}</b>${x.lieu ? ` · ${esc(x.lieu)}` : ""}</p>${x.rdvj === 0 ? `<p><b>C'est aujourd'hui.</b></p>` : x.rdvj < 0 ? `<p><b>Le rendez-vous est passé : ${x.k === "rev" ? "la révision a-t-elle été faite" : "le contrôle a-t-il été fait"} ?</b></p>` : ""}${x.k === "rev" ? choix : ""}`
        : x.niveau === "vide" ? `<p>Pas encore de date : indique quand ${x.k === "rev" ? "la dernière a été faite" : "le dernier a été fait"}.</p>`
        : x.niveau === "apres" ? `${fait(x)}<p>${m.pol_le ? "Déjà fait depuis le dernier contrôle technique : le prochain se fera après le CT." : "À faire 1 an après le premier contrôle technique."}</p>`
        : `${fait(x)}<p>${x.k === "rev" ? "Prochaine" : "Prochain"} avant le <b>${frDate(x.due)}</b>${x.avant ? " <span class='muted'>(date notée)</span>" : ` · délai ${esc(DELAIS[m[x.mois]] || `${m[x.mois]} mois`)}`}</p>`}
      <div class="row2"><button class="btn light" data-act="ech" data-k="${x.k}" data-d="auj">✅ ${x.k === "rev" ? "Faite" : "Fait"} aujourd'hui</button><button class="btn light" data-act="ech" data-k="${x.k}" data-d="autre">📅 Autre date</button></div>${report(x)}</div>`;
  return header(disp(m), m.plaque ? m.modele : "Véhicule", { fam: "vehicule" }) + `<main>
    ${otherDraft ? `<a class="draftwarn" href="#/machine/${encodeURIComponent(DRAFT.id)}">⚠️ Corrections non enregistrées sur <b>${esc(disp(otherDraft))}</b> : touche ici pour les valider.</a>` : ""}
    <div class="hero" style="--c:${vsc(st)}"><span class="fam">${VAN}</span>
      <div class="id">${plaqueHTML(m, true)}</div><div class="mod" style="margin-top:8px">${esc(m.modele || "")}${m.type_vehicule ? ` · ${esc(VTYPES[m.type_vehicule] || m.type_vehicule)}` : ""}</div>
      <div class="st">${esc(VST[st].nom)}</div><div class="since">${esc(m.lieu === "reparateur" ? `Au garage${m.reparateur ? ` : ${m.reparateur}` : ""}` : teamLabel(m.equipe))}${m.depuis ? ` · ${esc(sinceTxt(m.depuis))}` : ""}</div>
      ${m.motif && ["probleme", "reparation", "hs", "revision"].includes(st) ? `<div class="since">${m.probleme_type && st === "probleme" ? `${esc(m.probleme_type)} : ` : ""}« ${esc(m.motif)} »</div>` : ""}</div>

    <div class="sect"><h3>Échéances</h3><div class="ech">${ech.map(echRow).join("") || `<p class="muted">Aucune échéance suivie.</p>`}</div></div>

    <div class="sect"><h3>Kilométrage</h3>${m.km != null && m.km !== "" ? `<span class="km">${Number(m.km).toLocaleString("fr-FR")} km</span> <span class="muted">${m.km_le ? `relevé le ${frDate(m.km_le)}` : ""}</span>` : `<p class="muted" style="margin:0">Pas encore relevé.</p>`}
      <div style="height:8px"></div><button class="btn light" data-act="km">Mettre à jour le kilométrage</button></div>

    <div class="sect"><h3>Changer l'état</h3><div class="stgrid">
      ${VSTATUTS.map(s => `<button class="stbtn ${st === s.id ? "on" : ""}" style="--c:${vsc(s.id)}" data-act="statut" data-v="${s.id}">${esc(s.nom)}</button>`).join("")}
    </div><div class="stfoot"><span class="muted">Une confirmation est demandée à chaque changement.</span></div></div>

    <div class="sect"><h3>Photo</h3><div class="photo" id="photo-box" data-main="${esc(id)}">${m.photo || pendingPhoto(m.id, "main") ? "Chargement de la photo…" : "Pas encore de photo"}</div>
      <div class="pickrow"><label class="btn light">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" id="photo-cam" hidden></label>
      <label class="btn light">🖼️ Galerie<input type="file" accept="image/*" id="photo-input" hidden></label></div></div>

    <div class="sect"><h3>Historique : problèmes, réparations, contrôles</h3>${eventsHTML(id)}</div>

    <div class="sect ${dirty ? "dirty" : ""}"><h3>Infos du véhicule</h3><p class="muted" style="margin:0 0 4px">Pour corriger une erreur de saisie. Rien n'est changé tant que tu n'as pas appuyé sur « Enregistrer ».</p>
      ${isChef() ? "" : `<div class="lock">🔒 Plaque, type et délais : réservé à Cyril et Nico</div>`}
      ${inp("plaque", "Plaque d'immatriculation", "text", "AB-123-CD", "", !isChef())}
      ${inp("modele", "Modèle")}
      ${sel("type_vehicule", "Type de véhicule", [["utilitaire", VTYPES.utilitaire], ["voiture", VTYPES.voiture]])}
      <label class="f" for="f-equipe">Équipe</label><select class="inp" id="f-equipe" data-field="equipe">${teamOpts}</select>
      <div class="two"><div>${sel("ct_mois", "CT tous les", [["24", "2 ans"], ["12", "1 an"]])}</div><div>${sel("pol_mois", "Pollution tous les", [["", "Non concerné"], ["12", "1 an"]])}</div></div>
      ${sel("rev_mois", "Révision tous les", [["12", "1 an"], ["6", "6 mois"], ["24", "2 ans"]])}
      ${inp("mise_circulation", "Mise en circulation", "date")}
      <p class="muted" style="margin:10px 0 0">Prochaines dates « avant le » (carte grise, carnet) : à remplir seulement si on les connaît.</p>
      <div class="two"><div>${inp("ct_avant", "Prochain CT avant le", "date")}</div><div>${+dv(m, "pol_mois") > 0 ? inp("pol_avant", "Pollution avant le", "date") : ""}</div></div>
      ${inp("rev_avant", "Prochaine révision avant le", "date")}
      ${inp("reparateur", "Garage", "text", "Nom du garage")}
      <div class="two"><div>${inp("depose_par", "Déposé par", "text", "Nom", "noms")}</div><div>${inp("depose_le", "Déposé le", "date")}</div></div>
      <div class="two"><div>${inp("recupere_par", "Récupéré par", "text", "Nom", "noms")}</div><div>${inp("recupere_le", "Récupéré le", "date")}</div></div>
      ${inp("depuis", "Dans cet état depuis le", "date")}
      <label class="f" for="f-motif">Problème / raison</label><textarea class="inp" id="f-motif" data-field="motif">${esc(dv(m, "motif"))}</textarea>
      <label class="f" for="f-notes">Notes</label><textarea class="inp" id="f-notes" data-field="notes">${esc(dv(m, "notes"))}</textarea>
      <datalist id="noms">${NOMS().map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    </div>

    <details class="sect journal" ${JOPEN ? "open" : ""}><summary><h3 style="display:inline">Journal de toutes les modifications</h3></summary><ul class="hist" id="hist" data-id="${esc(id)}">${HISTC[id] || "<li>Chargement…</li>"}</ul></details>

    ${isChef() ? `<button class="btn ${m.actif === false ? "light" : "danger"}" data-act="actif">${m.actif === false ? "Remettre dans le parc" : "Retirer du parc (vendu, détruit…)"}</button>`
      : `<button class="btn dis" disabled>🔒 ${m.actif === false ? "Remettre dans le parc" : "Retirer du parc"} : réservé à Cyril et Nico</button>`}
  </main>
  <div class="savebar ${dirty ? "" : "hidden"}" id="savebar"><span>Modifications non enregistrées</span><button class="btn light" data-act="draft-cancel">Annuler</button><button class="btn" data-act="draft-save">💾 Enregistrer</button></div>`;
}
function viewAjoutV() {
  const teamOpts = `<option value="">Dépôt</option>` + teamNums().map(n => `<option value="${n}">${esc(teamLabel(n))}</option>`).join("");
  return header("Ajouter un véhicule", "Nouveau véhicule", { fam: "vehicule" }) + `<main><div class="sect">
    <label class="f" for="a-plaque" style="margin-top:0">Plaque (ex. : AB-123-CD) <span class="muted">— peut rester vide</span></label><input class="inp" id="a-plaque" autocapitalize="characters" autocomplete="off">
    <label class="f" for="a-mod">Modèle (ex. : Renault Master)</label><input class="inp" id="a-mod" autocomplete="off">
    <label class="f" for="a-type">Type</label><select class="inp" id="a-type"><option value="utilitaire">${VTYPES.utilitaire}</option><option value="voiture">${VTYPES.voiture}</option></select>
    <label class="f" for="a-eq">Équipe</label><select class="inp" id="a-eq">${teamOpts}</select>
    <div id="a-msg"></div><div style="height:14px"></div>
    <button class="btn" data-act="save-add-v">Ajouter le véhicule</button></div></main>`;
}
const fmtPlaque = v => { const x = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(x) ? `${x.slice(0, 2)}-${x.slice(2, 5)}-${x.slice(5)}` : String(v || "").toUpperCase().trim(); };
function nextVeh() { const max = Math.max(0, ...Object.keys(S.machines).map(k => (k.match(/^VH(\d+)$/) || [])[1]).filter(Boolean).map(Number)); return "VH" + String(max + 1).padStart(2, "0"); }

/* changer l'état d'un véhicule */
function askStatutV(id, v) {
  const m = S.machines[id], s = VST[v], cur = m.statut;
  if (v === cur) return;
  const leavingRep = cur === "reparation" && v !== "reparation";
  const nomsList = `<datalist id="m-noms">${NOMS().map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
  let html = `<p class="mq">Es-tu sûr que <b>${esc(disp(m))}</b> (${esc(m.modele)}) <b style="color:${vsc(v)}">${esc(s.q)}</b> ?</p>`;
  if (v === "probleme") html += `<label class="f">Genre de problème</label><div class="chips2" id="m-pbt">${PB_TYPES.map(t => `<button type="button" data-act="pbt" data-v="${esc(t)}">${esc(t)}</button>`).join("")}</div>
    <label class="f" for="m-motif">Ce qui s'est passé</label><textarea class="inp" id="m-motif" placeholder="Ex. : accroché un poteau en marche arrière…"></textarea>${photoField("Photo du problème")}`;
  if (v === "hs" || v === "revision") html += `<label class="f" for="m-motif">${v === "hs" ? "Pourquoi ?" : "Précision (facultatif)"}</label><textarea class="inp" id="m-motif">${esc(v === "hs" ? m.motif : "")}</textarea>`;
  if (v === "reparation") html += `<label class="f" for="m-rep">Quel garage ?</label><input class="inp" id="m-rep" value="${esc(m.reparateur)}" placeholder="Nom du garage">
    <div class="two"><div><label class="f" for="m-dpar">Déposé par</label><input class="inp" id="m-dpar" list="m-noms" value="${esc(myName())}"></div><div><label class="f" for="m-dle">Le</label><input class="inp" id="m-dle" type="date" value="${today()}"></div></div>
    <label class="f" for="m-motif">Pour quoi ?</label><textarea class="inp" id="m-motif">${esc(m.motif)}</textarea>${photoField("Photo")}${nomsList}`;
  if (leavingRep) html += `<div class="mnote">Il revient du garage ${esc(m.reparateur || "")}.</div><div class="two"><div><label class="f" for="m-rpar">Récupéré par</label><input class="inp" id="m-rpar" list="m-noms" value="${esc(myName())}"></div><div><label class="f" for="m-rle">Le</label><input class="inp" id="m-rle" type="date" value="${today()}"></div></div>${nomsList}`;
  openModal({
    title: `${esc(disp(m))} : ${esc(s.nom)}`, html, ok: `Oui, confirmer`, okColor: vsc(v),
    onOk: async () => {
      const ch = { statut: v, depuis: today() }, ev = {};
      if (v === "probleme") {
        const t = (MODAL.el.querySelector("#m-pbt .on") || {}).dataset; const motif = mval("m-motif");
        if (!t && !motif) { $("#m-msg").innerHTML = `<div class="msg err">Choisis le genre de problème ou décris-le.</div>`; return false; }
        ch.probleme_type = t ? t.v : ""; ch.motif = motif; Object.assign(ev, { probleme_type: ch.probleme_type, motif });
      }
      if (v === "hs" || v === "revision") { ch.motif = mval("m-motif"); if (ch.motif) ev.motif = ch.motif; }
      if (v === "reparation") {
        Object.assign(ch, { lieu: "reparateur", reparateur: mval("m-rep"), depose_par: mval("m-dpar"), depose_le: mval("m-dle") || today(), recupere_par: "", recupere_le: null, motif: mval("m-motif") });
        Object.assign(ev, { reparateur: ch.reparateur, depose_par: ch.depose_par, depose_le: ch.depose_le, motif: ch.motif });
      } else if (m.lieu === "reparateur" || v === "disponible") ch.lieu = v === "disponible" ? "depot" : (m.equipe != null ? "equipe" : "depot");
      if (v === "operationnelle") { ch.motif = ""; ch.probleme_type = ""; }
      let retour = null;
      if (leavingRep) { ch.recupere_par = mval("m-rpar"); ch.recupere_le = mval("m-rle") || today(); retour = { reparateur: m.reparateur, recupere_par: ch.recupere_par, recupere_le: ch.recupere_le, duree: m.depose_le ? Math.max(0, Math.round((Date.parse(ch.recupere_le) - Date.parse(m.depose_le)) / 864e5)) : null }; }
      const file = MODAL && MODAL.el.__file;
      if (file) { try { ev.photo = await addPhoto(id, file, "ev"); } catch (e) {} }
      if (retour) addEvent(id, "retour", retour);
      if (["probleme", "reparation", "hs", "revision"].includes(v)) addEvent(id, v, ev);
      setFields(id, ch);
      return true;
    },
    onOpen: d => { d.querySelectorAll(".m-photo").forEach(i => i.addEventListener("change", () => { if (i.files[0]) { d.__file = i.files[0]; $("#m-photo-lbl").textContent = "✅ Photo ajoutée"; } })); },
  });
}
/* une échéance a été faite (CT, pollution, révision) */
function askEch(id, k, quand) {
  const m = S.machines[id], e = ECH.find(x => x.k === k); if (!m || !e) return;
  openModal({ title: `${esc(e.nom)} ${e.f} ?`, center: true, ok: "Oui, enregistrer",
    html: `<p class="mq">Es-tu sûr que ${k === "rev" ? "la révision / vidange" : `le ${e.nom.toLowerCase()}`} de <b>${esc(disp(m))}</b> a été ${e.f} ?</p>
      <label class="f" for="m-ed">Date</label><input class="inp" id="m-ed" type="date" value="${quand === "auj" ? today() : (m[e.le] || today())}" max="${today()}">
      <label class="f" for="m-ekm">Kilométrage ${k === "rev" ? "" : `<span class="muted">(facultatif)</span>`}</label><input class="inp" id="m-ekm" type="number" inputmode="numeric" min="0" placeholder="${m.km ? `dernier relevé : ${Number(m.km).toLocaleString("fr-FR")}` : "ex. 156500"}">
      <p class="muted" id="m-enext"></p>`,
    onOpen: d => { const upd = () => { const x = d.querySelector("#m-ed").value; d.querySelector("#m-enext").textContent = k === "pol" ? "Le prochain se fera avec le prochain contrôle technique." : x && +m[e.mois] ? `Prochain rappel : 2 semaines avant le ${frDate(isoOf(addMonths(x, +m[e.mois])))}.` : ""; }; d.querySelector("#m-ed").addEventListener("input", upd); upd(); if (quand !== "auj") setTimeout(() => d.querySelector("#m-ed").focus(), 50); },
    onOk: () => {
      const d = mval("m-ed"), km = mval("m-ekm");
      if (!d) { $("#m-msg").innerHTML = `<div class="msg err">Indique la date.</div>`; return false; }
      if (d > today()) { $("#m-msg").innerHTML = `<div class="msg err">La date ne peut pas être dans le futur.</div>`; return false; }
      if (k === "rev" && !km) { $("#m-msg").innerHTML = `<div class="msg err">Indique le kilométrage de la révision (il sert à calculer la prochaine).</div>`; return false; }
      if (km && !/^\d+$/.test(km)) { $("#m-msg").innerHTML = `<div class="msg err">Le kilométrage doit être un nombre.</div>`; return false; }
      const ch = { [e.le]: d };
      if (m[`${k}_avant`]) ch[`${k}_avant`] = null;
      if (m[`${k}_rdv`]) ch[`${k}_rdv`] = null;
      if (k !== "rev" && m[LIEU[k]]) ch[LIEU[k]] = "";
      if (k === "rev") { if (m.rev_mode) ch.rev_mode = ""; if (m.rev_cible_km) ch.rev_cible_km = null; if (m.rev_rdv) ch.rev_rdv = null; if (m.rev_garage) ch.rev_garage = ""; if (m.rev_choix) ch.rev_choix = ""; }
      if (k === "ct" && m.pol_avant) ch.pol_avant = null;      // nouveau CT : la pollution repart d'un an après
      if (km) { if (k === "rev") ch.rev_km = +km; if (!m.km_le || d >= m.km_le) { ch.km = +km; ch.km_le = d; } }
      if (k === "rev" && m.statut === "revision") { ch.statut = "operationnelle"; ch.depuis = today(); ch.motif = ""; }
      addEvent(id, k, { fait_le: d, km: km ? +km : null });
      setFields(id, ch); return true;
    } });
}
function askKm(id) {
  const m = S.machines[id];
  openModal({ title: "Kilométrage", center: true, ok: "Oui, enregistrer",
    html: `<p class="mq">Nouveau kilométrage de <b>${esc(disp(m))}</b> :</p><input class="inp" id="m-km" type="number" inputmode="numeric" min="0" placeholder="${m.km ? Number(m.km).toLocaleString("fr-FR") : "ex. 156500"}">
      <p class="muted">${m.km ? `Dernier relevé : ${Number(m.km).toLocaleString("fr-FR")} km${m.km_le ? ` le ${frDate(m.km_le)}` : ""}.` : ""}</p>`,
    onOpen: d => setTimeout(() => d.querySelector("#m-km").focus(), 50),
    onOk: () => {
      const v = mval("m-km");
      if (!/^\d+$/.test(v)) { $("#m-msg").innerHTML = `<div class="msg err">Écris le kilométrage en chiffres.</div>`; return false; }
      if (m.km && +v < +m.km && !MODAL.el.__okBas) { MODAL.el.__okBas = true; $("#m-msg").innerHTML = `<div class="msg err">C'est moins que le dernier relevé (${Number(m.km).toLocaleString("fr-FR")} km). Si c'est bien ça (erreur à corriger), appuie encore une fois sur « Oui, enregistrer ».</div>`; return false; }
      setFields(id, { km: +v, km_le: today() }); return true;
    } });
}
/* une ligne du pop-up d'alerte (la révision propose des choix) */
function popRow(x) {
  const m = x.m, lien = `href="#/machine/${encodeURIComponent(m.id)}" data-act="m-cancel" style="color:inherit;text-decoration:none"`;
  const det = x.mode === "km" ? `Prévue à <b>${kmf(m.rev_cible_km)}</b> · compteur : ${m.km ? kmf(m.km) : "?"}${m.km_le ? ` (relevé le ${frDate(m.km_le)})` : ""}`
    : x.mode === "rdv" ? (x.rdvj === 0 ? `Rendez-vous <b>aujourd'hui</b>${x.lieu ? ` · ${esc(x.lieu)}` : ""}.` : `Le rendez-vous était le <b>${frDate(x.rdv)}</b>. ${x.k === "rev" ? "La révision a-t-elle été faite" : "Le contrôle a-t-il été fait"} ?`)
    : `${m[x.le] ? `${x.k === "rev" ? "Faite" : "Fait"} le ${frDate(m[x.le])}${x.k === "rev" && m.rev_km ? ` à ${kmf(m.rev_km)}` : ""} · ` : ""}à refaire avant le <b>${frDate(x.due)}</b>`;
  const btns = x.k === "rev" ? `<p style="margin-top:8px"><b>Que veux-tu faire ?</b></p><div class="choix3">
      <button class="btn light" data-act="rev-choix" data-c="rdv" data-id="${esc(m.id)}">📅 La faire dès que possible (noter la date du RDV)</button>
      <button class="btn light" data-act="rev-choix" data-c="km" data-id="${esc(m.id)}">🛣️ Attendre un kilométrage</button>
      <button class="btn light" data-act="rev-choix" data-c="fait" data-id="${esc(m.id)}">✅ Elle est déjà faite</button></div>`
    : `<p style="margin-top:8px"><b>Que veux-tu faire ?</b></p><div class="choix3">
      <button class="btn light" data-act="rev-choix" data-c="rdv" data-k="${x.k}" data-id="${esc(m.id)}">📅 Rendez-vous pris (noter la date)</button>
      <button class="btn light" data-act="rev-choix" data-c="fait" data-k="${x.k}" data-id="${esc(m.id)}">✅ Il est déjà fait</button></div>`;
  return `<div class="echrow ${x.niveau}" style="margin-bottom:8px"><a ${lien}><h4>${esc(x.nom)} <span class="due ${x.niveau}">${esc(echTxt(x))}</span></h4>
    <p>${plaqueHTML(m)} ${esc(m.modele || "")}</p><p>${det}</p></a>${btns}</div>`;
}
/* kilométrage conseillé pour la prochaine révision : moyenne du véhicule */
function kmConseil(m, kmNow) {
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  let parAn = 0, base = "";
  if (m.rev_km && m.rev_le && kmNow > +m.rev_km && days(m.rev_le, today()) > 60) { parAn = (kmNow - m.rev_km) / days(m.rev_le, today()) * 365; base = `${kmf(kmNow - m.rev_km)} depuis la dernière révision`; }
  else if (m.mise_circulation && kmNow && days(m.mise_circulation, today()) > 180) { parAn = kmNow / days(m.mise_circulation, today()) * 365; base = `${kmf(kmNow)} depuis ${String(m.mise_circulation).slice(0, 4)}`; }
  if (!parAn) { parAn = 15000; base = "moyenne habituelle d'un utilitaire"; }
  parAn = Math.round(parAn / 100) * 100;
  const depart = +m.rev_km || kmNow || 0;
  let cible = Math.ceil((depart + parAn) / 1000) * 1000;
  if (kmNow && cible < kmNow + 1000) cible = Math.ceil((kmNow + 1000) / 1000) * 1000;
  return { parAn, base, cible, depart };
}
function askRevReport(id) {
  openModal({ title: "Révision : pas tout de suite", center: true, cancel: null, ok: "Fermer",
    html: `<p class="mq">Que veux-tu faire pour la révision de <b>${esc(disp(S.machines[id]))}</b> ?</p><div class="choix3">
      <button class="btn light" data-act="rev-choix" data-c="rdv" data-id="${esc(id)}">📅 La faire dès que possible (noter la date du RDV)</button>
      <button class="btn light" data-act="rev-choix" data-c="km" data-id="${esc(id)}">🛣️ Attendre un kilométrage</button></div>` });
}
function askRevChoix(id, c, k = "rev") {
  const m = S.machines[id]; if (!m) return;
  if (c === "fait") return askEch(id, k, "auj");
  const qui = `${myName() || "?"} le ${frDate(today())}`, e = ECH.find(x => x.k === k), rev = k === "rev";
  if (c === "rdv") return openModal({ title: rev ? "Révision dès que possible" : `${e.nom} : rendez-vous pris`, center: true, ok: "Oui, enregistrer",
    html: `<p class="mq">${esc(e.nom)} de <b>${esc(disp(m))}</b> : quand est le rendez-vous ?</p>
      <label class="f" for="m-rdv">Date du rendez-vous</label><input class="inp" id="m-rdv" type="date" min="${today()}" value="${m[`${k}_rdv`] && m[`${k}_rdv`] >= today() ? m[`${k}_rdv`] : ""}">
      <label class="f" for="m-rg">${rev ? "Garage" : "Centre de contrôle"} <span class="muted">(facultatif)</span></label><input class="inp" id="m-rg" value="${esc(m[LIEU[k]] || "")}" placeholder="${rev ? "Nom du garage" : "Ex. : Autosur, Dekra…"}">
      <p class="muted">Plus de rappel jusqu'au rendez-vous. Le matin du jour J, une notification le rappelle ; ensuite l'appli demande si c'est fait.</p>`,
    onOk: () => {
      const d = mval("m-rdv"), g = mval("m-rg");
      if (!d) { $("#m-msg").innerHTML = `<div class="msg err">Indique la date du rendez-vous.</div>`; return false; }
      if (d < today()) { $("#m-msg").innerHTML = `<div class="msg err">La date du rendez-vous est déjà passée.</div>`; return false; }
      addEvent(id, `${k}_rdv`, { rdv: d, garage: g });
      setFields(id, rev ? { rev_mode: "rdv", rev_rdv: d, rev_garage: g, rev_cible_km: null, rev_choix: qui } : { [`${k}_rdv`]: d, [LIEU[k]]: g }); return true;
    } });
  if (c === "km") return openModal({ title: "Attendre un kilométrage", center: true, ok: "Oui, enregistrer",
    html: `<p class="mq">Révision de <b>${esc(disp(m))}</b> : on attend un kilométrage.</p>
      <label class="f" for="m-kmnow">Kilométrage actuel du compteur</label><input class="inp" id="m-kmnow" type="number" inputmode="numeric" min="0" placeholder="ex. 151300">
      <p class="muted" style="margin:6px 0 0">${m.km ? `Dernier relevé : ${kmf(m.km)}${m.km_le ? ` le ${frDate(m.km_le)}` : ""}.` : "Pas encore de relevé."}</p>
      <label class="f" for="m-cible">Faire la révision à (km)</label><input class="inp" id="m-cible" type="number" inputmode="numeric" min="0">
      <div class="box2" id="m-calc" style="font-size:14px"></div>
      <p class="muted">L'alerte revient quand le compteur approche de ce kilométrage (à 1 000 km près). L'appli demande de relever le compteur une fois par mois.</p>`,
    onOpen: d => {
      const now = d.querySelector("#m-kmnow"), cib = d.querySelector("#m-cible"), calc = d.querySelector("#m-calc"); let touched = false;
      const upd = () => { const k = +now.value || +m.km || 0, c2 = kmConseil(m, k);
        calc.innerHTML = `💡 Calcul : ce véhicule roule environ <b>${kmf(c2.parAn)} par an</b> (${esc(c2.base)}).${c2.depart ? ` Révision faite à ${kmf(c2.depart)} →` : ""} la prochaine vers <b>${kmf(c2.cible)}</b>.`;
        if (!touched) cib.value = c2.cible; };
      now.addEventListener("input", upd); cib.addEventListener("input", () => touched = true); upd(); setTimeout(() => now.focus(), 50);
    },
    onOk: () => {
      const kn = mval("m-kmnow"), ci = mval("m-cible");
      if (!/^\d+$/.test(kn)) { $("#m-msg").innerHTML = `<div class="msg err">Écris le kilométrage actuel du compteur, en chiffres.</div>`; return false; }
      if (m.km && +kn < +m.km && !MODAL.el.__okBas) { MODAL.el.__okBas = true; $("#m-msg").innerHTML = `<div class="msg err">C'est moins que le dernier relevé (${kmf(m.km)}). Si c'est bien ça, appuie encore une fois sur « Oui, enregistrer ».</div>`; return false; }
      if (!/^\d+$/.test(ci) || +ci <= +kn) { $("#m-msg").innerHTML = `<div class="msg err">Le kilométrage de la révision doit être plus grand que le compteur actuel.</div>`; return false; }
      addEvent(id, "rev_attente", { cible_km: +ci, km: +kn });
      setFields(id, { km: +kn, km_le: today(), rev_mode: "km", rev_cible_km: +ci, rev_rdv: null, rev_garage: "", rev_choix: qui }); return true;
    } });
}
/* relevé du compteur une fois par mois (véhicules qui attendent un kilométrage) */
function maybeKmPopup() {
  if (!USER || MODAL || ROLE === "coupe") return;
  const key = `asdj_kmask_${USER.id}`; let vu = {}; try { vu = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
  const now = Date.now();
  const m = vehicules().find(v => v.rev_mode === "km" && (!v.km_le || (Date.parse(today()) - Date.parse(v.km_le)) / 864e5 > 30) && (!vu[v.id] || now - vu[v.id] > 48 * 3600e3));
  if (!m) return;
  vu[m.id] = now; try { localStorage.setItem(key, JSON.stringify(vu)); } catch (e) {}
  openModal({ title: "📟 Relevé du compteur", center: true, ok: "Enregistrer", cancel: "Plus tard",
    html: `<p class="mq">Le dernier relevé de <b>${esc(disp(m))}</b> date de plus d'un mois. Combien affiche le compteur ?</p><input class="inp" id="m-km" type="number" inputmode="numeric" min="0" placeholder="${m.km ? `dernier : ${Number(m.km).toLocaleString("fr-FR")}` : "ex. 152400"}">
      <p class="muted">Ça sert à savoir quand faire la révision (prévue à ${kmf(m.rev_cible_km)}).</p>`,
    onOk: () => {
      const v = mval("m-km");
      if (!/^\d+$/.test(v)) { $("#m-msg").innerHTML = `<div class="msg err">Écris le kilométrage en chiffres.</div>`; return false; }
      if (m.km && +v < +m.km && !MODAL.el.__okBas) { MODAL.el.__okBas = true; $("#m-msg").innerHTML = `<div class="msg err">C'est moins que le dernier relevé (${kmf(m.km)}). Si c'est bien ça, appuie encore une fois sur « Enregistrer ».</div>`; return false; }
      setFields(m.id, { km: +v, km_le: today() }); return true;
    } });
}
/* pop-up des rendez-vous à prendre : à l'ouverture, puis tous les 2 jours tant que ce n'est pas fait */
function maybeAlertPopup() {
  if (!USER || MODAL || ROLE === "coupe") return;
  const a = alertes(); if (!a.length) return maybeKmPopup();
  const key = `asdj_alertes_${USER.id}`; let vu = {}; try { vu = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
  const now = Date.now(), sig = x => `${x.m.id}|${x.k}|${x.due}`;
  if (!a.some(x => !vu[sig(x)] || now - vu[sig(x)] > 48 * 3600e3)) return maybeKmPopup();
  const nv = {}; a.forEach(x => nv[sig(x)] = now); try { localStorage.setItem(key, JSON.stringify(nv)); } catch (e) {}
  openModal({ title: "⚠️ Rendez-vous à prendre", center: true, cancel: null, ok: "Compris",
    html: a.slice(0, 6).map(popRow).join("")
      + (a.length > 6 ? `<p class="muted">… et ${a.length - 6} autre${a.length - 6 > 1 ? "s" : ""}.</p>` : "")
      + `<p class="muted" style="margin-top:6px">Ce rappel revient tous les 2 jours tant que la date n'est pas mise à jour.</p>` });
}

/* ---------- PARAMÈTRES (notifications, compte, réglages des chefs) ---------- */
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
function u8(b64) { const s = atob(String(b64).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(b64).length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function pushEtat() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIOS() && !standalone() ? "ios-ecran" : "nonsupporte";
  if (isIOS() && !standalone()) return "ios-ecran";
  if (Notification.permission === "denied") return "refuse";
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); return sub ? "actif" : "inactif"; } catch (e) { return "inactif"; }
}
function viewParametres() {
  const r = ROLE === "chef" ? "Chef" : "Équipier";
  return header("Paramètres", "Réglages de l'appli") + `<main>
    <div class="sect"><h3>🔔 Notifications sur ce téléphone</h3><div id="push-box"><p class="muted">Chargement…</p></div></div>
    <div class="sect"><h3>👤 Mon compte</h3><p class="mq" style="margin:0"><b>${esc(myName() || "Sans prénom")}</b> · <span class="role ${ROLE === "chef" ? "chef" : "eq"}">${r}</span></p>
      <p class="muted" style="margin:4px 0 10px">${esc((USER && USER.email) || "")}</p><button class="btn light" data-act="logout">Se déconnecter</button></div>
    ${isChef() ? `<div class="sect"><h3>🛡️ Réglages des chefs</h3><p class="muted" style="margin:0 0 8px">Visible seulement par Cyril et Nico.</p>
      <a class="setrow" href="#/activite"><span>📋</span><b>Activité et annulations</b><small>Qui a fait quoi, annuler une modif</small>${SVG.chev}</a>
      <a class="setrow" href="#/acces"><span>👥</span><b>Accès à l'appli</b><small>Les comptes, couper ou rendre un accès, lever une pause</small>${SVG.chev}</a></div>` : ""}
  </main>`;
}
async function loadParams() {
  const box = $("#push-box"); if (!box) return;
  const st = await pushEtat(), b = $("#push-box"); if (!b) return;
  const T = {
    actif: `<p class="mq">✅ <b>Activées</b> sur ce téléphone.</p><p class="muted">Tu reçois les rappels des véhicules vers 6 h 30 (et à midi si c'est urgent).</p><button class="btn light" data-act="push-off">Désactiver sur ce téléphone</button>`,
    inactif: `<p class="mq">Reçois les rappels des véhicules (CT, pollution, révision) même quand l'appli est fermée : vers 6 h 30, et aussi à midi quand c'est urgent.</p><button class="btn" data-act="push-on">🔔 Recevoir les alertes sur ce téléphone</button>`,
    refuse: `<p class="mq">⛔ Les notifications sont <b>bloquées</b> pour l'appli sur ce téléphone.</p><p class="muted">Pour les débloquer : réglages du téléphone → Notifications → ${isIOS() ? "ASDJ - Tools" : "Chrome → cyril77169.github.io"} → Autoriser. Puis reviens ici.</p>`,
    "ios-ecran": `<p class="mq">Sur iPhone, il faut d'abord <b>ajouter l'appli à l'écran d'accueil</b> : dans Safari, bouton Partager → « Sur l'écran d'accueil » → Ajouter.</p><p class="muted">Ensuite, ouvre l'appli avec la nouvelle icône et reviens ici.</p>`,
    nonsupporte: `<p class="muted">Ce téléphone ou ce navigateur ne sait pas recevoir de notifications. Sur Android, utilise Chrome ; sur iPhone, l'icône de l'écran d'accueil.</p>`,
  };
  b.innerHTML = T[st] || T.nonsupporte;
}
async function pushOn(btn) {
  const msg = t => { const b = $("#push-box"); if (b) b.insertAdjacentHTML("beforeend", `<div class="msg err" style="margin-top:8px">${t}</div>`); };
  if (!navigator.onLine) return msg("Il faut du réseau pour activer les notifications.");
  btn.disabled = true; btn.textContent = "Activation…";
  try {
    const { data: pub } = await supa.rpc("push_cle_publique");
    if (!pub) { btn.disabled = false; btn.textContent = "🔔 Recevoir les alertes sur ce téléphone"; return msg("Les notifications ne sont pas encore installées. Réessaie un peu plus tard."); }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { loadParams(); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(pub) });
    const j = sub.toJSON();
    const { error } = await supa.from("push_abonnements").insert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, appareil: isIOS() ? "iPhone" : (/android/i.test(navigator.userAgent) ? "Android" : "Autre") });
    if (error && error.code !== "23505") { await sub.unsubscribe().catch(() => {}); throw error; }
    loadParams();
  } catch (e) { btn.disabled = false; btn.textContent = "🔔 Recevoir les alertes sur ce téléphone"; msg(`Ça n'a pas marché (${esc(e && e.message || e)}). Réessaie.`); }
}
async function pushOff(btn) {
  btn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) { if (navigator.onLine) await supa.from("push_abonnements").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
  } catch (e) {}
  loadParams();
}

/* rendu principal (garde la position de défilement de chaque écran) */
let pendingRender = false, focusSearch = false;
function render(nav) {
  if (!USER) return;
  if (ROLE === "coupe") return viewCoupe();
  closePops();
  const r = parseRoute(); const [a, b] = r.parts;
  if (nav && DRAFT && !(a === "machine" && b === DRAFT.id)) { /* on garde le brouillon pour le retour sur la fiche */ }
  let html;
  if (!a) html = viewHome();
  else if (a === "famille") html = viewFamille(b, r.q);
  else if (a === "equipes") html = viewEquipes();
  else if (a === "equipe") html = viewEquipe(b, r.q);
  else if (a === "tout") html = viewTout(r.q);
  else if (a === "machine") html = isVeh(S.machines[b]) ? viewVehicule(S.machines[b]) : viewMachine(b);
  else if (a === "vehicules") html = viewVehicules();
  else if (a === "ajouter") html = b === "vehicule" ? viewAjoutV() : viewAjout(b);
  else if (a === "activite") html = viewActivite();
  else if (a === "acces") html = viewAcces();
  else if (a === "parametres") html = viewParametres();
  else html = viewHome();
  const y = nav ? (scrolls[r.key] || 0) : window.scrollY;
  $("#app").innerHTML = html;
  window.scrollTo(0, y);
  if (a === "machine") { loadHist(b); showPhotos(); }
  if (a === "activite" && isChef() && (nav || ACT.key !== actFilter().key)) loadActivite(true);
  if (a === "acces" && isChef() && nav) loadAcces();
  if (a === "parametres") loadParams();
  if (a === "equipe") showPhotos();
  if (a === "tout" && focusSearch) { focusSearch = false; const s = $("#search"); if (s) { s.focus(); const n = s.value.length; try { s.setSelectionRange(n, n); } catch (_) {} } }
  pendingRender = false;
}
/* nouvelles données : on rafraîchit sans déranger quelqu'un en train d'écrire ou de confirmer */
function softRender() {
  const ae = document.activeElement;
  if (MODAL || (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) { pendingRender = true; return; }
  render(false);
}

/* ---------- changement d'état : confirmation + sous-champs ---------- */
const photoField = (label) => `<label class="f">${label} <span class="muted">(facultatif)</span></label>
  <div class="pickrow"><label class="btn light">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" class="m-photo" hidden></label>
  <label class="btn light">🖼️ Galerie<input type="file" accept="image/*" class="m-photo" hidden></label></div><div class="muted" id="m-photo-lbl"></div>`;
function askStatut(id, v) {
  const m = S.machines[id], s = ST[v], cur = m.statut;
  if ((v === cur || v === eff(m)) && v !== "controle" && !(v === "operationnelle" && m.equipe == null)) return;
  const leavingRep = cur === "reparation" && v !== "reparation";
  const nomsList = `<datalist id="m-noms">${NOMS().map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
  let html = `<p class="mq">Es-tu sûr que <b>${esc(m.id)}</b> (${esc(m.modele)}) <b style="color:${sc(v)}">${esc(s.q)}</b> ?</p>`;
  if (v === "probleme" || v === "hs") html += `<label class="f" for="m-motif">Quel est le problème ?</label><textarea class="inp" id="m-motif" placeholder="Ex. : ne démarre plus, lame cassée…">${esc(m.motif)}</textarea>${photoField("Photo du problème")}`;
  if (v === "reparation") html += `<label class="f">Chez quel réparateur ?</label>${repPicker("m-rep", m.reparateur)}
    <div class="two"><div><label class="f" for="m-dpar">Déposée par</label><input class="inp" id="m-dpar" list="m-noms" value="${esc(myName())}"></div><div><label class="f" for="m-dle">Le</label><input class="inp" id="m-dle" type="date" value="${today()}"></div></div>
    <label class="f" for="m-motif">Pourquoi ?</label><textarea class="inp" id="m-motif">${esc(m.motif)}</textarea>${photoField("Photo des pièces confiées au réparateur")}${nomsList}`;
  if (leavingRep) html += `<div class="mnote">Elle revient de chez ${esc(m.reparateur || "le réparateur")}.</div><div class="two"><div><label class="f" for="m-rpar">Récupérée par</label><input class="inp" id="m-rpar" list="m-noms" value="${esc(myName())}"></div><div><label class="f" for="m-rle">Le</label><input class="inp" id="m-rle" type="date" value="${today()}"></div></div>${nomsList}`;
  if (v === "operationnelle") html += `<label class="f" for="m-eq">Attribuée à quelle équipe ?</label><select class="inp" id="m-eq"><option value="">— Choisir —</option>${teamNums().map(n => `<option value="${n}" ${m.equipe === n ? "selected" : ""}>${esc(teamLabel(n))}</option>`).join("")}</select>`;
  if (v === "disponible") html += `<div class="mnote">Elle sera notée <b>au dépôt</b>, libre pour une équipe (plus attribuée).</div>`;
  if (v === "controle") html += `<label class="f" for="m-cdate">Date du contrôle</label><input class="inp" id="m-cdate" type="date" value="${today()}">`;
  openModal({
    title: `${esc(m.id)} : ${esc(s.nom)}`, html, ok: `Oui, ${s.nom.toLowerCase()}`, okColor: sc(v),
    onOk: async () => {
      const ch = { statut: v }, ev = {};
      if (v !== cur) ch.depuis = today();
      if (v === "probleme" || v === "hs") { ch.motif = mval("m-motif"); ev.motif = ch.motif; }
      if (v === "reparation") {
        Object.assign(ch, { lieu: "reparateur", reparateur: mval("m-rep"), depose_par: mval("m-dpar"), depose_le: mval("m-dle") || today(), recupere_par: "", recupere_le: null, motif: mval("m-motif") });
        Object.assign(ev, { reparateur: ch.reparateur, depose_par: ch.depose_par, depose_le: ch.depose_le, motif: ch.motif });
      }
      if (v === "operationnelle") {
        const e = mval("m-eq"); if (!e) { $("#m-msg").innerHTML = `<div class="msg err">Choisis l'équipe à qui elle est attribuée.</div>`; return false; }
        ch.equipe = +e; ch.affectation = chef(+e); ch.lieu = "equipe";
      }
      if (v === "disponible") { ch.lieu = "depot"; ch.equipe = null; ch.affectation = ""; }
      if (v === "controle") { ch.controle = mval("m-cdate") || today(); if (m.lieu === "reparateur") ch.lieu = m.equipe != null ? "equipe" : "depot"; }
      if ((v === "probleme" || v === "hs") && m.lieu === "reparateur") ch.lieu = m.equipe != null ? "equipe" : "depot";
      let retour = null;
      if (leavingRep) {
        ch.recupere_par = mval("m-rpar"); ch.recupere_le = mval("m-rle") || today();
        retour = { reparateur: m.reparateur, recupere_par: ch.recupere_par, recupere_le: ch.recupere_le, duree: m.depose_le ? Math.max(0, Math.round((Date.parse(ch.recupere_le) - Date.parse(m.depose_le)) / 864e5)) : null };
      }
      const file = MODAL && MODAL.el.__file;
      if (file) { try { ev.photo = await addPhoto(id, file, "ev"); } catch (e) {} }
      if (retour) addEvent(id, "retour", retour);
      if (EVT[v]) addEvent(id, v, ev);
      setFields(id, ch);
      return true;
    },
    onOpen: d => { d.querySelectorAll(".m-photo").forEach(i => i.addEventListener("change", () => { if (i.files[0]) { d.__file = i.files[0]; $("#m-photo-lbl").textContent = "✅ Photo ajoutée"; } })); },
  });
}

/* ---------- prêt d'une machine (à n'importe qui) ---------- */
function askPret(id) {
  const m = S.machines[id], nomsList = `<datalist id="m-noms">${NOMS().map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
  if (m.lieu === "pret") {
    openModal({
      title: `${esc(m.id)} : rendue`, ok: "Oui, elle est rendue",
      html: `<p class="mq">Es-tu sûr que <b>${esc(m.id)}</b> a été rendue par <b>${esc(m.pret_a || "la personne")}</b> ?</p>
        <label class="f" for="m-back">Elle revient…</label><select class="inp" id="m-back">${m.equipe != null ? `<option value="equipe">à ${esc(teamLabel(m.equipe))}</option>` : ""}<option value="depot">au dépôt</option></select>`,
      onOk: () => {
        const back = mval("m-back") || "depot";
        addEvent(id, "rendu", { pret_a: m.pret_a, duree: m.pret_le ? daysSince(m.pret_le) : null });
        setFields(id, { lieu: back, depuis: today() }); return true;
      },
    });
    return;
  }
  openModal({
    title: `Prêter ${esc(m.id)}`, ok: "Oui, prêter",
    html: `<p class="mq">À qui prêtes-tu <b>${esc(m.id)}</b> (${esc(m.modele)}) ?</p>
      <label class="f" for="m-pa">Nom de la personne</label><input class="inp" id="m-pa" list="m-noms" placeholder="N'importe quel employé" autocomplete="off">
      <label class="f" for="m-ple">Le</label><input class="inp" id="m-ple" type="date" value="${today()}">${nomsList}`,
    onOk: () => {
      const a = mval("m-pa"); if (!a) { $("#m-msg").innerHTML = `<div class="msg err">Écris le nom de la personne.</div>`; return false; }
      const le = mval("m-ple") || today();
      addEvent(id, "pret", { pret_a: a, pret_le: le });
      setFields(id, { lieu: "pret", pret_a: a, pret_le: le, depuis: le }); return true;
    },
  });
}

/* ---------- actions ---------- */
document.addEventListener("click", async e => {
  if (!e.target.closest(".pop") && !e.target.closest("[data-act=dots]")) closePops();
  const t = e.target.closest("[data-act]"); if (!t) return;
  const act = t.dataset.act, r = parseRoute();
  if (act === "dots") {
    const was = t.classList.contains("on"); closePops(); if (was) return;
    const k = t.dataset.kind; let menu = "";
    if (k === "row") menu = `<button data-act="undo-one" data-hid="${esc(t.dataset.hid)}">↩️ Annuler cette modif</button>`;
    if (k === "all") { const f = actFilter(); menu = `<button data-act="undo-all">↩️ Tout annuler (${esc(f.par ? nomDe(f.par) : "tout le monde")}, ${esc(f.label)})</button>`; }
    if (k === "acc") menu = (t.dataset.actif === "1" ? `<button data-act="acc" data-a="couper" data-uid="${esc(t.dataset.uid)}">⛔ Couper l'accès</button>` : `<button class="n" data-act="acc" data-a="rendre" data-uid="${esc(t.dataset.uid)}">✅ Rendre l'accès</button>`)
      + (t.dataset.pause ? `<button class="n" data-act="acc" data-a="lever_pause" data-uid="${esc(t.dataset.uid)}">▶️ Lever la pause</button>` : "");
    t.classList.add("on"); const pop = document.createElement("div"); pop.className = "pop"; pop.innerHTML = menu; t.parentNode.appendChild(pop);
    return;
  }
  if (act === "undo-one") { closePops(); if (isChef()) askUndoOne(String(t.dataset.hid).split(",").map(Number)); return; }
  if (act === "undo-all") { closePops(); if (isChef()) askUndoAll(); return; }
  if (act === "acc") { closePops(); if (isChef()) askAcces(t.dataset.uid, t.dataset.a); return; }
  if (act === "go") return go(t.dataset.h);
  if (act === "go-r") return replaceTo(t.dataset.h);
  if (act === "push-on") return pushOn(t);
  if (act === "push-off") return pushOff(t);
  if (act === "pbt") { t.parentNode.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === t)); const mm = $("#m-msg"); if (mm) mm.innerHTML = ""; return; }
  if (act === "act-f") { replaceTo(t.dataset.h); return; }
  if (act === "act-more") { t.disabled = true; t.textContent = "Chargement…"; loadActivite(false); return; }
  if (act === "act-date") {
    const f = actFilter(), d = new Date(f.depuis), pad = n => String(n).padStart(2, "0");
    const v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    openModal({ title: "Depuis quand ?", center: true, ok: "Afficher", cancel: "Fermer", html: `<label class="f" for="m-dt">Date et heure</label><input class="inp" id="m-dt" type="datetime-local" value="${v}">`,
      onOk: () => { const x = mval("m-dt"); if (!x || isNaN(Date.parse(x))) { $("#m-msg").innerHTML = `<div class="msg err">Choisis une date et une heure.</div>`; return false; }
        setTimeout(() => replaceTo(actLink(f.par, "date", x)), 0); return true; } });
    return;
  }
  if (act === "m-cancel") return closeModal();
  if (act === "m-ok") {
    if (!MODAL) return; t.disabled = true;
    const ok = MODAL.onOk ? await MODAL.onOk() : true;
    t.disabled = false;
    if (ok !== false) { closeModal(true); render(false); }
    return;
  }
  if (act === "back") return back();
  if (act === "logout") {
    if (Q.length || PHOTOS_WAIT.length) { openModal({ title: "Pas encore", html: `<p class="mq">Des modifications ou des photos ne sont pas encore envoyées. Attends d'avoir du réseau avant de te déconnecter.</p>`, ok: "Compris", cancel: "Fermer" }); return; }
    openModal({ title: "Se déconnecter ?", html: `<p class="mq">Il faudra remettre ton e-mail et ton mot de passe pour revenir.</p>`, ok: "Oui, me déconnecter",
      onOk: async () => { await supa.auth.signOut(); location.replace("#/"); location.reload(); return true; } });
    return;
  }
  if (act === "sort") { famSort = t.dataset.v; render(false); return; }
  if (act === "add") return go(`#/ajouter/${t.dataset.fam}`);
  if (act === "zoom") { const url = await photoURL(t.dataset.key); if (url) openModal({ title: "Photo", html: `<img src="${url}" style="width:100%;border-radius:12px" alt="">`, ok: "Fermer", cancel: "Retour" }); return; }
  if ((act === "chef" || act === "team-add") && !isChef()) return;
  if (act === "chef" || act === "team-add") {
    const isNew = act === "team-add", n = isNew ? (Math.max(0, ...teamNums()) + 1) : +t.dataset.n;
    openModal({
      title: isNew ? "Nouvelle équipe" : `Équipe ${n}`,
      html: `${isNew ? `<label class="f" for="m-tn">Numéro de l'équipe</label><input class="inp" id="m-tn" type="number" min="1" value="${n}">` : ""}<label class="f" for="m-chef">Nom du chef d'équipe</label><input class="inp" id="m-chef" value="${esc(isNew ? "" : chef(n))}" autocomplete="off">`,
      ok: "💾 Enregistrer",
      onOk: () => {
        const num = isNew ? +mval("m-tn") : n, nom = mval("m-chef");
        if (!num || num < 1) { $("#m-msg").innerHTML = `<div class="msg err">Indique un numéro d'équipe.</div>`; return false; }
        if (isNew && S.equipes[num]) { $("#m-msg").innerHTML = `<div class="msg err">L'équipe ${num} existe déjà.</div>`; return false; }
        setChef(num, nom); return true;
      },
    });
    return;
  }
  const id = r.parts[0] === "machine" ? r.parts[1] : null;
  if (act === "rep-pick" || act === "rep-other") {
    const box = t.closest(".reps"), input = document.getElementById(box.dataset.for);
    box.querySelectorAll(".repc").forEach(b => b.classList.toggle("on", b === t));
    if (act === "rep-pick") { input.value = t.dataset.v; input.classList.add("hidden"); }
    else { input.value = ""; input.classList.remove("hidden"); input.focus(); }
    if (input.dataset.field && id) draftSet(id, "reparateur", input.value.trim());
    const mm = $("#m-msg"); if (mm) mm.innerHTML = "";
    return;
  }
  if (act === "statut" && id) return isVeh(S.machines[id]) ? askStatutV(id, t.dataset.v) : askStatut(id, t.dataset.v);
  if (act === "ech" && id) return askEch(id, t.dataset.k, t.dataset.d);
  if (act === "rev-report" && id) return askRevReport(id);
  if (act === "rev-choix") { const vid = t.dataset.id, c = t.dataset.c, k = t.dataset.k || "rev"; closeModal(true); setTimeout(() => askRevChoix(vid, c, k), 0); return; }
  if (act === "km" && id) return askKm(id);
  if (act === "pret" && id) return askPret(id);
  if (act === "lieu" && id) { draftSet(id, "lieu", t.dataset.v); render(false); return; }
  if (act === "draft-cancel") {
    openModal({ title: "Annuler les corrections ?", html: `<p class="mq">Les modifications non enregistrées de cette fiche seront perdues.</p>`, ok: "Oui, annuler", cancel: "Non, garder",
      onOk: () => { DRAFT = null; saveDraft(); return true; } });
    return;
  }
  if (act === "draft-save" && id && DRAFT && DRAFT.id === id) {
    const m = S.machines[id], v = DRAFT.v, list = Object.keys(v).map(k => `<li>${esc(CHAMPS[k] || k)} : ${esc(histVal(k, m[k] == null ? "" : String(m[k])))} → <b>${esc(histVal(k, v[k] == null ? "" : String(v[k])))}</b></li>`).join("");
    const warn = [];
    if ("_num" in v) warn.push(`Es-tu sûr de vouloir changer le numéro de <b>${esc(disp(m))}</b> en <b>${esc(v._num === "__SN__" ? "Sans numéro" : v._num)}</b> ?`);
    if ("plaque" in v) warn.push(`Es-tu sûr de vouloir changer la plaque <b>${esc(m.plaque || "(vide)")}</b> en <b>${esc(v.plaque || "(vide)")}</b> ?`);
    if ("famille" in v) warn.push(`Es-tu sûr de vouloir déplacer cette machine de <b>${esc(FAM[m.famille] ? FAM[m.famille].nom : m.famille)}</b> vers <b>${esc(FAM[v.famille] ? FAM[v.famille].nom : v.famille)}</b> ?`);
    openModal({ title: `Enregistrer ${esc(disp(m))} ?`, html: `${warn.map(w => `<div class="mwarn">⚠️ ${w}</div>`).join("")}<p class="mq">Tu vas modifier :</p><ul class="mlist">${list}</ul>`, ok: "💾 Oui, enregistrer",
      onOk: async () => {
        const ch = Object.assign({}, v); let target = id;
        if ("_num" in ch) {
          const err = t => { $("#m-msg").innerHTML = `<div class="msg err">${esc(t)}</div>`; return false; };
          const nn = ch._num === "__SN__" ? "SN-" + Date.now().toString(36).toUpperCase() : ch._num;
          if (!nn) return err("Indique le nouveau numéro, ou coche « Sans numéro ».");
          if (S.machines[nn]) return err(`Le numéro ${nn} existe déjà.`);
          if (!navigator.onLine) return err("Il faut du réseau pour changer le numéro. Le reste peut attendre : réessaie avec du réseau.");
          await flush();
          if (Q.some(o => o.id === id || (o.row && o.row.id === id) || (o.ev && o.ev.id === id))) return err("Des modifs de cette machine sont encore en attente d'envoi. Réessaie dans un instant.");
          const { data, error } = await supa.rpc("renommer_machine", { p_old: id, p_new: nn });
          if (error || !data) return err(isNetErr(error) ? "Pas de réseau : réessaie dans un instant." : "Le serveur a refusé ce numéro (" + (error && error.message) + ").");
          delete S.machines[id]; S.machines[data.id] = data; S.events.forEach(e => { if (e.id === id) e.id = data.id; });
          target = data.id; saveLocal(); delete ch._num;
        }
        if ("equipe" in ch) ch.affectation = ch.equipe != null ? chef(ch.equipe) : "";
        DRAFT = null; saveDraft();
        if (Object.keys(ch).length) setFields(target, ch);
        if (target !== id) setTimeout(() => replaceTo(`#/machine/${encodeURIComponent(target)}`), 0);
        return true;
      } });
    return;
  }
  if (act === "actif" && id && isChef()) {
    const m = S.machines[id], off = m.actif !== false;
    openModal({
      title: off ? `Retirer ${esc(m.id)} ?` : `Remettre ${esc(m.id)} ?`,
      html: off ? `<p class="mq">Elle ne sera plus comptée dans le parc, mais restera visible dans « Machines retirées » et pourra être remise.</p>` : `<p class="mq">Elle reviendra dans le parc, disponible au dépôt.</p>`,
      ok: off ? "Oui, retirer" : "Oui, remettre", okColor: off ? sc("probleme") : undefined,
      onOk: () => { setFields(id, off ? { actif: false, statut: "hs", depuis: today() } : { actif: true, statut: "disponible", lieu: "depot", equipe: null, depuis: today() }); return true; },
    });
    return;
  }
  if (act === "save-add-v") {
    const plaque = fmtPlaque($("#a-plaque").value), mod = $("#a-mod").value.trim(), type = $("#a-type").value, eqv = $("#a-eq").value, msg = $("#a-msg");
    if (!mod) { msg.innerHTML = `<div class="msg err">Indique le modèle (ex. : Renault Master).</div>`; return; }
    if (plaque && Object.values(S.machines).some(x => isVeh(x) && x.plaque === plaque)) { msg.innerHTML = `<div class="msg err">La plaque ${esc(plaque)} existe déjà.</div>`; return; }
    const eq = eqv === "" ? null : +eqv, nid = nextVeh();
    addMachine({ id: nid, famille: "vehicule", modele: mod, plaque, type_vehicule: type, equipe: eq, affectation: eq != null ? chef(eq) : "", statut: "operationnelle", lieu: eq != null ? "equipe" : "depot",
      ct_mois: 24, pol_mois: type === "utilitaire" ? 12 : null, rev_mois: 12, depuis: today(), actif: true, ordre: 1000 });
    replaceTo(`#/machine/${encodeURIComponent(nid)}`); return;
  }
  if (act === "save-add") {
    let num = $("#a-num").value.trim().toUpperCase().replace(/\s+/g, ""); const mod = $("#a-mod").value.trim(), eqv = $("#a-eq").value;
    const msg = $("#a-msg");
    const sansNum = $("#a-nonum").checked;
    if (sansNum) num = "SN-" + Date.now().toString(36).toUpperCase();   // identifiant interne, affiché « Sans n° »
    if (!num) { msg.innerHTML = `<div class="msg err">Indique le numéro, ou coche « Sans numéro ».</div>`; return; }
    if (S.machines[num]) { msg.innerHTML = `<div class="msg err">Le numéro ${esc(num)} existe déjà.</div>`; return; }
    const eq = eqv === "" ? null : +eqv;
    addMachine({ id: num, famille: t.dataset.fam, modele: mod, equipe: eq, affectation: eq != null ? chef(eq) : "", statut: eq != null ? "operationnelle" : "disponible", lieu: eq != null ? "equipe" : "depot", depuis: today(), actif: true, ordre: 1000 });
    replaceTo(`#/machine/${encodeURIComponent(num)}`); return;
  }
});
const PREFIX = { tondeuse: "T", debroussailleuse: "D", souffleur: "S", taillehaie: "TH", tronconneuse: "TR", autoportee: "A", motoculteur: "MC", scarificateur: "SC", outillage: "OU" };
function nextNum(fam) {
  const p = PREFIX[fam] || "X", re = new RegExp(`^${p}(\\d+)$`);
  const max = Math.max(0, ...Object.keys(S.machines).map(k => (k.match(re) || [])[1]).filter(Boolean).map(Number));
  return p + String(max + 1).padStart(2, "0");
}
function draftBlocked(id) {
  if (!DRAFT || DRAFT.id === id || !Object.keys(DRAFT.v).length || !S.machines[DRAFT.id]) return false;
  const other = S.machines[DRAFT.id];
  openModal({
    title: "Une autre fiche n'est pas enregistrée",
    html: `<p class="mq">Merci de valider (ou d'annuler) les corrections de la fiche <b>${esc(disp(other))}</b> (${esc(other.modele)}) avant d'en commencer une nouvelle.</p>`,
    ok: `Aller à ${disp(other)}`, cancel: "Fermer",
    onOk: () => { setTimeout(() => go(`#/machine/${encodeURIComponent(other.id)}`), 0); return true; },
  });
  setTimeout(() => render(false), 0);   // on remet la case telle qu'elle était
  return true;
}
function draftSet(id, fld, v) {
  const m = S.machines[id];
  if (draftBlocked(id)) return;
  if (!DRAFT || DRAFT.id !== id) DRAFT = { id, v: {} };
  const base = fld === "_num" ? (noNum(m) ? "__SN__" : m.id) : (m[fld] ?? null);
  if (fld === "_num" && typeof v === "string" && v !== "__SN__") v = v.toUpperCase().replace(/\s+/g, "");
  if (base === (v ?? null)) delete DRAFT.v[fld]; else DRAFT.v[fld] = v;
  saveDraft();
  const bar = $("#savebar"); if (bar) bar.classList.toggle("hidden", !Object.keys(DRAFT.v).length);
}
function fieldValue(el) {
  const fld = el.dataset.field; let v = el.value;
  if (fld === "equipe") return v === "" ? null : +v;
  if (["depuis", "controle", "depose_le", "recupere_le", "pret_le", "km_le", "ct_le", "pol_le", "rev_le", "ct_avant", "pol_avant", "rev_avant", "mise_circulation", "rev_rdv", "ct_rdv", "pol_rdv"].includes(fld)) return v || null;
  if (["km", "rev_km", "ct_mois", "pol_mois", "rev_mois", "rev_cible_km"].includes(fld)) return v === "" ? null : +v;
  if (fld === "plaque") return fmtPlaque(v);
  return v.trim();
}
document.addEventListener("input", e => {
  const el = e.target;
  if (MODAL && el.closest && el.closest("#modal")) { const mm = $("#m-msg"); if (mm) mm.innerHTML = ""; }
  if (el.dataset && el.dataset.field) { const r = parseRoute(); if (r.parts[0] === "machine") draftSet(r.parts[1], el.dataset.field, fieldValue(el)); return; }
  if (el.id === "home-search") { const v = el.value.trim(); if (v) { focusSearch = true; go(`#/tout?q=${encodeURIComponent(v)}`); } return; }
  if (el.id !== "search") return;
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    const r = parseRoute(), q = new URLSearchParams(r.q); const v = el.value.trim();
    if (v) q.set("q", v); else q.delete("q");
    const qs = q.toString(); history.replaceState(null, "", `#/tout${qs ? "?" + qs : ""}`);
    const pos = el.selectionStart; render(false);
    const s = $("#search"); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (_) {} }
  }, 200);
});
let searchT = null;
document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "f-nonum") {
    const r = parseRoute(), n = $("#f-num"); n.disabled = el.checked; n.placeholder = el.checked ? "Sans numéro" : "";
    if (el.checked) n.value = "";
    draftSet(r.parts[1], "_num", el.checked ? "__SN__" : n.value.trim()); return;
  }
  if (el.id === "a-nonum") { $("#a-msg").innerHTML = ""; const n = $("#a-num"); n.disabled = el.checked; if (el.checked) n.value = ""; n.placeholder = el.checked ? "Sans numéro" : ""; }
  if (el.dataset && el.dataset.field) { const r = parseRoute(); if (r.parts[0] === "machine") draftSet(r.parts[1], el.dataset.field, fieldValue(el)); }
});
document.addEventListener("focusout", () => { setTimeout(() => { if (pendingRender && !MODAL && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) softRender(); }, 100); });

/* ---------- photos : copie locale créée par l'appli, envoyée tout de suite, gardée en attente sans réseau ---------- */
let PHOTOS_WAIT = [];   // [{key, id, kind}] photos pas encore envoyées
const idb = (() => { let p; return () => p || (p = new Promise((ok, ko) => { const r = indexedDB.open("asdj", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos"); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); })); })();
async function idbDo(mode, fn) { const db = await idb(); return new Promise((ok, ko) => { const tx = db.transaction("photos", mode); const st = tx.objectStore("photos"); const rq = fn(st); tx.oncomplete = () => ok(rq && rq.result); tx.onerror = () => ko(tx.error); }); }
const idbGet = k => idbDo("readonly", st => st.get(k));
const idbPut = (k, v) => idbDo("readwrite", st => st.put(v, k));
const idbAll = () => idbDo("readonly", st => st.getAll());
async function loadPhotoQueue() { try { PHOTOS_WAIT = (await idbAll() || []).filter(p => !p.sent).sort((a, b) => a.at - b.at).map(p => ({ key: p.key, id: p.id, kind: p.kind || "main" })); } catch (e) { PHOTOS_WAIT = []; } updateStatus(); }
const pendingPhoto = (id, kind) => PHOTOS_WAIT.some(p => p.id === id && (!kind || p.kind === kind));
function shrink(file) {
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : ko(new Error("photo illisible")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error("photo illisible")); };
    img.src = url;
  });
}
async function addPhoto(id, file, kind = "main") {
  const blob = await shrink(file);
  const key = `machines/${id}/${kind === "ev" ? "rep-" : ""}${Date.now()}.jpg`;
  await idbPut(key, { key, id, kind, blob, sent: false, at: Date.now() });
  PHOTOS_WAIT.push({ key, id, kind }); updateStatus();
  photoUrls[key] = URL.createObjectURL(blob);
  if (kind === "main") { latestLocal[id] = key; showPhotos(); }
  setTimeout(sendPhotos, 50);
  return key;
}
let sendingPhotos = false;
async function sendPhotos() {
  if (sendingPhotos || !supa || !USER || !PHOTOS_WAIT.length) return;
  sendingPhotos = true; updateStatus();
  try {
    for (const p of [...PHOTOS_WAIT]) {
      const rec = await idbGet(p.key); if (!rec) { PHOTOS_WAIT = PHOTOS_WAIT.filter(x => x.key !== p.key); continue; }
      const { error } = await supa.storage.from("photos").upload(p.key, rec.blob, { contentType: "image/jpeg", upsert: false });
      if (error && !/exist|duplicate|409/i.test(`${error.message} ${error.statusCode} ${error.error}`)) throw error;   // déjà en ligne = envoyée
      rec.sent = true; await idbPut(p.key, rec);   // la copie locale reste sur le téléphone
      PHOTOS_WAIT = PHOTOS_WAIT.filter(x => x.key !== p.key);
      const pid = resolveId(p.id);
      if (p.kind === "main" && S.machines[pid] && (latestLocal[pid] === p.key || !S.machines[pid].photo)) setFields(pid, { photo: p.key });
    }
  } catch (e) { console.warn("photo en attente", e); }
  finally { sendingPhotos = false; updateStatus(); showPhotos(); }
}
const photoUrls = {}, latestLocal = {};
async function photoURL(key) {
  if (photoUrls[key]) return photoUrls[key];
  try { const rec = await idbGet(key); if (rec && rec.blob) return photoUrls[key] = URL.createObjectURL(rec.blob); } catch (e) {}
  if (!supa || !navigator.onLine) return null;
  const { data, error } = await supa.storage.from("photos").download(key);   // une photo à la fois, seulement quand on l'affiche
  if (error || !data) return null;
  try { await idbPut(key, { key, id: key.split("/")[1], kind: key.includes("/rep-") ? "ev" : "main", blob: data, sent: true, at: Date.now() }); } catch (e) {}
  return photoUrls[key] = URL.createObjectURL(data);
}
async function showPhotos() {
  const box = $("#photo-box");
  if (box) {
    const id = box.dataset.main, m = S.machines[id], wait = PHOTOS_WAIT.filter(p => p.id === id && p.kind === "main").pop();
    const key = latestLocal[id] || (wait && wait.key) || (m && m.photo);
    if (key) {
      const url = await photoURL(key); const b = $("#photo-box");
      if (b && b.dataset.main === id) b.innerHTML = url ? `<img src="${url}" alt="Photo de ${esc(id)}">${PHOTOS_WAIT.some(p => p.key === key) ? `<span class="wait">En attente d'envoi</span>` : ""}` : "Photo visible quand il y a du réseau";
    }
  }
  for (const img of document.querySelectorAll("img[data-photo]")) {
    if (img.src) continue;
    const url = await photoURL(img.dataset.photo);
    if (url) img.src = url; else img.alt = "hors ligne";
  }
}
document.addEventListener("change", async e => {
  if (!["photo-input", "photo-cam"].includes(e.target.id) || !e.target.files || !e.target.files[0]) return;
  const r = parseRoute(); if (r.parts[0] !== "machine") return;
  $("#photo-box").textContent = "Préparation de la photo…";
  try { await addPhoto(r.parts[1], e.target.files[0]); } catch (err) { $("#photo-box").textContent = "Cette photo n'a pas pu être lue. Essaie une autre."; }
});

/* ---------- connexion ---------- */
const NEED_PWD = /type=(invite|recovery)/.test(location.hash);
function viewLogin(mode, msg) {
  $("#status").classList.add("hidden");
  const pwd = mode === "pwd", name = mode === "name";
  $("#app").innerHTML = `<div class="login"><div class="brand"><img src="icons/icon-192.png" alt=""><h1>ASDJ - Tools</h1><p class="sub">Au service des jardins</p></div>
    <div class="sect">${pwd ? `<label class="f" for="lg-new" style="margin-top:0">Choisis ton mot de passe (8 caractères minimum)</label><input class="inp" id="lg-new" type="password" autocomplete="new-password">
      <div style="height:14px"></div><button class="btn" id="lg-setpwd">Enregistrer mon mot de passe</button>`
    : name ? `<label class="f" for="lg-name" style="margin-top:0">Ton prénom (il apparaîtra dans l'historique)</label><input class="inp" id="lg-name" autocomplete="given-name">
      <div style="height:14px"></div><button class="btn" id="lg-setname">Continuer</button>`
    : `<label class="f" for="lg-mail" style="margin-top:0">Adresse e-mail</label><input class="inp" id="lg-mail" type="email" autocomplete="username">
      <label class="f" for="lg-pass">Mot de passe</label><input class="inp" id="lg-pass" type="password" autocomplete="current-password">
      <div style="height:14px"></div><button class="btn" id="lg-go">Se connecter</button><button class="link" id="lg-forgot">Mot de passe oublié ?</button>`}
    <div id="lg-msg">${msg ? `<div class="msg ${msg.err ? "err" : ""}">${esc(msg.t)}</div>` : ""}</div></div></div>`;
  hideLoader();
  if (pwd) {
    $("#lg-setpwd").onclick = async () => {
      const p = $("#lg-new").value; if (p.length < 8) { $("#lg-msg").innerHTML = `<div class="msg err">8 caractères minimum.</div>`; return; }
      const { data, error } = await supa.auth.updateUser({ password: p });
      if (error) { $("#lg-msg").innerHTML = `<div class="msg err">${esc(error.message)}</div>`; return; }
      USER = data.user; history.replaceState(null, "", location.pathname + "#/"); afterLogin();
    };
    return;
  }
  if (name) {
    $("#lg-setname").onclick = async () => {
      const n = $("#lg-name").value.trim(); if (!n) { $("#lg-msg").innerHTML = `<div class="msg err">Écris ton prénom.</div>`; return; }
      const { data, error } = await supa.auth.updateUser({ data: { nom: n } });
      if (error) { $("#lg-msg").innerHTML = `<div class="msg err">${navigator.onLine ? esc(error.message) : "Il faut du réseau pour cette étape."}</div>`; return; }
      USER = data.user; start();
    };
    return;
  }
  $("#lg-go").onclick = async () => {
    const btn = $("#lg-go"); btn.disabled = true; btn.textContent = "Connexion…";
    const { data, error } = await supa.auth.signInWithPassword({ email: $("#lg-mail").value.trim(), password: $("#lg-pass").value });
    btn.disabled = false; btn.textContent = "Se connecter";
    if (error) { $("#lg-msg").innerHTML = `<div class="msg err">${navigator.onLine ? "E-mail ou mot de passe incorrect." : "Pas de réseau : la première connexion demande internet."}</div>`; return; }
    USER = data.user; afterLogin();
  };
  $("#lg-forgot").onclick = async () => {
    const mail = $("#lg-mail").value.trim();
    if (!mail) { $("#lg-msg").innerHTML = `<div class="msg err">Écris d'abord ton adresse e-mail au-dessus.</div>`; return; }
    const { error } = await supa.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname });
    $("#lg-msg").innerHTML = error ? `<div class="msg err">${esc(error.message)}</div>` : `<div class="msg">E-mail envoyé : ouvre le lien reçu pour choisir un nouveau mot de passe.</div>`;
  };
}
function afterLogin() { if (!myName()) viewLogin("name"); else start(); }

/* ---------- démarrage ---------- */
let loaderHidden = false;
function hideLoader() { if (loaderHidden) return; loaderHidden = true; const l = $("#loader"); if (!l) return; l.classList.add("fade"); setTimeout(() => l.remove(), 400); }
let started = false, channel = null;
async function start() {
  if (started) { render(true); return; }
  started = true;
  if (!/^#\//.test(location.hash)) history.replaceState(null, "", location.pathname + "#/");
  stack = [location.hash.slice(1) || "/"];
  $("#status").classList.remove("hidden"); updateStatus();
  await loadPhotoQueue(); sendPhotos();
  if (REJ.length) { REJ.forEach(o => { o.err = 0; Q.push(o); }); REJ = []; saveLocal(); }
  if (ROLE === "coupe") { viewCoupe(); await whoami(); if (ROLE !== "coupe") location.reload(); return; }
  const hasCache = Object.keys(S.machines).length > 0;
  if (hasCache) render(true);
  await whoami();
  if (ROLE === "coupe") { viewCoupe(); return; }
  if (hasCache) render(false);
  const lm = $("#loader-msg"); if (lm) lm.textContent = "Synchronisation en cours…";
  const timer = setTimeout(() => { if (hasCache) hideLoader(); }, 6000);
  await flush();
  const ok = await refresh();
  clearTimeout(timer);
  if (!ok && !hasCache) { const l2 = $("#loader-msg"); if (l2) l2.textContent = "Pas de réseau. Réessaie quand tu as internet."; setTimeout(() => location.reload(), 15000); return; }
  render(true); hideLoader(); checkRobot(); setTimeout(maybeAlertPopup, 900);
  // temps réel : les modifs de l'autre téléphone arrivent tout de suite
  try {
    channel = supa.channel("asdj")
      .on("postgres_changes", { event: "*", schema: "public", table: "machines" }, p => {
        if (p.eventType === "DELETE" && p.old && p.old.id) { delete S.machines[p.old.id]; saveLocal(); softRender(); return; }
        if (p.new && p.new.id) { mergeRow(p.new); saveLocal(); softRender(); } })
      .on("postgres_changes", { event: "*", schema: "public", table: "equipes" }, p => { if (p.new && p.new.numero != null) { mergeEquipe(p.new); saveLocal(); softRender(); } })
      .subscribe();
  } catch (e) { console.warn("temps réel indisponible", e); }
}
// filets de sécurité : renvoi toutes les 30 s, au retour du réseau et au retour dans l'appli
setInterval(() => { if (Q.length) flush(); if (PHOTOS_WAIT.length) sendPhotos(); }, 30000);
setInterval(() => { if (document.visibilityState === "visible" && USER && started) refresh().then(ok => ok && softRender()); }, 60000);
window.addEventListener("online", () => { updateStatus(); if (!started) return; checkVersion().then(upd => { if (upd) return; sendPhotos(); flush().then(() => refresh()).then(ok => ok && softRender()); }); });
window.addEventListener("offline", () => updateStatus());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !USER || !started) return;
  checkVersion().then(upd => { if (upd) return; checkRobot(); sendPhotos(); flush().then(() => refresh()).then(ok => { if (ok) softRender(); setTimeout(maybeAlertPopup, 600); }); });
});

(async function init() {
  if (!window.supabase || !CFG) { $("#loader-msg").textContent = "Erreur de chargement. Ferme et rouvre l'appli."; return; }
  if (await checkVersion()) return;   // une nouvelle version existe : on la charge avant tout
  supa = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  supa.auth.onAuthStateChange((ev, session) => {
    if (ev === "PASSWORD_RECOVERY") viewLogin("pwd");
    if (session && session.user) USER = session.user;
  });
  const { data: { session } } = await supa.auth.getSession();
  if (NEED_PWD && session) { USER = session.user; viewLogin("pwd"); return; }
  if (session && session.user) { USER = session.user; afterLogin(); }
  else viewLogin("login");
})();
