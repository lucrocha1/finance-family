import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
};

export const TagsInput = ({ value, onChange, placeholder = "Digite e Enter pra adicionar", maxTags = 10 }: Props) => {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const t = draft.trim().toLowerCase();
    if (!t) return;
    if (value.includes(t)) {
      setDraft("");
      return;
    }
    if (value.length >= maxTags) return;
    onChange([...value, t]);
    setDraft("");
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-secondary px-2 py-1.5">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
          #{tag}
          <button type="button" onClick={() => remove(tag)} className="hover:opacity-70" aria-label={`Remover tag ${tag}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : ""}
        className="h-7 flex-1 min-w-[120px] border-none bg-transparent px-1 text-sm focus-visible:ring-0"
      />
    </div>
  );
};
