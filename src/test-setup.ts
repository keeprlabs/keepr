import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView; stub it so components that call
// it during mount (e.g. ScopeSection) don't throw in tests.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// Vite injects __KEEPR_VERSION__ from package.json at build time. In tests
// we set it once before any module imports run so version-comparison code
// in src/lib/version.ts and friends sees a real value rather than "0.0.0".
(globalThis as any).__KEEPR_VERSION__ = "0.2.5";
