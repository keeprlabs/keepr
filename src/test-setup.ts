import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView; stub it so components that call
// it during mount (e.g. ScopeSection) don't throw in tests.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
