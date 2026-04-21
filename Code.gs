// ═══════════════════════════════════════════════════════════════════
//  PÔLE ACCOMPAGNEMENT SCOLAIRE — Apps Script Backend
//  Compte : delil.instituteur@gmail.com
//  Site   : https://eht-remediation.vercel.app/
//  Version: 2.0 — Corrections : MODE_TEST dynamique + lireConfig majuscules + date Lundi 8 juin
// ═══════════════════════════════════════════════════════════════════

var CONFIG = {
  ADMIN_EMAIL:       'delil.instituteur@gmail.com',
  SITE_URL:          'https://eht-remediation.vercel.app/',
  NOM_SYSTEME:       'Pôle Accompagnement Scolaire',
  PLACES_MAX_DEFAUT: 9,
  MAX_PAR_SEMAINE:   3,
  SEMAINE_1_DEBUT:   '2025-06-08',
  SEMAINE_1_FIN:     '2025-06-12',
  SEMAINE_2_DEBUT:   '2025-06-15',
  SEMAINE_2_FIN:     '2025-06-19',
  MODE_TEST:         true
};

var CRENEAUX_MATIN = [
  '8h15 – 9h05','9h05 – 9h55','9h55 – 10h45','11h00 – 11h50','11h50 – 12h40'
];
var CRENEAUX_APREM = [
  '13h30 – 14h20','14h20 – 15h10','15h10 – 16h00'
];

var JOURS_SEMAINE_1 = [
  { date: '2025-06-08', label: 'Lundi 8 juin',    hasPM: true  },
  { date: '2025-06-09', label: 'Mardi 9 juin',     hasPM: true  },
  { date: '2025-06-10', label: 'Mercredi 10 juin', hasPM: false },
  { date: '2025-06-11', label: 'Jeudi 11 juin',    hasPM: true  },
  { date: '2025-06-12', label: 'Vendredi 12 juin', hasPM: true  }
];
var JOURS_SEMAINE_2 = [
  { date: '2025-06-15', label: 'Lundi 15 juin',    hasPM: true  },
  { date: '2025-06-16', label: 'Mardi 16 juin',     hasPM: true  },
  { date: '2025-06-17', label: 'Mercredi 17 juin', hasPM: false },
  { date: '2025-06-18', label: 'Jeudi 18 juin',    hasPM: true  },
  { date: '2025-06-19', label: 'Vendredi 19 juin', hasPM: true  }
];

function chargerConfig() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Config');
    if (!sheet) return;
    var modeTest   = lireConfig(sheet, 'MODE_TEST');
    var placesMax  = lireConfig(sheet, 'PLACES_MAX_DEFAUT');
    var maxSemaine = lireConfig(sheet, 'MAX_PAR_SEMAINE');
    var adminEmail = lireConfig(sheet, 'ADMIN_EMAIL');
    var siteUrl    = lireConfig(sheet, 'SITE_URL');
    if (modeTest   !== null) CONFIG.MODE_TEST         = modeTest;
    if (placesMax  !== null) CONFIG.PLACES_MAX_DEFAUT = placesMax;
    if (maxSemaine !== null) CONFIG.MAX_PAR_SEMAINE   = maxSemaine;
    if (adminEmail !== null) CONFIG.ADMIN_EMAIL        = adminEmail;
    if (siteUrl    !== null) CONFIG.SITE_URL           = siteUrl;
    Logger.log('Config chargée — MODE_TEST=' + CONFIG.MODE_TEST);
  } catch(e) { Logger.log('Erreur chargerConfig : ' + e.toString()); }
}

