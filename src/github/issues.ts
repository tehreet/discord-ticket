export interface Issue {
  number: number;
  title: string;
  state: string;
  url: string;
  body: string;
}

export interface Github {
  searchIssues(query: string, state?: "open" | "closed" | "all"): Promise<Issue[]>;
  createIssue(args: { title: string; body: string; labels: string[] }): Promise<string>;
}

// Fetcher type is extracted so tests can inject a mock.
export type Fetcher = typeof fetch;

export interface Deps {
  repo: string;           // "owner/repo"
  token: string;          // GitHub personal/OAuth token (bearer)
  fetch?: Fetcher;        // optional override for tests
}

export function createGithub({ repo, token, fetch: fetchImpl = fetch }: Deps): Github {
  const base = "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  return {
    async searchIssues(query, state = "all") {
      // Use the search API: q="repo:owner/repo <query> is:<state>"
      const stateClause = state === "all" ? "" : ` is:${state}`;
      const q = `repo:${repo} ${query}${stateClause}`;
      const url = `${base}/search/issues?q=${encodeURIComponent(q)}&per_page=10`;
      const res = await fetchImpl(url, { headers });
      if (!res.ok) {
        throw new Error(`github search failed: ${res.status} ${await res.text()}`);
      }
      const body = await res.json() as { items?: Array<{ number: number; title: string; state: string; html_url: string; body: string | null }> };
      return (body.items ?? []).map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        url: i.html_url,
        body: i.body ?? "",
      }));
    },

    async createIssue({ title, body, labels }) {
      const url = `${base}/repos/${repo}/issues`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ title, body, labels }),
      });
      if (!res.ok) {
        throw new Error(`github create failed: ${res.status} ${await res.text()}`);
      }
      const issue = await res.json() as { html_url: string };
      return issue.html_url;
    },
  };
}

// Resolves the GitHub token. Prefers env var; falls back to `gh auth token`.
export async function resolveGithubToken(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const proc = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`gh auth token failed: ${err}`);
  }
  const token = out.trim();
  if (!token) throw new Error("gh auth token returned empty");
  return token;
}
