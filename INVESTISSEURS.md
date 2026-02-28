# Starknet NFT Ticketing -- Dossier Fonctionnel Investisseurs

## Vue d'ensemble

**Starknet NFT Ticketing** est une plateforme de billetterie decentralisee pour evenements (concerts, festivals, sport, conferences). Chaque billet vendu devient un **NFT** (jeton numerique unique) enregistre sur la blockchain Starknet. Cela signifie que chaque billet possede un certificat de propriete infalsifiable, verifiable par tous, et transferable de personne a personne sans intermediaire.

La plateforme couvre **l'integralite de la chaine de valeur** : creation d'evenement, vente de billets, paiement (carte bancaire ou crypto-monnaie), controle d'acces aux portes, revente entre particuliers, et meme le rattachement de billets vendus sur des plateformes classiques (Eventbrite, Weezevent, etc.).

---

## 1. Pourquoi la blockchain pour la billetterie ?

### Les problemes actuels de la billetterie classique

| Probleme | Impact |
|----------|--------|
| **Fraude et contrefacon** | Des millions de faux billets circulent chaque annee. Les acheteurs n'ont aucun moyen de verifier l'authenticite. |
| **Revente sauvage** | Les plateformes de revente (marche noir) fixent des prix exorbitants sans aucun controle de l'organisateur. |
| **Perte de controle** | Une fois le billet vendu, l'organisateur ne sait plus qui le possede. Aucune donnee sur les transferts. |
| **Frais d'intermediaires** | Chaque intermediaire (Ticketmaster, StubHub, revendeurs) preleve une commission. |
| **Billets perdus/voles** | Un billet papier ou PDF peut etre perdu, copie, ou partage sans controle. |

### Ce que la blockchain resout

| Solution | Comment |
|----------|---------|
| **Authenticite garantie** | Chaque billet est un NFT unique sur la blockchain. Impossible a contrefaire. |
| **Plafond de revente** | L'organisateur fixe un prix maximum de revente directement dans le code du contrat. Aucun depassement possible. |
| **Royalties automatiques** | A chaque revente, un pourcentage revient automatiquement a l'organisateur. Pas besoin de le reclamer. |
| **Tracabilite totale** | L'historique complet du billet (creation, ventes, transferts, utilisation) est visible sur la blockchain. |
| **Propriete reelle** | L'acheteur possede reellement son billet dans son portefeuille numerique. Aucun intermediaire ne peut le lui retirer. |

---

## 2. L'experience utilisateur -- Parcours complet

### 2.1 Le spectateur (fan)

**Etape 1 -- Connexion simplifiee**
Le spectateur se connecte avec son **compte Google, Apple, ou email**. Pas besoin de comprendre la blockchain ni de posseder un portefeuille crypto au prealable. La plateforme utilise **Web3Auth**, une technologie qui cree automatiquement un portefeuille blockchain invisible a partir de la connexion sociale. L'experience est identique a celle de n'importe quel site web moderne.

**Etape 2 -- Achat du billet**
Trois options de paiement :
- **Carte bancaire** via Stripe (Visa, Mastercard, etc.) -- identique a un achat en ligne classique.
- **Virement bancaire instantane** via Weero -- paiement par virement SEPA instantane, sans carte bancaire. Ideal pour les montants eleves ou les utilisateurs qui preferent payer directement depuis leur compte bancaire.
- **Crypto-monnaie** -- paiement en STRK (token natif Starknet), USDC ou USDT (stablecoins indexes sur le dollar). La plateforme verifie automatiquement le paiement sur la blockchain.

**Etape 3 -- Reception du billet NFT**
Apres paiement, le billet NFT est **cree automatiquement** (on dit "frappe" ou "mint") sur la blockchain et attribue au portefeuille du spectateur. Ce processus est gere en arriere-plan par une file d'attente qui garantit que meme en cas de forte affluence (ex: 10 000 ventes en 5 minutes), chaque billet est cree dans l'ordre et sans erreur.

