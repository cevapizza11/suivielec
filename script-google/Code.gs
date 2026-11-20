/**
 * Suivi Jean Camp — script Google (compte cevapizza11@gmail.com)
 * v.20/11/2026
 *
 * Rôle :
 *  1. « lire »    : lit la photo d'un compteur avec Gemini (index + numéro de compteur)
 *  2. « ranger »  : range la photo validée dans le Drive :
 *                   RELEVER ELECTRICITE ENSEMBLE JEAN CAMP / ELECTRICITE <MOIS> <ANNÉE>  (ou EAU <MOIS> <ANNÉE>)
 *  3. « facture » : range le PDF d'une facture de charges dans GESTION LOCATIVE / AAAA-MM <MOIS> <ANNÉE>
 *  4. « ping »    : test de connexion depuis l'appli
 *
 * Réglages (Paramètres du projet ⚙️ → Propriétés du script) :
 *   GEMINI_KEY = ta clé Gemini (https://aistudio.google.com/apikey)
 *   TOKEN      = un mot de passe au choix, le même que dans l'appli (👤 Locataires → 📷 Lecture des photos)
 *   MODELE     = (facultatif) nom du modèle Gemini à utiliser en priorité
 */

const DOSSIER_RELEVES = '1ZGwmHqLbl0kQjf1RjEZ2TmXEC908lxAn';   // RELEVER ELECTRICITE ENSEMBLE JEAN CAMP
const DOSSIER_GESTION = '1E9oAMniDkSSWi7JDNiuZvp1QBWMmkpWs';   // GESTION LOCATIVE
const MOIS = ['JANVIER','FEVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOUT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DECEMBRE'];
// Modèles essayés dans l'ordre (si l'un n'existe plus, on passe au suivant)
const MODELES = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

function doGet() {
  return json_({ ok: true, message: 'Script Suivi Jean Camp en ligne. Utilise l\'appli pour envoyer des photos.' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('TOKEN') || req.token !== props.getProperty('TOKEN')) {
      return json_({ ok: false, erreur: 'Mot de passe incorrect (TOKEN).' });
    }
    if (req.action === 'ping')    return json_({ ok: true, gemini: !!props.getProperty('GEMINI_KEY'), dossier: DriveApp.getFolderById(DOSSIER_RELEVES).getName() });
    if (req.action === 'lire')    return json_(lire_(req, props));
    if (req.action === 'ranger')  return json_(ranger_(req));
    if (req.action === 'facture') return json_(facture_(req));
    return json_({ ok: false, erreur: 'Action inconnue : ' + req.action });
  } catch (err) {
    return json_({ ok: false, erreur: String(err && err.message || err) });
  }
}

// ─────────────────────────────────────────────────────────────
// 1. Lecture de la photo par Gemini
// ─────────────────────────────────────────────────────────────
function lire_(req, props) {
  const cle = props.getProperty('GEMINI_KEY');
  if (!cle) return { ok: false, erreur: 'Clé Gemini absente : ajoute GEMINI_KEY dans les propriétés du script.' };
  const consigne =
    'Tu lis la photo d\'un compteur (électricité ou eau) pour un relevé de consommation en France.\n' +
    'Réponds UNIQUEMENT en JSON avec ces champs :\n' +
    '{"type":"elec"|"eau"|"inconnu","index":nombre ou null,"unite":"kWh"|"m3"|null,"numero":"texte ou null","lisible":true|false,"remarque":"texte court en français"}\n' +
    'Règles :\n' +
    '- Électricité (Linky, compteur électronique ou à disque) : index en kWh. Si l\'écran affiche plusieurs index (HP/HC), donne la SOMME dans "index" et le détail dans "remarque".\n' +
    '- Eau : les chiffres noirs (ou sur fond blanc) sont les m³, les chiffres rouges (ou roues rouges) sont les décimales (litres). Exemple : noir 01234 + rouge 567 → 1234.567.\n' +
    '- "numero" = numéro de série / numéro du compteur imprimé dessus (ex. "N° 012345678901" ou "A16LA123456"), sans espaces. null si illisible.\n' +
    '- Ne confonds pas le numéro du compteur avec l\'index.\n' +
    '- Si tu n\'es pas sûr d\'un chiffre, mets lisible=false et explique dans remarque.';
  const corps = {
    contents: [{ parts: [
      { text: consigne },
      { inline_data: { mime_type: req.mime || 'image/jpeg', data: req.image } }
    ]}],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  };
  const modeles = [props.getProperty('MODELE')].concat(MODELES).filter(String);
  let derniereErreur = '';
  for (let i = 0; i < modeles.length; i++) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modeles[i] + ':generateContent?key=' + cle;
    const rep = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(corps), muteHttpExceptions: true });
    const code = rep.getResponseCode();
    if (code === 404) { derniereErreur = 'modèle ' + modeles[i] + ' introuvable'; continue; }
    if (code !== 200) return { ok: false, erreur: 'Gemini a répondu ' + code + ' : ' + rep.getContentText().slice(0, 300) };
    const data = JSON.parse(rep.getContentText());
    const texte = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
    let r;
    try { r = JSON.parse(texte.replace(/```json|```/g, '').trim()); }
    catch (x) { return { ok: false, erreur: 'Réponse illisible de Gemini : ' + texte.slice(0, 200) }; }
    if (r.index != null) r.index = Number(String(r.index).replace(',', '.'));
    if (r.numero) r.numero = String(r.numero).replace(/\s+/g, '');
    r.ok = true; r.modele = modeles[i];
    return r;
  }
  return { ok: false, erreur: 'Aucun modèle Gemini disponible (' + derniereErreur + '). Mets un nom de modèle valide dans MODELE.' };
}

