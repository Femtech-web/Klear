/** Joins class names, dropping falsy ones. */
export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
