/**
 * Lecture minimale d'un flux GTFS-RT TripUpdates (protobuf), sans dépendance : seulement les
 * champs utiles au module. Spécification : https://gtfs.org/realtime/reference/
 *
 *   FeedMessage.entity (2) → FeedEntity.trip_update (3) → TripUpdate
 *   TripUpdate.trip (1) → TripDescriptor.trip_id (1)
 *   TripUpdate.stop_time_update (2) → stop_id (4), arrival (2), departure (3)
 *   StopTimeEvent.time (2) : secondes Unix
 */

/** Heure réelle de passage (millisecondes), par voyage puis par arrêt. */
export type PassagesReels = Map<string, Map<string, number>>;

class Lecteur {
  constructor(
    private readonly buf: Uint8Array,
    public pos: number,
    private readonly fin: number,
  ) {}

  varint(): number {
    let valeur = 0;
    let facteur = 1;
    for (let i = 0; i < 10; i += 1) {
      if (this.pos >= this.fin) throw new Error('GTFS-RT tronqué');
      const octet = this.buf[this.pos++]!;
      valeur += (octet & 0x7f) * facteur;
      if (octet < 0x80) return valeur;
      facteur *= 128;
    }
    throw new Error('GTFS-RT : entier trop long');
  }

  /** Un champ délimité (sous-message ou chaîne) : un lecteur borné sur ses octets. */
  sous(): Lecteur {
    const longueur = this.varint();
    const debut = this.pos;
    this.pos += longueur;
    if (this.pos > this.fin) throw new Error('GTFS-RT tronqué');
    return new Lecteur(this.buf, debut, debut + longueur);
  }

  texte(): string {
    const champ = this.sous();
    return new TextDecoder().decode(this.buf.subarray(champ.pos, champ.fin));
  }

  private sauter(type: number): void {
    if (type === 0) this.varint();
    else if (type === 1) this.pos += 8;
    else if (type === 2) this.sous();
    else if (type === 5) this.pos += 4;
    else throw new Error(`GTFS-RT : type de champ ${type} inconnu`);
    if (this.pos > this.fin) throw new Error('GTFS-RT tronqué');
  }

  /** Parcourt les champs ; `lire` rend vrai s'il a consommé le champ, sinon il est sauté. */
  champs(lire: (numero: number, type: number) => boolean): void {
    while (this.pos < this.fin) {
      const cle = this.varint();
      const type = cle & 7;
      if (!lire(Math.floor(cle / 8), type)) this.sauter(type);
    }
  }
}

function heure(evenement: Lecteur): number | null {
  let secondes: number | null = null;
  evenement.champs((n, t) => {
    if (n !== 2 || t !== 0) return false;
    secondes = evenement.varint();
    return true;
  });
  return secondes;
}

/**
 * Les passages réels du flux, pour les seuls voyages demandés (le flux couvre tout le réseau).
 * Lève une erreur si le flux est illisible.
 */
export function lirePassages(buf: Uint8Array, voyages: Set<string>): PassagesReels {
  const passages: PassagesReels = new Map();
  const message = new Lecteur(buf, 0, buf.length);
  message.champs((n, t) => {
    if (n !== 2 || t !== 2) return false;
    const entite = message.sous();
    entite.champs((ne, te) => {
      if (ne !== 3 || te !== 2) return false;
      const maj = entite.sous();
      let voyage = '';
      const arrets: [string, number][] = [];
      maj.champs((nm, tm) => {
        if (nm === 1 && tm === 2) {
          const descripteur = maj.sous();
          descripteur.champs((nd, td) => {
            if (nd !== 1 || td !== 2) return false;
            voyage = descripteur.texte();
            return true;
          });
          return true;
        }
        if (nm === 2 && tm === 2) {
          const arret = maj.sous();
          let id = '';
          let arrivee: number | null = null;
          let depart: number | null = null;
          arret.champs((na, ta) => {
            if (na === 4 && ta === 2) id = arret.texte();
            else if (na === 2 && ta === 2) arrivee = heure(arret.sous());
            else if (na === 3 && ta === 2) depart = heure(arret.sous());
            else return false;
            return true;
          });
          const secondes = depart ?? arrivee;
          if (id && secondes) arrets.push([id, secondes * 1000]);
          return true;
        }
        return false;
      });
      if (voyage && voyages.has(voyage) && arrets.length) passages.set(voyage, new Map(arrets));
      return true;
    });
    return true;
  });
  return passages;
}