function doPost(e) {
  chargerConfig();
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;
    var resultat;
    if      (action === 'inscrire')    resultat = traiterInscription(data);
    else if (action === 'annuler')     resultat = traiterAnnulation(data.token);
    else if (action === 'getPlanning') resultat = getEtatPlanning();
    else                               resultat = { succes: false, message: 'Action inconnue.' };
    return ContentService.createTextOutput(JSON.stringify(resultat)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('Erreur doPost : ' + err.toString());
    return ContentService.createTextOutput(JSON.stringify({ succes: false, message: 'Erreur serveur : ' + err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  chargerConfig();
  return ContentService.createTextOutput(JSON.stringify(getEtatPlanning())).setMimeType(ContentService.MimeType.JSON);
}

function traiterInscription(data) {
  var ss = getSpreadsheet();
  var sheetInscriptions = ss.getSheetByName('Inscriptions');
  var sheetPlanning     = ss.getSheetByName('Planning');
  var sheetConfig       = ss.getSheetByName('Config');
  var placesMax  = lireConfig(sheetConfig, 'PLACES_MAX_DEFAUT') || CONFIG.PLACES_MAX_DEFAUT;
  var maxSemaine = lireConfig(sheetConfig, 'MAX_PAR_SEMAINE')   || CONFIG.MAX_PAR_SEMAINE;
  var nom      = data.nom      || '';
  var classe   = data.classe   || '';
  var email    = (data.email   || '').toLowerCase().trim();
  var matieres = data.matieres || '';
  var date     = data.date     || '';
  var creneau  = data.creneau  || '';
  var semaine  = data.semaine  || '';
  if (!nom || !classe || !email || !matieres || !date || !creneau)
    return { succes: false, message: 'Champs manquants.' };
  var compteSemaine = compterInscriptionsSemaine(sheetInscriptions, email, semaine);
  if (compteSemaine >= maxSemaine)
    return { succes: false, message: 'Tu as atteint le maximum d\'inscriptions pour cette semaine. Maximum ' + maxSemaine + ' séance(s) par semaine par élève.' };
  var placesUtilisees  = compterPlacesUtilisees(sheetInscriptions, date, creneau);
  var placesMaxCreneau = lirePlacesMaxCreneau(sheetPlanning, date, creneau) || placesMax;
  if (placesUtilisees >= placesMaxCreneau)
    return { succes: false, message: 'Plus de disponibilités pour cette tranche horaire. Veuillez choisir une autre tranche horaire.' };
  var token      = genererToken();
  var horodatage = new Date();
  var dateSéance = construireDateSeance(date, creneau);
  var dateRappel = new Date(dateSéance.getTime() - 48 * 60 * 60 * 1000);
  sheetInscriptions.appendRow([horodatage, nom, classe, matieres, date, creneau, email, 'confirmé', 'non', dateRappel, token, semaine]);
  envoyerEmailConfirmation(email, nom, classe, matieres, date, creneau, token);
  return { succes: true, message: 'Inscription enregistrée.', token: token };
}

function traiterAnnulation(token) {
  if (!token) return { succes: false, message: 'Token manquant.' };
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Inscriptions');
  var donnees = sheet.getDataRange().getValues();
  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][10] === token) {
      if (donnees[i][7] === 'annulé') return { succes: false, message: 'Cette inscription est déjà annulée.' };
      sheet.getRange(i + 1, 8).setValue('annulé');
      envoyerEmailAnnulationEleve(donnees[i][6], donnees[i][1], donnees[i][4], donnees[i][5]);
      envoyerEmailNotifAdmin(donnees[i][1], donnees[i][2], donnees[i][6], donnees[i][4], donnees[i][5]);
      return { succes: true, message: 'Inscription annulée avec succès.' };
    }
  }
  return { succes: false, message: 'Token introuvable.' };
}

function getEtatPlanning() {
  var ss = getSpreadsheet();
  var sheetInscriptions = ss.getSheetByName('Inscriptions');
  var sheetPlanning     = ss.getSheetByName('Planning');
  var sheetConfig       = ss.getSheetByName('Config');
  var placesMaxDefaut = lireConfig(sheetConfig, 'PLACES_MAX_DEFAUT') || CONFIG.PLACES_MAX_DEFAUT;
  var donnees = sheetInscriptions.getDataRange().getValues();
  var etat = {};
  var tousJours = JOURS_SEMAINE_1.concat(JOURS_SEMAINE_2);
  tousJours.forEach(function(jour) {
    var creneaux = CRENEAUX_MATIN.slice();
    if (jour.hasPM) creneaux = creneaux.concat(CRENEAUX_APREM);
    creneaux.forEach(function(creneau) {
      var cle = jour.label + '|' + creneau;
      var used = 0;
      for (var i = 1; i < donnees.length; i++) {
        if (donnees[i][4] === jour.label && donnees[i][5] === creneau && donnees[i][7] === 'confirmé') used++;
      }
      var placesMax = lirePlacesMaxCreneau(sheetPlanning, jour.label, creneau) || placesMaxDefaut;
      etat[cle] = { used: used, places: placesMax };
    });
  });
  return { succes: true, planning: etat };
}

function envoyerRappelsAutomatiques() {
  chargerConfig();
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Inscriptions');
  var donnees = sheet.getDataRange().getValues();
  var maintenant = new Date();
  var envoyés = 0;
  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][7] !== 'confirmé') continue;
    if (donnees[i][8] === 'oui') continue;
    if (!donnees[i][9]) continue;
    if (new Date(donnees[i][9]) <= maintenant) {
      envoyerEmailRappel(donnees[i][6], donnees[i][1], donnees[i][4], donnees[i][5], donnees[i][3], donnees[i][10]);
      sheet.getRange(i + 1, 9).setValue('oui');
      envoyés++;
    }
  }
  Logger.log('Rappels envoyés : ' + envoyés);
}

