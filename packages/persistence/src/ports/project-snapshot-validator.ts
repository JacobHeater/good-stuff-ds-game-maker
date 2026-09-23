import type { ProjectSnapshot } from "@goodstuff/core";

export interface ProjectSnapshotValidationResult {
  valid: boolean;
  issues: readonly string[];
}

/**
 * Validates that an already-parsed value actually conforms to the
 * ProjectSnapshot schema. Kept separate from `ProjectSerializer` so a
 * caller that only needs "is this a valid project file?" — e.g. a
 * project-list preview deciding whether to show a file as openable —
 * doesn't need serialization capability, and so the serializer never
 * has to make trust decisions itself.
 */
export interface ProjectSnapshotValidator {
  validate(candidate: unknown): ProjectSnapshotValidationResult;
  /** Throws ProjectValidationError if `candidate` is invalid; otherwise returns it narrowed to ProjectSnapshot. */
  assertValid(candidate: unknown): ProjectSnapshot;
}
