/* ASDJ - Tools : suivi du matériel par famille et par équipe.
   Données partagées entre les comptes connectés (Supabase), copie locale + file d'attente pour le hors ligne. */
"use strict";
const CFG = window.APP_CONFIG;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- référentiels ---------- */
const FAMILLES = [
  { id: "tondeuse", nom: "Tondeuses", un: "Tondeuse" },
  { id: "debroussailleuse", nom: "Débroussailleuses", un: "Débroussailleuse" },
  { id: "souffleur", nom: "Souffleurs", un: "Souffleur" },
  { id: "taillehaie", nom: "Taille-haies", un: "Taille-haie" },
  { id: "tronconneuse", nom: "Tronçonneuses", un: "Tronçonneuse" },
];
const FAM = Object.fromEntries(FAMILLES.map(f => [f.id, f]));
const STATUTS = [
  { id: "operationnelle", nom: "Opérationnelle" },
  { id: "controle", nom: "Contrôle fait" },
  { id: "disponible", nom: "Disponible" },
  { id: "probleme", nom: "Problème technique" },
  { id: "reparation", nom: "En réparation" },
  { id: "hs", nom: "HS" },
];
const ST = Object.fromEntries(STATUTS.map(s => [s.id, s]));
const LIEUX = { depot: "Au dépôt", equipe: "Avec l'équipe", reparateur: "Chez le réparateur" };
const sc = id => `var(--s-${id})`;
const fc = id => `var(--f-${id})`;

/* Pictos des familles (dessins maison, trait blanc) */
const ICONS = {
  tondeuse: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M31 24 41 6h5"/><path d="M11 24c0-6 4-9 9-9s9 3 9 9"/><rect x="5" y="24" width="30" height="8" rx="3"/><circle cx="11" cy="37" r="4"/><circle cx="30" cy="37" r="4"/><path d="M4 45h40" stroke-dasharray="2 4"/></svg>`,
  debroussailleuse: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="39" cy="9" r="5"/><path d="M35 13 11 37"/><path d="M19 22l10 10M17 24l-3 3M31 30l-3 3"/><ellipse cx="9" cy="40" rx="7" ry="3"/><path d="M2 44l3-2M16 44l-3-2"/></svg>`,
  souffleur: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="17" height="24" rx="5"/><path d="M9 12h7M9 18h7"/><path d="M20 26c9 0 9 12 18 12"/><path d="M38 34v8"/><path d="M42 32h4M42 38h5M42 44h4"/></svg>`,
  taillehaie: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="19" width="15" height="11" rx="4"/><path d="M8 19c0-6 3-9 9-9h2v9"/><rect x="18" y="21" width="27" height="6" rx="2"/><path d="M22 21v-3M27 21v-3M32 21v-3M37 21v-3M42 21v-3M22 27v3M27 27v3M32 27v3M37 27v3M42 27v3"/></svg>`,
  tronconneuse: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="18" width="18" height="15" rx="4"/><path d="M7 18c0-6 3-9 8-9h6v9"/><path d="M21 21h20a4.5 4.5 0 0 1 0 9H21"/><path d="M25 21v-2M30 21v-2M35 21v-2M40 21v-2M25 30v2M30 30v2M35 30v2M40 30v2"/></svg>`,
};
const SVG = {
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  team: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.2c2.9.2 5 2.3 5 5.3"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>`,
  out: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4"/></svg>`,
};

