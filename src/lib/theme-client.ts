"use client";

import { useSyncExternalStore } from "react";
import { siteConfig } from "@/config/site";

/** 浏览器端的主题偏好：存在 localStorage.theme，页头切换按钮和设置页共用 */
export type ThemePref = "system" | "light" | "dark";

const listeners = new Set<() => void>();

const read = (): ThemePref => {
  try {
    const t = localStorage.getItem("theme");
    if (t === "system" || t === "light" || t === "dark") return t;
  } catch {}
  return siteConfig.defaultTheme;
};

const resolve = (pref: ThemePref) =>
  pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;

export function setThemePref(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref);
  try {
    localStorage.setItem("theme", pref);
  } catch {}
  listeners.forEach((l) => l());
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      window.addEventListener("storage", l);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", l);
      };
    },
    read,
    () => siteConfig.defaultTheme,
  );
}
