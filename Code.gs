// ═══════════════════════════════════════════════════════════════════
//  PÔLE ACCOMPAGNEMENT SCOLAIRE — Apps Script Backend
//  Compte : delil.instituteur@gmail.com
//  Site   : https://eht-remediation.vercel.app/
//  Version: 1.0
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
//  SECTION 1 — CONFIGURATION GLOBALE
//  Tous les paramètres modifiables sont ici.
//  Ne modifier que cette section, jamais le reste du code.
// ───────────────────────────────────────────────────────────────────

var CONFIG = {
  // Email administrateur (reçoit les notifications d'annulation)
  ADMIN_EMAIL: 'delil.instituteur@gmail.com',

  // URL publique du site
  SITE_URL: 'https://eht-remediation.vercel.app/',

  // Nom affiché dans les emails
  NOM_SYSTEME: 'Pôle Accompagnement Scolaire',

  // Nombre de places max par créneau (défaut)
  PLACES_MAX_DEFAUT: 9,

  // Nombre max d'inscriptions par élève par semaine
  MAX_PAR_SEMAINE: 3,

  // Semaine 1
  SEMAINE_1_DEBUT: '2025-06-08',
  SEMAINE_1_FIN:   '2025-06-12',

  // Semaine 2
  SEMAINE_2_DEBUT: '2025-06-15',
  SEMAINE_2_FIN:   '2025-06-19',

  // Mode test : true = emails remplacés par des logs, false = vrais emails
  MODE_TEST: true
};

// ───────────────────────────────────────────────────────────────────
//  SECTION 2 — STRUCTURE DES CRÉNEAUX
//  Reflète exactement le frontend : 5 créneaux matin + 3 après-midi
// ───────────────────────────────────────────────────────────────────

var CRENEAUX_MATIN = [
  '8h15 – 9h05',
  '9h05 – 9h55',
  '9h55 – 10h45',
  '11h00 – 11h50',
  '11h50 – 12h40'
];

var CRENEAUX_APREM = [
  '13h30 – 14h20',
  '14h20 – 15h10',
  '15h10 – 16h00'
];

// Jours avec après-midi (mercredi = matin uniquement)
var JOURS_SEMAINE_1 = [
  { date: '2025-06-09', label: 'Lundi 8 juin',     hasPM: true  },
  { date: '2025-06-09', label: 'Mardi 9 juin',      hasPM: true  },
  { date: '2025-06-10', label: 'Mercredi 10 juin',  hasPM: false },
  { date: '2025-06-11', label: 'Jeudi 11 juin',     hasPM: true  },
  { date: '2025-06-12', label: 'Vendredi 12 juin',  hasPM: true  }
];

var JOURS_SEMAINE_2 = [
  { date: '2025-06-15', label: 'Lundi 15 juin',     hasPM: true  },
  { date: '2025-06-16', label: 'Mardi 16 juin',      hasPM: true  },
  { date: '2025-06-17', label: 'Mercredi 17 juin',  hasPM: false },
  { date: '2025-06-18', label: 'Jeudi 18 juin',     hasPM: true  },
  { date: '2025-06-19', label: 'Vendredi 19 juin',  hasPM: true  }
];

// ───────────────────────────────────────────────────────────────────
//  SECTION 3 — POINT D'ENTRÉE WEB (reçoit les données du site)
//  Le site appelle cette fonction via fetch() pour toute action.
// ───────────────────────────────────────────────────────────────────

/**
 * Reçoit les requêtes POST depuis le site Vercel.
 * Actions possibles : 'inscrire', 'annuler', 'getPlanning'
 */
