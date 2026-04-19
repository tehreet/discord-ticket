import { log } from "../log";

export interface ExecResult { stdout: string; stderr: string; code: number; }
export type Exec = (cmd: string, args: string[]) => Promise<ExecResult>;

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

export const bunExec: Exec = async (cmd, args) => {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
};
