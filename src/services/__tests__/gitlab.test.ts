// Tests for src/services/gitlab.ts. Focus on fetchProjectActivity —
// the API surface the pipeline depends on — plus the approvals + notes
// collapse rule (user-preferred "every non-system note = one review row").

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ---------------------------------------------------------------

// Typed as loose rest-arg functions. Without explicit signatures, Vitest
// infers `vi.fn()` as `() => unknown` which makes `mock.calls[0]` empty-tuple
// and turns spread proxies (`(...a) => mock(...a)`) into TS2556 errors.
const tauriFetch = vi.fn<(...args: any[]) => any>();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => tauriFetch(...args),
}));

const getSecret = vi.fn<(...args: any[]) => any>();
const setSecret = vi.fn<(...args: any[]) => Promise<void>>(async () => {});
vi.mock("../secrets", () => ({
  SECRET_KEYS: {
    gitlab: "gitlab.token",
    anthropic: "anthropic",
    openai: "openai",
    openrouter: "openrouter",
    custom: "custom",
    "claude-code": "claude-code",
    github: "github.token",
    slackBot: "slack.bot_token",
    slackClientId: "slack.client_id",
    slackClientSecret: "slack.client_secret",
    jiraEmail: "jira.email",
    jiraToken: "jira.api_token",
    linear: "linear.api_key",
  },
  getSecret: (...a: unknown[]) => getSecret(...a),
  setSecret: (...a: unknown[]) => setSecret(...a),
}));

const getConfig = vi.fn<(...args: any[]) => any>();
const getFetchCursor = vi.fn<(...args: any[]) => any>();
const setFetchCursor = vi.fn<(...args: any[]) => Promise<void>>(async () => {});
vi.mock("../db", () => ({
  getConfig: (...a: unknown[]) => getConfig(...a),
  getFetchCursor: (...a: unknown[]) => getFetchCursor(...a),
  setFetchCursor: (...a: unknown[]) => setFetchCursor(...a),
}));

// Pull the module under test AFTER mocks register.
import {
  fetchProjectActivity,
  getViewer,
  listUserProjects,
  savePAT,
} from "../gitlab";

// ---- Helpers -------------------------------------------------------------

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  };
}

function err(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
    text: async () => "",
    json: async () => ({}),
  };
}

beforeEach(() => {
  tauriFetch.mockReset();
  getSecret.mockReset();
  getSecret.mockResolvedValue("glpat-test-token");
  getConfig.mockReset();
  getConfig.mockResolvedValue({ gitlab_instance_url: "https://gitlab.com" });
  getFetchCursor.mockReset();
  getFetchCursor.mockResolvedValue(null);
  setFetchCursor.mockClear();
});

// ---- Tests ---------------------------------------------------------------

describe("gitlab.savePAT", () => {
  it("persists the token under the gitlab secret key", async () => {
    await savePAT("glpat-abc-123");
    expect(setSecret).toHaveBeenCalledWith("gitlab.token", "glpat-abc-123");
  });
});

describe("gitlab.getViewer", () => {
  it("calls /user with a Bearer token and returns username + name", async () => {
    tauriFetch.mockResolvedValueOnce(ok({ username: "octo", name: "Octo Cat" }));
    const viewer = await getViewer();
    expect(viewer).toEqual({ username: "octo", name: "Octo Cat" });
    const [url, init] = tauriFetch.mock.calls[0];
    expect(url).toBe("https://gitlab.com/api/v4/user");
    expect(init.headers.Authorization).toBe("Bearer glpat-test-token");
  });

  it("throws 'No GitLab token' when no secret is set", async () => {
    getSecret.mockResolvedValueOnce(null);
    await expect(getViewer()).rejects.toThrow(/No GitLab token/);
    expect(tauriFetch).not.toHaveBeenCalled();
  });

  it("honors a custom instance URL from config", async () => {
    getConfig.mockResolvedValueOnce({ gitlab_instance_url: "https://gl.acme.com/" });
    tauriFetch.mockResolvedValueOnce(ok({ username: "x", name: null }));
    await getViewer();
    const [url] = tauriFetch.mock.calls[0];
    // Trailing slash stripped.
    expect(url).toBe("https://gl.acme.com/api/v4/user");
  });

  it("throws a parseable error string on HTTP failure", async () => {
    tauriFetch.mockResolvedValueOnce(err(401, "Unauthorized"));
    await expect(getViewer()).rejects.toThrow(/GitLab \/user: 401 Unauthorized/);
  });
});

describe("gitlab.listUserProjects", () => {
  it("fetches /projects with membership=true", async () => {
    tauriFetch.mockResolvedValueOnce(
      ok([
        { id: 1, name: "a", path_with_namespace: "g/a" },
        { id: 2, name: "b", path_with_namespace: "g/b" },
      ])
    );
    const projects = await listUserProjects();
    expect(projects).toHaveLength(2);
    const [url] = tauriFetch.mock.calls[0];
    expect(url).toMatch(/\/api\/v4\/projects\?membership=true&order_by=last_activity_at/);
  });
});

