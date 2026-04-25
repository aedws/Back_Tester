import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0b0d12",
          panel: "#11141b",
          subtle: "#161a23",
        },
        border: {
          DEFAULT: "#222836",
          strong: "#2c3445",
        },
        accent: {
          DEFAULT: "#3ea6ff",
          green: "#34d399",
          red: "#f87171",
          amber: "#fbbf24",
        },
        ink: {
          DEFAULT: "#e6e8ee",
          muted: "#9aa3b2",
          dim: "#6b7280",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Pretendard",
          "Apple SD Gothic Neo",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