/* ---------- état + stockage local ---------- */
const LS_CACHE = "asdj_cache_v1", LS_Q = "asdj_queue_v1", LS_REJ = "asdj_rejets_v1";
const S = { machines: {}, equipes: {}, cacheAt: 0 };
let Q = [];        // modifications pas encore envoyées
let REJ = [];      // modifications refusées par le serveur (gardées, jamais effacées)
let supa = null, USER = null, online = navigator.onLine, lastSyncOk = 0;
try {
  const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
  if (c) { S.machines = c.m || {}; S.equipes = c.e || {}; S.cacheAt = c.at || 0; }
  Q = JSON.parse(localStorage.getItem(LS_Q) || "[]");
  REJ = JSON.parse(localStorage.getItem(LS_REJ) || "[]");
} catch (e) { console.warn("cache illisible", e); }
function saveLocal() {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify({ m: S.machines, e: S.equipes, at: S.cacheAt }));
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
const teamLabel = n => n == null ? "Sans équipe" : `Équipe ${n}` + (chef(n) ? ` · ${chef(n)}` : "");
const natural = (a, b) => a.localeCompare(b, "fr", { numeric: true });
const actives = () => Object.values(S.machines).filter(m => m.actif !== false);
function whereTxt(m) {
  if (m.statut === "reparation" || m.lieu === "reparateur") return `Chez ${m.reparateur || "le réparateur"}` + (m.depuis ? ` · ${sinceTxt(m.depuis)}` : "");
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
  }
}
let tsLast = 0;
const nowTs = () => { const t = Math.max(Date.now(), tsLast + 1); tsLast = t; return t; };
function setFields(id, obj) {
  const m = S.machines[id]; if (!m) return;
  for (const [c, v] of Object.entries(obj)) {
    if ((m[c] ?? null) === (v ?? null)) continue;
    const op = { k: "f", id, c, v, ts: nowTs() };
    // une seule modif en attente par champ : la dernière remplace la précédente
    Q = Q.filter(o => !(o.k === "f" && o.id === id && o.c === c));
    Q.push(op); applyOp(op);
  }
  saveLocal(); updateStatus(); flushSoon();
}
function addMachine(row) {
  const op = { k: "new", row, ts: nowTs() };
  Q.push(op); applyOp(op); saveLocal(); updateStatus(); flushSoon();
}
function setChef(n, v) {
  const op = { k: "eq", n, v, ts: nowTs() };
  Q = Q.filter(o => !(o.k === "eq" && o.n === n));
  Q.push(op); applyOp(op); saveLocal(); updateStatus(); flushSoon();
}
/* une ligne arrive du serveur : on la prend, puis on remet par-dessus ce qui n'est pas encore envoyé */
function mergeRow(r) {
  S.machines[r.id] = Object.assign({}, r);
  Q.filter(o => (o.k === "f" || o.k === "new") && (o.id === r.id || (o.row && o.row.id === r.id))).forEach(applyOp);
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
    lastSyncOk = Date.now();
  } catch (e) { console.warn("envoi reporté", e); }
  finally { flushing = false; updateStatus(); softRender(); }
}

/* ---------- chargement depuis le serveur (paginé : 1000 lignes max par requête) ---------- */
async function fetchAll(table, order) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await supa.from(table).select("*").order(order).range(from, from + 999);
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
    const [ms, es] = await Promise.all([fetchAll("machines", "id"), fetchAll("equipes", "numero")]);
    const keepNew = Q.filter(o => o.k === "new");
    S.machines = {}; ms.forEach(r => S.machines[r.id] = r);
    S.equipes = {}; es.forEach(r => S.equipes[r.numero] = r);
    keepNew.forEach(applyOp); Q.forEach(applyOp);
    S.cacheAt = Date.now(); lastSyncOk = Date.now(); saveLocal();
    return true;
  } catch (e) { console.warn("lecture serveur impossible", e); return false; }
  finally { refreshing = false; updateStatus(); }
}

/* ---------- barre d'état ---------- */
function updateStatus(force) {
  const el = $("#status"); if (!el || !USER) return;
  el.classList.remove("hidden", "busy", "off", "err");
  let txt, cls = "";
  const n = Q.length;
  if (force === "busy" || flushing) { cls = "busy"; txt = "Envoi en cours…"; }
  else if (!navigator.onLine) { cls = "off"; txt = n ? `Hors ligne · ${n} modif${n > 1 ? "s" : ""} en attente d'envoi` : "Hors ligne · tout est gardé sur le téléphone"; }
  else if (n) { cls = "off"; txt = `${n} modif${n > 1 ? "s" : ""} en attente d'envoi`; }
  else { txt = "Tout est sauvegardé en ligne"; }
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

/* ---------- navigation (bouton retour du téléphone = écran précédent) ---------- */
const scrolls = {};
let stack = [], replacing = false, current = "";
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
  render(true);
});
function parseRoute() {
  const h = (location.hash.slice(1) || "/");
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || ""), key: h };
}

