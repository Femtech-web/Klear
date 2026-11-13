export function WorkflowNav({ current }: { current: "setup" | "activate" | "manage" }) {
  return (
    <ol aria-label="Investor journey" className="grid grid-cols-3 gap-3 border-b border-line pb-4">
      {(
        [
          ["setup", "Set up"],
          ["activate", "Activate"],
          ["manage", "Manage"],
        ] as const
      ).map(([id, label], i) => (
        <li
          key={id}
          aria-current={id === current ? "step" : undefined}
          className={`flex items-center gap-2 text-sm ${id === current ? "font-semibold text-ink" : "text-ink-3"}`}
        >
          <span
            aria-hidden="true"
            className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${id === current ? "bg-ink text-canvas" : "border border-line-strong"}`}
          >
            {i + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}
