export interface Issue {
  number: number;
  title: string;
  state: string;
  url: string;
  body: string;
}

export interface ExecResult { stdout: string; stderr: string; code: number; }
export type Exec = (cmd: string, args: string[]) => Promise<ExecResult>;

export interface Deps { repo: string; exec: Exec; }

export interface Github {
  searchIssues(query: string, state?: "open" | "closed" | "all"): Promise<Issue[]>;
  createIssue(args: { title: string; body: string; labels: string[] }): Promise<string>;
}

export function createGithub({ repo, exec }: Deps): Github {
  return {
    async searchIssues(query, state = "all") {
      const { stdout, stderr, code } = await exec("gh", [
        "issue", "list",
        "--repo", repo,
        "--search", query,
        "--state", state,
        "--json", "number,title,state,url,body",
        "--limit", "10",
      ]);
      if (code !== 0) throw new Error(`gh issue list failed: ${stderr}`);
      if (!stdout.trim()) return [];
      return JSON.parse(stdout) as Issue[];
    },

    async createIssue({ title, body, labels }) {
      const args = [
        "issue", "create",
        "--repo", repo,
        "--title", title,
        "--body", body,
      ];
      if (labels.length > 0) args.push("--label", labels.join(","));
      const { stdout, stderr, code } = await exec("gh", args);
      if (code !== 0) throw new Error(`gh issue create failed: ${stderr}`);
      return stdout.trim();
    },
  };
}

// Production helper: wraps Bun.spawn so callers can use it directly.
export const bunExec: Exec = async (cmd, args) => {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
};