function envoyerEmailConfirmation(email, nom, classe, matieres, date, creneau, token) {
  var lienAnnulation = CONFIG.SITE_URL + '?annuler=' + token;
  var sujet = '✅ Confirmation – ' + CONFIG.NOM_SYSTEME + ' – ' + date;
  var corps = creerTemplateEmail('Inscription confirmée !', nom,
    [{label:'Date',valeur:date},{label:'Créneau',valeur:creneau},{label:'Classe',valeur:classe},{label:'Matière(s)',valeur:matieres}],
    '<p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">Nous t\'attendons avec impatience ! Pense à venir avec <strong>tes cours complétés</strong> et <strong>tes notes à jour</strong>.</p><p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">Un rappel automatique te sera envoyé <strong>48h avant ta séance</strong>.</p>',
    '<div style="margin:24px 0;text-align:center"><a href="' + lienAnnulation + '" style="font-size:13px;color:#80868b;text-decoration:underline">Annuler mon inscription</a></div>');
  envoyerEmail(email, sujet, corps);
}

function envoyerEmailRappel(email, nom, date, creneau, matieres, token) {
  var lienAnnulation = CONFIG.SITE_URL + '?annuler=' + token;
  var sujet = '⏰ Rappel – Ta séance demain – ' + CONFIG.NOM_SYSTEME;
  var corps = creerTemplateEmail('Rappel : ta séance approche !', nom,
    [{label:'Date',valeur:date},{label:'Créneau',valeur:creneau},{label:'Matière(s)',valeur:matieres}],
    '<p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">Ta séance a lieu <strong>demain</strong>. N\'oublie pas tes <strong>cours complétés</strong> et tes <strong>notes à jour</strong> !</p>',
    '<div style="margin:24px 0;text-align:center"><a href="' + lienAnnulation + '" style="font-size:13px;color:#80868b;text-decoration:underline">Annuler mon inscription</a></div>');
  envoyerEmail(email, sujet, corps);
}

function envoyerEmailAnnulationEleve(email, nom, date, creneau) {
  var sujet = '❌ Annulation confirmée – ' + CONFIG.NOM_SYSTEME;
  var corps = creerTemplateEmail('Inscription annulée', nom,
    [{label:'Date',valeur:date},{label:'Créneau',valeur:creneau}],
    '<p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">Ton inscription a bien été annulée. La place a été libérée.</p><p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">Tu peux te réinscrire à tout moment sur le site.</p>', '');
  envoyerEmail(email, sujet, corps);
}

