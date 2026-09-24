/**
 * The one thing that needs to know whether a file is still there. Deliberately
 * its own tiny port: `ProjectFileReader` satisfies it structurally (it has
 * `exists`), but a consumer that only asks "is this path still present?" —
 * like the recent-projects list — shouldn't depend on being able to read files.
 */
export interface PathExistenceChecker {
  exists(path: string): Promise<boolean>;
}
