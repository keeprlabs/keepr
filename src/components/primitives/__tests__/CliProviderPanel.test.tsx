import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CliProviderPanel } from "../CliProviderPanel";
import type { LLMProvider } from "../../../services/llm";

// Minimal mock provider — only the fields CliProviderPanel reads.
const codexMock: LLMProvider = {
  id: "claude-code", // re-using a real id for type satisfaction; field values are what matter
  category: "cli",
  label: "Codex",
  keyUrl: "",
  defaultSynthesisModel: "gpt-5",
  defaultClassifierModel: "gpt-5-mini",
  cli: {
    installCmd: "brew install codex",
    installUrl: "github.com/openai/codex",
    loginCmd: "codex login",
  },
  complete: vi.fn(),
  test: vi.fn(),
};

describe("CliProviderPanel", () => {
  beforeEach(() => {
    // Reset clipboard mock between tests.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => {}) },
    });
  });

  describe("idle state (probe = null)", () => {
    it("renders 'No API key required' copy", () => {
      render(<CliProviderPanel provider={codexMock} probe={null} />);
      expect(screen.getByText("No API key required.")).toBeDefined();
      expect(screen.getByText(/your installed Codex CLI/)).toBeDefined();
    });
  });

  describe("ok state (probe = ok)", () => {
    it("renders the 'detected ✓' confirmation", () => {
      render(<CliProviderPanel provider={codexMock} probe={{ ok: true }} />);
      expect(screen.getByText(/Codex CLI: detected/)).toBeDefined();
    });
  });

  describe("not_installed state", () => {
    it("renders the install command and the install URL link", () => {
      render(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "not_installed", raw: "codex: command not found" }}
        />
      );
      expect(screen.getByText("Codex CLI not installed.")).toBeDefined();
      expect(screen.getByText("brew install codex")).toBeDefined();
      const link = screen.getByRole("link", { name: "github.com/openai/codex" });
      expect(link.getAttribute("href")).toBe("https://github.com/openai/codex");
    });

    it("renders 'Detect again' button only when onRetry is supplied", () => {
      const onRetry = vi.fn();
      const { rerender } = render(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "not_installed", raw: "" }}
        />
      );
      expect(screen.queryByRole("button", { name: "Detect again" })).toBeNull();

      rerender(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "not_installed", raw: "" }}
          onRetry={onRetry}
        />
      );
      const btn = screen.getByRole("button", { name: "Detect again" });
      fireEvent.click(btn);
      expect(onRetry).toHaveBeenCalledOnce();
    });
  });

  describe("not_signed_in state", () => {
    it("renders the click-to-copy login command", () => {
      render(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "not_signed_in", raw: "auth required" }}
        />
      );
      expect(screen.getByText("Codex CLI installed but not signed in.")).toBeDefined();
      const copyBtn = screen.getByRole("button", { name: "Copy command: codex login" });
      expect(copyBtn).toBeDefined();
    });

    it("writes the login command to the clipboard on click", async () => {
      const writeText = vi.fn(async () => {});
      Object.assign(navigator, { clipboard: { writeText } });

      render(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "not_signed_in", raw: "auth required" }}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy command: codex login" }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("codex login");
      });
    });

    it("swallows clipboard errors silently — the command stays visible inline", async () => {
      const writeText = vi.fn(async () => {
        throw new Error("clipboard denied");
      });
      Object.assign(navigator, { clipboard: { writeText } });

      render(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "not_signed_in", raw: "auth required" }}
        />
      );
      // Clicking should not throw.
      fireEvent.click(screen.getByRole("button", { name: "Copy command: codex login" }));
      // Command text is rendered for manual copy.
      expect(screen.getByText("codex login")).toBeDefined();
    });
  });

  describe("other (network/etc) state", () => {
    it("renders the consumer-supplied error message", () => {
      render(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "other", raw: "ECONNRESET" }}
          otherErrorMessage="Couldn't reach the provider. Check your network."
        />
      );
      expect(screen.getByText(/Couldn't reach the provider/)).toBeDefined();
    });

    it("falls back to a generic message when none supplied", () => {
      render(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "other", raw: "" }}
        />
      );
      expect(screen.getByText(/Detection failed/)).toBeDefined();
    });
  });

  describe("defensive guards", () => {
    it("returns null when provider has no cli metadata", () => {
      const noCli: LLMProvider = { ...codexMock, cli: undefined };
      const { container } = render(<CliProviderPanel provider={noCli} probe={null} />);
      expect(container.firstChild).toBeNull();
    });

    it("drops the install URL link when the URL isn't a bare host+path", () => {
      // Trusted source today, but the guard turns "must verify every entry by hand"
      // into "the link is silently dropped if someone mistypes a scheme".
      const evil: LLMProvider = {
        ...codexMock,
        cli: { installCmd: "brew install codex", installUrl: 'evil.com" onclick="x' },
      };
      render(
        <CliProviderPanel
          provider={evil}
          probe={{ ok: false, reason: "not_installed", raw: "" }}
        />
      );
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  describe("transitions", () => {
    it("idle copy disappears once a probe result lands", () => {
      const { rerender } = render(
        <CliProviderPanel provider={codexMock} probe={null} />
      );
      expect(screen.getByText("No API key required.")).toBeDefined();

      rerender(<CliProviderPanel provider={codexMock} probe={{ ok: true }} />);
      expect(screen.queryByText("No API key required.")).toBeNull();
      expect(screen.getByText(/Codex CLI: detected/)).toBeDefined();
    });

    it("copy button aria-label flips to 'Copied' after a successful copy", async () => {
      const writeText = vi.fn(async () => {});
      Object.assign(navigator, { clipboard: { writeText } });
      render(
        <CliProviderPanel
          provider={codexMock}
          probe={{ ok: false, reason: "not_signed_in", raw: "" }}
        />
      );
      const btn = screen.getByRole("button", { name: "Copy command: codex login" });
      fireEvent.click(btn);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Copied: codex login" })).toBeDefined();
      });
    });
  });
});
