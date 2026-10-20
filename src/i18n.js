// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature names),
// in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

export const both = (en, fr) => ({ en, fr });

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

/** "45 s" / "25 min" / "3 h", for the waits. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 120) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

/** The names of the sections of an answer, by their short code (src/constants.js SECTIONS). */
export const SECTION_NAMES = {
  in: both('Input', 'Entrée'),
  out: both('Output', 'Sortie'),
  dl: both('DL input', 'Entrée DL'),
  sg: both('System value (general)', 'Valeur système (générale)'),
  ss: both('System value (sun)', 'Valeur système (soleil)'),
  sp: both('Electrical power', 'Puissance électrique'),
  na: both('Analog network input', 'Entrée réseau analogique'),
  nd: both('Digital network input', 'Entrée réseau numérique'),
  mb: both('M-Bus', 'M-Bus'),
  mo: both('Modbus', 'Modbus'),
  knx: both('KNX', 'KNX'),
  la: both('Analog logging', 'Journalisation analogique'),
  ld: both('Digital logging', 'Journalisation numérique'),
};

export const NODE_NAME = (type, id) => both(`${type} (node ${id})`, `${type} (nœud ${id})`);

/** The reason of a failure, in each language (never the English reason in French). */
export function reasonOf(err) {
  const status = err?.status ? ` (HTTP ${err.status})` : '';
  switch (err?.kind) {
    case 'timeout':
      return both('no answer in time', 'pas de réponse à temps');
    case 'network':
      return both(
        'the C.M.I. cannot be reached on the network',
        'le C.M.I. est injoignable sur le réseau',
      );
    case 'unavailable':
      return both(
        `the C.M.I. answered an error${status}`,
        `le C.M.I. a répondu une erreur${status}`,
      );
    case 'bad_response':
    case 'empty':
    case 'size':
      return both('the answer is not the expected one', "la réponse n'est pas celle attendue");
    default:
      return both(`unexpected answer${status}`, `réponse inattendue${status}`);
  }
}

/** The reason a node was not read (status code of the answer), in each language. */
export function nodeReasonOf(code) {
  switch (code) {
    case 1:
      return both('node not available', 'nœud indisponible');
    case 2:
      return both('CAN request failed', 'échec de la requête CAN');
    case 5:
      return both('device not supported', 'appareil non pris en charge');
    case 7:
      return both('CAN bus busy', 'bus CAN occupé');
    default:
      return both(`refused (code ${code ?? '?'})`, `refusé (code ${code ?? '?'})`);
  }
}

export const T = {
  noConfig: both(
    'Enter the IP address of the C.M.I., its user name and its password.',
    "Saisissez l'adresse IP du C.M.I., son nom d'utilisateur et son mot de passe.",
  ),
  addressPath: both(
    'The address field holds a path or credentials: enter only the IP address (and the port). Remove the rest: it may hold the password.',
    "Le champ adresse contient un chemin ou des identifiants : saisissez seulement l'adresse IP (et le port). Retirez le reste : il peut contenir le mot de passe.",
  ),
  addressHttps: both(
    'Enter the address without "https://": the JSON API of the C.M.I. is read over http on your local network.',
    "Saisissez l'adresse sans « https:// » : l'API JSON du C.M.I. est lue en http sur votre réseau local.",
  ),
  addressInvalid: both(
    'The address is not a valid IP address or host name.',
    "L'adresse n'est pas une adresse IP ou un nom d'hôte valide.",
  ),
  nodesInvalid: both(
    'The CAN nodes field must list node numbers (1 to 62, 16 at most) separated by commas, or stay empty.',
    'Le champ des nœuds CAN doit lister des numéros de nœud (1 à 62, 16 au plus) séparés par des virgules, ou rester vide.',
  ),
  connecting: (wait) =>
    both(
      `Waiting for the next request to the C.M.I. (one per minute at most): ${wait.en}.`,
      `Attente de la prochaine requête au C.M.I. (une par minute au plus) : ${wait.fr}.`,
    ),
  reading: both(
    'Reading the C.M.I. (one request per minute at most)…',
    'Lecture du C.M.I. (une requête par minute au plus)…',
  ),
  connected: (read, total) =>
    both(
      `Connected: ${read}/${total} node${total > 1 ? 's' : ''} read (read only, one request per minute at most).`,
      `Connecté : ${read}/${total} nœud${total > 1 ? 's' : ''} lu${read > 1 ? 's' : ''} (lecture seule, une requête par minute au plus).`,
    ),
  nodeErrors: (list) => both(`Not read: ${list.en}.`, `Non lus : ${list.fr}.`),
  noNode: both(
    'The C.M.I. lists no CAN node. Enter the node numbers in the configuration (shown in the C.M.I. web interface).',
    "Le C.M.I. ne liste aucun nœud CAN. Saisissez les numéros des nœuds dans la configuration (affichés par l'interface web du C.M.I.).",
  ),
  refused: (wait) =>
    both(
      `The C.M.I. refused the user name or the password. New try in ${wait.en}, or at once when you change them. "Test the connection" also tries again once the one-minute limit allows it.`,
      `Le C.M.I. a refusé le nom d'utilisateur ou le mot de passe. Nouvel essai dans ${wait.fr}, ou aussitôt quand vous les changez. « Tester la connexion » réessaie aussi dès que la limite d'une requête par minute le permet.`,
    ),
  rateLimited: (wait) =>
    both(
      `The C.M.I. refused a request: one per minute at most (another program, or its web interface, may be reading it too). Pause of ${wait.en}.`,
      `Le C.M.I. a refusé une requête : une par minute au plus (un autre programme, ou son interface web, le lit peut-être aussi). Pause de ${wait.fr}.`,
    ),
  waiting: (wait) =>
    both(
      `Waiting before the next request to the C.M.I. (${wait.en}).`,
      `Attente avant la prochaine requête au C.M.I. (${wait.fr}).`,
    ),
  unreachable: (reason, wait) =>
    both(
      `C.M.I. not read: ${reason.en}. New try in ${wait.en}.`,
      `C.M.I. non lu : ${reason.fr}. Nouvel essai dans ${wait.fr}.`,
    ),
  test: {
    wait: (wait) =>
      both(
        `The C.M.I. accepts one request per minute: next request possible in ${wait.en}.`,
        `Le C.M.I. accepte une requête par minute : prochaine requête possible dans ${wait.fr}.`,
      ),
  },
  busy: both(
    'A request is in progress, try again in a minute.',
    'Une requête est en cours, réessayez dans une minute.',
  ),
  readOnly: both(
    'This integration is read only: nothing can be changed on the controller from Gladys.',
    'Cette intégration est en lecture seule : rien ne peut être modifié sur la régulation depuis Gladys.',
  ),
  notInAnswer: both(
    'Not in the last answer of the C.M.I.',
    'Absent de la dernière réponse du C.M.I.',
  ),
};
