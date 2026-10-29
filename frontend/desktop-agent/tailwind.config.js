/** @type {import('tailwindcss').Config} */
export default {
  // Only the reskin components are scanned, so utilities never get generated
  // for class names already used by App.tsx / App.css.
  content: ["./src/ui/**/*.{ts,tsx}"],
  // The reskin's dark face follows the theme hook's html.dark class.
  darkMode: "class",
  corePlugins: {
    // Tailwind's base reset would restyle every existing screen.
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        bg: "var(--k-bg)",
        "bg-2": "var(--k-bg-2)",
        card: "var(--k-card)",
        ink: "var(--k-ink)",
        "ink-2": "var(--k-ink-2)",
        muted: "var(--k-muted)",
        faint: "var(--k-faint)",
        dot: "var(--k-dot)",
        brand: "var(--k-brand)",
        "brand-deep": "var(--k-brand-deep)",
        brandaccent: "var(--k-brand-accent)",
        line: "var(--k-line)",
        "line-2": "var(--k-line-2)",
        plum: "var(--k-plum)",
        "plum-2": "var(--k-plum-2)",
        navy: "var(--k-navy)",
        "navy-2": "var(--k-navy-2)",
        "navy-soft": "var(--k-navy-soft)",
        "navy-text": "var(--k-navy-text)",
        "navy-line": "var(--k-navy-line)",
        solid: "var(--k-solid)",
        "solid-2": "var(--k-solid-2)",
        hover: "var(--k-hover)",
        field: "var(--k-field)",
        pink: "var(--k-pink)",
        "pink-2": "var(--k-pink-2)",
        ok: "var(--k-green)",
        "ok-2": "var(--k-green-2)",
        warn: "var(--k-amber)",
        "warn-2": "var(--k-amber-2)",
        bad: "var(--k-rose)",
        "bad-2": "var(--k-rose-2)",
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        heading: ["Inter Variable", "Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        body: ["Inter Variable", "Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        label: ["Inter Variable", "Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        // The design used Inter for "mono" too; timers rely on tabular numerals.
        mono: ["Inter Variable", "Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        arabic: ["IBM Plex Sans Arabic", "Inter Variable", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
