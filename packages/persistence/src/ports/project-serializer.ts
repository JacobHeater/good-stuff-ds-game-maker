import type { ProjectSnapshot } from "@goodstuff/core";

/**
 * Converts between a `ProjectSnapshot` and its on-disk wire format.
 * Deliberately kept separate from validation: a serializer's job is
 * turning a shape into bytes and back, not deciding whether the result
 * is trustworthy. `deserialize` returns `unknown` rather than
 * `ProjectSnapshot` on purpose — successfully parsing raw text (e.g.
 * valid JSON syntax) only proves it's well-formed, not that it actually
 * conforms to the `ProjectSnapshot` shape. That's `ProjectSnapshotValidator`'s
 * job; composing the two is `ProjectRepository`'s job.
 */
export interface ProjectSerializer {
  serialize(snapshot: ProjectSnapshot): string;
  /** Throws ProjectSerializationError if `raw` cannot be parsed at all (e.g. invalid JSON). */
  deserialize(raw: string): unknown;
}
