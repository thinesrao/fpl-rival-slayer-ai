import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
          edge: "hsl(var(--card-edge))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        fut: {
          gold: "hsl(var(--fut-gold))",
          "gold-mid": "hsl(var(--fut-gold-mid))",
          "gold-deep": "hsl(var(--fut-gold-deep))",
          silver: "hsl(var(--fut-silver))",
          "silver-mid": "hsl(var(--fut-silver-mid))",
          "silver-deep": "hsl(var(--fut-silver-deep))",
          bronze: "hsl(var(--fut-bronze))",
          "bronze-mid": "hsl(var(--fut-bronze-mid))",
          "bronze-deep": "hsl(var(--fut-bronze-deep))",
        },
      },
      backgroundImage: {
        "tier-gold":
          "linear-gradient(145deg, hsl(var(--fut-gold)) 0%, hsl(var(--fut-gold-mid)) 45%, hsl(var(--fut-gold-deep)) 100%)",
        "tier-silver":
          "linear-gradient(145deg, hsl(var(--fut-silver)) 0%, hsl(var(--fut-silver-mid)) 45%, hsl(var(--fut-silver-deep)) 100%)",
        "tier-bronze":
          "linear-gradient(145deg, hsl(var(--fut-bronze)) 0%, hsl(var(--fut-bronze-mid)) 45%, hsl(var(--fut-bronze-deep)) 100%)",
        "holo-stripes":
          "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 6px, transparent 6px 14px)",
      },
      boxShadow: {
        "fut-gold":
          "0 12px 32px -10px hsl(var(--fut-gold) / 0.45), 0 0 0 1px hsl(var(--fut-gold) / 0.35)",
        "fut-silver":
          "0 12px 32px -10px hsl(var(--fut-silver) / 0.35), 0 0 0 1px hsl(var(--fut-silver) / 0.3)",
        "fut-bronze":
          "0 12px 32px -10px hsl(var(--fut-bronze) / 0.4), 0 0 0 1px hsl(var(--fut-bronze) / 0.35)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "ovr-pop": {
          "0%":   { transform: "scale(0.8)", opacity: "0" },
          "60%":  { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "pack-tear": {
          "0%":   { clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)" },
          "100%": { clipPath: "polygon(0 0, 100% 0, 100% 0, 0 0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "ovr-pop": "ovr-pop 600ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        "pack-tear": "pack-tear 600ms ease-in forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
