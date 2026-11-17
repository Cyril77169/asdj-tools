// Robot « Notifications » : chaque matin vers 6 h 30 (et à midi pour l'urgent), envoie UNE notification groupée
// aux téléphones abonnés quand une échéance de véhicule approche. Lancé par .github/workflows/notifs.yml.
// Rythme (jours ouvrés seulement : pas le samedi, le dimanche ni les jours fériés) :
// 2 semaines avant → tous les 2 jours à 6 h 30 ; 2 derniers jours avant la date limite → 6 h 30 ET midi ;
// date dépassée sans rendez-vous ni « fait » → tous les 2 jours jusqu'à ce que ce soit fait ;
// rendez-vous pris → plus rien jusqu'au jour J (6 h 30), ou la veille ouvrée si le RDV tombe un jour non travaillé.

const ECH = [
  { k: "ct", nom: "CT", le: "ct_le", mois: "ct_mois" },
  { k: "pol", nom: "Pollution", le: "pol_le", mois: "pol_mois" },
  { k: "rev", nom: "Révision", le: "rev_le", mois: "rev_mois" },
];
const pad = n => String(n).padStart(2, "0");
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function addMonths(iso, n) { const [y, mo, d] = String(iso).slice(0, 10).split("-").map(Number); const x = new Date(y, mo - 1 + n, d); if (x.getDate() !== d) x.setDate(0); return x; }
const days = (iso, today) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); const [a, b, c] = today.split("-").map(Number); return Math.round((new Date(y, m - 1, d) - new Date(a, b - 1, c)) / 864e5); };
const frDate = iso => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}`; };
/* jours fériés en France (fixes + Pâques, Ascension, Pentecôte) */
function paques(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
export function ferie(iso) {
  const [y, m, d] = iso.split("-").map(Number), md = `${pad(m)}-${pad(d)}`;
  if (["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].includes(md)) return true;
  const p = paques(y), plus = n => isoOf(new Date(p.getFullYear(), p.getMonth(), p.getDate() + n));
  return [plus(1), plus(39), plus(50)].includes(iso);
}
export function ouvre(iso) { const [y, m, d] = iso.split("-").map(Number), j = new Date(y, m - 1, d).getDay(); return j !== 0 && j !== 6 && !ferie(iso); }
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return isoOf(new Date(y, m - 1, d + n)); };

// même calcul que l'appli (echeances)
export function echeances(m, today) {
  return ECH.filter(e => +m[e.mois] > 0).map(e => {
    if (e.k === "rev" && m.rev_mode === "km" && +m.rev_cible_km > 0) {
      const reste = +m.rev_cible_km - (+m.km || 0);
      return { ...e, mode: "km", reste, niveau: reste <= 0 ? "late" : reste <= 1000 ? "warn" : "ok" };
    }
    const rdv = m[`${e.k}_rdv`];
    if (rdv) { const j = days(rdv, today); return { ...e, mode: "rdv", rdv: String(rdv).slice(0, 10), rdvj: j, niveau: j <= 0 ? "warn" : "ok" }; }
    const av = m[`${e.k}_avant`]; let due = null;
    if (av) due = String(av).slice(0, 10);
    else if (e.k === "pol") {
      if (m.ct_le && (!m.pol_le || m.ct_le >= m.pol_le)) due = isoOf(addMonths(m.ct_le, +m.pol_mois));
      else return { ...e, niveau: m.pol_le || m.ct_avant ? "apres" : "vide" };
    } else if (m[e.le]) due = isoOf(addMonths(m[e.le], +m[e.mois]));
    else return { ...e, niveau: "vide" };
    const jours = days(due, today);
    return { ...e, due, jours, niveau: jours < 0 ? "late" : jours <= 14 ? "warn" : "ok" };
  });
}

// ce qu'il faut envoyer à ce créneau (« matin » ou « midi ») ; journal = { cle: dernier envoi (ms) }
export function selection(vehicules, journal, creneau, today, nowMs) {
  const items = [];
  for (const m of vehicules) {
    if (m.actif === false || m.famille !== "vehicule") continue;
    const nomV = m.plaque || m.modele || m.id;
    for (const x of echeances(m, today)) {
      // rendez-vous qui tombe un jour non travaillé (week-end, férié) : prévenir la veille ouvrée
      if (x.mode === "rdv" && x.rdvj > 0) {
        let tousOff = true; for (let i = 1; i <= x.rdvj; i++) if (ouvre(addDays(today, i))) { tousOff = false; break; }
        if (tousOff && creneau === "matin") {
          const lieu = m[x.k === "rev" ? "rev_garage" : `${x.k}_lieu`], cle = `${m.id}|${x.k}|${x.rdv}|jourJ`, [y, mo, d] = x.rdv.split("-").map(Number);
          if (!journal[cle]) items.push({ cle, txt: `RDV ${JOURS[new Date(y, mo - 1, d).getDay()]} : ${x.nom} ${nomV}${lieu ? ` (${lieu})` : ""}`, urgent: true });
        }
        continue;
      }
      if (x.niveau !== "warn" && x.niveau !== "late") continue;
      const base = `${m.id}|${x.k}|${x.due || x.rdv || "km" + m.rev_cible_km}`;
      let freq, txt;
      const lieu = m[x.k === "rev" ? "rev_garage" : `${x.k}_lieu`];
      if (x.mode === "rdv" && x.rdvj === 0) { freq = "jourJ"; txt = `RDV aujourd'hui : ${x.nom} ${nomV}${lieu ? ` (${lieu})` : ""}`; }
      else if (x.mode === "rdv") { freq = "2j"; txt = `${x.nom} ${nomV} : RDV du ${frDate(x.rdv)} passé, c'est fait ?`; }
      else if (x.mode === "km") { freq = "2j"; txt = `Révision ${nomV} : ${x.reste > 0 ? `plus que ${x.reste.toLocaleString("fr-FR")} km` : "kilométrage atteint"}`; }
      else if (x.jours < 0) { freq = "2j"; txt = `${x.nom} ${nomV} dépassé de ${-x.jours} j : RDV à prendre`; }
      else if (x.jours <= 2) { freq = "urgent"; txt = `${x.nom} ${nomV} ${x.jours === 0 ? "aujourd'hui" : `dans ${x.jours} j`}`; }
      else { freq = "2j"; txt = `${x.nom} ${nomV} dans ${x.jours} j`; }
      const last = journal[base] || 0;
      let ok = false;
      if (freq === "urgent") ok = true;                                            // 6 h et midi, tous les jours
      else if (creneau !== "matin") ok = false;
      else if (freq === "jourJ") ok = !journal[`${base}|jourJ`];                    // une fois, le matin du jour J
      else ok = nowMs - last >= 44 * 3600e3;                                       // tous les 2 jours, le matin
      if (ok) items.push({ cle: freq === "jourJ" ? `${base}|jourJ` : base, txt, urgent: freq === "urgent" || freq === "jourJ" || x.niveau === "late" });
    }
  }
  items.sort((a, b) => b.urgent - a.urgent);
  return items;
}
export function message(items) {
  const n = items.length;
  return { title: `🚐 ${n} rendez-vous véhicule${n > 1 ? "s" : ""} à gérer`, body: items.slice(0, 4).map(i => i.txt).join("\n") + (n > 4 ? `\n… et ${n - 4} autre${n - 4 > 1 ? "s" : ""}` : ""), url: "./#/vehicules" };
}
// créneau selon l'heure de Paris (le robot est lancé plusieurs fois pour couvrir l'heure d'été/d'hiver)
export function creneauParis(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(x => [x.type, x.value]));
  const h = +p.hour + +p.minute / 60, today = `${p.year}-${p.month}-${p.day}`;
  return { today, creneau: h >= 6.25 && h < 9.5 ? "matin" : h >= 11.7 && h < 14 ? "midi" : null };
}

