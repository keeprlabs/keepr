import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryDivider } from "../CategoryDivider";

describe("CategoryDivider", () => {
  it("renders the label text", () => {
    render(<CategoryDivider label="Local CLI" />);
    expect(screen.getByText("Local CLI")).toBeDefined();
  });

  it("uses role=presentation so the label text isn't double-announced", () => {
    const { container } = render(<CategoryDivider label="Hosted" />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.getAttribute("role")).toBe("presentation");
  });

  it("renders two decorative rules so the label sits inline", () => {
    const { container } = render(<CategoryDivider label="Self-hosted" />);
    const rules = container.querySelectorAll('[aria-hidden="true"]');
    expect(rules.length).toBe(2);
  });
});