function doPost(e) {
  // Autoriser les requêtes cross-origin (CORS)
  var headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;
    var resultat;

    if (action === 'inscrire') {
      resultat = traiterInscription(data);
    } else if (action === 'annuler') {
      resultat = traiterAnnulation(data.token);
    } else if (action === 'getPlanning') {
      resultat = getEtatPlanning();
    } else {
      resultat = { succes: false, message: 'Action inconnue.' };
    }

    return ContentService
      .createTextOutput(JSON.stringify(resultat))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Erreur doPost : ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ succes: false, message: 'Erreur serveur : ' + err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Permet au site de récupérer l'état du planning via GET
 */
function doGet(e) {
  var resultat = getEtatPlanning();
  return ContentService
    .createTextOutput(JSON.stringify(resultat))
    .setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 4 — TRAITEMENT DES INSCRIPTIONS
// ───────────────────────────────────────────────────────────────────

/**
 * Traite une nouvelle inscription.
 * Vérifie : places disponibles + limite hebdomadaire par email.
 * Si OK : enregistre dans Sheets + envoie email de confirmation.
 */
function traiterInscription(data) {
  var ss = getSpreadsheet();
  var sheetInscriptions = ss.getSheetByName('Inscriptions');
  var sheetPlanning     = ss.getSheetByName('Planning');
  var sheetConfig       = ss.getSheetByName('Config');

  // Lire les paramètres depuis Config
  var placesMax  = lireConfig(sheetConfig, 'PLACES_MAX_DEFAUT') || CONFIG.PLACES_MAX_DEFAUT;
  var maxSemaine = lireConfig(sheetConfig, 'MAX_PAR_SEMAINE')   || CONFIG.MAX_PAR_SEMAINE;

  var nom      = data.nom      || '';
  var classe   = data.classe   || '';
  var email    = (data.email   || '').toLowerCase().trim();
  var matieres = data.matieres || '';
  var date     = data.date     || '';
  var creneau  = data.creneau  || '';
  var semaine  = data.semaine  || '';  // 'W1' ou 'W2'

  // ── Vérification 1 : champs obligatoires ──
  if (!nom || !classe || !email || !matieres || !date || !creneau) {
    return { succes: false, message: 'Champs manquants.' };
  }

  // ── Vérification 2 : limite hebdomadaire côté serveur ──
  var compteSemaine = compterInscriptionsSemaine(sheetInscriptions, email, semaine);
  if (compteSemaine >= maxSemaine) {
    return {
      succes: false,
      message: 'Tu as atteint le maximum d\'inscriptions pour cette semaine. Maximum ' + maxSemaine + ' séance(s) par semaine par élève.'
    };
  }

  // ── Vérification 3 : places disponibles ──
  var placesUtilisees = compterPlacesUtilisees(sheetInscriptions, date, creneau);
  var placesMaxCreneau = lirePlacesMaxCreneau(sheetPlanning, date, creneau) || placesMax;
  if (placesUtilisees >= placesMaxCreneau) {
    return {
      succes: false,
      message: 'Plus de disponibilités pour cette tranche horaire. Veuillez choisir une autre tranche horaire.'
    };
  }

  // ── Enregistrement ──
  var token = genererToken();
  var horodatage = new Date();

  // Calculer la date/heure de la séance pour le rappel 48h
  var dateSéance = construireDateSeance(date, creneau);
  var dateRappel = new Date(dateSéance.getTime() - 48 * 60 * 60 * 1000);

  sheetInscriptions.appendRow([
    horodatage,       // A - Horodatage
    nom,              // B - Nom & Prénom
    classe,           // C - Classe
    matieres,         // D - Matière(s)
    date,             // E - Date session
    creneau,          // F - Créneau
    email,            // G - Email
    'confirmé',       // H - Statut
    'non',            // I - Rappel envoyé
    dateRappel,       // J - Date rappel prévue
    token,            // K - Token annulation
    semaine           // L - Semaine (W1/W2)
  ]);

  // ── Email de confirmation ──
  envoyerEmailConfirmation(email, nom, classe, matieres, date, creneau, token);

  return {
    succes: true,
    message: 'Inscription enregistrée.',
    token: token
  };
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 5 — TRAITEMENT DES ANNULATIONS
// ───────────────────────────────────────────────────────────────────

/**
 * Annule une inscription via son token UUID.
 * Libère la place + envoie emails élève et admin.
 */
function traiterAnnulation(token) {
  if (!token) return { succes: false, message: 'Token manquant.' };

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Inscriptions');
  var donnees = sheet.getDataRange().getValues();

  // Chercher la ligne correspondant au token (colonne K = index 10)
  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][10] === token) {
      if (donnees[i][7] === 'annulé') {
        return { succes: false, message: 'Cette inscription est déjà annulée.' };
      }

      // Marquer comme annulé
      sheet.getRange(i + 1, 8).setValue('annulé');

      var nom      = donnees[i][1];
      var classe   = donnees[i][2];
      var matieres = donnees[i][3];
      var date     = donnees[i][4];
      var creneau  = donnees[i][5];
      var email    = donnees[i][6];

      // Emails d'annulation
      envoyerEmailAnnulationEleve(email, nom, date, creneau);
      envoyerEmailNotifAdmin(nom, classe, email, date, creneau);

      return { succes: true, message: 'Inscription annulée avec succès.' };
    }
  }

  return { succes: false, message: 'Token introuvable.' };
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 6 — ÉTAT DU PLANNING (lu par le site au chargement)
// ───────────────────────────────────────────────────────────────────

/**
 * Retourne pour chaque créneau le nombre de places utilisées.
 * Le site l'appelle au chargement pour afficher les places réelles.
 */
function getEtatPlanning() {
  var ss = getSpreadsheet();
  var sheetInscriptions = ss.getSheetByName('Inscriptions');
  var sheetPlanning     = ss.getSheetByName('Planning');
  var sheetConfig       = ss.getSheetByName('Config');

  var placesMaxDefaut = lireConfig(sheetConfig, 'PLACES_MAX_DEFAUT') || CONFIG.PLACES_MAX_DEFAUT;
  var donnees = sheetInscriptions.getDataRange().getValues();
  var etat = {};

  // Construire l'état pour chaque créneau
  var tousJours = JOURS_SEMAINE_1.concat(JOURS_SEMAINE_2);
  tousJours.forEach(function(jour) {
    var creneaux = CRENEAUX_MATIN.slice();
    if (jour.hasPM) creneaux = creneaux.concat(CRENEAUX_APREM);
    creneaux.forEach(function(creneau) {
      var cle = jour.label + '|' + creneau;
      var used = 0;
      for (var i = 1; i < donnees.length; i++) {
        if (donnees[i][4] === jour.label && donnees[i][5] === creneau && donnees[i][7] === 'confirmé') {
          used++;
        }
      }
      var placesMax = lirePlacesMaxCreneau(sheetPlanning, jour.label, creneau) || placesMaxDefaut;
      etat[cle] = { used: used, places: placesMax };
    });
  });

  return { succes: true, planning: etat };
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 7 — RAPPELS AUTOMATIQUES (CRON quotidien à 7h)
// ───────────────────────────────────────────────────────────────────

/**
 * Parcourt les inscriptions confirmées et envoie un rappel
 * si la date de rappel prévue est aujourd'hui ou dépassée.
 * Cette fonction est appelée automatiquement chaque jour à 7h.
 */
function envoyerRappelsAutomatiques() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Inscriptions');
  var donnees = sheet.getDataRange().getValues();
  var maintenant = new Date();
  var envoyés = 0;

  for (var i = 1; i < donnees.length; i++) {
    var statut       = donnees[i][7];
    var rappelEnvoye = donnees[i][8];
    var dateRappel   = donnees[i][9];

    if (statut !== 'confirmé') continue;
    if (rappelEnvoye === 'oui') continue;
    if (!dateRappel) continue;

    var drappel = new Date(dateRappel);
    if (drappel <= maintenant) {
      var email    = donnees[i][6];
      var nom      = donnees[i][1];
      var date     = donnees[i][4];
      var creneau  = donnees[i][5];
      var matieres = donnees[i][3];
      var token    = donnees[i][10];

      envoyerEmailRappel(email, nom, date, creneau, matieres, token);
      sheet.getRange(i + 1, 9).setValue('oui');
      envoyés++;
    }
  }

  Logger.log('Rappels envoyés : ' + envoyés);
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 8 — EMAILS HTML
// ───────────────────────────────────────────────────────────────────

/**
 * Email de confirmation envoyé à l'élève après inscription.
 * Contient le récapitulatif complet + lien d'annulation unique.
 */
function envoyerEmailConfirmation(email, nom, classe, matieres, date, creneau, token) {
  var lienAnnulation = CONFIG.SITE_URL + '?annuler=' + token;
  var sujet = '✅ Confirmation – ' + CONFIG.NOM_SYSTEME + ' – ' + date;

  var corps = creerTemplateEmail(
    'Inscription confirmée !',
    nom,
    [
      { label: 'Date',       valeur: date    },
      { label: 'Créneau',    valeur: creneau },
      { label: 'Classe',     valeur: classe  },
      { label: 'Matière(s)', valeur: matieres }
    ],
    '<p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">' +
    'Nous t\'attendons avec impatience ! Pour que ta séance soit vraiment utile, ' +
    'pense à venir avec <strong>tes cours complétés</strong> et <strong>tes notes à jour</strong>. ' +
    'L\'équipe encadrante est là pour t\'aider à progresser.' +
    '</p>' +
    '<p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">' +
    'Un rappel automatique te sera envoyé <strong>48h avant ta séance</strong>.' +
    '</p>',
    '<div style="margin:24px 0;text-align:center">' +
    '<a href="' + lienAnnulation + '" style="font-size:13px;color:#80868b;text-decoration:underline">' +
    'Annuler mon inscription' +
    '</a>' +
    '</div>'
  );

  envoyerEmail(email, sujet, corps);
}

/**
 * Email de rappel envoyé 48h avant la séance.
 */
function envoyerEmailRappel(email, nom, date, creneau, matieres, token) {
  var lienAnnulation = CONFIG.SITE_URL + '?annuler=' + token;
  var sujet = '⏰ Rappel – Ta séance demain – ' + CONFIG.NOM_SYSTEME;

  var corps = creerTemplateEmail(
    'Rappel : ta séance approche !',
    nom,
    [
      { label: 'Date',       valeur: date    },
      { label: 'Créneau',    valeur: creneau },
      { label: 'Matière(s)', valeur: matieres }
    ],
    '<p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">' +
    'Ta séance d\'accompagnement a lieu <strong>demain</strong>. ' +
    'N\'oublie pas de venir avec tes <strong>cours complétés</strong> et tes <strong>notes à jour</strong> !' +
    '</p>',
    '<div style="margin:24px 0;text-align:center">' +
    '<a href="' + lienAnnulation + '" style="font-size:13px;color:#80868b;text-decoration:underline">' +
    'Annuler mon inscription' +
    '</a>' +
    '</div>'
  );

  envoyerEmail(email, sujet, corps);
}

/**
 * Email de confirmation d'annulation envoyé à l'élève.
 */
function envoyerEmailAnnulationEleve(email, nom, date, creneau) {
  var sujet = '❌ Annulation confirmée – ' + CONFIG.NOM_SYSTEME;

  var corps = creerTemplateEmail(
    'Inscription annulée',
    nom,
    [
      { label: 'Date',    valeur: date    },
      { label: 'Créneau', valeur: creneau }
    ],
    '<p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">' +
    'Ton inscription a bien été annulée. La place a été libérée pour un autre élève.' +
    '</p>' +
    '<p style="margin:16px 0;color:#3c4043;font-size:14px;line-height:1.7">' +
    'Tu peux te réinscrire à tout moment sur le site si tu le souhaites.' +
    '</p>',
    ''
  );

  envoyerEmail(email, sujet, corps);
}

/**
 * Email de notification envoyé à l'admin lors d'une annulation.
 */
function envoyerEmailNotifAdmin(nom, classe, email, date, creneau) {
  var sujet = '[PAS] Annulation – ' + nom + ' – ' + date;
  var corps =
    '<p>Une inscription vient d\'être annulée :</p>' +
    '<ul>' +
    '<li><strong>Élève :</strong> ' + nom + ' (' + classe + ')</li>' +
    '<li><strong>Email :</strong> ' + email + '</li>' +
    '<li><strong>Date :</strong> ' + date + '</li>' +
    '<li><strong>Créneau :</strong> ' + creneau + '</li>' +
    '</ul>' +
    '<p>La place a été automatiquement libérée.</p>';

  envoyerEmail(CONFIG.ADMIN_EMAIL, sujet, corps);
}

/**
 * Template HTML commun à tous les emails élève.
 * Paramètres : titre, nom, tableau de champs, contenu, pied.
 */
function creerTemplateEmail(titre, nom, champs, contenu, pied) {
  var lignesChamps = champs.map(function(c) {
    return '<tr>' +
      '<td style="padding:8px 14px;font-size:13px;color:#5f6368;border-bottom:1px solid #e8eaed;width:120px">' + c.label + '</td>' +
      '<td style="padding:8px 14px;font-size:13px;color:#202124;font-weight:500;border-bottom:1px solid #e8eaed">' + c.valeur + '</td>' +
      '</tr>';
  }).join('');

  return '<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#f8f9fa;font-family:\'DM Sans\',Arial,sans-serif">' +
    '<div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;border:1px solid #e8eaed;overflow:hidden">' +
    '<div style="background:#1a73e8;padding:24px 28px">' +
    '<div style="color:#ffffff;font-size:13px;opacity:.85;margin-bottom:4px">Pôle Accompagnement Scolaire</div>' +
    '<div style="color:#ffffff;font-size:20px;font-weight:500">' + titre + '</div>' +
    '</div>' +
    '<div style="padding:24px 28px">' +
    '<p style="margin:0 0 20px;font-size:14px;color:#202124">Bonjour <strong>' + nom + '</strong>,</p>' +
    '<table style="width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:8px;overflow:hidden;margin-bottom:4px">' +
    lignesChamps +
    '</table>' +
    contenu +
    pied +
    '</div>' +
    '<div style="background:#f8f9fa;border-top:1px solid #e8eaed;padding:14px 28px;font-size:12px;color:#80868b;text-align:center">' +
    CONFIG.NOM_SYSTEME + ' — ' +
    '<a href="' + CONFIG.SITE_URL + '" style="color:#1a73e8;text-decoration:none">' + CONFIG.SITE_URL + '</a>' +
    '</div>' +
    '</div>' +
    '</body></html>';
}

/**
 * Envoie un email HTML.
 * En mode test (CONFIG.MODE_TEST = true), logue au lieu d'envoyer.
 */
function envoyerEmail(destinataire, sujet, corpsHtml) {
  if (CONFIG.MODE_TEST) {
    Logger.log('=== MODE TEST — EMAIL NON ENVOYÉ ===');
    Logger.log('À      : ' + destinataire);
    Logger.log('Sujet  : ' + sujet);
    Logger.log('Corps  : ' + corpsHtml.substring(0, 200) + '...');
    return;
  }
  try {
    GmailApp.sendEmail(destinataire, sujet, '', { htmlBody: corpsHtml, name: CONFIG.NOM_SYSTEME });
  } catch (err) {
    Logger.log('Erreur envoi email à ' + destinataire + ' : ' + err.toString());
  }
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 9 — INITIALISATION DES FEUILLES GOOGLE SHEETS
//  Appelle cette fonction UNE SEULE FOIS depuis le menu personnalisé.
// ───────────────────────────────────────────────────────────────────

/**
 * Crée ou réinitialise les 3 feuilles : Inscriptions, Planning, Config.
 * Toutes les données existantes sont conservées si les feuilles existent déjà.
 */
function initialiserSysteme() {
  var ss = getSpreadsheet();

  creerFeuille_Inscriptions(ss);
  creerFeuille_Planning(ss);
  creerFeuille_Config(ss);

  SpreadsheetApp.getUi().alert(
    '✅ Système initialisé !\n\n' +
    '3 feuilles créées : Inscriptions, Planning, Config.\n\n' +
    'Prochaine étape : déployer le script comme application web\n' +
    '(Extensions → Apps Script → Déployer → Nouveau déploiement).'
  );
}

function creerFeuille_Inscriptions(ss) {
  var sheet = ss.getSheetByName('Inscriptions');
  if (!sheet) sheet = ss.insertSheet('Inscriptions');

  // En-têtes seulement si la feuille est vide
  if (sheet.getLastRow() === 0) {
    var entetes = [
      'Horodatage', 'Nom & Prénom', 'Classe', 'Matière(s)',
      'Date session', 'Créneau', 'Email', 'Statut',
      'Rappel envoyé', 'Date rappel prévue', 'Token annulation', 'Semaine'
    ];
    sheet.appendRow(entetes);
    sheet.getRange(1, 1, 1, entetes.length)
      .setBackground('#1a73e8')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(7, 200);
    sheet.setColumnWidth(10, 160);
    sheet.setColumnWidth(11, 240);
  }

  // Mise en forme conditionnelle : rouge si annulé, vert si confirmé
  var regle1 = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('annulé')
    .setBackground('#fce8e6')
    .setFontColor('#c5221f')
    .setRanges([sheet.getRange('H2:H1000')])
    .build();
  var regle2 = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('confirmé')
    .setBackground('#e6f4ea')
    .setFontColor('#188038')
    .setRanges([sheet.getRange('H2:H1000')])
    .build();
  sheet.setConditionalFormatRules([regle1, regle2]);
}

function creerFeuille_Planning(ss) {
  var sheet = ss.getSheetByName('Planning');
  if (!sheet) sheet = ss.insertSheet('Planning');
  sheet.clearContents();

  var entetes = ['Semaine', 'Jour', 'Date', 'Créneau', 'Places max', 'Places utilisées', 'Statut'];
  sheet.appendRow(entetes);
  sheet.getRange(1, 1, 1, entetes.length)
    .setBackground('#1a73e8')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Remplir toutes les lignes de créneaux
  var lignes = [];
  var semaines = [
    { label: 'Semaine 1', jours: JOURS_SEMAINE_1 },
    { label: 'Semaine 2', jours: JOURS_SEMAINE_2 }
  ];

  semaines.forEach(function(sem) {
    sem.jours.forEach(function(jour) {
      var creneaux = CRENEAUX_MATIN.slice();
      if (jour.hasPM) creneaux = creneaux.concat(CRENEAUX_APREM);
      creneaux.forEach(function(c) {
        lignes.push([sem.label, jour.label, jour.date, c, CONFIG.PLACES_MAX_DEFAUT, 0, 'Disponible']);
      });
    });
  });

  if (lignes.length > 0) {
    sheet.getRange(2, 1, lignes.length, 7).setValues(lignes);
  }

  // Mise en forme conditionnelle : rouge si Complet
  var regle = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Complet')
    .setBackground('#fce8e6')
    .setFontColor('#c5221f')
    .setRanges([sheet.getRange('G2:G500')])
    .build();
  sheet.setConditionalFormatRules([regle]);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(4, 160);
}

function creerFeuille_Config(ss) {
  var sheet = ss.getSheetByName('Config');
  if (!sheet) sheet = ss.insertSheet('Config');
  sheet.clearContents();

  var entetes = ['Paramètre', 'Valeur', 'Description'];
  sheet.appendRow(entetes);
  sheet.getRange(1, 1, 1, 3)
    .setBackground('#1a73e8')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);

  var params = [
    ['PLACES_MAX_DEFAUT', CONFIG.PLACES_MAX_DEFAUT,    'Nombre de places par créneau (défaut)'],
    ['MAX_PAR_SEMAINE',   CONFIG.MAX_PAR_SEMAINE,      'Max inscriptions par élève par semaine'],
    ['ADMIN_EMAIL',       CONFIG.ADMIN_EMAIL,           'Email administrateur (notifications)'],
    ['SITE_URL',          CONFIG.SITE_URL,              'URL publique du site'],
    ['MODE_TEST',         CONFIG.MODE_TEST.toString(),  'true = pas de vrais emails envoyés'],
    ['SEMAINE_1_DEBUT',   CONFIG.SEMAINE_1_DEBUT,       'Date début semaine 1 (YYYY-MM-DD)'],
    ['SEMAINE_1_FIN',     CONFIG.SEMAINE_1_FIN,         'Date fin semaine 1 (YYYY-MM-DD)'],
    ['SEMAINE_2_DEBUT',   CONFIG.SEMAINE_2_DEBUT,       'Date début semaine 2 (YYYY-MM-DD)'],
    ['SEMAINE_2_FIN',     CONFIG.SEMAINE_2_FIN,         'Date fin semaine 2 (YYYY-MM-DD)'],
  ];

  sheet.getRange(2, 1, params.length, 3).setValues(params);
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(3, 320);

  // Mettre la colonne Valeur en jaune pâle pour montrer qu'elle est modifiable
  sheet.getRange(2, 2, params.length, 1).setBackground('#fef7e0');
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 10 — MENU PERSONNALISÉ GOOGLE SHEETS
// ───────────────────────────────────────────────────────────────────

/**
 * Crée le menu "PAS Admin" dans Google Sheets au chargement.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎓 PAS Admin')
    .addItem('1 — Initialiser le système', 'initialiserSysteme')
    .addSeparator()
    .addItem('2 — Lancer les rappels manuellement', 'lancerRappelsManuels')
    .addItem('3 — Voir le récapitulatif', 'voirRecapitulatif')
    .addSeparator()
    .addItem('4 — Réinitialiser un créneau', 'reinitialiserCreneau')
    .addItem('5 — Activer/Désactiver mode test', 'toggleModeTest')
    .addToUi();
}

function lancerRappelsManuels() {
  envoyerRappelsAutomatiques();
  SpreadsheetApp.getUi().alert('Rappels traités. Voir les logs pour le détail.');
}

function voirRecapitulatif() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Inscriptions');
  var donnees = sheet.getDataRange().getValues();

  var total = 0, confirmes = 0, annules = 0;
  for (var i = 1; i < donnees.length; i++) {
    total++;
    if (donnees[i][7] === 'confirmé') confirmes++;
    if (donnees[i][7] === 'annulé')   annules++;
  }

  SpreadsheetApp.getUi().alert(
    '📊 Récapitulatif\n\n' +
    'Total inscriptions : ' + total + '\n' +
    'Confirmées         : ' + confirmes + '\n' +
    'Annulées           : ' + annules
  );
}

function reinitialiserCreneau() {
  var ui = SpreadsheetApp.getUi();
  var rep = ui.prompt(
    'Réinitialiser un créneau',
    'Entre le nom du jour exact (ex: Lundi 8 juin) :\n(Toutes les inscriptions confirmées de ce jour seront annulées)',
    ui.ButtonSet.OK_CANCEL
  );
  if (rep.getSelectedButton() !== ui.Button.OK) return;

  var jour = rep.getResponseText().trim();
  var sheet = getSpreadsheet().getSheetByName('Inscriptions');
  var donnees = sheet.getDataRange().getValues();
  var count = 0;

  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][4] === jour && donnees[i][7] === 'confirmé') {
      sheet.getRange(i + 1, 8).setValue('annulé');
      count++;
    }
  }

  ui.alert(count + ' inscription(s) annulée(s) pour ' + jour + '.');
}

function toggleModeTest() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getSpreadsheet().getSheetByName('Config');
  var donnees = sheet.getDataRange().getValues();

  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][0] === 'MODE_TEST') {
      var actuel = donnees[i][1].toString() === 'true';
      var nouveau = !actuel;
      sheet.getRange(i + 1, 2).setValue(nouveau.toString());
      CONFIG.MODE_TEST = nouveau;
      ui.alert('Mode test : ' + (nouveau ? '✅ ACTIVÉ (emails simulés)' : '🔴 DÉSACTIVÉ (vrais emails envoyés)'));
      return;
    }
  }
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 11 — DÉCLENCHEUR CRON (rappels automatiques à 7h)
// ───────────────────────────────────────────────────────────────────

/**
 * Installe le déclencheur quotidien à 7h.
 * À appeler UNE SEULE FOIS manuellement depuis l'éditeur Apps Script.
 * Menu : Extensions → Apps Script → Exécuter → installerDeclencheur
 */
function installerDeclencheur() {
  // Supprimer les anciens déclencheurs pour éviter les doublons
  var declencheurs = ScriptApp.getProjectTriggers();
  declencheurs.forEach(function(d) {
    if (d.getHandlerFunction() === 'envoyerRappelsAutomatiques') {
      ScriptApp.deleteTrigger(d);
    }
  });

  // Créer le nouveau déclencheur quotidien entre 7h et 8h
  ScriptApp.newTrigger('envoyerRappelsAutomatiques')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  SpreadsheetApp.getUi().alert('✅ Déclencheur installé : rappels envoyés chaque jour à 7h.');
}

// ───────────────────────────────────────────────────────────────────
//  SECTION 12 — FONCTIONS UTILITAIRES
// ───────────────────────────────────────────────────────────────────

/**
 * Retourne le SpreadSheet actif.
 */
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Génère un token UUID v4 unique pour chaque inscription.
 */
function genererToken() {
  return Utilities.getUuid();
}

/**
 * Lit une valeur dans la feuille Config par nom de paramètre.
 */
function lireConfig(sheet, parametre) {
  var donnees = sheet.getDataRange().getValues();
  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][0] === parametre) {
      var val = donnees[i][1];
      if (val === 'true')  return true;
      if (val === 'false') return false;
      if (!isNaN(val) && val !== '') return Number(val);
      return val;
    }
  }
  return null;
}

