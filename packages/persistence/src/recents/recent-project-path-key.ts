import { resolve } from "node:path";

/** Maps a path to the identity used to decide whether two paths are the same project. */
export type PathKey = (path: string) => string;

/**
 * Two spellings of a path are the same project if they resolve to the same
 * absolute path — compared case-insensitively on Windows, where `C:\A.gsds`
 * and `c:\a.gsds` are one file.
 */
export function createPathKey(caseInsensitive: boolean = process.platform === "win32"): PathKey {
  return (path) => {
    const resolved = resolve(path);
    return caseInsensitive ? resolved.toLowerCase() : resolved;
  };
}