// ─────────────────────────────────────────────────────────────
// 2. Rangement de la photo dans le bon sous-dossier du mois
// ─────────────────────────────────────────────────────────────
function ranger_(req) {
  // req.date = "JJ/MM/AAAA" (date de la photo), req.type = "elec" | "eau"
  const p = req.date.split('/');
  const mois = +p[1], annee = p[2];
  const dossier = sousDossierReleve_(req.type, mois, annee);
  const blob = Utilities.newBlob(Utilities.base64Decode(req.image), req.mime || 'image/jpeg', req.nom || 'releve.jpg');
  const f = dossier.createFile(blob);
  return { ok: true, url: f.getUrl(), id: f.getId(), dossier: dossier.getName() };
}

// Clé de comparaison : sans accents, majuscules, sans mots parasites (COMPTEUR, RELEVER…), sans " 1" final
function cle_(nom) {
  const s = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/ELECTRIVITE/g, 'ELECTRICITE').replace(/\s+\d$/, '');
  const type = /\bEAU\b/.test(s) ? 'eau' : (/ELECTRI/.test(s) ? 'elec' : '');
  const mois = MOIS.findIndex(m => new RegExp('\\b' + m + '\\b').test(s)) + 1;
  const an = (s.match(/\b(20\d\d)\b/) || [])[1] || '';
  return type + '|' + mois + '|' + an;
}

function sousDossierReleve_(type, mois, annee) {
  const parent = DriveApp.getFolderById(DOSSIER_RELEVES);
  const cherche = type + '|' + mois + '|' + annee;
  const it = parent.getFolders();
  const trouves = [];
  while (it.hasNext()) { const f = it.next(); if (cle_(f.getName()) === cherche) trouves.push(f); }
  const nomStandard = (type === 'eau' ? 'EAU ' : 'ELECTRICITE ') + MOIS[mois - 1] + ' ' + annee;
  if (trouves.length) {
    // Préférer le dossier au nom standard, sinon le premier trouvé
    return trouves.find(f => f.getName().trim() === nomStandard) || trouves[0];
  }
  return parent.createFolder(nomStandard);
}

// ─────────────────────────────────────────────────────────────
// 3. Rangement d'une facture de charges dans GESTION LOCATIVE / AAAA-MM MOIS AAAA
// ─────────────────────────────────────────────────────────────
function facture_(req) {
  // req.date = date d'émission "JJ/MM/AAAA"
  const p = req.date.split('/');
  const prefixe = p[2] + '-' + p[1];
  const parent = DriveApp.getFolderById(DOSSIER_GESTION);
  let dossier = null;
  const it = parent.getFolders();
  while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf(prefixe) === 0) { dossier = f; break; } }
  if (!dossier) dossier = parent.createFolder(prefixe + ' ' + MOIS[+p[1] - 1] + ' ' + p[2]);
  // Remplacer une ancienne version de la même facture
  const anciens = dossier.getFilesByName(req.nom);
  while (anciens.hasNext()) anciens.next().setTrashed(true);
  const blob = Utilities.newBlob(Utilities.base64Decode(req.pdf), 'application/pdf', req.nom);
  const f = dossier.createFile(blob);
  return { ok: true, url: f.getUrl(), dossier: 'GESTION LOCATIVE / ' + dossier.getName() };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Pour tester depuis l'éditeur : sélectionne « test » puis ▶ Exécuter (autorise l'accès au Drive la 1re fois)
function test() {
  Logger.log(DriveApp.getFolderById(DOSSIER_RELEVES).getName());
  Logger.log(DriveApp.getFolderById(DOSSIER_GESTION).getName());
  Logger.log(sousDossierReleve_('elec', 10, '2026').getName());
}