/**
 * Compte combien de fois un email est inscrit sur une semaine donnée.
 */
function compterInscriptionsSemaine(sheet, email, semaine) {
  var donnees = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][6].toLowerCase() === email &&
        donnees[i][11] === semaine &&
        donnees[i][7] === 'confirmé') {
      count++;
    }
  }
  return count;
}

/**
 * Compte les places utilisées pour un créneau précis.
 */
function compterPlacesUtilisees(sheet, date, creneau) {
  var donnees = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][4] === date &&
        donnees[i][5] === creneau &&
        donnees[i][7] === 'confirmé') {
      count++;
    }
  }
  return count;
}

/**
 * Lit le nombre de places max pour un créneau depuis la feuille Planning.
 */
function lirePlacesMaxCreneau(sheet, date, creneau) {
  var donnees = sheet.getDataRange().getValues();
  for (var i = 1; i < donnees.length; i++) {
    if (donnees[i][1] === date && donnees[i][3] === creneau) {
      return donnees[i][4] || null;
    }
  }
  return null;
}

/**
 * Construit un objet Date à partir du label de jour et du créneau.
 * Utilisé pour calculer la date de rappel (J-48h).
 */
function construireDateSeance(dateLabel, creneau) {
  // Extraire l'heure de début du créneau (ex: "8h15 – 9h05" → 8h15)
  var match = creneau.match(/(\d+)h(\d+)/);
  var heure   = match ? parseInt(match[1]) : 8;
  var minutes = match ? parseInt(match[2]) : 0;

  // Retrouver la date ISO depuis le label
  var tousJours = JOURS_SEMAINE_1.concat(JOURS_SEMAINE_2);
  var dateISO = null;
  tousJours.forEach(function(j) {
    if (j.label === dateLabel) dateISO = j.date;
  });

  if (!dateISO) return new Date();

  var parties = dateISO.split('-');
  var d = new Date(parseInt(parties[0]), parseInt(parties[1]) - 1, parseInt(parties[2]), heure, minutes, 0);
  return d;
}
