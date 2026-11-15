/* ASDJ - Tools : suivi du matériel par famille et par équipe.
   Données partagées entre les comptes connectés (Supabase), copie locale + file d'attente pour le hors ligne. */
"use strict";
const APP_V = 3;   // à augmenter à chaque version (avec version.json, ?v=N et le cache de sw.js)
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
  { id: "disponible", nom: "Disponible", q: "est disponible au dépôt" },
  { id: "controle", nom: "Contrôle fait", q: "a été contrôlée" },
  { id: "operationnelle", nom: "Opérationnelle", q: "est opérationnelle" },
];
const ST = Object.fromEntries(STATUTS.map(s => [s.id, s]));
const URGENTS = ["probleme", "reparation", "hs"];
const ATTRIB = ["operationnelle", "controle"];
const LIEUX = { depot: "Au dépôt", equipe: "Avec l'équipe", reparateur: "Chez le réparateur", pret: "Prêtée" };
const PRIO = { probleme: 0, reparation: 1, hs: 2, disponible: 3, controle: 4, operationnelle: 5 };
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
const S = { machines: {}, equipes: {}, events: [], cacheAt: 0 };
let Q = [];        // modifications pas encore envoyées
let REJ = [];      // modifications refusées par le serveur (gardées, jamais effacées)
let supa = null, USER = null;
try {
  const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
  if (c) { S.machines = c.m || {}; S.equipes = c.e || {}; S.events = c.ev || []; S.cacheAt = c.at || 0; }
  Q = JSON.parse(localStorage.getItem(LS_Q) || "[]");
  REJ = JSON.parse(localStorage.getItem(LS_REJ) || "[]");
} catch (e) { console.warn("cache illisible", e); }
function saveLocal() {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify({ m: S.machines, e: S.equipes, ev: S.events, at: S.cacheAt }));
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
const teamLabel = n => n == null || n === "" ? "Sans équipe" : `Équipe ${n}` + (chef(n) ? ` · ${chef(n)}` : "");
const natural = (a, b) => a.localeCompare(b, "fr", { numeric: true });
const norm = t => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const prio = m => PRIO[m.statut] ?? 9;
const byAlert = (a, b) => prio(a) - prio(b) || natural(a.id, b.id);
const actives = () => Object.values(S.machines).filter(m => m.actif !== false);
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
const statMatch = (m, sel) => !sel || (sel === "attribuee" ? ATTRIB.includes(m.statut) : m.statut === sel);
function whereTxt(m) {
  if (m.statut === "reparation" || m.lieu === "reparateur") return `Chez ${m.reparateur || "le réparateur"}` + ((m.depose_le || m.depuis) ? ` · ${sinceTxt(m.depose_le || m.depuis)}` : "") + (m.depose_par ? ` · déposée par ${m.depose_par}` : "");
  if (m.lieu === "pret") return `Prêtée à ${m.pret_a || "quelqu'un"}` + (m.pret_le ? ` · ${sinceTxt(m.pret_le)}` : "") + (m.equipe != null ? ` · ${teamLabel(m.equipe)}` : "");
  if (m.lieu === "depot") return "Au dépôt" + (m.equipe != null ? ` · ${teamLabel(m.equipe)}` : "") + (m.statut !== "operationnelle" && m.depuis ? ` · ${sinceTxt(m.depuis)}` : "");
  return teamLabel(m.equipe) + (["probleme", "hs"].includes(m.statut) && m.depuis ? ` · ${sinceTxt(m.depuis)}` : "");
}
function countBy(list) { const c = {}; STATUTS.forEach(s => c[s.id] = 0); list.forEach(m => c[m.statut] = (c[m.statut] || 0) + 1); return c; }
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
let flushing = false, flushTimer = null;
function flushSoon() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250); }
async function flush() {
  if (flushing || !supa || !USER) return;
  if (!Q.length) { updateStatus(); return; }
  flushing = true; updateStatus("busy");
  try {
    while (Q.length) {
      const op = Q[0]; let res;
      if (op.k === "f") res = await supa.rpc("maj_champ", { p_id: op.id, p_champ: op.c, p_valeur: op.v == null ? "" : String(op.v), p_ts: new Date(op.ts).toISOString() });
      else if (op.k === "new") res = await supa.from("machines").upsert(op.row, { onConflict: "id", ignoreDuplicates: true });
      else if (op.k === "eq") res = await supa.from("equipes").upsert({ numero: op.n, chef: op.v, updated_at: new Date(op.ts).toISOString() });
      else if (op.k === "ev") res = await supa.from("historique").insert({ machine_id: op.ev.id, champ: "evenement", nouveau: JSON.stringify(op.ev) });
      if (res && res.error) {
        if (isNetErr(res.error)) throw res.error;
        op.err = (op.err || 0) + 1; op.msg = res.error.message;
        if (op.err >= 4) { REJ.push(Q.shift()); saveLocal(); continue; } // mis de côté, pas effacé
        throw res.error;
      }
      Q.shift();
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
  refreshing = true;
  try {
    const [ms, es, hs] = await Promise.all([fetchAll("machines", "id"), fetchAll("equipes", "numero"),
      fetchAll("historique", "id", q => q.eq("champ", "evenement"))]);
    S.machines = {}; ms.forEach(r => S.machines[r.id] = r);
    S.equipes = {}; es.forEach(r => S.equipes[r.numero] = r);
    S.events = []; hs.forEach(h => { try { S.events.push(JSON.parse(h.nouveau)); } catch (e) {} });
    Q.forEach(applyOp);
    S.cacheAt = Date.now(); saveLocal();
    return true;
  } catch (e) { console.warn("lecture serveur impossible", e); return false; }
  finally { refreshing = false; updateStatus(); }
}

/* ---------- barre d'état ---------- */
function updateStatus(force) {
  const el = $("#status"); if (!el || !USER) return;
  let txt, cls = "";
  const n = Q.length, pp = PHOTOS_WAIT.length;
  if (force === "busy" || flushing || sendingPhotos) { cls = "busy"; txt = "Envoi en cours…"; }
  else if (!navigator.onLine) { cls = "off"; txt = n ? `Hors ligne · ${n} modif${n > 1 ? "s" : ""} en attente d'envoi` : "Hors ligne · tout est gardé sur le téléphone"; }
  else if (n) { cls = "off"; txt = `${n} modif${n > 1 ? "s" : ""} en attente d'envoi`; }
  else txt = pp ? "Données sauvegardées en ligne" : "Tout est sauvegardé en ligne";
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
function openModal({ title, html, ok = "Oui, confirmer", okColor, cancel = "Non, annuler", onOk, onOpen }) {
  closeModal(true);
  const d = document.createElement("div"); d.id = "modal";
  d.innerHTML = `<div class="mback" data-act="m-cancel"></div><div class="mbox" role="dialog" aria-modal="true">
    <h2>${title}</h2><div class="mbody">${html || ""}</div><div id="m-msg"></div>
    <div class="mbtns"><button class="btn light" data-act="m-cancel">${esc(cancel)}</button><button class="btn" data-act="m-ok" ${okColor ? `style="background:${okColor}"` : ""}>${esc(ok)}</button></div></div>`;
  document.body.appendChild(d); document.body.classList.add("noscroll");
  MODAL = { onOk, el: d };
  if (onOpen) onOpen(d);
}
function closeModal(silent) {
  if (!MODAL) return; MODAL.el.remove(); MODAL = null; document.body.classList.remove("noscroll");
  if (!silent && pendingRender) softRender();
}
const mval = id => { const e = document.getElementById(id); return e ? e.value.trim() : ""; };
const mfile = id => { const e = document.getElementById(id); return e && e.files && e.files[0]; };

/* ---------- rendu ---------- */
function header(title, sub, opts = {}) {
  const left = opts.home
    ? `<img class="logo" src="icons/icon-192.png" alt="">`
    : `<button class="iconbtn" data-act="back" aria-label="Retour">${SVG.back}</button>`;
  const famIc = opts.fam ? `<span class="hfam" style="color:${fc(opts.fam)}">${ICONS[opts.fam]}</span>` : "";
  return `<header class="top"><div class="row">${left}${famIc}<h1>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</h1>${opts.right || ""}</div></header>`;
}
function cardHTML(m) {
  return `<a class="card ${m.actif === false ? "off" : ""}" href="#/machine/${encodeURIComponent(m.id)}" style="--c:${sc(m.statut)}">
    <span class="stripe"></span>
    <span class="body"><span class="num">${esc(m.id)}</span><span class="mod">${esc(m.modele)}</span><div class="where">${esc(whereTxt(m))}</div></span>
    <span class="side"><span class="pill">${esc(ST[m.statut] ? ST[m.statut].nom : m.statut)}</span></span></a>`;
}
function summaryHTML(list, base) {
  const c = countBy(list), att = c.operationnelle + c.controle;
  const cell = (id, n, label, big) => `<a class="sum ${big ? "big" : ""} ${n ? "" : "zero"}" href="${base}statut=${id}" style="--c:${id === "attribuee" ? sc("operationnelle") : sc(id)}"><b>${n}</b><span>${esc(label)}</span></a>`;
  return `<div class="summary"><div class="sumrow two">${cell("probleme", c.probleme, c.probleme > 1 ? "Problèmes techniques" : "Problème technique", true)}${cell("reparation", c.reparation, "En réparation", true)}</div>
    <div class="sumrow three">${cell("disponible", c.disponible, c.disponible > 1 ? "Disponibles" : "Disponible")}${cell("attribuee", att, att > 1 ? "Attribuées" : "Attribuée")}${cell("hs", c.hs, "HS")}</div></div>`;
}

function viewHome() {
  const all = actives();
  const tiles = FAMILLES.map(f => {
    const l = all.filter(m => m.famille === f.id);
    return `<a class="tile" href="#/famille/${f.id}"><span class="ic" style="background:${fc(f.id)}">${ICONS[f.id]}</span>
      <h2>${esc(f.nom)}</h2><span class="n">${l.length} machine${l.length > 1 ? "s" : ""}</span>${barHTML(l)}${dotsHTML(l, URGENTS)}</a>`;
  }).join("");
  const teams = teamNums();
  return header("ASDJ - Tools", "Au service des jardins", { home: true, right: `<button class="iconbtn" data-act="logout" aria-label="Se déconnecter">${SVG.out}</button>` }) +
    `<main><input class="search" id="home-search" type="search" placeholder="🔍 Code, modèle, chef, type de machine…" autocomplete="off">
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
    body = Object.keys(groups).sort().map(k => `<div class="group-h">${esc(k === "z" ? "Sans équipe (dépôt)" : teamLabel(+k))}</div><div class="list">${groups[k].sort(byAlert).map(cardHTML).join("")}</div>`).join("");
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
function teamPannes(n) { return S.events.filter(e => (e.type === "probleme" || e.type === "hs") && e.equipe === n).length; }
function viewEquipes() {
  const all = actives();
  const cards = `<div class="tgrid">${teamNums().map(n => { const p = teamPannes(n); return teamCard(n, all).replace("</a>", `${p ? `<span class="tpan">${p} panne${p > 1 ? "s" : ""} signalée${p > 1 ? "s" : ""} au total</span>` : ""}</a>`); }).join("")}</div>`;
  const dep = all.filter(m => m.equipe == null);
  return header("Les équipes", "Le matériel de chaque chef") + `<main>${cards}<div class="list" style="margin-top:12px">
    <a class="card" href="#/equipe/depot" style="--c:var(--s-disponible)"><span class="stripe"></span><span class="body team"><span class="badge depot">D</span>
      <span style="flex:1;min-width:0"><span class="num" style="font-size:18px">Sans équipe</span><div class="where">${dep.length} machine${dep.length > 1 ? "s" : ""} au dépôt ou en réparation</div>${barHTML(dep)}</span></span></a>
  </div><div class="addbar"><button class="btn light" data-act="team-add">+ Ajouter une équipe</button></div></main>`;
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
  const edit = isDep ? "" : `<button class="iconbtn" data-act="chef" data-n="${n}" aria-label="Changer le chef">✎</button>`;
  return header(isDep ? "Sans équipe" : `Équipe ${n}`, isDep ? "Au dépôt ou en réparation" : (chef(n) ? `Chef : ${chef(n)}` : "Chef à indiquer"), { right: edit }) +
    `<main>${summaryHTML(all, `#/equipe/${id}?`)}${sel ? `<div class="filtre">Filtre : <b>${esc(sel === "attribuee" ? "Attribuées" : ST[sel].nom)}</b> <a href="#/equipe/${id}">✕ retirer</a></div>` : ""}${body}
    <div class="sect" style="margin-top:18px"><h3>Historique de l'équipe : pannes, réparations, prêts</h3>${teamHistHTML(n)}</div></main>`;
}
function viewTout(q) {
  const sel = q.get("statut"), txt = norm((q.get("q") || "").trim());
  const all = actives();
  const list = all.filter(m => statMatch(m, sel) &&
    (!txt || txt.split(/\s+/).every(w => norm([m.id, m.modele, (m.modele || "").replace(/\s+/g, ""), FAM[m.famille] && FAM[m.famille].un, FAM[m.famille] && FAM[m.famille].nom,
      chef(m.equipe), m.equipe != null ? `equipe ${m.equipe}` : "sans equipe", ST[m.statut] && ST[m.statut].nom, LIEUX[m.lieu], m.reparateur, m.depose_par, m.recupere_par, m.pret_a, m.lieu === "pret" ? "pretee pret" : "", m.notes, m.motif].join(" ")).includes(w))))
    .sort(byAlert);
  const base = `#/tout${txt ? `?q=${encodeURIComponent(q.get("q").trim())}` : ""}`;
  return header("Toutes les machines", `${all.length} machines`) +
    `<main><input class="search" id="search" type="search" placeholder="🔍 Code, modèle, chef, type de machine…" autocomplete="off" value="${esc(q.get("q") || "")}">
    ${statusChips(all, sel === "attribuee" ? "" : sel, base)}${sel === "attribuee" ? `<div class="filtre">Filtre : <b>Attribuées</b> <a href="${base}">✕ retirer</a></div>` : ""}
    <div class="list">${list.map(cardHTML).join("") || `<div class="empty">Aucune machine trouvée.</div>`}</div></main>`;
}

/* ----- fiche machine ----- */
let DRAFT = null;   // corrections en cours (pas encore enregistrées)
const dv = (m, f) => DRAFT && DRAFT.id === m.id && f in DRAFT.v ? DRAFT.v[f] : m[f];
const EVT = {
  probleme: { nom: "Problème signalé", c: "probleme" },
  reparation: { nom: "Partie en réparation", c: "reparation" },
  retour: { nom: "Revenue de réparation", c: "disponible" },
  hs: { nom: "Déclarée HS", c: "hs" },
  pret: { nom: "Prêtée", c: "controle" },
  rendu: { nom: "Rendue après prêt", c: "operationnelle" },
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
  const ev = S.events.filter(e => n === null ? e.equipe == null : e.equipe === n).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!ev.length) return `<p class="muted">Rien d'enregistré pour l'instant.</p>`;
  const np = ev.filter(e => e.type === "probleme" || e.type === "hs").length, nr = ev.filter(e => e.type === "reparation").length, npr = ev.filter(e => e.type === "pret").length;
  const per = {}; ev.filter(e => e.type === "probleme" || e.type === "hs").forEach(e => per[e.id] = (per[e.id] || 0) + 1);
  const top = Object.entries(per).sort((a, b) => b[1] - a[1]).filter(x => x[1] > 1);
  return `<div class="evsum"><span><b>${np}</b> panne${np > 1 ? "s" : ""}</span><span><b>${nr}</b> réparation${nr > 1 ? "s" : ""}</span><span><b>${npr}</b> prêt${npr > 1 ? "s" : ""}</span></div>
    ${top.length ? `<p class="muted">Machines qui tombent le plus en panne : ${top.map(([k, v]) => `<b>${esc(k)}</b> (${v})`).join(", ")}</p>` : ""}
    <ul class="evlist">${ev.slice(0, 60).map(e => {
      const t = EVT[e.type] || { nom: e.type, c: "hs" }, d = new Date(e.at), mm = S.machines[e.id];
      return `<li style="--c:${sc(t.c)}"><a class="evtxt" href="#/machine/${encodeURIComponent(e.id)}"><time>${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>
        <span class="evm">${mm ? `<span class="evic" style="color:${fc(mm.famille)}">${ICONS[mm.famille]}</span>` : ""}<b>${esc(e.id)}</b> · ${esc(t.nom)}</span>${evLines(e).map(l => `<div>${esc(l)}</div>`).join("")}</a>
        ${e.photo ? `<button class="thumb" data-act="zoom" data-key="${esc(e.photo)}"><img data-photo="${esc(e.photo)}" alt="Photo"></button>` : ""}</li>`;
    }).join("")}</ul>`;
}
function eventsOf(id) { return S.events.filter(e => e.id === id).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
function eventsHTML(id) {
  const ev = eventsOf(id);
  if (!ev.length) return `<p class="muted">Aucune panne, réparation ni prêt enregistré pour l'instant.</p>`;
  const np = ev.filter(e => e.type === "probleme" || e.type === "hs").length, nr = ev.filter(e => e.type === "reparation").length;
  const teams = {}; ev.filter(e => e.type === "probleme" || e.type === "hs").forEach(e => { const k = teamLabel(e.equipe); teams[k] = (teams[k] || 0) + 1; });
  const npr = ev.filter(e => e.type === "pret").length;
  return `<div class="evsum"><span><b>${np}</b> panne${np > 1 ? "s" : ""}</span><span><b>${nr}</b> réparation${nr > 1 ? "s" : ""}</span><span><b>${npr}</b> prêt${npr > 1 ? "s" : ""}</span></div>
    ${Object.keys(teams).length ? `<p class="muted">Pannes par équipe : ${Object.entries(teams).map(([k, v]) => `${esc(k)} (${v})`).join(", ")}</p>` : ""}
    <ul class="evlist">${ev.map(e => {
      const t = EVT[e.type] || { nom: e.type, c: "hs" }, d = new Date(e.at);
      const lines = [];
      if (e.equipe != null && e.type !== "retour") lines.push(`Équipe : ${teamLabel(e.equipe)}`);
      if (e.motif) lines.push(`Pourquoi : ${e.motif}`);
      if (e.reparateur) lines.push(`Réparateur : ${e.reparateur}`);
      if (e.pret_a) lines.push(`${e.type === "rendu" ? "Rendue par" : "Prêtée à"} ${e.pret_a}${e.pret_le && e.type === "pret" ? ` le ${frDate(e.pret_le)}` : ""}`);
      if (e.type === "rendu" && e.duree != null) lines.push(`Durée du prêt : ${e.duree} j`);
      if (e.depose_par) lines.push(`Déposée par ${e.depose_par}${e.depose_le ? ` le ${frDate(e.depose_le)}` : ""}`);
      if (e.recupere_par || e.recupere_le) lines.push(`Récupérée${e.recupere_par ? ` par ${e.recupere_par}` : ""}${e.recupere_le ? ` le ${frDate(e.recupere_le)}` : ""}`);
      if (e.duree != null && e.type === "retour") lines.push(`Durée chez le réparateur : ${e.duree} j`);
      if (e.auteur) lines.push(`Noté par ${e.auteur}`);
      return `<li style="--c:${sc(t.c)}"><div class="evtxt"><time>${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>
        <b>${esc(t.nom)}</b>${lines.map(l => `<div>${esc(l)}</div>`).join("")}</div>${e.photo ? `<button class="thumb" data-act="zoom" data-key="${esc(e.photo)}"><img data-photo="${esc(e.photo)}" alt="Photo"></button>` : ""}</li>`;
    }).join("")}</ul>`;
}
function viewMachine(id) {
  const m = S.machines[id];
  if (!m) return header("Machine introuvable") + `<main><div class="empty">Cette machine n'existe pas (ou plus).</div></main>`;
  const f = FAM[m.famille] || { un: m.famille };
  const lieu = dv(m, "lieu"), eq = dv(m, "equipe");
  const teamOpts = `<option value="">Sans équipe</option>` + teamNums().map(n => `<option value="${n}" ${eq === n ? "selected" : ""}>${esc(teamLabel(n))}</option>`).join("");
  const famOpts = FAMILLES.map(x => `<option value="${x.id}" ${dv(m, "famille") === x.id ? "selected" : ""}>${esc(x.un)}</option>`).join("");
  const inp = (fld, label, type = "text", ph = "", list = "") => `<label class="f" for="f-${fld}">${label}</label><input class="inp" id="f-${fld}" ${type !== "text" ? `type="${type}"` : ""} ${list ? `list="${list}"` : ""} data-field="${fld}" value="${esc(dv(m, fld) || "")}" placeholder="${esc(ph)}">`;
  const dirty = DRAFT && DRAFT.id === id && Object.keys(DRAFT.v).length;
  return header(`${m.id} · ${m.modele}`, f.un) + `<main>
    <div class="hero" style="--c:${sc(m.statut)}"><span class="fam">${ICONS[m.famille] || ""}</span>
      <div class="big">${esc(m.id)}</div><div class="mod">${esc(f.un)} ${esc(m.modele)}</div>
      <div class="st">${esc(ST[m.statut] ? ST[m.statut].nom : m.statut)}</div>
      <div class="since">${esc(whereTxt(m))}</div>${m.motif && URGENTS.includes(m.statut) ? `<div class="since">« ${esc(m.motif)} »</div>` : ""}</div>

    <div class="sect"><h3>Changer l'état</h3><div class="stgrid">
      ${STATUTS.map(s => `<button class="stbtn ${m.statut === s.id ? "on" : ""}" style="--c:${sc(s.id)}" data-act="statut" data-v="${s.id}">${esc(s.nom)}</button>`).join("")}
    </div><div class="stfoot"><span class="muted">Une confirmation est demandée à chaque changement.</span>
      <button class="pretbtn ${m.lieu === "pret" ? "on" : ""}" data-act="pret">🤝 ${m.lieu === "pret" ? `Rendue ? (${esc(m.pret_a || "prêtée")})` : "Prêter"}</button></div></div>

    <div class="sect"><h3>Photo</h3><div class="photo" id="photo-box" data-main="${esc(id)}">${m.photo || pendingPhoto(m.id, "main") ? "Chargement de la photo…" : "Pas encore de photo"}</div>
      <label class="btn light" style="text-align:center">📷 ${m.photo ? "Changer la photo" : "Ajouter une photo"}<input type="file" accept="image/*" id="photo-input" hidden></label></div>

    <div class="sect"><h3>Historique : pannes, réparations, prêts</h3>${eventsHTML(id)}</div>

    <div class="sect ${dirty ? "dirty" : ""}"><h3>Infos de la machine</h3><p class="muted" style="margin:0 0 4px">Pour corriger une erreur de saisie. Rien n'est changé tant que tu n'as pas appuyé sur « Enregistrer ».</p>
      <label class="f" for="f-famille">Type de machine</label><select class="inp" id="f-famille" data-field="famille">${famOpts}</select>
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
      <p class="muted">Le numéro (${esc(m.id)}) ne se modifie pas : en cas d'erreur, retire la machine et recrée-la avec le bon numéro.</p>
    </div>

    <details class="sect journal"><summary><h3 style="display:inline">Journal de toutes les modifications</h3></summary><ul class="hist" id="hist"><li>Chargement…</li></ul></details>

    <button class="btn ${m.actif === false ? "light" : "danger"}" data-act="actif">${m.actif === false ? "Remettre dans le parc" : "Retirer du parc (vendue, perdue, détruite…)"}</button>
  </main>
  <div class="savebar ${dirty ? "" : "hidden"}" id="savebar"><span>Modifications non enregistrées</span><button class="btn light" data-act="draft-cancel">Annuler</button><button class="btn" data-act="draft-save">💾 Enregistrer</button></div>`;
}
const CHAMPS = { pret_a: "Prêtée à", pret_le: "Prêtée le", depose_par: "Déposée par", depose_le: "Déposée le", recupere_par: "Récupérée par", recupere_le: "Récupérée le", photo: "Photo", statut: "État", lieu: "Lieu", reparateur: "Réparateur", depuis: "Depuis", motif: "Pourquoi", equipe: "Équipe", controle: "Contrôle", modele: "Modèle", notes: "Notes", actif: "Dans le parc", affectation: "Affectation", famille: "Type" };
function histVal(c, v) {
  if (v == null || v === "") return "—";
  if (c === "statut") return ST[v] ? ST[v].nom : v;
  if (c === "lieu") return LIEUX[v] || v;
  if (c === "equipe") return teamLabel(+v);
  if (["depuis", "controle", "depose_le", "recupere_le", "pret_le"].includes(c)) return frDate(v);
  if (c === "actif") return v === "true" ? "oui" : "non";
  if (c === "photo") return "nouvelle photo";
  return v;
}
async function loadHist(id) {
  const ul = $("#hist"); if (!ul) return;
  if (!supa || !navigator.onLine) { ul.innerHTML = `<li>Visible quand il y a du réseau.</li>`; return; }
  const { data, error } = await supa.from("historique").select("*").eq("machine_id", id).neq("champ", "evenement").order("at", { ascending: false }).limit(60);
  if (!$("#hist")) return;
  if (error) { ul.innerHTML = `<li>Journal indisponible pour le moment.</li>`; return; }
  ul.innerHTML = (data || []).length ? data.map(h => {
    const d = new Date(h.at);
    return `<li><time>${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>${esc(CHAMPS[h.champ] || h.champ)} : ${esc(histVal(h.champ, h.ancien))} → <b>${esc(histVal(h.champ, h.nouveau))}</b></li>`;
  }).join("") : `<li>Aucun changement pour l'instant.</li>`;
}

function viewAjout(fid) {
  const f = FAM[fid] || FAMILLES[0];
  const teamOpts = `<option value="">Sans équipe (au dépôt)</option>` + teamNums().map(n => `<option value="${n}">${esc(teamLabel(n))}</option>`).join("");
  return header(`Ajouter : ${f.un}`, "Nouvelle machine", { fam: f.id }) + `<main><div class="sect">
    <label class="f" for="a-num" style="margin-top:0">Numéro interne (ex. : ${({ tondeuse: "T14", debroussailleuse: "D08", souffleur: "S08", taillehaie: "TH08", tronconneuse: "TR11", autoportee: "A01", motoculteur: "MC01", scarificateur: "SC01", outillage: "OU01" })[f.id] || "X01"})</label><input class="inp" id="a-num" autocapitalize="characters" autocomplete="off">
    <label class="f" for="a-mod">Modèle (ex. : HRX 537)</label><input class="inp" id="a-mod" autocomplete="off">
    <label class="f" for="a-eq">Équipe</label><select class="inp" id="a-eq">${teamOpts}</select>
    <div id="a-msg"></div><div style="height:14px"></div>
    <button class="btn" data-act="save-add" data-fam="${f.id}">Ajouter la machine</button></div></main>`;
}

/* rendu principal (garde la position de défilement de chaque écran) */
let pendingRender = false, focusSearch = false;
function render(nav) {
  if (!USER) return;
  const r = parseRoute(); const [a, b] = r.parts;
  if (nav && DRAFT && !(a === "machine" && b === DRAFT.id)) { /* on garde le brouillon pour le retour sur la fiche */ }
  let html;
  if (!a) html = viewHome();
  else if (a === "famille") html = viewFamille(b, r.q);
  else if (a === "equipes") html = viewEquipes();
  else if (a === "equipe") html = viewEquipe(b, r.q);
  else if (a === "tout") html = viewTout(r.q);
  else if (a === "machine") html = viewMachine(b);
  else if (a === "ajouter") html = viewAjout(b);
  else html = viewHome();
  const y = nav ? (scrolls[r.key] || 0) : window.scrollY;
  $("#app").innerHTML = html;
  window.scrollTo(0, y);
  if (a === "machine") { if (nav) loadHist(b); showPhotos(); }
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
const photoField = (label) => `<label class="f">${label} <span class="muted">(facultatif)</span></label><label class="btn light pick" style="text-align:center">📷 <span id="m-photo-lbl">Prendre / choisir une photo</span><input type="file" accept="image/*" id="m-photo" hidden></label>`;
function askStatut(id, v) {
  const m = S.machines[id], s = ST[v], cur = m.statut;
  if (v === cur && v !== "controle") return;
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
      const file = mfile("m-photo");
      if (file) { try { ev.photo = await addPhoto(id, file, "ev"); } catch (e) {} }
      if (retour) addEvent(id, "retour", retour);
      if (EVT[v]) addEvent(id, v, ev);
      setFields(id, ch);
      return true;
    },
    onOpen: d => { const i = d.querySelector("#m-photo"); if (i) i.addEventListener("change", () => { if (i.files[0]) $("#m-photo-lbl").textContent = "✅ Photo ajoutée"; }); },
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
  const t = e.target.closest("[data-act]"); if (!t) return;
  const act = t.dataset.act, r = parseRoute();
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
  if (act === "statut" && id) return askStatut(id, t.dataset.v);
  if (act === "pret" && id) return askPret(id);
  if (act === "lieu" && id) { draftSet(id, "lieu", t.dataset.v); render(false); return; }
  if (act === "draft-cancel") { DRAFT = null; render(false); return; }
  if (act === "draft-save" && id && DRAFT && DRAFT.id === id) {
    const m = S.machines[id], v = DRAFT.v, list = Object.keys(v).map(k => `<li>${esc(CHAMPS[k] || k)} : ${esc(histVal(k, m[k] == null ? "" : String(m[k])))} → <b>${esc(histVal(k, v[k] == null ? "" : String(v[k])))}</b></li>`).join("");
    openModal({ title: `Enregistrer ${esc(id)} ?`, html: `<p class="mq">Tu vas modifier :</p><ul class="mlist">${list}</ul>`, ok: "💾 Oui, enregistrer",
      onOk: () => { const ch = Object.assign({}, v); if ("equipe" in ch) ch.affectation = ch.equipe != null ? chef(ch.equipe) : ""; DRAFT = null; setFields(id, ch); return true; } });
    return;
  }
  if (act === "actif" && id) {
    const m = S.machines[id], off = m.actif !== false;
    openModal({
      title: off ? `Retirer ${esc(m.id)} ?` : `Remettre ${esc(m.id)} ?`,
      html: off ? `<p class="mq">Elle ne sera plus comptée dans le parc, mais restera visible dans « Machines retirées » et pourra être remise.</p>` : `<p class="mq">Elle reviendra dans le parc, disponible au dépôt.</p>`,
      ok: off ? "Oui, retirer" : "Oui, remettre", okColor: off ? sc("probleme") : undefined,
      onOk: () => { setFields(id, off ? { actif: false, statut: "hs", depuis: today() } : { actif: true, statut: "disponible", lieu: "depot", equipe: null, depuis: today() }); return true; },
    });
    return;
  }
  if (act === "save-add") {
    const num = $("#a-num").value.trim().toUpperCase().replace(/\s+/g, ""), mod = $("#a-mod").value.trim(), eqv = $("#a-eq").value;
    const msg = $("#a-msg");
    if (!num) { msg.innerHTML = `<div class="msg err">Indique le numéro interne.</div>`; return; }
    if (S.machines[num]) { msg.innerHTML = `<div class="msg err">Le numéro ${esc(num)} existe déjà.</div>`; return; }
    const eq = eqv === "" ? null : +eqv;
    addMachine({ id: num, famille: t.dataset.fam, modele: mod, equipe: eq, affectation: eq != null ? chef(eq) : "", statut: eq != null ? "operationnelle" : "disponible", lieu: eq != null ? "equipe" : "depot", depuis: today(), actif: true, ordre: 1000 });
    replaceTo(`#/machine/${encodeURIComponent(num)}`); return;
  }
});
function draftSet(id, fld, v) {
  const m = S.machines[id];
  if (!DRAFT || DRAFT.id !== id) DRAFT = { id, v: {} };
  if ((m[fld] ?? null) === (v ?? null)) delete DRAFT.v[fld]; else DRAFT.v[fld] = v;
  const bar = $("#savebar"); if (bar) bar.classList.toggle("hidden", !Object.keys(DRAFT.v).length);
}
function fieldValue(el) {
  const fld = el.dataset.field; let v = el.value;
  if (fld === "equipe") return v === "" ? null : +v;
  if (["depuis", "controle", "depose_le", "recupere_le", "pret_le"].includes(fld)) return v || null;
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
      const { error } = await supa.storage.from("photos").upload(p.key, rec.blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      rec.sent = true; await idbPut(p.key, rec);   // la copie locale reste sur le téléphone
      PHOTOS_WAIT = PHOTOS_WAIT.filter(x => x.key !== p.key);
      if (p.kind === "main" && S.machines[p.id] && (latestLocal[p.id] === p.key || !S.machines[p.id].photo)) setFields(p.id, { photo: p.key });
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
  if (e.target.id !== "photo-input" || !e.target.files || !e.target.files[0]) return;
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
  const hasCache = Object.keys(S.machines).length > 0;
  if (hasCache) render(true);
  const lm = $("#loader-msg"); if (lm) lm.textContent = "Synchronisation en cours…";
  const timer = setTimeout(() => { if (hasCache) hideLoader(); }, 6000);
  await flush();
  const ok = await refresh();
  clearTimeout(timer);
  if (!ok && !hasCache) { const l2 = $("#loader-msg"); if (l2) l2.textContent = "Pas de réseau. Réessaie quand tu as internet."; setTimeout(() => location.reload(), 15000); return; }
  render(true); hideLoader(); checkRobot();
  // temps réel : les modifs de l'autre téléphone arrivent tout de suite
  try {
    channel = supa.channel("asdj")
      .on("postgres_changes", { event: "*", schema: "public", table: "machines" }, p => { if (p.new && p.new.id) { mergeRow(p.new); saveLocal(); softRender(); } })
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
  checkVersion().then(upd => { if (upd) return; checkRobot(); sendPhotos(); flush().then(() => refresh()).then(ok => ok && softRender()); });
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
