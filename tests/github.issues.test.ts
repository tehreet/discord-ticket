import { describe, test, expect, mock } from "bun:test";
import { createGithub, type Fetcher } from "../src/github/issues";

function mockFetch(response: { status: number; body: unknown }): Fetcher {
  return mock(async (_url: string | URL | Request, _init?: RequestInit) => {
    const body = typeof response.body === "string"
      ? response.body
      : JSON.stringify(response.body);
    return new Response(body, { status: response.status }) as Response;
  }) as unknown as Fetcher;
}

describe("github/issues", () => {
  test("searchIssues calls the search API with repo+query and returns parsed items", async () => {
    const fetchImpl = mockFetch({
      status: 200,
      body: { items: [{ number: 47, title: "hi", state: "open", html_url: "https://github.com/o/r/issues/47", body: "b" }] },
    });
    const gh = createGithub({ repo: "o/r", token: "tkn", fetch: fetchImpl });
    const res = await gh.searchIssues("chat lobby", "open");
    expect(res).toEqual([{ number: 47, title: "hi", state: "open", url: "https://github.com/o/r/issues/47", body: "b" }]);
    const call = (fetchImpl as any).mock.calls[0]!;
    const url = String(call[0]);
    expect(url).toContain("/search/issues");
    expect(url).toContain("repo%3Ao%2Fr");
    expect(url).toContain("chat%20lobby");
    expect(url).toContain("is%3Aopen");
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tkn");
  });

  test("searchIssues returns [] when GitHub returns no items", async () => {
    const fetchImpl = mockFetch({ status: 200, body: { items: [] } });
    const gh = createGithub({ repo: "o/r", token: "tkn", fetch: fetchImpl });
    expect(await gh.searchIssues("nothing")).toEqual([]);
  });

  test("searchIssues throws when GitHub returns non-2xx", async () => {
    const fetchImpl = mockFetch({ status: 500, body: "boom" });
    const gh = createGithub({ repo: "o/r", token: "tkn", fetch: fetchImpl });
    await expect(gh.searchIssues("x")).rejects.toThrow(/500/);
  });

  test("createIssue POSTs to /repos/owner/repo/issues and returns html_url", async () => {
    const fetchImpl = mockFetch({
      status: 201,
      body: { html_url: "https://github.com/o/r/issues/112" },
    });
    const gh = createGithub({ repo: "o/r", token: "tkn", fetch: fetchImpl });
    const url = await gh.createIssue({ title: "T", body: "B", labels: ["feature", "ui"] });
    expect(url).toBe("https://github.com/o/r/issues/112");
    const call = (fetchImpl as any).mock.calls[0]!;
    expect(String(call[0])).toBe("https://api.github.com/repos/o/r/issues");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({ title: "T", body: "B", labels: ["feature", "ui"] });
  });

  test("createIssue throws on non-2xx", async () => {
    const fetchImpl = mockFetch({ status: 422, body: { message: "Validation Failed" } });
    const gh = createGithub({ repo: "o/r", token: "tkn", fetch: fetchImpl });
    await expect(gh.createIssue({ title: "T", body: "B", labels: [] })).rejects.toThrow(/422/);
  });
});
