"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

const WALLET_PATH = /^\/(practice|create|strategies\/[^/]+)\/?$/;

export function SiteLink({ href, ...props }: ComponentProps<"a"> & { href: string }) {
  const path = usePathname();
  const destination = href.split(/[?#]/, 1)[0];
  const internal = destination.startsWith("/") && !destination.startsWith("//");

  // A client transition keeps the old document's CSP and nonce.
  if (internal && destination !== path && (WALLET_PATH.test(path) || WALLET_PATH.test(destination))) {
    return <a href={href} {...props} />;
  }
  return <Link href={href} {...props} />;
}