/* ---------- lancement par le robot ---------- */
async function main() {
  const REF = process.env.SUPABASE_REF, TOKEN = process.env.SUPABASE_ACCESS_TOKEN, PRIV = process.env.VAPID_PRIVATE, TEST = process.env.NOTIF_TEST === "1";
  if (!TOKEN || !REF) throw new Error("SUPABASE_ACCESS_TOKEN manquant");
  if (!PRIV) { console.log("Clé VAPID_PRIVATE pas encore rangée dans les Secrets : rien à envoyer."); return; }
  const sql = async q => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
    const t = await r.text(); if (!r.ok) throw new Error(`Base : HTTP ${r.status} ${t.slice(0, 300)}`); return JSON.parse(t);
  };
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  // clé publique calculée à partir de la clé secrète, rangée dans la base pour que l'appli puisse s'abonner
  const crypto = await import("node:crypto");
  const ecdh = crypto.createECDH("prime256v1"); ecdh.setPrivateKey(Buffer.from(PRIV.trim(), "base64url"));
  const PUB = ecdh.getPublicKey().toString("base64url");
  await sql(`insert into public.reglages (cle, valeur) values ('vapid_public', ${q(PUB)}) on conflict (cle) do update set valeur = excluded.valeur`);
  const { today, creneau } = creneauParis(new Date());
  if (!creneau && !TEST) { console.log("Pas l'heure d'un envoi (6 h 30 ou midi, heure de Paris)."); return; }
  if (!TEST && !ouvre(today)) { console.log("Week-end ou jour férié : pas de notification aujourd'hui."); return; }
  const slotKey = `creneau|${creneau}|${today}`;
  // seulement les téléphones des chefs (Cyril et Nico), accès non coupé
  const abos = await sql("select a.endpoint, a.p256dh, a.auth from public.push_abonnements a join public.membres m on m.user_id = a.user_id where m.role = 'chef' and m.actif");
  if (!abos.length) { console.log("Aucun téléphone abonné."); return; }
  let items, msg;
  if (TEST) { items = []; msg = { title: "🔔 ASDJ - Tools", body: "Test : les notifications marchent sur ce téléphone.", url: "./#/vehicules" }; }
  else {
    if ((await sql(`select 1 from public.push_journal where cle = ${q(slotKey)}`)).length) { console.log("Créneau déjà traité aujourd'hui."); return; }
    const vehicules = await sql("select * from public.machines where famille = 'vehicule' and actif");
    const jr = await sql("select cle, max(le) as le from public.push_journal where le > now() - interval '30 days' group by cle");
    const journal = Object.fromEntries(jr.map(r => [r.cle, Date.parse(r.le)]));
    items = selection(vehicules, journal, creneau, today, Date.now());
    await sql(`insert into public.push_journal (cle) values (${q(slotKey)})`);
    if (!items.length) { console.log("Rien à signaler ce créneau."); return; }
    msg = message(items);
  }
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails("mailto:asdj.tools@example.com", PUB, PRIV.trim());
  let ok = 0; const morts = [];
  for (const a of abos) {
    try { await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, JSON.stringify(msg), { TTL: 6 * 3600, urgency: "high" }); ok++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) morts.push(a.endpoint); console.log("Envoi raté :", e.statusCode || "", String(e.body || e.message).slice(0, 120)); }
  }
  if (morts.length) await sql(`delete from public.push_abonnements where endpoint in (${morts.map(q).join(",")})`);
  if (items.length) await sql(`insert into public.push_journal (cle) values ${items.map(i => `(${q(i.cle)})`).join(",")}`);
  console.log(`Notification envoyée à ${ok} téléphone(s) sur ${abos.length} : ${msg.title} — ${msg.body.replace(/\n/g, " · ")}`);
}
if (process.argv[1] && process.argv[1].endsWith("notifs.mjs")) main().catch(e => { console.error("ERREUR :", e.message); process.exit(1); });
