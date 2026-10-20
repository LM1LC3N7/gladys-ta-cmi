# TA C.M.I.

Intégration non officielle, sans lien avec Technische Alternative. Elle amène
dans Gladys les régulations **Technische Alternative** (UVR16x2, UVR1611,
UVR610, UVR65, UVR67, RSM610, CAN-I/O45, CAN-EZ2, CAN-EZ3, CAN-BC2,
CAN-MTx2…) par l'**API JSON officielle du C.M.I.** (Control and Monitoring
Interface), sur votre réseau local, **en lecture seule**.

> **Attention : jamais testé avec un vrai appareil.** Cette intégration a été
> écrite à partir de la bibliothèque Python ta-cmi et testée contre un faux
> C.M.I. seulement. Les retours sont les bienvenus.

## Ce que vous obtenez

Un appareil Gladys par **nœud CAN** derrière le C.M.I. (par exemple
« UVR16x2 (nœud 1) »), avec une fonctionnalité par voie :

| Valeurs lues         | Fonctionnalités                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principales (défaut) | Entrées (« Entrée 1 »…), sorties (« Sortie 1 »…), entrées du bus DL (« Entrée DL 1 »…).                                                                               |
| Toutes (sur demande) | En plus, si l'appareil les a : valeurs système (générales, soleil), journalisation analogique et numérique, entrées réseau, M-Bus, Modbus, KNX, puissance électrique. |

L'API JSON ne donne pas les noms des voies, seulement leur numéro et leur
unité : renommez les fonctionnalités dans Gladys (le nom donné n'est jamais
écrasé).

- Les températures (°C) sont des **sondes** : elles n'entrent pas dans la
  moyenne de la pièce.
- Les durées, pressions, volumes, distances, vitesses, CO2, luminosité,
  précipitations et montants (€, $) ont leur unité Gladys.
- Les autres unités (K, W/m², l/h, %, kW, kWh, MWh, V, A, Hz…) n'ont pas de
  catégorie dans Gladys : la fonctionnalité est un capteur simple, avec
  l'unité dans son nom (« Entrée 3 (l/h) »).
- L'énergie et la puissance ne sont **pas** envoyées au tableau de bord
  énergie de Gladys : le C.M.I. ne dit pas si un kWh est électrique ou
  thermique (compteur de chaleur), et Gladys le compterait comme de
  l'électricité.
- Une voie numérique (marche/arrêt, oui/non) vaut 0 ou 1.