function envoyerEmailNotifAdmin(nom, classe, email, date, creneau) {
  var sujet = '[PAS] Annulation – ' + nom + ' – ' + date;
  var corps = '<p>Une inscription vient d\'être annulée :</p><ul><li><strong>Élève :</strong> ' + nom + ' (' + classe + ')</li><li><strong>Email :</strong> ' + email + '</li><li><strong>Date :</strong> ' + date + '</li><li><strong>Créneau :</strong> ' + creneau + '</li></ul><p>La place a été automatiquement libérée.</p>';
  envoyerEmail(CONFIG.ADMIN_EMAIL, sujet, corps);
}

function creerTemplateEmail(titre, nom, champs, contenu, pied) {
  var lignesChamps = champs.map(function(c) {
    return '<tr><td style="padding:8px 14px;font-size:13px;color:#5f6368;border-bottom:1px solid #e8eaed;width:120px">' + c.label + '</td><td style="padding:8px 14px;font-size:13px;color:#202124;font-weight:500;border-bottom:1px solid #e8eaed">' + c.valeur + '</td></tr>';
  }).join('');
  return '<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#f8f9fa;font-family:Arial,sans-serif"><div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;border:1px solid #e8eaed;overflow:hidden"><div style="background:#1a73e8;padding:24px 28px"><div style="color:#fff;font-size:13px;opacity:.85;margin-bottom:4px">Pôle Accompagnement Scolaire</div><div style="color:#fff;font-size:20px;font-weight:500">' + titre + '</div></div><div style="padding:24px 28px"><p style="margin:0 0 20px;font-size:14px;color:#202124">Bonjour <strong>' + nom + '</strong>,</p><table style="width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:8px;overflow:hidden;margin-bottom:4px">' + lignesChamps + '</table>' + contenu + pied + '</div><div style="background:#f8f9fa;border-top:1px solid #e8eaed;padding:14px 28px;font-size:12px;color:#80868b;text-align:center">' + CONFIG.NOM_SYSTEME + ' — <a href="' + CONFIG.SITE_URL + '" style="color:#1a73e8;text-decoration:none">' + CONFIG.SITE_URL + '</a></div></div></body></html>';
}

function envoyerEmail(destinataire, sujet, corpsHtml) {
  if (CONFIG.MODE_TEST) {
    Logger.log('=== MODE TEST — EMAIL NON ENVOYÉ ===');
    Logger.log('À : ' + destinataire + ' | Sujet : ' + sujet);
    return;
  }
  try {
    GmailApp.sendEmail(destinataire, sujet, '', { htmlBody: corpsHtml, name: CONFIG.NOM_SYSTEME });
  } catch (err) {
    Logger.log('Erreur envoi email : ' + err.toString());
  }
}

function initialiserSysteme() {
  var ss = getSpreadsheet();
  creerFeuille_Inscriptions(ss);
  creerFeuille_Planning(ss);
  creerFeuille_Config(ss);
  SpreadsheetApp.getUi().alert('✅ Système initialisé !\n\n3 feuilles créées : Inscriptions, Planning, Config.\n\nProchaine étape : Déployer → Nouveau déploiement.');
}

function creerFeuille_Inscriptions(ss) {
  var sheet = ss.getSheetByName('Inscriptions');
  if (!sheet) sheet = ss.insertSheet('Inscriptions');
  if (sheet.getLastRow() === 0) {
    var entetes = ['Horodatage','Nom & Prénom','Classe','Matière(s)','Date session','Créneau','Email','Statut','Rappel envoyé','Date rappel prévue','Token annulation','Semaine'];
    sheet.appendRow(entetes);
    sheet.getRange(1,1,1,entetes.length).setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,160);sheet.setColumnWidth(2,160);sheet.setColumnWidth(7,200);sheet.setColumnWidth(10,160);sheet.setColumnWidth(11,240);
  }
  var r1 = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('annulé').setBackground('#fce8e6').setFontColor('#c5221f').setRanges([sheet.getRange('H2:H1000')]).build();
  var r2 = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('confirmé').setBackground('#e6f4ea').setFontColor('#188038').setRanges([sheet.getRange('H2:H1000')]).build();
  sheet.setConditionalFormatRules([r1, r2]);
}

