/**
 * The generic version-history core behind ADR-005 (variants) and ADR-008 (reports).
 *
 * A "history" is every version of one owner (a variant, a report), in any order. The rules are
 * the same for every owner:
 * - Approval belongs to a version. An approved version is frozen.
 * - An edit after approval becomes a new, unapproved version numbered after the newest.
 * - Only the newest version can be approved, and only once.
 *
 * `createHistory` binds those rules to one version type through a `HistoryKind`. Nothing here
 * mutates its inputs; callers persist what they get back.
 */
import { GuardError } from '../guards/errors';

/** The fields every versioned record shares. */
export interface VersionLike {
  id: string;
  number: number;
  note: string;
  approvedAt?: string | undefined;
  approvedBy?: string | undefined;
}

export interface HistoryKind<V extends VersionLike, Input> {
  /** The field that names the owner on the version, e.g. `variantId`. */
  ownerKey: keyof V & string;
  /** For programmer-error messages, e.g. `variant`. */
  ownerNoun: string;
  /** For consultant-facing messages, e.g. `design` or `report`. */
  thingNoun: string;
  /** Validates (and returns) a version; throws if the data breaks the schema. */
  parse: (value: unknown) => V;
  /** The owner id the input is for. */
  ownerOf: (input: Input) => string;
  /** The raw (unvalidated) fields of a brand-new version, numbered `number`. */
  build: (input: Input, owner: string, number: number) => unknown;
  /** The raw fields of `latest` with the input's content applied (an in-place draft edit). */
  patch: (latest: V, input: Input) => unknown;
}

export type SaveResult<V> = { kind: 'updated'; version: V } | { kind: 'created'; version: V };

export function isApproved(version: Pick<VersionLike, 'approvedAt' | 'approvedBy'>): boolean {
  return version.approvedAt !== undefined && version.approvedBy !== undefined;
}

export interface History<V extends VersionLike, Input> {
  latestVersion: (history: readonly V[]) => V | undefined;
  latestApprovedVersion: (history: readonly V[]) => V | undefined;
  createVersion: (history: readonly V[], input: Input) => V;
  saveEdit: (history: readonly V[], input: Input) => SaveResult<V>;
  approveVersion: (
    history: readonly V[],
    versionId: string,
    approval: { approvedBy: string; approvedAt: string },
  ) => V;
}

export function createHistory<V extends VersionLike, Input>(
  kind: HistoryKind<V, Input>,
): History<V, Input> {
  const ownerOfVersion = (v: V): unknown => v[kind.ownerKey];

  /** Throws a programmer error if the history mixes owners or repeats a number or id. */
  function checkHistory(history: readonly V[]): void {
    const owners = new Set(history.map(ownerOfVersion));
    if (owners.size > 1) {
      throw new Error(`Version history mixes ${kind.ownerNoun}s: ${[...owners].join(', ')}`);
    }
    if (new Set(history.map((v) => v.number)).size !== history.length) {
      throw new Error('Version history repeats a version number');
    }
    if (new Set(history.map((v) => v.id)).size !== history.length) {
      throw new Error('Version history repeats a version id');
    }
  }

  function newest(history: readonly V[]): V | undefined {
    let best: V | undefined;
    for (const v of history) if (!best || v.number > best.number) best = v;
    return best;
  }

  function latestVersion(history: readonly V[]): V | undefined {
    checkHistory(history);
    return newest(history);
  }

  function latestApprovedVersion(history: readonly V[]): V | undefined {
    checkHistory(history);
    return newest(history.filter(isApproved));
  }

  function checkOwner(latest: V | undefined, owner: string): void {
    if (latest && ownerOfVersion(latest) !== owner) {
      throw new Error(
        `Input is for ${kind.ownerNoun} ${owner}, history is for ${String(ownerOfVersion(latest))}`,
      );
    }
  }

  function createVersion(history: readonly V[], input: Input): V {
    const latest = latestVersion(history);
    const owner = kind.ownerOf(input);
    checkOwner(latest, owner);
    return kind.parse(kind.build(input, owner, (latest?.number ?? 0) + 1));
  }

  function saveEdit(history: readonly V[], input: Input): SaveResult<V> {
    const latest = latestVersion(history);
    if (latest && !isApproved(latest)) {
      checkOwner(latest, kind.ownerOf(input));
      return { kind: 'updated', version: kind.parse(kind.patch(latest, input)) };
    }
    return { kind: 'created', version: createVersion(history, input) };
  }

  function approveVersion(
    history: readonly V[],
    versionId: string,
    approval: { approvedBy: string; approvedAt: string },
  ): V {
    const latest = latestVersion(history);
    const target = history.find((v) => v.id === versionId);
    if (!target) throw new Error(`Version ${versionId} is not in this history`);
    if (isApproved(target)) {
      throw new GuardError(
        'already-approved',
        `This version of the ${kind.thingNoun} is already approved.`,
      );
    }
    if (target !== latest) {
      throw new GuardError(
        'not-latest',
        `There is a newer version of this ${kind.thingNoun}. Review and approve the newest version instead.`,
      );
    }
    return kind.parse({ ...target, ...approval });
  }

  return { latestVersion, latestApprovedVersion, createVersion, saveEdit, approveVersion };
}
