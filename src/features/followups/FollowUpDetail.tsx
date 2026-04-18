// FollowUpDetail — inline detail panel for editing a follow-up.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FollowUp, TeamMember } from "../../lib/types";

interface Props {
  followUp: FollowUp;
  members: TeamMember[];
  onSave: (id: number, subject: string, description: string) => void;
  onStateChange: (id: number, state: "open" | "carried" | "resolved") => void;
  onClose: () => void;
}

const STATES: FollowUp["state"][] = ["open", "carried", "resolved"];

const STATE_LABEL: Record<FollowUp["state"], string> = {
  open: "Open",
  carried: "Carried",
  resolved: "Resolved",
};

export function FollowUpDetail({ followUp, members, onSave, onStateChange, onClose }: Props) {
  const [subject, setSubject] = useState(followUp.subject);
  const [description, setDescription] = useState(followUp.description ?? "");
  const subjectRef = useRef<HTMLInputElement>(null);

  // Sync local state when followUp changes.
  useEffect(() => {
    setSubject(followUp.subject);
    setDescription(followUp.description ?? "");
  }, [followUp.id, followUp.subject, followUp.description]);

  const saveSubject = useCallback(() => {
    const trimmed = subject.trim();
    if (trimmed && trimmed !== followUp.subject) {
      onSave(followUp.id, trimmed, description);
    }
  }, [subject, description, followUp.id, followUp.subject, onSave]);

  const saveDescription = useCallback(() => {
    if (description !== (followUp.description ?? "")) {
      onSave(followUp.id, subject, description);
    }
  }, [subject, description, followUp.id, followUp.description, onSave]);

  const member = followUp.origin_member_id
    ? members.find((m) => m.id === followUp.origin_member_id)
    : null;

  // Focus subject input on open.
  useEffect(() => {
    subjectRef.current?.focus();
  }, [followUp.id]);

  return (
    <div className="flex h-full flex-col border-l border-hairline bg-canvas">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <span className="text-xs text-ink-faint uppercase tracking-wider">Follow-up</span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-6 w-6 items-center justify-center rounded text-ink-muted transition-colors duration-180 hover:bg-[rgba(10,10,10,0.04)] hover:text-ink"
        >
          &times;
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Subject */}
        <input
          ref={subjectRef}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={saveSubject}
          className="w-full bg-transparent text-sm font-medium text-ink-soft outline-none placeholder:text-ink-faint"
          placeholder="Subject"
        />

        {/* Description */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          rows={5}
          className="w-full resize-none rounded-md border border-hairline bg-transparent px-3 py-2 text-xs leading-relaxed text-ink-soft outline-none placeholder:text-ink-faint focus:border-accent/30 transition-colors duration-180"
          placeholder="Add notes..."
        />

        {/* State buttons */}
        <div className="flex gap-1.5">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => onStateChange(followUp.id, s)}
              className={`rounded-md border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors duration-180 ${
                followUp.state === s
                  ? "border-accent/40 bg-accent/5 text-accent font-medium"
                  : "border-hairline text-ink-faint hover:border-accent/20 hover:text-ink-muted"
              }`}
            >
              {STATE_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Metadata */}
        <div className="space-y-1.5 text-[10px] text-ink-faint">
          {followUp.origin_session != null && (
            <div>From session #{followUp.origin_session}</div>
          )}
          {member && <div>{member.display_name}</div>}
          <div>Created {formatDate(followUp.created_at)}</div>
          {followUp.resolved_at && (
            <div>Resolved {formatDate(followUp.resolved_at)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