/* ---------- rendu ---------- */
function header(title, sub, opts = {}) {
  const left = opts.home
    ? `<img class="logo" src="icons/icon-192.png" alt="">`
    : `<button class="iconbtn" data-act="back" aria-label="Retour">${SVG.back}</button>`;
  const right = opts.right || "";
  const famIc = opts.fam ? `<span class="hfam" style="color:${fc(opts.fam)}">${ICONS[opts.fam]}</span>` : "";
  return `<header class="top"><div class="row">${left}${famIc}<h1>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</h1>${right}</div></header>`;
}
function cardHTML(m) {
  return `<a class="card ${m.actif === false ? "off" : ""}" href="#/machine/${encodeURIComponent(m.id)}" style="--c:${sc(m.statut)}">
    <span class="stripe"></span>
    <span class="body"><span class="num">${esc(m.id)}</span><span class="mod">${esc(m.modele)}</span><div class="where">${esc(whereTxt(m))}</div></span>
    <span class="side"><span class="pill">${esc(ST[m.statut] ? ST[m.statut].nom : m.statut)}</span></span></a>`;
}

function viewHome() {
  const all = actives(), c = countBy(all);
  const urgent = ["reparation", "probleme", "hs"].filter(s => c[s]);
  const alerts = urgent.length
    ? `<div class="alerts">${urgent.map(s => `<a class="alert" href="#/tout?statut=${s}" style="background:${sc(s)}"><b>${c[s]}</b> ${esc(ST[s].nom)}</a>`).join("")}</div>`
    : `<div class="allgood">🌿 Tout le matériel est en état. Aucune machine en panne ni en réparation.</div>`;
  const tiles = FAMILLES.map(f => {
    const l = all.filter(m => m.famille === f.id);
    return `<a class="tile" href="#/famille/${f.id}"><span class="ic" style="background:${fc(f.id)}">${ICONS[f.id]}</span>
      <h2>${esc(f.nom)}</h2><span class="n">${l.length} machine${l.length > 1 ? "s" : ""}</span>${barHTML(l)}${dotsHTML(l, ["probleme", "reparation", "hs"])}</a>`;
  }).join("");
  return header("ASDJ - Tools", "Au service des jardins", { home: true, right: `<button class="iconbtn" data-act="logout" aria-label="Se déconnecter">${SVG.out}</button>` }) +
    `<main>${alerts}<div class="tiles">${tiles}
      <a class="tile wide" href="#/equipes"><span class="ic">${SVG.team}</span><span class="txt"><h2>Par équipe</h2><span class="n">Le matériel de chaque chef d'équipe</span></span></a>
      <a class="tile wide" href="#/tout"><span class="ic">${SVG.list}</span><span class="txt"><h2>Toutes les machines</h2><span class="n">${all.length} machines · recherche</span></span></a>
    </div></main>`;
}