Le badge de chaque appareil affiche « local », ou « injoignable » quand le
C.M.I. ne répond pas ou refuse les identifiants (avec un point orange quand ce
nœud seulement n'a pas pu être lu : nœud indisponible, bus CAN occupé…).

## Installation

1. Notez l'**adresse IP** du C.M.I. (donnez-lui un bail DHCP réservé), un
   **utilisateur** de son interface web (admin par défaut) et son **mot de
   passe**.
2. Facultatif : notez les numéros des **nœuds CAN** à lire (affichés par
   l'interface web du C.M.I.). Sans cette liste, l'intégration la demande au
   C.M.I. (une requête de plus, toutes les 6 heures).
3. Dans Gladys, installez l'intégration TA C.M.I., saisissez l'adresse,
   l'utilisateur, le mot de passe, et enregistrez.
4. Ajoutez les appareils depuis l'onglet **Découverte**.

## Une requête par minute

Le C.M.I. accepte **une requête par minute** sur son API JSON (il répond
« trop de requêtes » sinon). L'intégration respecte strictement cette limite :

- deux requêtes sont toujours espacées d'**au moins 75 secondes**, comptées
  depuis la fin de la précédente (réponse, erreur ou délai dépassé), quel que
  soit ce qui les demande (lecture régulière, bouton, Découverte) ;
- l'heure de la dernière requête est gardée dans `/data` **avant** chaque
  requête : un redémarrage n'envoie jamais rien trop tôt ;
- une lecture de tous les nœuds a lieu toutes les **5 minutes** par défaut
  (120 à 3600 secondes) ; avec plusieurs nœuds, chacun prend une requête (deux
  pour certains appareils avec « Toutes », comme le CAN-BC2), donc une lecture
  complète de 4 nœuds prend au moins 4 × 75 secondes.

Si un autre programme lit aussi le C.M.I. (ou si vous ouvrez son interface
web au même moment), le C.M.I. peut refuser une requête : l'intégration fait
alors une pause de 5, 10 puis 15 minutes.

Le bouton **Tester la connexion** n'envoie une requête que si la limite le
permet ; sinon il affiche l'état et le temps restant.

## Lecture seule

L'API JSON du C.M.I. ne sert qu'à lire : cette intégration **ne commande
rien**. Toutes les fonctionnalités sont en lecture seule ; une commande venue
de Gladys (scène, tableau de bord, assistant vocal) est refusée sans rien
envoyer.

## Identifiants et vie privée

- Le mot de passe est **gardé par Gladys dans sa base, jamais réaffiché, et
  envoyé seulement au C.M.I.** (authentification HTTP Basic). Il n'apparaît
  jamais dans les journaux, les messages d'état ni `/data`.
- Le volume `/data` de l'intégration garde l'heure de la dernière requête, la
  pause en cours, un arrêt sur identifiants refusés, la liste des nœuds et le
  type de chaque nœud, avec une empreinte de l'adresse et du port. Ni
  l'utilisateur, ni le mot de passe.
- Tout reste sur votre réseau local, en HTTP : quiconque écoute ce réseau peut
  lire les identifiants, comme avec l'interface web du C.M.I. Utilisez de
  préférence un utilisateur dédié.

## Erreurs

- **Identifiants refusés** (HTTP 401 ou 403) : les lectures s'arrêtent ; un
  nouvel essai après 10 min, 1 h, puis toutes les 6 h, ou aussitôt quand vous
  changez l'adresse, l'utilisateur ou le mot de passe. **Tester la
  connexion** réessaie aussi dès que la limite le permet. L'arrêt est gardé
  aux redémarrages.
- **Trop de requêtes** (code 4 du C.M.I. ou HTTP 429) : pause de 5, 10 puis
  15 minutes (Retry-After s'il est donné, 6 h au plus), gardée aux
  redémarrages.
- **Nœud indisponible, bus CAN occupé, appareil non pris en charge** (codes 1,
  2, 5, 7) : ce nœud est marqué injoignable, les autres continuent ; il est
  relu au cycle suivant.
- **C.M.I. injoignable** ou réponse inattendue : nouvel essai après 1, 2, 5,
  10 puis toutes les 15 minutes, jamais plus vite que l'intervalle.
- Une réponse trop grande (plus de 256 Ko) ou qui n'est pas le JSON attendu
  est refusée.

## Limites

- Jamais testé avec un vrai appareil.
- Pas de noms de voies (l'API JSON ne les donne pas).
- Les valeurs système de date et d'heure ne sont pas lues.
- Si l'unité d'une voie change sur la régulation, la fonctionnalité créée
  garde son ancienne unité et ne reçoit plus de valeur : supprimez l'appareil
  puis ajoutez-le de nouveau depuis la Découverte (son historique est perdu).
- Pas de CoE (CAN over Ethernet) ni de commande.

## Crédits

- [ta-cmi](https://gitlab.com/DeerMaximum/ta-cmi) de DeerMaximum (MIT) : les
  points d'accès de l'API JSON, les codes d'état, les types d'appareils, leurs
  paramètres et les codes d'unité sont portés en JavaScript.
- Voir `THIRD_PARTY_NOTICES.md`.

Technische Alternative, C.M.I. et UVR sont des marques de Technische
Alternative RT GmbH ; ce projet est sans lien avec Technische Alternative.
