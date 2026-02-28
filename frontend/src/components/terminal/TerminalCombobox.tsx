import type { ReactNode } from "react";
import { TerminalInput } from "./TerminalInput";

type Props<T> = {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  placeholder?: string;
  open: boolean;
  items: T[];
  selectedIndex?: number;
  onSelect: (item: T) => void;
  renderItem: (item: T, meta: { selected: boolean; index: number }) => ReactNode;
  getItemKey: (item: T, index: number) => string;
  className?: string;
  inputClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  loading?: boolean;
  "data-testid"?: string;
};

export function TerminalCombobox<T>({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  placeholder,
  open,
  items,
  selectedIndex = -1,
  onSelect,
  renderItem,
  getItemKey,
  className = "",
  inputClassName = "",
  listClassName = "",
  itemClassName = "",
  loading = false,
  "data-testid": dataTestId,
}: Props<T>) {
  return (
    <div className={className}>
      <TerminalInput
        tone="ui"
        aria-busy={loading || undefined}
        className={inputClassName}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        spellCheck={false}
        data-testid={dataTestId}
      />
      {open && items.length > 0 ? (
        <div className={listClassName}>
          {items.map((item, index) => (
            <div
              key={getItemKey(item, index)}
              className={itemClassName}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
            >
              {renderItem(item, { selected: index === selectedIndex, index })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
