"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@/components/ui/icons";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const theme = document.documentElement.dataset.theme;
      setDark(theme ? theme === "dark" : preference.matches);
    };
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  return (
    <button
      type="button"
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="grid size-10 cursor-pointer place-items-center rounded-md border border-line-strong text-ink-2 hover:bg-surface-2 hover:text-ink"
      onClick={() => {
        const theme = dark ? "light" : "dark";
        document.documentElement.dataset.theme = theme;
        setDark(!dark);
        try {
          localStorage.setItem("klear:theme", theme);
        } catch {}
      }}
    >
      {dark ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
