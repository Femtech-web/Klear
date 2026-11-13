"use client";

export function RefreshSetup({ children, className }: { children: string; className: string }) {
  return (
    <button type="button" className={className} onClick={() => window.location.reload()}>
      {children}
    </button>
  );
}
