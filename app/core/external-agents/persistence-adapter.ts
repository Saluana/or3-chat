import type {
  ExternalAgentPersistenceLease,
  ExternalAgentPersistenceSnapshot,
} from "./types";

/**
 * Serializes workspace persistence writes so an older, slower save cannot
 * overwrite a newer snapshot.
 */
export class ExternalAgentPersistenceAdapter {
  #saveTail: Promise<void> = Promise.resolve();

  async save(
    persistence: ExternalAgentPersistenceLease,
    snapshot: ExternalAgentPersistenceSnapshot,
  ): Promise<void> {
    const save = this.#saveTail.then(
      () => persistence.save(snapshot),
      () => persistence.save(snapshot),
    );
    this.#saveTail = save.catch(() => undefined);
    await save;
  }
}
