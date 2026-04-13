/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Granola-inspired monochromatic palette.
        canvas: "#FAFAF9",
        surface: "#F4F3F0",
        sunken: "#EFEEEA",
        hairline: "rgba(10, 10, 10, 0.08)",
        ink: {
          DEFAULT: "#0A0A0A",
          soft: "#1A1A1A",
          muted: "#6B6B68",
          faint: "#9A9A96",
          ghost: "#C4C3BE",
        },
        // The single restrained accent — a desaturated ink blue.
        accent: {
          DEFAULT: "#2F3A4C",
          soft: "#E6E9EE",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
        serif: [
          '"Newsreader"',
          '"Charter"',
          '"Iowan Old Style"',
          "Georgia",
          "serif",
        ],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        // Deliberate size ladder — real hierarchy, not size soup.
        xxs: ["11px", { lineHeight: "16px", letterSpacing: "0.02em" }],
        xs: ["12px", { lineHeight: "18px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14.5px", { lineHeight: "24px" }],
        md: ["15px", { lineHeight: "26px" }],
        lg: ["17px", { lineHeight: "28px" }],
        xl: ["20px", { lineHeight: "30px", letterSpacing: "-0.01em" }],
        "2xl": ["26px", { lineHeight: "34px", letterSpacing: "-0.015em" }],
        "3xl": ["34px", { lineHeight: "42px", letterSpacing: "-0.02em" }],
      },
      boxShadow: {
        sheet:
          "0 1px 2px rgba(10,10,10,0.04), 0 12px 40px rgba(10,10,10,0.10)",
        hairline: "0 0 0 1px rgba(10,10,10,0.08)",
        soft: "0 1px 0 rgba(10,10,10,0.04)",
      },
      transitionTimingFunction: {
        calm: "cubic-bezier(0.22, 0.61, 0.36, 1)",
      },
      transitionDuration: {
        180: "180ms",
        220: "220ms",
      },
    },
  },
  plugins: [],
};
