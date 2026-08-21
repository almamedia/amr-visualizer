import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string;
}

export function MultiSelect({
  id,
  label,
  values,
  options,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  allowCustom = false,
  customLabel = (q) => `Add “${q}”`,
  onChange,
}: {
  id?: string;
  label: string;
  values: string[];
  options: MultiSelectOption[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowCustom?: boolean;
  customLabel?: (query: string) => string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => {
    const byValue = new Map(options.map((o) => [o.value, o]));
    return values.map(
      (v) => byValue.get(v) ?? { value: v, label: v }
    );
  }, [options, values]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.hint?.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q)
    );
  }, [options, query]);

  const queryTrim = query.trim();
  const exactMatch = options.some(
    (o) => o.label.toLowerCase() === queryTrim.toLowerCase()
  );
  const alreadyPicked = values.some(
    (v) => v.toLowerCase() === queryTrim.toLowerCase()
  );
  const showCustom =
    allowCustom && queryTrim.length > 0 && !exactMatch && !alreadyPicked;

  const rows: Array<
    | { kind: "option"; option: MultiSelectOption }
    | { kind: "custom"; value: string }
  > = [
    ...filtered.map((option) => ({ kind: "option" as const, option })),
    ...(showCustom ? [{ kind: "custom" as const, value: queryTrim }] : []),
  ];

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
  }

  function toggle(value: string) {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
      return;
    }
    onChange([...values, value]);
  }

  function addCustom(value: string) {
    const existing = options.find(
      (o) => o.label.toLowerCase() === value.toLowerCase()
    );
    const next = existing?.value ?? value;
    if (!values.some((v) => v.toLowerCase() === next.toLowerCase())) {
      onChange([...values, next]);
    }
    setQuery("");
  }

  function onSearchKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (!row) return;
      if (row.kind === "custom") addCustom(row.value);
      else toggle(row.option.value);
      return;
    }
    if (e.key === "Backspace" && query === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="multi-select" ref={rootRef}>
      <div
        id={id}
        className="multi-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        tabIndex={0}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open ? close() : setOpen(true);
          }
        }}
      >
        <span className="multi-select-values">
          {selected.length === 0 ? (
            <span className="placeholder">{placeholder}</span>
          ) : (
            selected.map((opt) => (
              <span key={opt.value} className="multi-select-chip">
                {opt.label}
                <button
                  type="button"
                  className="multi-select-chip-x"
                  aria-label={`Remove ${opt.label}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(opt.value);
                  }}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </span>
        <span className="multi-select-chevron" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </div>

      {open && (
        <div
          className="multi-select-menu"
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
        >
          <input
            ref={searchRef}
            type="text"
            className="multi-select-search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            aria-label={searchPlaceholder}
          />
          <div className="multi-select-results">
            {rows.map((row, i) => {
              if (row.kind === "custom") {
                return (
                  <button
                    type="button"
                    key="custom"
                    className={`multi-select-option custom ${
                      i === active ? "active" : ""
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => addCustom(row.value)}
                  >
                    {customLabel(row.value)}
                  </button>
                );
              }
              const picked = values.includes(row.option.value);
              return (
                <button
                  type="button"
                  key={row.option.value}
                  role="option"
                  aria-selected={picked}
                  className={`multi-select-option ${picked ? "picked" : ""} ${
                    i === active ? "active" : ""
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(row.option.value)}
                >
                  <span className="multi-select-check" aria-hidden>
                    {picked ? "✓" : ""}
                  </span>
                  <span className="multi-select-option-text">
                    <span>{row.option.label}</span>
                    {row.option.hint && row.option.hint !== row.option.label && (
                      <small>{row.option.hint}</small>
                    )}
                  </span>
                </button>
              );
            })}
            {rows.length === 0 && (
              <p className="multi-select-empty">{emptyText}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
