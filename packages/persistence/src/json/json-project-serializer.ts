import type { ProjectSnapshot } from "@goodstuff/core";

import { ProjectSerializationError } from "../errors";
import type { ProjectSerializer } from "../ports/project-serializer";

/** The chosen wire format — see requirements/persistence/EPIC.project-persistence.md. */
export class JsonProjectSerializer implements ProjectSerializer {
  serialize(snapshot: ProjectSnapshot): string {
    return JSON.stringify(snapshot, null, 2);
  }

  deserialize(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new ProjectSerializationError("Project file is not valid JSON.", { cause: error });
    }
  }
}