**Etape 4 -- QR code dynamique**
Le spectateur accede a son billet depuis l'application. Un **QR code unique** est genere en temps reel. Ce QR code change toutes les 25 secondes et expire apres 30 secondes. Cela rend impossible la capture d'ecran ou la copie : un QR code photographie par un fraudeur sera deja invalide au moment ou il tente de l'utiliser.

**Etape 5 -- Entree a l'evenement**
Le personnel au portique scanne le QR code avec l'application. La validation se fait en **moins de 50 millisecondes** (0,05 seconde). Le systeme utilise un mecanisme atomique qui rend **physiquement impossible** la double utilisation : meme si deux portiques scannent le meme QR code a la meme milliseconde, un seul passage sera autorise.

**Etape 6 -- Revente**
Si le spectateur ne peut plus se rendre a l'evenement, il peut mettre son billet en vente sur la **place de marche integree**. Le prix est automatiquement plafonne par les regles definies par l'organisateur (par exemple : maximum 120% du prix d'achat). A chaque revente, des royalties sont versees automatiquement a l'organisateur.

### 2.2 L'organisateur

**Etape 1 -- Creation de l'evenement**
L'organisateur cree un evenement via l'interface. En coulisses, un **contrat intelligent** (smart contract) est deploye automatiquement sur la blockchain. Ce contrat contient toutes les regles de l'evenement : nombre maximum de billets, prix, plafond de revente, royalties, devises acceptees.

**Etape 2 -- Configuration avancee**
L'organisateur peut configurer :
- **Nombre maximum de billets** -- applique par le contrat blockchain (impossible de depasser, meme en cas de bug).
- **Plafond de revente** -- exprime en pourcentage du prix original (ex: 150% = le billet ne peut pas etre revendu a plus de 1,5x son prix).
- **Royalties** -- pourcentage preleve automatiquement sur chaque revente (ex: 5% revient a l'organisateur).
- **Mode "Soulbound"** -- si active, le billet est **intransferable**. Il est lie a l'identite de l'acheteur original et ne peut etre ni revendu, ni donne. Utile pour les evenements ou l'identite du porteur est importante (examens, ceremonies, VIP).
- **Devises acceptees** -- STRK, USDC, USDT, ou combinaison.
- **Sponsorisation des frais** -- l'organisateur peut payer les frais de transaction blockchain a la place des spectateurs (voir section Paymaster).

**Etape 3 -- Gestion du personnel**
L'organisateur attribue des roles : les membres du "staff" peuvent scanner les billets aux portes. Les droits d'acces sont geres par le systeme d'authentification (organizer/staff/fan).

**Etape 4 -- Tableau de bord et analytics**
Interface de suivi en temps reel : billets vendus, billets scannes, revenus, activite de revente.

---

## 3. Les fonctionnalites cles en detail

### 3.1 Billet intelligent (Smart Ticket)

Chaque billet n'est pas un simple jeton. C'est un **objet programmable** dont le comportement est regi par un contrat intelligent. Voici ses proprietes :

| Propriete | Description | Avantage business |
|-----------|-------------|-------------------|
| **Plafond de prix** | Le prix de revente ne peut pas depasser un maximum fixe par l'organisateur | Elimine la speculation sauvage |
| **Royalties automatiques** | A chaque revente, un pourcentage revient a l'organisateur | Revenus passifs sur le marche secondaire |
| **Etat dynamique** | Le billet passe par des etats : Disponible -> En vente -> Utilise -> Annule | Suivi en temps reel de chaque billet |
| **Controle d'acces** | Seul le personnel autorise (role STAFF) peut valider un billet | Securite aux portes |
| **Mode Soulbound** | Billet non-transferable, lie a son proprietaire | Anti-revente totale quand necessaire |
| **Limite de transferts** | Nombre maximum de reventes configurable | Controle de la circulation |

### 3.2 Transactions sans frais pour l'utilisateur (Paymaster)

Un des freins majeurs a l'adoption de la blockchain est le **cout des transactions** (appeles "gas fees"). Notre plateforme integre un systeme de **Paymaster** qui permet a l'organisateur de **prendre en charge les frais de transaction** a la place du spectateur.

Fonctionnement :
- L'organisateur depose un **budget** sur le Paymaster.
- Chaque transaction effectuee par un spectateur (achat, transfert, revente) est **sponsorisee** : le spectateur ne paie rien en frais blockchain.
- Des **limites quotidiennes** empechent les abus (par exemple : maximum 10 transactions par jour par utilisateur).
- Un systeme **anti-spam** empeche les utilisateurs malveillants d'epuiser le budget (delai minimum entre chaque transaction).

Resultat : **l'utilisateur final ne voit jamais de frais blockchain**. L'experience est identique a celle d'une application classique.

### 3.3 Place de marche integree (Marketplace)

La plateforme inclut une **place de marche de revente peer-to-peer** (de particulier a particulier), directement integree :

- **Mise en vente** : le possesseur d'un billet le met en vente en un clic.
- **Achat** : l'acheteur paie et recoit instantanement le billet dans son portefeuille.
- **Commission plateforme** : 2% preleves automatiquement sur chaque transaction de revente.
- **Plafond de prix** : le prix est automatiquement bloque si il depasse le maximum autorise par l'organisateur.
- **Royalties organisateur** : versees automatiquement a chaque revente.
- **Securite anti-fraude** : le contrat utilise le pattern CEI (Checks-Effects-Interactions), une methode de programmation qui rend impossible les attaques par reentrance (une technique de piratage classique en blockchain).

### 3.4 Controle d'acces rapide (Scan QR)

Le systeme de scan est concu pour les evenements de grande capacite (stades, festivals) :

- **Temps de validation : < 50 ms** (0,05 seconde). Plus rapide qu'un lecteur de code-barres classique.
- **QR code dynamique** : change toutes les 25 secondes. Impossible a photocopier ou a partager par capture d'ecran.
- **Signature cryptographique** : chaque QR code est signe numeriquement. Un QR code modifie ou forge est immediatement rejete.
- **Anti-double utilisation atomique** : meme si deux agents scannent le meme billet au meme instant, un seul passage est autorise. Le systeme utilise une operation Redis SETNX (Set if Not Exists), une primitive de base de donnees qui garantit l'unicite au niveau materiel.
- **Mode hors-ligne** : en cas de coupure reseau au lieu de l'evenement, les scans sont mis en cache localement et synchronises des que la connexion revient.

### 3.5 Bridge Digital Twin (Pont Jumeau Numerique)

C'est la fonctionnalite la plus innovante et celle qui differencie la plateforme de ses concurrents. Le **Digital Twin Bridge** permet de **connecter n'importe quelle plateforme de billetterie classique** (Eventbrite, Weezevent, See Tickets, etc.) a la blockchain.

**Le probleme** : un organisateur utilise deja Eventbrite pour vendre ses billets. Il veut offrir a ses spectateurs les avantages de la blockchain (propriete, revente controlee, collectible) sans changer de plateforme de vente.

**La solution** :

1. **Le spectateur achete son billet normalement** sur Eventbrite/Weezevent/etc.
2. **La plateforme classique envoie une notification automatique** (webhook) a notre systeme pour chaque vente.
3. **Notre systeme cree automatiquement le NFT correspondant** sur la blockchain Starknet. Le NFT est temporairement conserve dans un "coffre-fort" (vault) en attendant que l'acheteur le reclame.
4. **L'acheteur se connecte** sur notre application avec le meme email que celui utilise pour l'achat.
5. **Le NFT lui est automatiquement transfere** dans son portefeuille.

Le spectateur se retrouve avec un **billet classique** (pour l'entree) ET un **NFT** (pour la propriete, la revente, et la collectibilite). D'ou le nom "Digital Twin" : le NFT est le jumeau numerique du billet classique.

**Securite du bridge** :
- Chaque notification est **signee cryptographiquement** (HMAC-SHA256). Une notification forgee est immediatement rejetee.
- Le systeme est **idempotent** : si la plateforme classique envoie la meme notification deux fois (ce qui arrive frequemment), le second envoi est ignore. Pas de doublon.
- Les evenements en mode **Soulbound** sont automatiquement rejetes (un NFT intransferable ne peut pas etre depose dans un coffre-fort pour etre reclame).
- **Limitation du debit** : 100 notifications par minute (webhook), 10 reclamations par minute (claim). Protection contre les surcharges et les abus.

### 3.6 Recuperation de compte (Account Recovery)

Si un spectateur perd acces a son compte (telephone perdu, oubli de mot de passe), un systeme de recuperation securise est en place :

- **Gardien** : un tiers de confiance (ami, service client) est designe a l'avance.
- **Delai de securite de 24h** : une demande de recuperation ne prend effet qu'apres 24 heures. Si le proprietaire legitime revient entre-temps, il peut annuler la demande.
- **Revocation automatique** : toutes les sessions actives et cles temporaires sont automatiquement invalidees lors d'une recuperation.

Ce systeme empeche un attaquant de voler un compte meme s'il a acces au gardien : le proprietaire a 24 heures pour bloquer l'operation.

### 3.7 Sessions temporaires (Session Keys)

Pour eviter que l'utilisateur ait a approuver chaque action individuellement (ce qui est une friction majeure en blockchain), le systeme utilise des **cles de session** :

- L'utilisateur approuve une session une seule fois.
- Pendant **24 heures maximum**, les actions sont pre-approuvees (achats, transferts, scans).
- Chaque cle de session a un **perimetre limite** : elle ne peut effectuer que certaines actions precises.
- Les cles expirent automatiquement et sont revoquees en cas de recuperation de compte.

---

## 4. Modele de revenus

| Source de revenus | Description | Qui paie |
|-------------------|-------------|----------|
| **Commission de vente primaire** | Pourcentage sur chaque billet vendu | Organisateur |
| **Commission marketplace** | 2% sur chaque revente P2P | Vendeur |
| **Royalties organisateur** | Configurables par evenement (ex: 5%) | Acheteur secondaire |
| **Frais de bridge** | Possibilite de facturer le minting automatique | Organisateur |
| **Sponsorisation Paymaster** | L'organisateur depose un budget pour payer les frais de ses spectateurs | Organisateur |

---

## 5. Avantages concurrentiels

### 5.1 Par rapport aux plateformes classiques (Ticketmaster, Eventbrite)

| Critere | Classique | Notre solution |
|---------|-----------|----------------|
| Contrefacon | Possible (PDF copiable) | Impossible (NFT unique sur blockchain) |
| Revente sauvage | Aucun controle | Prix plafonne par contrat intelligent |
| Royalties sur revente | Inexistantes | Automatiques et programmables |
| Propriete du billet | Licence revocable | Propriete reelle (NFT) |
| Tracabilite | Limitee | Complete et publique |
| Frais utilisateur blockchain | N/A | Zero (Paymaster) |

### 5.2 Le marche de la billetterie blockchain

Le marche mondial de la billetterie NFT est evalue a **1,3 milliard de dollars en 2025** et devrait atteindre **4,5 a 7,8 milliards de dollars d'ici 2033** selon les estimations (CAGR de 14 a 25%). En 2025, plus de **18% des organisateurs d'evenements en Amerique du Nord** ont adopte des systemes bases sur les NFT pour eliminer les faux billets et reprendre le controle du marche secondaire.

Ce marche est encore jeune et fragmente. Aucun acteur n'a pris une position dominante. C'est le moment ideal pour entrer avec une solution techniquement superieure.

### 5.3 Analyse des concurrents blockchain

#### GET Protocol (Pays-Bas)
- **Blockchain** : Polygon (sidechain Ethereum)
- **Forces** : Pionnier du secteur, plateforme reconnue, integrations avec des organisateurs europeens
- **Faiblesses** : Pas de bridge Digital Twin automatise, pas de Paymaster natif (les utilisateurs paient des frais), QR codes statiques, pas de mode Soulbound, pas de recuperation de compte avancee
- **Notre avantage** : Notre solution est plus complete fonctionnellement et utilise une blockchain plus performante

#### GUTS Tickets (Pays-Bas, acquis par CM.com en 2025)
- **Blockchain** : Proprietary (semi-centralise)
- **Forces** : QR codes dynamiques (similaires aux notres), rachat par CM.com qui apporte une base clients large
- **Faiblesses** : Solution semi-centralisee (pas de vraie propriete NFT), pas de marketplace P2P integree, pas de royalties automatiques, dependance a CM.com pour l'evolution produit
- **Notre avantage** : Veritable decentralisation (propriete reelle du billet), marketplace integree avec plafond de prix et royalties

#### YellowHeart (USA)
- **Blockchain** : Polygon
- **Forces** : Partenariats avec des artistes majeurs (Maroon 5, Kings of Leon), forte visibilite marketing
- **Faiblesses** : Focus sur le marche americain, pas de bridge avec les plateformes classiques, frais de transaction visibles pour l'utilisateur, pas de Paymaster
- **Notre avantage** : Bridge Digital Twin (compatible Eventbrite/Weezevent), zero frais utilisateur via Paymaster, marche europeen et international

#### tokenproof (USA)
- **Blockchain** : Ethereum
- **Forces** : Token-gating innovant (acces conditionnel base sur la possession de NFT), ecosysteme Web3 natif
- **Faiblesses** : Frais de transaction Ethereum eleves (plusieurs dollars par transaction), pas de solution de billetterie complete, pas de scan rapide pour evenements physiques
- **Notre avantage** : Solution de billetterie de bout en bout (pas seulement du token-gating), frais quasi-nuls sur Starknet

#### Comparaison synthetique

| Critere | GET Protocol | GUTS / CM.com | YellowHeart | tokenproof | **Notre solution** |
|---------|-------------|---------------|-------------|------------|-------------------|
| Blockchain | Polygon | Proprietary | Polygon | Ethereum | **Starknet (ZK)** |
| Cout/transaction | ~0,02 $ | N/A | ~0,02 $ | 2-10 $ | **~0,002 $** |
| Bridge ticketing classique | Non | Partiel | Non | Non | **Oui (automatise)** |
| QR dynamique | Non | Oui | Non | Non | **Oui (25s, signe)** |
| Temps de scan | Variable | Variable | Variable | N/A | **< 50 ms garanti** |
| Transactions gasless | Non | N/A | Non | Non | **Oui (Paymaster)** |
| Marketplace P2P | Basique | Non | Oui | Non | **Oui (plafond + royalties)** |
| Plafond de revente on-chain | Non | Non | Partiel | Non | **Oui (contrat intelligent)** |
| Royalties automatiques | Non | Non | Partiel | Non | **Oui (programmables)** |
| Mode Soulbound | Non | Non | Non | Non | **Oui (natif)** |
| Recuperation de compte | Non | Non | Non | Non | **Gardien + timelock 24h** |
| Mode hors-ligne | Non | Partiel | Non | Non | **Cache + sync auto** |
| Preuve zero-knowledge | Non | Non | Non | Non | **Oui (ZK-STARKs)** |

### 5.4 Starknet : pourquoi cette blockchain ?

Le choix de la blockchain est une decision strategique fondamentale. Voici pourquoi Starknet est le meilleur choix pour une plateforme de billetterie, et pourquoi les concurrents sont limites par leur choix technique.

#### Le probleme des blockchains actuelles pour la billetterie

La billetterie a des contraintes specifiques que la plupart des blockchains ne peuvent pas satisfaire :

- **Volume** : un festival de 100 000 personnes genere 100 000+ transactions (achat, entree, revente). Il faut traiter des pics massifs en quelques heures.
- **Cout** : si chaque transaction coute 2 $, un evenement de 100 000 billets coute 200 000 $ rien qu'en frais blockchain. Inacceptable.
- **Vitesse** : au portique d'un stade, chaque seconde compte. 15 secondes de confirmation = file d'attente qui s'allonge.
- **Securite** : les billets ont une valeur reelle (parfois des centaines d'euros). La blockchain doit etre aussi sure qu'Ethereum.

#### Pourquoi PAS Ethereum directement ?

| Critere | Ethereum L1 | Impact billetterie |
|---------|-------------|-------------------|
| Cout moyen | 2 a 50 $ par transaction | Economiquement impossible pour de la billetterie grand public |
| Debit | ~15 transactions/seconde | Un seul evenement de 50 000 places saturerait le reseau pendant des heures |
| Confirmation | 12 secondes minimum | Trop lent pour le scan aux portes |

Ethereum est la blockchain la plus securisee au monde, mais elle n'est pas concue pour des applications a haut volume et faible valeur unitaire comme la billetterie.

#### Pourquoi PAS Polygon ?

Polygon est le choix de la plupart des concurrents (GET Protocol, YellowHeart). C'est un choix "facile" mais avec des compromis importants :

| Critere | Polygon | Starknet | Avantage |
|---------|---------|----------|----------|
| Type | Sidechain / zkEVM | ZK-Rollup natif | Starknet |
| Securite | Validateurs propres (ne herite pas totalement d'Ethereum) | Herite directement de la securite d'Ethereum L1 | Starknet |
| Cout/tx | ~0,02 $ | ~0,002 $ | **Starknet (10x moins cher)** |
| Debit | 40-50 TPS | ~127 TPS (mesure fin 2024) | **Starknet (2,5x plus rapide)** |
| Preuves | zkEVM (en transition) | ZK-STARKs (natif depuis le debut) | Starknet |
| Decentralisation | Centralisee (peu de validateurs) | Stage 1 atteint en 2025 (valide par Vitalik Buterin) | Starknet |
| Abstraction de compte | Non native | **Native** (chaque compte est un contrat intelligent) | Starknet |

Le point le plus critique : **l'abstraction de compte native**. Sur Starknet, chaque compte utilisateur est un contrat intelligent. Cela permet nativement les sessions temporaires, la recuperation par gardien, et le Paymaster. Sur Polygon, ces fonctionnalites necessitent des hacks complexes et fragiles (ERC-4337), non supportes par la plupart des portefeuilles.

#### Pourquoi PAS zkSync ou Optimism ?

| Solution | Limitation principale pour la billetterie |
|----------|------------------------------------------|
| **zkSync Era** | Debit reel de 12-15 TPS (insuffisant pour les pics), ecosysteme encore immature |
| **Optimism** | Rollup optimiste = 7 jours de delai pour les retraits, pas de preuves zero-knowledge |
| **Arbitrum** | Memes limitations qu'Optimism (rollup optimiste), pas d'abstraction de compte native |
| **Base** (Coinbase) | Rollup optimiste, dependance a Coinbase (centralisation), pas de ZK |

#### Les atouts uniques de Starknet

**1. Cout : la fraction de centime**
Une transaction sur Starknet coute en moyenne **0,002 $** (0,2 centime). Pour un evenement de 100 000 billets, le cout total en frais blockchain serait de **200 $** au lieu de 200 000 $ sur Ethereum ou 2 000 $ sur Polygon. Ce cout negligeable permet de sponsoriser tous les frais via le Paymaster sans impact significatif sur la marge.

**2. Vitesse : confirmation en moins de 2 secondes**
Starknet confirme les transactions en moins de 2 secondes. Pour le scan au portique, notre systeme utilise un cache Redis (< 50 ms) avec confirmation blockchain en arriere-plan. L'utilisateur ne ressent aucune latence.

**3. Securite : la garantie Ethereum**
Starknet est un "rollup" : toutes les transactions sont regroupees en lots, et une **preuve mathematique** (ZK-STARK) est generee pour prouver que ces transactions sont valides. Cette preuve est ensuite **verifiee sur Ethereum**. Cela signifie que meme si Starknet disparaissait demain, tous les billets et leur historique seraient recuperables a partir d'Ethereum. C'est le niveau de securite le plus eleve disponible dans l'industrie blockchain.

**4. Abstraction de compte : l'experience Web2**
Sur Starknet, chaque utilisateur possede un **compte intelligent** (smart account). Cela permet :
- Se connecter avec Google/Apple/email (pas besoin de cle privee)
- Sessions temporaires (pas de popup de confirmation a chaque action)
- Recuperation de compte par un gardien (pas de "seed phrase" a memoriser)
- Paymaster (l'organisateur paie les frais a la place de l'utilisateur)

Aucune autre blockchain ne propose ces 4 fonctionnalites nativement. Sur Polygon ou Ethereum, il faut assembler des solutions tierces fragiles et couteuses.

**5. Scalabilite : pret pour la croissance**
Starknet a atteint 127 TPS en conditions reelles fin 2024, avec des ameliorations prevues (objectif : x4 du debit, -80% sur les frais). Grace a la compression "Stateful" des donnees, Starknet optimise l'utilisation des blobs Ethereum, ce qui maintient des frais bas meme quand le reseau est tres sollicite.

**6. Ecosysteme et financement**
StarkWare, la societe derriere Starknet, a leve **287 millions de dollars** aupres d'investisseurs de premier plan :
- **Sequoia Capital** (fonds le plus prestigieux de la Silicon Valley)
- **Paradigm** (fonds crypto de reference)
- **Coatue Management**, **Tiger Global**
- **Vitalik Buterin** (createur d'Ethereum, investisseur personnel)
- **Ethereum Foundation** (12 millions de dollars de soutien)

La valorisation de StarkWare atteint **8 milliards de dollars** (Serie D, 2022). Starknet a atteint le **Stage 1 de decentralisation** en 2025, un jalon valide par le framework de Vitalik Buterin lui-meme.

#### Resume : pourquoi Starknet est optimal pour la billetterie

| Besoin billetterie | Solution Starknet |
|-------------------|-------------------|
| Cout bas (millions de transactions) | 0,002 $/tx — le plus bas du marche L2 |
| Confirmation rapide (portique) | < 2 secondes on-chain, < 50 ms avec cache |
| Securite maximale (billets = argent reel) | Preuves ZK verifiees sur Ethereum L1 |
| UX sans friction (grand public) | Abstraction de compte native + Paymaster |
| Scalabilite (festivals, stades) | 127+ TPS, compression Stateful |
| Perennite (investissement long terme) | StarkWare valorise 8 Mds $, Sequoia/Paradigm/Vitalik |

---

## 6. Maturite technique

### 6.1 Tests automatises

La plateforme est couverte par **235 tests automatises** qui verifient le bon fonctionnement de chaque composant :

| Composant | Nombre de tests | Couverture |
|-----------|----------------|------------|
| Contrats intelligents (Cairo) | 71 tests | Mint, transfert, revente, plafonds, royalties, soulbound, sessions, recovery, paymaster |
| Backend (TypeScript) | 164 tests | Routes, services, workers, integration, bridge, securite |
| **Total** | **235 tests** | |

### 6.2 Integration continue (CI/CD)

A chaque modification du code, **3 pipelines automatiques** se lancent en parallele :

1. **Contrats** : verification du formatage, compilation, execution des 71 tests, rapport de consommation de gas.
2. **Backend** : installation des dependances, verification des types, execution des 164 tests.
3. **Frontend** : verification des types, compilation de production.

Si un seul test echoue, la modification est rejetee. Cela garantit que le code en production est toujours fonctionnel.

### 6.3 Architecture

La plateforme est composee de **6 contrats intelligents** sur la blockchain et d'une application complete (serveur + interface). L'architecture est modulaire : chaque composant peut etre mis a jour independamment.

| Couche | Technologie | Maturite |
|--------|-------------|----------|
| Blockchain | Starknet + Cairo 2.9 | Production-ready |
| Serveur | Node.js + Fastify + TypeScript | Production-ready |
| Base de donnees | PostgreSQL + Redis | Standard industriel |
| File d'attente | BullMQ | Standard industriel |
| Interface | Next.js + React | Standard industriel |
| Authentification | Web3Auth + JWT | Standard industriel |
| Paiement | Stripe + Weero + crypto (STRK/USDC/USDT) | Standard industriel |

---

## 7. Securite -- Resume non technique

| Menace | Protection |
|--------|-----------|
| Faux billets | Chaque billet est un NFT unique sur la blockchain, impossible a dupliquer |
| Copie de QR code | Le QR change toutes les 25 secondes et est signe cryptographiquement |
| Double utilisation d'un billet | Mecanisme atomique : un seul passage possible, meme en cas de scan simultane |
| Revente abusive | Plafond de prix applique par le contrat intelligent (non modifiable) |
| Vol de compte | Recuperation avec gardien + delai de securite de 24 heures |
| Attaques sur la plateforme | Limitation de debit, validation stricte de toutes les donnees, en-tetes de securite |
| Notification forgee (bridge) | Signature cryptographique obligatoire sur chaque notification externe |
| Epuisement du budget Paymaster | Limites quotidiennes et anti-spam par utilisateur |
| Panne reseau au lieu de l'evenement | Mode hors-ligne avec synchronisation automatique |

---

## 8. Cas d'usage cibles

1. **Concerts et festivals** -- Gestion de billets NFT avec revente controlee et royalties.
2. **Evenements sportifs** -- Stades de grande capacite avec scan < 50 ms.
3. **Conferences professionnelles** -- Billets Soulbound (non-transferables) lies a l'identite.
4. **Spectacles** -- Bridge avec les plateformes de vente existantes (pas besoin de changer d'outil).
5. **Experiences VIP** -- Le NFT devient un collectible apres l'evenement (valeur memorielle et commerciale).

---

## 9. Feuille de route potentielle

| Phase | Fonctionnalite | Statut |
|-------|---------------|--------|
| V1 | Contrats intelligents (mint, transfert, marketplace, paymaster, account) | Fait |
| V2 | Backend complet (paiement, scan, workers, securite) | Fait |
| V2.1 | Digital Twin Bridge (Eventbrite/Weezevent/etc.) | Fait |
| V3 | Application mobile native (iOS/Android) | A developper |
| V3 | Dashboard analytics avance pour organisateurs | A developper |
| V4 | NFT collectibles post-evenement (souvenirs numeriques) | A developper |
| V4 | Programme de fidelite cross-evenements | A developper |
| V5 | Integration directe Ticketmaster / See Tickets | A developper |

---

## 10. Chiffres cles

- **6** contrats intelligents sur blockchain
- **19** endpoints API (points d'entree du serveur)
- **235** tests automatises (71 blockchain + 164 serveur)
- **< 50 ms** temps de validation d'un billet au portique
- **25 s** rotation du QR code (anti-copie)
- **24 h** delai de securite pour la recuperation de compte
- **2%** commission marketplace sur les reventes
- **3** devises crypto acceptees (STRK, USDC, USDT)
- **0** frais blockchain pour l'utilisateur final (Paymaster)

---

*Document genere a partir de la documentation technique du projet Starknet NFT Ticketing -- Fevrier 2026*
