import type { ProjectSnapshot } from "@goodstuff/core";
import Ajv, { type ValidateFunction } from "ajv";

import { ProjectValidationError } from "../errors";
import type { ProjectSnapshotValidationResult, ProjectSnapshotValidator } from "../ports/project-snapshot-validator";
import { PROJECT_SNAPSHOT_JSON_SCHEMA } from "./project-snapshot.schema";

/**
 * The default `ProjectSnapshotValidator`, backed by ajv and
 * `PROJECT_SNAPSHOT_JSON_SCHEMA`. Any other implementation of
 * `ProjectSnapshotValidator` (e.g. one backed by a generated-rather-than-
 * hand-authored schema) must honor the same contract — `validate` never
 * throws, `assertValid` throws `ProjectValidationError` — to be a valid
 * substitute wherever this one is used.
 */
export class JsonSchemaProjectSnapshotValidator implements ProjectSnapshotValidator {
  private readonly validateFn: ValidateFunction;

  constructor(ajv: Ajv = new Ajv({ allErrors: true })) {
    this.validateFn = ajv.compile(PROJECT_SNAPSHOT_JSON_SCHEMA);
  }

  validate(candidate: unknown): ProjectSnapshotValidationResult {
    const valid = this.validateFn(candidate);
    if (valid) {
      return { valid: true, issues: [] };
    }
    const issues = (this.validateFn.errors ?? []).map(
      (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`
    );
    return { valid: false, issues };
  }

  assertValid(candidate: unknown): ProjectSnapshot {
    const result = this.validate(candidate);
    if (!result.valid) {
      throw new ProjectValidationError("Project file failed schema validation.", result.issues);
    }
    return candidate as ProjectSnapshot;
  }
}
