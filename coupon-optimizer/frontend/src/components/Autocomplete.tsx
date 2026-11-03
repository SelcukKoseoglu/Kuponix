import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export type AutocompleteOption = {
  value: string;
  /** Sağda gösterilen kısa bilgi (lig, grup…). */
  hint?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  getOptions: (query: string) => AutocompleteOption[];
  /** Seçenek seçildikten sonra çağrılır (ör. oyuncu şablonunda imleci sona taşımak için). */
  onPick?: (option: AutocompleteOption) => void;
  placeholder?: string;
  invalid?: boolean;
  emptyText?: string;
  ariaLabel?: string;
};

/**
 * Serbest metin girilebilen arama kutusu: yazdıkça öneriler listelenir, ↑/↓ ile gezilir, Enter ile seçilir.
 * Listede olmayan değer yazılırsa olduğu gibi kullanılır.
 */
export const Autocomplete = forwardRef<HTMLInputElement, Props>(function Autocomplete(
  { value, onChange, getOptions, onPick, placeholder, invalid, emptyText = 'Listede yok; yazdığın gibi kullanılır.', ariaLabel },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current!);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = useMemo(() => (open ? getOptions(value) : []), [open, value, getOptions]);

  const pick = (option: AutocompleteOption) => {
    onChange(option.value);
    setOpen(false);
    setActive(-1);
    onPick?.(option);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const showList = open && (options.length > 0 || value.trim().length > 0);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className={`input ${invalid ? 'input-error' : ''}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl shadow-black/40"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">{emptyText}</li>
          ) : (
            options.map((o, i) => (
              <li
                key={`${o.value}-${o.hint ?? ''}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // Odak kaybından (blur) önce seçimi yakalamak için mousedown kullanılır.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm ${
                  i === active ? 'bg-sky-900/60 text-white' : 'text-slate-200'
                }`}
              >
                <span className="min-w-0 truncate">{o.value}</span>
                {o.hint && <span className="shrink-0 text-xs text-slate-400">{o.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
});