let famSort = "num";
function statusChips(list, sel, base) {
  const c = countBy(list);
  return `<div class="chips"><a class="chip ${!sel ? "on" : ""}" href="${base}">Toutes · ${list.length}</a>${STATUTS.filter(s => c[s.id]).map(s =>
    `<a class="chip ${sel === s.id ? "on" : ""}" href="${base}${base.includes("?") ? "&" : "?"}statut=${s.id}"><span class="sw" style="background:${sc(s.id)}"></span>${esc(s.nom)} · ${c[s.id]}</a>`).join("")}</div>`;
}
function viewFamille(fid, q) {
  const f = FAM[fid]; if (!f) return viewHome();
  const all = Object.values(S.machines).filter(m => m.famille === fid);
  const act = all.filter(m => m.actif !== false), off = all.filter(m => m.actif === false);
  const sel = q.get("statut");
  let list = act.filter(m => !sel || m.statut === sel);
  let body;
  if (famSort === "equipe") {
    const groups = {};
    list.forEach(m => { const k = m.equipe == null ? "z" : String(m.equipe).padStart(3, "0"); (groups[k] = groups[k] || []).push(m); });
    body = Object.keys(groups).sort().map(k => `<div class="group-h">${esc(k === "z" ? "Sans équipe (dépôt)" : teamLabel(+k))}</div><div class="list">${groups[k].sort((a, b) => natural(a.id, b.id)).map(cardHTML).join("")}</div>`).join("");
  } else body = `<div class="list">${list.sort((a, b) => natural(a.id, b.id)).map(cardHTML).join("")}</div>`;
  if (!list.length) body = `<div class="empty">Aucune machine ici.</div>`;
  const retired = off.length ? `<details class="retired"><summary>Machines retirées du parc (${off.length})</summary><div class="list">${off.sort((a, b) => natural(a.id, b.id)).map(cardHTML).join("")}</div></details>` : "";
  return header(f.nom, `${act.length} machine${act.length > 1 ? "s" : ""}`, { fam: fid }) +
    `<main><div class="seg"><button data-act="sort" data-v="num" class="${famSort === "num" ? "on" : ""}">Par numéro</button><button data-act="sort" data-v="equipe" class="${famSort === "equipe" ? "on" : ""}">Par équipe</button></div>
    ${statusChips(act, sel, `#/famille/${fid}`)}${body}${retired}</main>
    <button class="fab" data-act="add" data-fam="${fid}" aria-label="Ajouter une machine">+</button>`;
}

function viewEquipes() {
  const all = actives();
  const nums = Object.keys(S.equipes).map(Number).sort((a, b) => a - b);
  const cards = nums.map(n => {
    const l = all.filter(m => m.equipe === n);
    return `<a class="card" href="#/equipe/${n}" style="--c:var(--green)"><span class="body team"><span class="badge">${n}</span>
      <span style="flex:1;min-width:0"><span class="num" style="font-size:18px">${esc(chef(n) || "Chef à indiquer")}</span><div class="where">${l.length} machine${l.length > 1 ? "s" : ""}</div>${barHTML(l)}</span></span></a>`;
  }).join("");
  const dep = all.filter(m => m.equipe == null);
  return header("Par équipe", "Le matériel de chaque chef") + `<main><div class="list">${cards}
    <a class="card" href="#/equipe/depot" style="--c:var(--s-disponible)"><span class="body team"><span class="badge depot">D</span>
      <span style="flex:1;min-width:0"><span class="num" style="font-size:18px">Sans équipe</span><div class="where">${dep.length} machine${dep.length > 1 ? "s" : ""} au dépôt ou en réparation</div>${barHTML(dep)}</span></span></a>
  </div></main>`;
}
function viewEquipe(id, q) {
  const isDep = id === "depot", n = isDep ? null : +id;
  const all = actives().filter(m => isDep ? m.equipe == null : m.equipe === n);
  const sel = q.get("statut");
  const list = all.filter(m => !sel || m.statut === sel);
  const body = FAMILLES.map(f => {
    const l = list.filter(m => m.famille === f.id).sort((a, b) => natural(a.id, b.id));
    return l.length ? `<div class="group-h"><span style="color:${fc(f.id)}">${ICONS[f.id]}</span>${esc(f.nom)} · ${l.length}</div><div class="list">${l.map(cardHTML).join("")}</div>` : "";
  }).join("") || `<div class="empty">Aucune machine ici.</div>`;
  const edit = isDep ? "" : `<button class="iconbtn" data-act="chef" data-n="${n}" aria-label="Changer le chef">✎</button>`;
  return header(isDep ? "Sans équipe" : `Équipe ${n}`, isDep ? "Au dépôt ou en réparation" : (chef(n) ? `Chef : ${chef(n)}` : "Chef à indiquer"), { right: edit }) +
    `<main>${statusChips(all, sel, `#/equipe/${id}`)}${body}</main>`;
}
function viewTout(q) {
  const sel = q.get("statut"), txt = (q.get("q") || "").trim().toLowerCase();
  const all = actives();
  const list = all.filter(m => (!sel || m.statut === sel) &&
    (!txt || [m.id, m.modele, FAM[m.famille] && FAM[m.famille].un, chef(m.equipe), m.reparateur, m.notes, m.motif].join(" ").toLowerCase().includes(txt)))
    .sort((a, b) => natural(a.id, b.id));
  return header("Toutes les machines", `${all.length} machines`) +
    `<main><input class="search" id="search" type="search" placeholder="Chercher : T01, HRX, Nico, réparateur…" value="${esc(q.get("q") || "")}">
    ${statusChips(all, sel, `#/tout${txt ? `?q=${encodeURIComponent(txt)}` : ""}`)}
    <div class="list">${list.map(cardHTML).join("") || `<div class="empty">Aucune machine trouvée.</div>`}</div></main>`;
}

function viewMachine(id) {
  const m = S.machines[id];
  if (!m) return header("Machine introuvable") + `<main><div class="empty">Cette machine n'existe pas (ou plus).</div></main>`;
  const f = FAM[m.famille] || { un: m.famille };
  const teamOpts = `<option value="">Sans équipe</option>` + Object.keys(S.equipes).map(Number).sort((a, b) => a - b)
    .map(n => `<option value="${n}" ${m.equipe === n ? "selected" : ""}>${esc(teamLabel(n))}</option>`).join("");
  const showRep = m.lieu === "reparateur" || m.statut === "reparation";
  return header(`${m.id} · ${m.modele}`, f.un) + `<main>
    <div class="hero" style="--c:${sc(m.statut)}"><span class="fam">${ICONS[m.famille] || ""}</span>
      <div class="big">${esc(m.id)}</div><div class="mod">${esc(f.un)} ${esc(m.modele)}</div>
      <div class="st">${esc(ST[m.statut] ? ST[m.statut].nom : m.statut)}</div>
      <div class="since">${esc(LIEUX[m.lieu] || "")}${m.lieu === "reparateur" && m.reparateur ? ` : ${esc(m.reparateur)}` : ""}${m.depuis ? ` · ${esc(sinceTxt(m.depuis))}` : ""}</div></div>

    <div class="sect"><h3>État de la machine</h3><div class="stgrid">
      ${STATUTS.map(s => `<button class="stbtn ${m.statut === s.id ? "on" : ""}" style="--c:${sc(s.id)}" data-act="statut" data-v="${s.id}">${esc(s.nom)}</button>`).join("")}
    </div></div>

    <div class="sect"><h3>Où est-elle ?</h3><div class="where3">
      ${Object.entries(LIEUX).map(([k, v]) => `<button class="${m.lieu === k ? "on" : ""}" data-act="lieu" data-v="${k}">${esc(v)}</button>`).join("")}
    </div>
      <div class="${showRep ? "" : "hidden"}"><label class="f" for="f-rep">Nom du réparateur (entreprise)</label>
        <input class="inp" id="f-rep" data-field="reparateur" value="${esc(m.reparateur)}" placeholder="Ex. : Motoculture Dupont"></div>
      <label class="f" for="f-depuis">Depuis le</label>
      <input class="inp" id="f-depuis" type="date" data-field="depuis" value="${esc(m.depuis || "")}">
      <label class="f" for="f-motif">Pourquoi ? (panne, problème, raison)</label>
      <textarea class="inp" id="f-motif" data-field="motif" placeholder="Ex. : ne démarre plus, lame cassée…">${esc(m.motif)}</textarea>
    </div>

    <div class="sect"><h3>Équipe responsable</h3>
      <select class="inp" id="f-equipe" data-field="equipe">${teamOpts}</select>
      <label class="f" for="f-controle">Dernier contrôle</label>
      <input class="inp" id="f-controle" type="date" data-field="controle" value="${esc(m.controle || "")}">
    </div>

    <div class="sect"><h3>Infos</h3>
      <label class="f" for="f-modele" style="margin-top:0">Modèle</label>
      <input class="inp" id="f-modele" data-field="modele" value="${esc(m.modele)}">
      <label class="f" for="f-notes">Notes</label>
      <textarea class="inp" id="f-notes" data-field="notes">${esc(m.notes)}</textarea>
    </div>

    <div class="sect"><h3>Historique</h3><ul class="hist" id="hist"><li>Chargement…</li></ul></div>

    <button class="btn ${m.actif === false ? "light" : "danger"}" data-act="actif">${m.actif === false ? "Remettre dans le parc" : "Retirer du parc (vendue, perdue, détruite…)"}</button>
  </main>`;
}
const CHAMPS = { statut: "État", lieu: "Lieu", reparateur: "Réparateur", depuis: "Depuis", motif: "Pourquoi", equipe: "Équipe", controle: "Contrôle", modele: "Modèle", notes: "Notes", actif: "Dans le parc", affectation: "Affectation" };
function histVal(c, v) {
  if (v == null || v === "") return "—";
  if (c === "statut") return ST[v] ? ST[v].nom : v;
  if (c === "lieu") return LIEUX[v] || v;
  if (c === "equipe") return teamLabel(+v);
  if (c === "depuis" || c === "controle") return frDate(v);
  if (c === "actif") return v === "true" ? "oui" : "non";
  return v;
}
async function loadHist(id) {
  const ul = $("#hist"); if (!ul) return;
  if (!supa || !navigator.onLine) { ul.innerHTML = `<li>Visible quand il y a du réseau.</li>`; return; }
  const { data, error } = await supa.from("historique").select("*").eq("machine_id", id).order("at", { ascending: false }).limit(40);
  if (!$("#hist")) return;
  if (error) { ul.innerHTML = `<li>Historique indisponible pour le moment.</li>`; return; }
  ul.innerHTML = (data || []).length ? data.map(h => {
    const d = new Date(h.at);
    return `<li><time>${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time>${esc(CHAMPS[h.champ] || h.champ)} : ${esc(histVal(h.champ, h.ancien))} → <b>${esc(histVal(h.champ, h.nouveau))}</b></li>`;
  }).join("") : `<li>Aucun changement pour l'instant.</li>`;
}

