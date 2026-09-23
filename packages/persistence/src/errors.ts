/**
 * Every port implementation in this package (Node-backed, in-memory, or
 * any future one) MUST throw these exact error types for the matching
 * failure mode — never a provider-specific error (e.g. a raw Node
 * `ErrnoException`) leaked past the port boundary. That's what makes
 * implementations genuinely substitutable for each other (Liskov
 * substitution): a caller written against `ProjectFileReader` can swap
 * `NodeProjectFileReader` for `InMemoryProjectFileStore` and its
 * try/catch handling keeps working unchanged, because both honor the
 * same thrown-error contract, not just the same method signatures.
 */
export abstract class PersistenceError extends Error {
  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Thrown by any ProjectFileReader/ProjectFileLister when `path` does not exist. */
export class ProjectFileNotFoundError extends PersistenceError {
  constructor(public readonly path: string) {
    super(`Project file not found: ${path}`);
  }
}

/** Thrown by any ProjectFileReader/ProjectFileLister for a read failure other than "not found" (permissions, I/O error, etc). */
export class ProjectFileReadError extends PersistenceError {
  constructor(
    public readonly path: string,
    options?: { cause?: unknown }
  ) {
    super(`Failed to read: ${path}`, options);
  }
}

/** Thrown by any ProjectFileWriter when a write fails (permissions, disk full, etc). */
export class ProjectFileWriteError extends PersistenceError {
  constructor(
    public readonly path: string,
    options?: { cause?: unknown }
  ) {
    super(`Failed to write project file: ${path}`, options);
  }
}

/**
 * Thrown by any ProjectSerializer when raw content can't be parsed into
 * a shape at all (e.g. invalid JSON). Distinct from ProjectValidationError,
 * which is for content that parses fine but doesn't conform to the
 * ProjectSnapshot schema.
 */
export class ProjectSerializationError extends PersistenceError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** Thrown by any ProjectSnapshotValidator when a candidate object fails schema validation. */
export class ProjectValidationError extends PersistenceError {
  constructor(
    message: string,
    public readonly issues: readonly string[]
  ) {
    super(message);
  }
}
