import { describe, expect, it, vi } from "vitest";
import {
  searchSlack,
  searchLinear,
  searchJira,
  searchGitHub,
  loadJiraUserPool,
  loadGitHubMemberPool,
  invalidateGitHubPool,
  resolveGitHubLabel,
  resolveSlackLabel,
} from "../teammateSearch";
import type { SlackUser } from "../slack";
import type { LinearUser } from "../linear";
import type { JiraUser } from "../jira";
import type { GitHubMember } from "../github";

vi.mock("../github", () => ({
  listUserOrgs: vi.fn(async () => [
    { login: "acme", description: null },
    { login: "widgets", description: null },
  ]),
  listOrgMembers: vi.fn(async (org: string) => {
    if (org === "acme") {
      return [
        { login: "octocat", name: "The Octocat", avatarUrl: null },
        { login: "shared", name: "Shared User", avatarUrl: null },
      ];
    }
    if (org === "widgets") {
      return [
        { login: "priya", name: "Priya Raman", avatarUrl: null },
        { login: "shared", name: "Shared User", avatarUrl: null },
      ];
    }
    return [];
  }),
  hasReadOrgScope: vi.fn(async () => true),
  invalidateScopeCache: vi.fn(),
}));

vi.mock("../jira", async () => {
  let calls = 0;
  return {
    listProjectMembers: vi.fn(async (key: string) => {
      calls++;
      if (key === "FAIL") throw new Error("403");
      // Same person appears in two projects — must dedup by accountId.
      return [
        { accountId: `acc-${key}-1`, displayName: "Priya Raman", emailAddress: "priya@x.io" },
        { accountId: "acc-shared", displayName: "Shared User", emailAddress: "shared@x.io" },
      ] satisfies JiraUser[];
    }),
    _calls: () => calls,
  };
});

const slackCache: SlackUser[] = [
  {
    id: "U_PRIYA",
    name: "priyar",
    real_name: "Priya Raman",
    profile: { display_name: "Priya R", real_name: "Priya Raman" },
  },
  {
    id: "U_MARK",
    name: "markb",
    real_name: "Mark Brown",
    profile: { display_name: "Mark", real_name: "Mark Brown" },
  },
];

const linearCache: LinearUser[] = [
  { id: "lin-1", name: "priya", displayName: "Priya R.", email: "priya@x.io" },
  { id: "lin-2", name: "mark", displayName: "Mark Brown", email: "mark@x.io" },
];

const jiraCache: JiraUser[] = [
  { accountId: "acc-1", displayName: "Priya Raman", emailAddress: "priya@x.io" },
];

describe("searchSlack", () => {
  it("ranks display-name matches first", () => {
    const out = searchSlack("priya", slackCache);
    expect(out[0].handle).toBe("U_PRIYA");
    expect(out[0].label).toBe("Priya R");
  });

  it("returns empty when cache is empty", () => {
    expect(searchSlack("priya", [])).toEqual([]);
  });

  it("returns alphabetical list when query is empty", () => {
    const out = searchSlack("", slackCache);
    expect(out.map((m) => m.label)).toEqual(["Mark", "Priya R"]);
  });
});

describe("searchLinear", () => {
  it("persists displayName as the handle (pipeline matches by displayName)", () => {
    const out = searchLinear("priya", linearCache);
    expect(out[0].handle).toBe("Priya R.");
  });
});

describe("searchJira", () => {
  it("uses displayName as handle for pipeline compatibility", () => {
    const out = searchJira("priya", jiraCache);
    expect(out[0].handle).toBe("Priya Raman");
  });
});

const githubCache: GitHubMember[] = [
  { login: "octocat", name: "The Octocat", avatarUrl: null },
  { login: "priya", name: "Priya Raman", avatarUrl: null },
];

describe("searchGitHub", () => {
  it("uses login as handle and 'Name (@login)' as label", () => {
    const out = searchGitHub("priya", githubCache);
    expect(out[0].handle).toBe("priya");
    expect(out[0].label).toBe("Priya Raman (@priya)");
  });

  it("returns alphabetical list when query empty (sorted by visible label)", () => {
    const out = searchGitHub("", githubCache);
    // "Priya Raman (@priya)" < "The Octocat (@octocat)"
    expect(out.map((m) => m.handle)).toEqual(["priya", "octocat"]);
  });

  it("returns empty when cache is empty", () => {
    expect(searchGitHub("priya", [])).toEqual([]);
  });
});

describe("loadGitHubMemberPool", () => {
  it("unions members across all orgs and dedupes by login", async () => {
    invalidateGitHubPool();
    const pool = await loadGitHubMemberPool();
    const logins = pool.map((m) => m.login).sort();
    expect(logins).toEqual(["octocat", "priya", "shared"]);
  });

  it("coalesces concurrent callers into a single fetch", async () => {
    invalidateGitHubPool();
    const [a, b] = await Promise.all([
      loadGitHubMemberPool(),
      loadGitHubMemberPool(),
    ]);
    expect(a).toBe(b);
  });
});

describe("resolveGitHubLabel", () => {
  it("looks up cached login and renders 'Name (@login)'", () => {
    expect(resolveGitHubLabel("priya", githubCache)).toBe("Priya Raman (@priya)");
    expect(resolveGitHubLabel("ghost", githubCache)).toBeNull();
  });
});

describe("loadJiraUserPool", () => {
  it("dedupes users seen across multiple projects", async () => {
    const pool = await loadJiraUserPool(["KEEPR", "DEMO"]);
    const ids = pool.map((u) => u.accountId).sort();
    expect(ids).toContain("acc-shared");
    // acc-shared appears in both project responses → must appear only once.
    expect(ids.filter((x) => x === "acc-shared").length).toBe(1);
  });

  it("survives a single project's failure", async () => {
    const pool = await loadJiraUserPool(["KEEPR", "FAIL", "DEMO"]);
    expect(pool.length).toBeGreaterThan(0);
  });

  it("returns empty when no project keys are given", async () => {
    expect(await loadJiraUserPool([])).toEqual([]);
  });
});

describe("resolveSlackLabel", () => {
  it("looks up label by id", () => {
    expect(resolveSlackLabel("U_PRIYA", slackCache)).toBe("Priya R");
    expect(resolveSlackLabel("U_GHOST", slackCache)).toBeNull();
  });
});