function viewAjout(fid) {
  const f = FAM[fid] || FAMILLES[0];
  const teamOpts = `<option value="">Sans équipe (au dépôt)</option>` + Object.keys(S.equipes).map(Number).sort((a, b) => a - b).map(n => `<option value="${n}">${esc(teamLabel(n))}</option>`).join("");
  return header(`Ajouter : ${f.un}`, "Nouvelle machine", { fam: f.id }) + `<main><div class="sect">
    <label class="f" for="a-num" style="margin-top:0">Numéro interne (ex. : T14)</label><input class="inp" id="a-num" autocapitalize="characters" autocomplete="off">
    <label class="f" for="a-mod">Modèle (ex. : HRX 537)</label><input class="inp" id="a-mod" autocomplete="off">
    <label class="f" for="a-eq">Équipe</label><select class="inp" id="a-eq">${teamOpts}</select>
    <div id="a-msg"></div><div style="height:14px"></div>
    <button class="btn" data-act="save-add" data-fam="${f.id}">Ajouter la machine</button></div></main>`;
}
function viewChef(n) {
  return header(`Équipe ${n}`, "Chef d'équipe") + `<main><div class="sect">
    <label class="f" for="c-nom" style="margin-top:0">Nom du chef de l'équipe ${n}</label><input class="inp" id="c-nom" value="${esc(chef(n))}" autocomplete="off">
    <div style="height:14px"></div><button class="btn" data-act="save-chef" data-n="${n}">Enregistrer</button></div></main>`;
}