function creerFeuille_Planning(ss) {
  var sheet = ss.getSheetByName('Planning');
  if (!sheet) sheet = ss.insertSheet('Planning');
  sheet.clearContents();
  sheet.appendRow(['Semaine','Jour','Date','Créneau','Places max','Places utilisées','Statut']);
  sheet.getRange(1,1,1,7).setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
  var lignes = [];
  [{label:'Semaine 1',jours:JOURS_SEMAINE_1},{label:'Semaine 2',jours:JOURS_SEMAINE_2}].forEach(function(sem) {
    sem.jours.forEach(function(jour) {
      var cr = CRENEAUX_MATIN.slice();
      if (jour.hasPM) cr = cr.concat(CRENEAUX_APREM);
      cr.forEach(function(c) { lignes.push([sem.label,jour.label,jour.date,c,CONFIG.PLACES_MAX_DEFAUT,0,'Disponible']); });
    });
  });
  if (lignes.length > 0) sheet.getRange(2,1,lignes.length,7).setValues(lignes);
  sheet.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Complet').setBackground('#fce8e6').setFontColor('#c5221f').setRanges([sheet.getRange('G2:G500')]).build()]);
  sheet.setColumnWidth(2,160);sheet.setColumnWidth(4,160);
}

function creerFeuille_Config(ss) {
  var sheet = ss.getSheetByName('Config');
  if (!sheet) sheet = ss.insertSheet('Config');
  sheet.clearContents();
  sheet.appendRow(['Paramètre','Valeur','Description']);
  sheet.getRange(1,1,1,3).setBackground('#1a73e8').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
  var params = [
    ['PLACES_MAX_DEFAUT',9,'Nombre de places par créneau (défaut)'],
    ['MAX_PAR_SEMAINE',3,'Max inscriptions par élève par semaine'],
    ['ADMIN_EMAIL','delil.instituteur@gmail.com','Email administrateur (notifications)'],
    ['SITE_URL','https://eht-remediation.vercel.app/','URL publique du site'],
    ['MODE_TEST','false','true = pas de vrais emails envoyés'],
    ['SEMAINE_1_DEBUT','2025-06-08','Date début semaine 1 (YYYY-MM-DD)'],
    ['SEMAINE_1_FIN','2025-06-12','Date fin semaine 1 (YYYY-MM-DD)'],
    ['SEMAINE_2_DEBUT','2025-06-15','Date début semaine 2 (YYYY-MM-DD)'],
    ['SEMAINE_2_FIN','2025-06-19','Date fin semaine 2 (YYYY-MM-DD)']
  ];
  sheet.getRange(2,1,params.length,3).setValues(params);
  sheet.setColumnWidth(1,200);sheet.setColumnWidth(2,180);sheet.setColumnWidth(3,320);
  sheet.getRange(2,2,params.length,1).setBackground('#fef7e0');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎓 PAS Admin')
    .addItem('1 — Initialiser le système','initialiserSysteme').addSeparator()
    .addItem('2 — Lancer les rappels manuellement','lancerRappelsManuels')
    .addItem('3 — Voir le récapitulatif','voirRecapitulatif').addSeparator()
    .addItem('4 — Réinitialiser un créneau','reinitialiserCreneau')
    .addItem('5 — Activer/Désactiver mode test','toggleModeTest').addToUi();
}

function lancerRappelsManuels() {
  envoyerRappelsAutomatiques();
  SpreadsheetApp.getUi().alert('Rappels traités. Voir les logs pour le détail.');
}

function voirRecapitulatif() {
  var donnees = getSpreadsheet().getSheetByName('Inscriptions').getDataRange().getValues();
  var total=0,confirmes=0,annules=0;
  for(var i=1;i<donnees.length;i++){total++;if(donnees[i][7]==='confirmé')confirmes++;if(donnees[i][7]==='annulé')annules++;}
  SpreadsheetApp.getUi().alert('📊 Récapitulatif\n\nTotal : '+total+'\nConfirmées : '+confirmes+'\nAnnulées : '+annules);
}