describe("gitlab.fetchProjectActivity", () => {
  it("hits the MR index with updated_after filter and emits the cursor", async () => {
    tauriFetch.mockResolvedValueOnce(ok([])); // MR index
    await fetchProjectActivity(
      42,
      "acme/platform",
      "2024-04-01T00:00:00Z",
      { forceRefresh: true }
    );
    const [url] = tauriFetch.mock.calls[0];
    expect(url).toContain("/projects/42/merge_requests");
    expect(url).toContain(`updated_after=${encodeURIComponent("2024-04-01T00:00:00Z")}`);
    expect(setFetchCursor).toHaveBeenCalled();
    const [source, scope] = setFetchCursor.mock.calls[0];
    expect(source).toBe("gitlab");
    expect(scope).toBe("acme/platform");
  });

  it("uses the cached cursor when it's newer than the requested since", async () => {
    getFetchCursor.mockResolvedValueOnce("2024-05-01T00:00:00Z");
    tauriFetch.mockResolvedValueOnce(ok([]));
    await fetchProjectActivity(
      7,
      "acme/web",
      "2024-04-01T00:00:00Z"
    );
    const [url] = tauriFetch.mock.calls[0];
    expect(url).toContain(`updated_after=${encodeURIComponent("2024-05-01T00:00:00Z")}`);
  });

  it("collapses approvals + non-system notes into review rows", async () => {
    tauriFetch
      // 1) MR index
      .mockResolvedValueOnce(
        ok([
          {
            iid: 211,
            web_url: "https://gitlab.com/acme/platform/-/merge_requests/211",
            title: "Pin deploy controller",
            description: "Body here",
            author: { username: "priyar" },
            state: "merged",
            merged_at: "2024-04-22T12:00:00Z",
            created_at: "2024-04-20T12:00:00Z",
            updated_at: "2024-04-22T12:00:00Z",
          },
        ])
      )
      // 2) approvals
      .mockResolvedValueOnce(
        ok({ approved_by: [{ user: { username: "averyj" } }] })
      )
      // 3) notes
      .mockResolvedValueOnce(
        ok([
          {
            id: 301,
            body: "Right call. Captured in the runbook.",
            system: false,
            author: { username: "averyj" },
            created_at: "2024-04-22T12:05:00Z",
          },
          {
            id: 302,
            body: "assigned to @averyj",
            system: true, // filtered
            author: { username: "bot" },
            created_at: "2024-04-22T12:04:00Z",
          },
          {
            id: 303,
            body: "Any risk with the stateful services at 3.4?",
            system: false,
            author: { username: "mchen" },
            created_at: "2024-04-22T12:06:00Z",
          },
        ])
      );

    const mrs = await fetchProjectActivity(
      42,
      "acme/platform",
      "2024-04-01T00:00:00Z",
      { forceRefresh: true }
    );

    expect(mrs).toHaveLength(1);
    const mr = mrs[0];
    expect(mr.source_id).toBe("acme/platform!211");
    expect(mr.title).toBe("Pin deploy controller");
    expect(mr.user).toBe("priyar");

    // 1 approval (APPROVED) + 2 non-system notes (COMMENTED) = 3 reviews,
    // system note dropped.
    expect(mr.reviews).toHaveLength(3);
    const approved = mr.reviews.find((r) => r.state === "APPROVED");
    expect(approved?.user).toBe("averyj");
    const comments = mr.reviews.filter((r) => r.state === "COMMENTED");
    expect(comments.map((c) => c.user).sort()).toEqual(["averyj", "mchen"]);
    // System note must not leak in.
    expect(mr.reviews.find((r) => r.body?.includes("assigned to"))).toBeUndefined();
  });

  it("is best-effort on approvals / notes: a failing sub-call still yields the MR", async () => {
    tauriFetch
      .mockResolvedValueOnce(
        ok([
          {
            iid: 5,
            web_url: "https://gitlab.com/g/p/-/merge_requests/5",
            title: "t",
            description: "",
            author: { username: "u" },
            state: "opened",
            merged_at: null,
            created_at: "2024-04-22T00:00:00Z",
            updated_at: "2024-04-22T00:00:00Z",
          },
        ])
      )
      .mockResolvedValueOnce(err(403, "Forbidden")) // approvals blocked
      .mockResolvedValueOnce(err(500, "Server Error")); // notes fail too

    const mrs = await fetchProjectActivity(1, "g/p", "2024-04-01T00:00:00Z", {
      forceRefresh: true,
    });
    expect(mrs).toHaveLength(1);
    expect(mrs[0].reviews).toHaveLength(0);
  });

  it("caps output at 200 MRs", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      iid: i + 1,
      web_url: `https://gitlab.com/g/p/-/merge_requests/${i + 1}`,
      title: `MR ${i}`,
      description: "",
      author: { username: "u" },
      state: "opened",
      merged_at: null,
      created_at: "2024-04-22T00:00:00Z",
      updated_at: "2024-04-22T00:00:00Z",
    }));
    tauriFetch.mockResolvedValue(ok([])); // default for all sub-calls
    // Replace the first call (index) with the big list.
    let call = 0;
    tauriFetch.mockImplementation(async () => {
      call++;
      if (call === 1) return ok(many);
      return ok([]); // approvals + notes empty
    });

    const mrs = await fetchProjectActivity(1, "g/p", "2024-04-01T00:00:00Z", {
      forceRefresh: true,
    });
    expect(mrs.length).toBe(200);
  });

  it("aborts mid-flight when the signal is pre-aborted", async () => {
    // First HTTP call (MR index) resolves, then abort check happens inside
    // the per-MR loop. We trigger the check directly by pre-aborting the
    // signal.
    tauriFetch.mockResolvedValueOnce(
      ok([
        {
          iid: 9,
          web_url: "https://gitlab.com/g/p/-/merge_requests/9",
          title: "t",
          description: "",
          author: { username: "u" },
          state: "opened",
          merged_at: null,
          created_at: "2024-04-22T00:00:00Z",
          updated_at: "2024-04-22T00:00:00Z",
        },
      ])
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchProjectActivity(1, "g/p", "2024-04-01T00:00:00Z", {
        forceRefresh: true,
        signal: controller.signal,
      })
    ).rejects.toThrow(/abort/i);
  });
});