/* rendu principal (garde la position de défilement de chaque écran) */
let pendingRender = false;
function render(nav) {
  if (!USER) return;
  const r = parseRoute(); current = r.key; const [a, b] = r.parts;
  let html;
  if (!a) html = viewHome();
  else if (a === "famille") html = viewFamille(b, r.q);
  else if (a === "equipes") html = viewEquipes();
  else if (a === "equipe") html = viewEquipe(b, r.q);
  else if (a === "tout") html = viewTout(r.q);
  else if (a === "machine") html = viewMachine(b);
  else if (a === "ajouter") html = viewAjout(b);
  else if (a === "chef") html = viewChef(+b);
  else html = viewHome();
  const y = nav ? (scrolls[r.key] || 0) : window.scrollY;
  $("#app").innerHTML = html;
  window.scrollTo(0, y);
  if (a === "machine" && nav) loadHist(b);
  if (a === "tout") { const s = $("#search"); if (s && document.activeElement !== s && nav === "search") s.focus(); }
  pendingRender = false;
}
/* nouvelles données : on rafraîchit sans déranger quelqu'un en train d'écrire */
function softRender() {
  const ae = document.activeElement;
  if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) { pendingRender = true; return; }
  render(false);
  const r = parseRoute(); if (r.parts[0] === "machine") loadHist(r.parts[1]);
}

