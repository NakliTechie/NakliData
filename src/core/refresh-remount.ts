import type { Engine } from './engine.ts';
import { getHandle } from './handles.ts';
import {
  type MountedSource,
  mountUrl,
  reconcileRemountedFolder,
  releaseMountedTableNames,
  remountFolderFromHandle,
} from './mount.ts';

export interface StagedRefreshBatch {
  sources: MountedSource[];
  replacements: Array<{ stagedName: string; targetName: string }>;
  removals: string[];
  /** Every staging relation, including newly-added relations retained on success. */
  stagingNames: string[];
  /** Staging relations materialised into an existing target, then discarded. */
  disposableStagingNames: string[];
}

/** Read and validate every changed source into collision-safe staging relations. */
export async function stageSourceRefreshes(
  engine: Engine,
  sources: ReadonlyArray<MountedSource>,
): Promise<StagedRefreshBatch> {
  const batch: StagedRefreshBatch = {
    sources: [],
    replacements: [],
    removals: [],
    stagingNames: [],
    disposableStagingNames: [],
  };
  try {
    for (const source of sources) {
      if (source.kind === 'fsa-folder') {
        if (!source.ref) throw new Error(`Folder source "${source.label}" has no saved handle.`);
        const handle = await getHandle(source.ref);
        if (!handle || handle.kind !== 'directory') {
          throw new Error(`Folder source "${source.label}" needs to be reconnected.`);
        }
        const remounted = await remountFolderFromHandle(
          engine,
          handle as FileSystemDirectoryHandle,
          source.ref,
          source.label,
          source.id,
        );
        const reconciled = reconcileRemountedFolder(remounted, source.tables);
        const stagingNames = remounted.tables.map((table) => table.name);
        batch.sources.push(reconciled.source);
        batch.replacements.push(...reconciled.relationReplacements);
        batch.removals.push(...reconciled.removedRelationNames);
        batch.stagingNames.push(...stagingNames);
        batch.disposableStagingNames.push(
          ...reconciled.relationReplacements.map((replacement) => replacement.stagedName),
        );
        continue;
      }

      if (source.kind === 'http') {
        const prior = source.tables[0];
        if (!source.ref || !prior) {
          throw new Error(`URL source "${source.label}" is missing its persisted relation.`);
        }
        const remounted = await mountUrl(engine, {
          url: source.ref,
          label: source.label,
          tableName: prior.name,
        });
        const staged = remounted.tables[0];
        if (!staged) throw new Error(`URL source "${source.label}" produced no table.`);
        batch.sources.push({
          ...remounted,
          id: source.id,
          tables: [{ ...staged, id: prior.id, sourceId: source.id, name: prior.name }],
        });
        batch.replacements.push({ stagedName: staged.name, targetName: prior.name });
        batch.stagingNames.push(staged.name);
        batch.disposableStagingNames.push(staged.name);
        continue;
      }

      throw new Error(
        `Source "${source.label}" supports change detection but not transactional remount yet.`,
      );
    }
    return batch;
  } catch (err) {
    await cleanupStagedRefresh(engine, batch.stagingNames);
    throw err;
  }
}

/**
 * Swap every staged relation in one DuckDB transaction. Workbook state is
 * intentionally not touched here; the caller publishes `batch.sources` only
 * after this succeeds.
 */
export async function commitStagedRefresh(
  engine: Engine,
  batch: StagedRefreshBatch,
): Promise<void> {
  try {
    await engine.replaceRelationsAtomically(batch.replacements, batch.removals);
  } catch (err) {
    await cleanupStagedRefresh(engine, batch.stagingNames);
    throw err;
  }

  await cleanupStagedRefresh(engine, batch.disposableStagingNames);
  releaseMountedTableNames(engine, batch.removals);
}

async function cleanupStagedRefresh(engine: Engine, names: ReadonlyArray<string>): Promise<void> {
  const unique = [...new Set(names)];
  for (const name of unique) {
    try {
      await engine.drop(name);
    } catch {
      // Best-effort cleanup; the primary staging/swap error is more useful.
    }
  }
  releaseMountedTableNames(engine, unique);
}
