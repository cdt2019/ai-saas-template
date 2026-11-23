"use client";

import { Moon, Sun } from "lucide-react";
import { setThemePref } from "@/lib/theme-client";

/** 页头的深浅色切换：直接在浅色 / 深色之间切（「跟随系统」在设置页里选） */
export function ThemeToggle({ label, className = "icon-btn" }: { label: string; className?: string }) {
  const toggle = () => setThemePref(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} className={className}>
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </button>
  );
}
