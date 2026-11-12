"use client";

import { useEffect } from "react";

/** Publishes the sticky header's height as --header-h, so menus can stick right below it at any width. */
export function HeaderHeight() {
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const set = () =>
      document.documentElement.style.setProperty(
        "--header-h",
        `${Math.round(header.getBoundingClientRect().height)}px`,
      );
    set();
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return null;
}
