import { createHash } from "node:crypto";
import { type Entity, isNaturalPersonNif, type Location } from "@sns-conv/schema";

/** pseudónimo estável (sem sal: só precisa de ser consistente entre snapshots e não reversível na prática) */
export function pseudonymForNif(nif: string): string {
  return `P${createHash("sha256").update(`sns-conv:${nif}`).digest("hex").slice(0, 8).toUpperCase()}`;
}

/**
 * Substitui o NIF de pessoas singulares por um pseudónimo em entidades, locais e convenções.
 * Corre no fim da ingestão, depois dos cruzamentos por NIF (Transparência, ERS).
 */
export function pseudonymiseNaturalPersons(entities: Entity[], locations: Location[]) {
  const map = new Map<string, string>();
  for (const e of entities) {
    if (isNaturalPersonNif(e.nif)) {
      const p = pseudonymForNif(e.nif);
      map.set(e.nif, p);
      e.nif = p;
    }
  }
  for (const l of locations) {
    l.nif = map.get(l.nif) ?? l.nif;
    for (const c of l.conventions) c.entityNif = map.get(c.entityNif) ?? c.entityNif;
  }
  return map.size;
}