function reinitialiserCreneau() {
  var ui=SpreadsheetApp.getUi();
  var rep=ui.prompt('Réinitialiser un créneau','Entre le nom du jour exact (ex: Lundi 8 juin) :',ui.ButtonSet.OK_CANCEL);
  if(rep.getSelectedButton()!==ui.Button.OK)return;
  var jour=rep.getResponseText().trim();
  var sheet=getSpreadsheet().getSheetByName('Inscriptions');
  var donnees=sheet.getDataRange().getValues();var count=0;
  for(var i=1;i<donnees.length;i++){if(donnees[i][4]===jour&&donnees[i][7]==='confirmé'){sheet.getRange(i+1,8).setValue('annulé');count++;}}
  ui.alert(count+' inscription(s) annulée(s) pour '+jour+'.');
}

function toggleModeTest() {
  var ui=SpreadsheetApp.getUi();
  var sheet=getSpreadsheet().getSheetByName('Config');
  var donnees=sheet.getDataRange().getValues();
  for(var i=1;i<donnees.length;i++){
    if(donnees[i][0]==='MODE_TEST'){
      var actuel=donnees[i][1].toString().toLowerCase()==='true';
      var nouveau=!actuel;
      sheet.getRange(i+1,2).setValue(nouveau.toString());
      CONFIG.MODE_TEST=nouveau;
      ui.alert('Mode test : '+(nouveau?'✅ ACTIVÉ (emails simulés)':'🔴 DÉSACTIVÉ (vrais emails envoyés)'));
      return;
    }
  }
}

function installerDeclencheur() {
  ScriptApp.getProjectTriggers().forEach(function(d){if(d.getHandlerFunction()==='envoyerRappelsAutomatiques')ScriptApp.deleteTrigger(d);});
  ScriptApp.newTrigger('envoyerRappelsAutomatiques').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getUi().alert('✅ Déclencheur installé : rappels envoyés chaque jour à 7h.');
}

function getSpreadsheet() {
  return SpreadsheetApp.openById('1_qk9mcbiTx9Gy6n--xWIFnaLwTvJXyZarqcglHmZSvg');
}
function genererToken()    { return Utilities.getUuid(); }

function lireConfig(sheet, parametre) {
  var donnees = sheet.getDataRange().getValues();
  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][0] === parametre) {
      var val = donnees[i][1];
      if (val === true)  return true;
      if (val === false) return false;
      var s = val.toString().trim().toLowerCase();
      if (s === 'true')  return true;
      if (s === 'false') return false;
      if (!isNaN(val) && val !== '') return Number(val);
      return val;
    }
  }
  return null;
}

function compterInscriptionsSemaine(sheet, email, semaine) {
  var donnees=sheet.getDataRange().getValues();var count=0;
  for(var i=1;i<donnees.length;i++){if(donnees[i][6].toLowerCase()===email&&donnees[i][11]===semaine&&donnees[i][7]==='confirmé')count++;}
  return count;
}

function compterPlacesUtilisees(sheet, date, creneau) {
  var donnees=sheet.getDataRange().getValues();var count=0;
  for(var i=1;i<donnees.length;i++){if(donnees[i][4]===date&&donnees[i][5]===creneau&&donnees[i][7]==='confirmé')count++;}
  return count;
}

function lirePlacesMaxCreneau(sheet, date, creneau) {
  var donnees=sheet.getDataRange().getValues();
  for(var i=1;i<donnees.length;i++){if(donnees[i][1]===date&&donnees[i][3]===creneau)return donnees[i][4]||null;}
  return null;
}

function construireDateSeance(dateLabel, creneau) {
  var match=creneau.match(/(\d+)h(\d+)/);
  var heure=match?parseInt(match[1]):8;
  var minutes=match?parseInt(match[2]):0;
  var tousJours=JOURS_SEMAINE_1.concat(JOURS_SEMAINE_2);
  var dateISO=null;
  tousJours.forEach(function(j){if(j.label===dateLabel)dateISO=j.date;});
  if(!dateISO)return new Date();
  var p=dateISO.split('-');
  return new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]),heure,minutes,0);
}