/* ---------- actions ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const act = t.dataset.act, r = parseRoute();
  if (act === "back") return back();
  if (act === "logout") { if (Q.length) { alert(`Impossible de se déconnecter : ${Q.length} modification(s) pas encore envoyée(s). Attends d'avoir du réseau.`); return; } await supa.auth.signOut(); location.replace("#/"); location.reload(); return; }
  if (act === "sort") { famSort = t.dataset.v; render(false); return; }
  if (act === "add") return go(`#/ajouter/${t.dataset.fam}`);
  if (act === "chef") return go(`#/chef/${t.dataset.n}`);
  const id = r.parts[0] === "machine" ? r.parts[1] : null;
  if (act === "statut" && id) {
    const m = S.machines[id], v = t.dataset.v, ch = { statut: v };
    if (v !== m.statut) ch.depuis = today();
    if (v === "reparation") ch.lieu = "reparateur";
    else if (v === "disponible") ch.lieu = "depot";
    else if (v === "controle") ch.controle = today();
    if (v !== "reparation" && m.lieu === "reparateur") ch.lieu = m.equipe != null ? "equipe" : "depot";
    if (v === "operationnelle" && m.lieu === "depot" && m.equipe != null) ch.lieu = "equipe";
    setFields(id, ch); render(false);
    if (v === "reparation" && !S.machines[id].reparateur) setTimeout(() => { const i = $("#f-rep"); if (i) { i.focus(); i.scrollIntoView({ block: "center", behavior: "smooth" }); } }, 50);
    return;
  }
  if (act === "lieu" && id) {
    const m = S.machines[id], v = t.dataset.v, ch = { lieu: v };
    if (v !== m.lieu) ch.depuis = today();
    if (v === "reparateur") ch.statut = "reparation";
    else if (m.statut === "reparation") ch.statut = v === "depot" ? "disponible" : "operationnelle";
    setFields(id, ch); render(false);
    if (v === "reparateur") setTimeout(() => { const i = $("#f-rep"); if (i) i.focus(); }, 50);
    return;
  }
  if (act === "actif" && id) {
    const m = S.machines[id], off = m.actif !== false;
    if (off && !confirm(`Retirer ${m.id} du parc ? Elle restera visible dans « Machines retirées » et pourra être remise.`)) return;
    setFields(id, off ? { actif: false, statut: "hs", depuis: today() } : { actif: true, statut: "disponible", lieu: "depot", depuis: today() });
    render(false); return;
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
  if (act === "save-chef") { setChef(+t.dataset.n, $("#c-nom").value.trim()); back(); return; }
});
document.addEventListener("change", e => {
  const el = e.target, fld = el.dataset && el.dataset.field; if (!fld) return;
  const r = parseRoute(); if (r.parts[0] !== "machine") return;
  let v = el.value;
  if (fld === "equipe") v = v === "" ? null : +v;
  if (fld === "depuis" || fld === "controle") v = v || null;
  if (fld !== "equipe" && typeof v === "string") v = v.trim();
  const ch = { [fld]: v };
  if (fld === "equipe") { ch.affectation = v != null ? chef(v) : ""; const m = S.machines[r.parts[1]]; if (m.lieu === "equipe" && v == null) ch.lieu = "depot"; }
  setFields(r.parts[1], ch);
});
document.addEventListener("focusout", () => { setTimeout(() => { if (pendingRender && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) softRender(); }, 100); });
let searchT = null;
document.addEventListener("input", e => {
  if (e.target.id !== "search") return;
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    const r = parseRoute(), q = new URLSearchParams(r.q); const v = e.target.value.trim();
    if (v) q.set("q", v); else q.delete("q");
    const qs = q.toString(); history.replaceState(null, "", `#/tout${qs ? "?" + qs : ""}`);
    const pos = e.target.selectionStart; render(false);
    const s = $("#search"); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (_) {} }
  }, 200);
});

/* ---------- connexion ---------- */
const NEED_PWD = /type=(invite|recovery)/.test(location.hash);
function viewLogin(mode, msg) {
  $("#status").classList.add("hidden");
  const pwd = mode === "pwd";
  $("#app").innerHTML = `<div class="login"><div class="brand"><img src="icons/icon-192.png" alt=""><h1>ASDJ - Tools</h1><p class="sub">Au service des jardins</p></div>
    <div class="sect">${pwd ? `<label class="f" for="lg-new" style="margin-top:0">Choisis ton mot de passe (8 caractères minimum)</label><input class="inp" id="lg-new" type="password" autocomplete="new-password">
      <div style="height:14px"></div><button class="btn" id="lg-setpwd">Enregistrer mon mot de passe</button>`
    : `<label class="f" for="lg-mail" style="margin-top:0">Adresse e-mail</label><input class="inp" id="lg-mail" type="email" autocomplete="username">
      <label class="f" for="lg-pass">Mot de passe</label><input class="inp" id="lg-pass" type="password" autocomplete="current-password">
      <div style="height:14px"></div><button class="btn" id="lg-go">Se connecter</button><button class="link" id="lg-forgot">Mot de passe oublié ?</button>`}
    <div id="lg-msg">${msg ? `<div class="msg ${msg.err ? "err" : ""}">${esc(msg.t)}</div>` : ""}</div></div></div>`;
  hideLoader();
  if (pwd) {
    $("#lg-setpwd").onclick = async () => {
      const p = $("#lg-new").value; if (p.length < 8) { $("#lg-msg").innerHTML = `<div class="msg err">8 caractères minimum.</div>`; return; }
      const { error } = await supa.auth.updateUser({ password: p });
      if (error) { $("#lg-msg").innerHTML = `<div class="msg err">${esc(error.message)}</div>`; return; }
      location.replace(location.pathname + "#/"); start();
    };
    return;
  }
  $("#lg-go").onclick = async () => {
    const btn = $("#lg-go"); btn.disabled = true; btn.textContent = "Connexion…";
    const { data, error } = await supa.auth.signInWithPassword({ email: $("#lg-mail").value.trim(), password: $("#lg-pass").value });
    btn.disabled = false; btn.textContent = "Se connecter";
    if (error) { $("#lg-msg").innerHTML = `<div class="msg err">${navigator.onLine ? "E-mail ou mot de passe incorrect." : "Pas de réseau : la première connexion demande internet."}</div>`; return; }
    USER = data.user; start();
  };
  $("#lg-forgot").onclick = async () => {
    const mail = $("#lg-mail").value.trim();
    if (!mail) { $("#lg-msg").innerHTML = `<div class="msg err">Écris d'abord ton adresse e-mail au-dessus.</div>`; return; }
    const { error } = await supa.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname });
    $("#lg-msg").innerHTML = error ? `<div class="msg err">${esc(error.message)}</div>` : `<div class="msg">E-mail envoyé : ouvre le lien reçu pour choisir un nouveau mot de passe.</div>`;
  };
}

