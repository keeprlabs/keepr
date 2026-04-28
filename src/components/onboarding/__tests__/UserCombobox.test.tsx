// Combobox behaviour: lazy load, debounce + abort, keyboard nav, label
// resolution, and the "clearing the input does NOT clear the value"
// guarantee that prevents silent overwrites.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserCombobox } from "../UserCombobox";
import type { ProviderUserMatch } from "../../../services/teammateSearch";

function makeMatch(overrides: Partial<ProviderUserMatch> = {}): ProviderUserMatch {
  return {
    provider: "slack",
    id: "U_PRIYA",
    handle: "U_PRIYA",
    label: "Priya R",
    detail: "@priyar",
    ...overrides,
  };
}

describe("UserCombobox", () => {
  it("calls onLoad once on first focus, then never again", async () => {
    const onLoad = vi.fn(async () => {});
    const search = vi.fn(() => [makeMatch()]);
    render(
      <UserCombobox
        provider="slack"
        value={null}
        onChange={vi.fn()}
        onLoad={onLoad}
        search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await waitFor(() => expect(search).toHaveBeenCalled());
    fireEvent.blur(input);
    fireEvent.focus(input);
    await new Promise((r) => setTimeout(r, 50));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it("debounces the search call to a single invocation per burst of typing", async () => {
    const search = vi.fn<(q: string) => ProviderUserMatch[]>(() => [
      makeMatch({ label: "Match" }),
    ]);
    render(
      <UserCombobox
        provider="slack"
        value={null}
        onChange={vi.fn()}
        search={search}
      />
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.focus(input);
    await waitFor(() => expect(search).toHaveBeenCalled());
    search.mockClear();

    fireEvent.change(input, { target: { value: "pri" } });
    fireEvent.change(input, { target: { value: "priy" } });
    fireEvent.change(input, { target: { value: "priya" } });
    // Wait past debounce window.
    await new Promise((r) => setTimeout(r, 250));
    // After debounce, only the final query is searched.
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]![0]).toBe("priya");

    await waitFor(() => expect(screen.getByRole("option")).toBeInTheDocument());
  });

  it("clearing the text input via Backspace does NOT clear the persisted value", async () => {
    const onChange = vi.fn();
    const search = vi.fn(() => [makeMatch()]);
    render(
      <UserCombobox
        provider="slack"
        value="U_PRIYA"
        label="Priya R"
        onChange={onChange}
        search={search}
      />
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("Priya R");
    fireEvent.focus(input);
    await waitFor(() => expect(search).toHaveBeenCalled());
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("× button explicitly clears the value", async () => {
    const onChange = vi.fn();
    const search = vi.fn(() => []);
    render(
      <UserCombobox
        provider="slack"
        value="U_PRIYA"
        label="Priya R"
        onChange={onChange}
        search={search}
      />
    );
    const clearBtn = screen.getByRole("button", { name: /clear selection/i });
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("Enter selects the highlighted result", async () => {
    const onChange = vi.fn();
    const a = makeMatch({ id: "U_A", label: "Alpha" });
    const b = makeMatch({ id: "U_B", label: "Bravo" });
    const search = vi.fn(() => [a, b]);
    render(
      <UserCombobox
        provider="slack"
        value={null}
        onChange={onChange}
        search={search}
      />
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(b);
  });

  it("resolveLabel runs once on mount when value is set without a label", async () => {
    const resolveLabel = vi.fn(async () => "Priya Raman");
    render(
      <UserCombobox
        provider="github"
        value="priyar"
        onChange={vi.fn()}
        search={vi.fn(() => [])}
        resolveLabel={resolveLabel}
      />
    );
    await waitFor(() => expect(resolveLabel).toHaveBeenCalledWith("priyar"));
    const input = screen.getByRole("combobox") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("Priya Raman"));
  });

  it("renders disabled with hint when provider is not connected", () => {
    render(
      <UserCombobox
        provider="jira"
        value={null}
        onChange={vi.fn()}
        search={vi.fn(() => [])}
        disabled
        disabledHint="Connect Jira to map"
      />
    );
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.placeholder).toBe("Connect Jira to map");
  });
});
