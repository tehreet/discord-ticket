import type { Exec } from "../github/issues";
import { log } from "../log";

export function createRepoPuller({ path, exec }: { path: string; exec: Exec }) {
  return async (): Promise<void> => {
    try {
      const { code, stderr } = await exec("git", ["-C", path, "pull", "--ff-only", "--quiet"]);
      if (code !== 0) log.warn({ stderr, path }, "git pull failed; continuing with stale clone");
    } catch (err) {
      log.warn({ err, path }, "git pull threw; continuing with stale clone");
    }
  };
}