/* ---------- démarrage ---------- */
let loaderHidden = false;
function hideLoader() { if (loaderHidden) return; loaderHidden = true; const l = $("#loader"); l.classList.add("fade"); setTimeout(() => l.remove(), 400); }
let started = false, channel = null;
async function start() {
  if (started) { render(true); return; }
  started = true;
  if (!/^#\//.test(location.hash)) history.replaceState(null, "", location.pathname + "#/");
  stack = [location.hash.slice(1) || "/"];
  $("#status").classList.remove("hidden"); updateStatus();
  const hasCache = Object.keys(S.machines).length > 0;
  if (hasCache) render(true);
  $("#loader-msg").textContent = "Synchronisation en cours…";
  const timer = setTimeout(() => { if (hasCache) hideLoader(); }, 5000);
  await flush();
  const ok = await refresh();
  clearTimeout(timer);
  if (!ok && !hasCache) { $("#loader-msg").textContent = "Pas de réseau. Réessaie quand tu as internet."; setTimeout(() => location.reload(), 15000); return; }
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
setInterval(() => { if (Q.length) flush(); }, 30000);
setInterval(() => { if (document.visibilityState === "visible" && USER) refresh().then(ok => ok && softRender()); }, 120000);
window.addEventListener("online", () => { updateStatus(); flush().then(() => refresh()).then(ok => ok && softRender()); });
window.addEventListener("offline", () => updateStatus());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && USER) { checkRobot(); flush().then(() => refresh()).then(ok => ok && softRender()); }
});

(async function init() {
  if (!window.supabase || !CFG) { $("#loader-msg").textContent = "Erreur de chargement. Ferme et rouvre l'appli."; return; }
  supa = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  supa.auth.onAuthStateChange((ev, session) => {
    if (ev === "PASSWORD_RECOVERY") viewLogin("pwd");
    if (session && session.user) USER = session.user;
  });
  const { data: { session } } = await supa.auth.getSession();
  if (NEED_PWD && session) { USER = session.user; viewLogin("pwd"); return; }
  if (session && session.user) { USER = session.user; start(); }
  else viewLogin("login");
})();
