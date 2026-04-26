// Tests for the StepLLM categorized restructure + CLI provider integration.
// The Tauri shell, fs, and path plugins are mocked transitively via the llm
// service mocks below — components only see the high-level llm exports.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ── Mock the llm service surface used by StepLLM ──────────────────────

const mocks = vi.hoisted(() => ({
  probeCodex: vi.fn(),
  probeClaudeCode: vi.fn(),
  invalidateCodexProbe: vi.fn(),
  invalidateClaudeProbe: vi.fn(),
}));

vi.mock("../../../services/llm", async (importOriginal) => {
  // Pull through the real type definitions and PROVIDERS so the component
  // sees actual category data, but stub the spawn-touching helpers.
  const actual: any = await importOriginal();
  return {
    ...actual,
    probeCodex: mocks.probeCodex,
    probeClaudeCode: mocks.probeClaudeCode,
    invalidateCodexProbe: mocks.invalidateCodexProbe,
    invalidateClaudeProbe: mocks.invalidateClaudeProbe,
  };
});

const mockProbeCodex = mocks.probeCodex;
const mockProbeClaudeCode = mocks.probeClaudeCode;
const mockInvalidateCodexProbe = mocks.invalidateCodexProbe;
const mockInvalidateClaudeProbe = mocks.invalidateClaudeProbe;

vi.mock("../../../services/secrets", () => ({
  SECRET_KEYS: {
    anthropic: "llm.anthropic.key",
    openai: "llm.openai.key",
    openrouter: "llm.openrouter.key",
    custom: "llm.custom.key",
    "claude-code": "llm.claude-code.key",
    codex: "llm.codex.key",
  },
  getSecret: vi.fn(async () => null),
  setSecret: vi.fn(async () => {}),
}));

vi.mock("../../../services/db", () => ({
  getConfig: vi.fn(async () => ({ llm_provider: "anthropic" })),
  setConfig: vi.fn(async () => {}),
  upsertIntegration: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

import { StepLLM } from "../StepLLM";

beforeEach(() => {
  mockProbeCodex.mockReset();
  mockProbeClaudeCode.mockReset();
  mockInvalidateCodexProbe.mockReset();
  mockInvalidateClaudeProbe.mockReset();
});

describe("StepLLM categorized grid [lane D]", () => {
  it("renders all six providers", async () => {
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("anthropic")).toBeDefined();
    });
    expect(screen.getByText("openai")).toBeDefined();
    expect(screen.getByText("openrouter")).toBeDefined();
    expect(screen.getByText("custom")).toBeDefined();
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("codex")).toBeDefined();
  });

  it("renders the Local CLI category divider between hosted and CLI groups", async () => {
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Local CLI")).toBeDefined();
    });
  });

  it("does NOT render a Self-hosted divider when the category is empty", async () => {
    // self_hosted has zero providers in v1; the divider should be absent
    // until Qwen Local lands. See TODOS.md.
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Local CLI")).toBeDefined();
    });
    expect(screen.queryByText("Self-hosted")).toBeNull();
  });

  it("[regression] picking anthropic still renders the API key input", async () => {
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("anthropic")).toBeDefined();
    });
    fireEvent.click(screen.getByText("anthropic"));
    await waitFor(() => {
      expect(screen.getByPlaceholderText("sk-…")).toBeDefined();
    });
  });
});

describe("StepLLM Codex flow [lane D]", () => {
  it("picking codex hides the key input and shows the CliProviderPanel idle copy", async () => {
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("codex")).toBeDefined();
    });
    fireEvent.click(screen.getByText("codex"));
    await waitFor(() => {
      // Idle copy is the "No API key required" sunken card
      expect(screen.getByText("No API key required.")).toBeDefined();
    });
    // No password input should be present
    expect(screen.queryByPlaceholderText("sk-…")).toBeNull();
  });

  it("Detect & save calls probeCodex(true) and shows green status on success", async () => {
    mockProbeCodex.mockResolvedValueOnce({ ok: true });
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("codex")).toBeDefined();
    });
    fireEvent.click(screen.getByText("codex"));
    await waitFor(() => {
      expect(screen.getByText("Detect & save")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Detect & save"));
    await waitFor(() => {
      expect(mockProbeCodex).toHaveBeenCalledWith(true);
    });
    await waitFor(() => {
      expect(screen.getByText("Codex detected.")).toBeDefined();
    });
  });

  it("not_signed_in: shows click-to-copy `codex login` inside the card", async () => {
    mockProbeCodex.mockResolvedValueOnce({
      ok: false,
      reason: "not_signed_in",
      raw: "auth required",
    });
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("codex")).toBeDefined());
    fireEvent.click(screen.getByText("codex"));
    await waitFor(() => expect(screen.getByText("Detect & save")).toBeDefined());
    fireEvent.click(screen.getByText("Detect & save"));
    await waitFor(() => {
      expect(screen.getByText("Codex CLI installed but not signed in.")).toBeDefined();
    });
    expect(screen.getByRole("button", { name: "Copy command: codex login" })).toBeDefined();
  });

  it("not_installed: shows install command inside the card", async () => {
    mockProbeCodex.mockResolvedValueOnce({
      ok: false,
      reason: "not_installed",
      raw: "codex: command not found",
    });
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("codex")).toBeDefined());
    fireEvent.click(screen.getByText("codex"));
    await waitFor(() => expect(screen.getByText("Detect & save")).toBeDefined());
    fireEvent.click(screen.getByText("Detect & save"));
    // The header text "Codex CLI not installed." appears in BOTH the panel
    // and the StatusLine (the StatusLine echoes the error). The install
    // command text is panel-only, so use it as the unambiguous probe target.
    await waitFor(() => {
      expect(screen.getByText("npm install -g @openai/codex")).toBeDefined();
    });
    // Header text is rendered both in panel + StatusLine — assert at least one.
    expect(screen.getAllByText("Codex CLI not installed.").length).toBeGreaterThanOrEqual(1);
  });

  it("retry: 'Detect again' invalidates the cache and re-probes", async () => {
    mockProbeCodex.mockResolvedValueOnce({
      ok: false,
      reason: "not_signed_in",
      raw: "auth required",
    });
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("codex")).toBeDefined());
    fireEvent.click(screen.getByText("codex"));
    await waitFor(() => expect(screen.getByText("Detect & save")).toBeDefined());
    fireEvent.click(screen.getByText("Detect & save"));
    await waitFor(() =>
      expect(screen.getByText("Codex CLI installed but not signed in.")).toBeDefined()
    );

    // Now the user has run `codex login` in a terminal and clicks "Detect again".
    mockProbeCodex.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Detect again" }));
    await waitFor(() => {
      expect(mockInvalidateCodexProbe).toHaveBeenCalled();
    });
    expect(mockProbeCodex).toHaveBeenCalledTimes(2);
    expect(mockProbeCodex).toHaveBeenLastCalledWith(true);
  });
});

describe("StepLLM Claude Code flow [lane D]", () => {
  it("uses probeClaudeCode (not probeCodex) when claude-code is the provider", async () => {
    mockProbeClaudeCode.mockResolvedValueOnce({ ok: true });
    render(<StepLLM onNext={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("claude-code")).toBeDefined());
    fireEvent.click(screen.getByText("claude-code"));
    await waitFor(() => expect(screen.getByText("Detect & save")).toBeDefined());
    fireEvent.click(screen.getByText("Detect & save"));
    await waitFor(() => {
      expect(mockProbeClaudeCode).toHaveBeenCalledWith(true);
    });
    expect(mockProbeCodex).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("Claude Code detected.")).toBeDefined();
    });
  });
});
