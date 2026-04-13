// Team members — fuzzy match GitHub handles against Slack display names,
// keyboard-first but mouse-accessible. Three columns: name, github, slack.
// As the manager types a name or handle, a low-key suggestion surfaces
// under the slack column and can be accepted with Tab or a click.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GhostButton,
  Lede,
  PrimaryButton,
  StepFooter,
  Title,
  inputCls,
} from "./primitives";
import { listMembers, upsertMember } from "../../services/db";
import * as slack from "../../services/slack";
import { slugify } from "../../services/memory";
import {
  bestSlackMatch,
  fuzzyMatchSlack,
  slackDisplay,
} from "./fuzzyMatch";

interface Row {
  display_name: string;
  github_handle: string;
  slack_user_id: string;
  /** non-persisted: the label we show next to the slack id */
  slack_label?: string;
  /** non-persisted: whether the current slack id came from an auto-match */
  auto_matched?: boolean;
}

const EMPTY_ROW: Row = { display_name: "", github_handle: "", slack_user_id: "" };

export function StepTeam({ onNext }: { onNext: () => void }) {
  const [rows, setRows] = useState<Row[]>([EMPTY_ROW, EMPTY_ROW, EMPTY_ROW]);
  const [slackUsers, setSlackUsers] = useState<slack.SlackUser[]>([]);
  const [slackAvailable, setSlackAvailable] = useState(true);
  const [suggestIdx, setSuggestIdx] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const existing = await listMembers();
      if (existing.length) {
        setRows(
          existing.map((m) => ({
            display_name: m.display_name,
            github_handle: m.github_handle || "",
            slack_user_id: m.slack_user_id || "",
          }))
        );
      }
      try {
        const users = await slack.listUsers();
        setSlackUsers(users);
      } catch {
        setSlackAvailable(false);
      }
    })();
  }, []);

  const update = (i: number, patch: Partial<Row>) => {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  // Auto-match slack id from github handle / display name as the user types,
  // but ONLY when the slack field is empty or still auto-matched. Never
  // stomp on a manual selection.
  const tryAutoMatch = (i: number, handle: string, displayName: string) => {
    if (!slackUsers.length) return;
    const current = rows[i];
    if (current.slack_user_id && !current.auto_matched) return;
    const q = handle.trim() || displayName.trim();
    if (!q) {
      if (current.auto_matched) {
        update(i, { slack_user_id: "", slack_label: "", auto_matched: false });
      }
      return;
    }
    const match = bestSlackMatch(q, slackUsers);
    if (match) {
      update(i, {
        slack_user_id: match.id,
        slack_label: slackDisplay(match),
        auto_matched: true,
      });
    }
  };

  const suggestionsFor = useMemo(() => {
    return (i: number) => {
      const r = rows[i];
      if (!slackUsers.length) return [];
      const q = r.github_handle.trim() || r.display_name.trim();
      if (!q) return [];
      return fuzzyMatchSlack(q, slackUsers, 4);
    };
  }, [rows, slackUsers]);

  const addRow = () => setRows((prev) => [...prev, EMPTY_ROW]);
  const removeRow = (i: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  const save = async () => {
    for (const r of rows) {
      if (!r.display_name.trim()) continue;
      await upsertMember({
        display_name: r.display_name.trim(),
        github_handle: r.github_handle.trim() || null,
        slack_user_id: r.slack_user_id.trim() || null,
        slug: slugify(r.display_name),
      });
    }
    onNext();
  };

  const nonEmptyCount = rows.filter((r) => r.display_name.trim()).length;

  return (
    <div ref={rootRef}>
      <Title>Who's on your team?</Title>
      <Lede>
        Map each person to their GitHub handle and Slack user id. Keepr
        uses this to thread activity across both sources into one story
        per person.
        {!slackAvailable && (
          <> Slack isn't connected yet — you can come back to this later.</>
        )}
      </Lede>

      <div className="mb-2 grid grid-cols-[1.25fr_1fr_1.25fr_auto] gap-2 px-1 text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        <span>Name</span>
        <span>GitHub</span>
        <span>Slack</span>
        <span />
      </div>

      <div className="mb-4 flex flex-col gap-[6px]">
        {rows.map((r, i) => {
          const suggestions = suggestionsFor(i);
          const showDropdown =
            suggestIdx === i &&
            !r.slack_user_id &&
            suggestions.length > 0 &&
            !r.auto_matched;
          return (
            <div
              key={i}
              className="relative grid grid-cols-[1.25fr_1fr_1.25fr_auto] gap-2 items-start"
            >
              <input
                className={inputCls}
                placeholder="Display name"
                value={r.display_name}
                onChange={(e) => {
                  update(i, { display_name: e.target.value });
                  tryAutoMatch(i, r.github_handle, e.target.value);
                }}
              />
              <input
                className={inputCls}
                placeholder="github-handle"
                value={r.github_handle}
                onChange={(e) => {
                  update(i, { github_handle: e.target.value });
                  tryAutoMatch(i, e.target.value, r.display_name);
                }}
              />
              <div className="relative">
                <input
                  className={inputCls}
                  placeholder={
                    slackUsers.length
                      ? "Suggested from handle…"
                      : "U01… (Slack user id)"
                  }
                  value={
                    r.slack_label
                      ? `${r.slack_label}  ·  ${r.slack_user_id}`
                      : r.slack_user_id
                  }
                  onFocus={() => setSuggestIdx(i)}
                  onBlur={() => {
                    // Delay so a click on a suggestion is registered first.
                    setTimeout(() => {
                      setSuggestIdx((cur) => (cur === i ? null : cur));
                    }, 120);
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    // If the user types raw, clear the friendly label and
                    // drop the auto_matched flag.
                    update(i, {
                      slack_user_id: v,
                      slack_label: "",
                      auto_matched: false,
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && suggestions[0] && !r.slack_user_id) {
                      e.preventDefault();
                      update(i, {
                        slack_user_id: suggestions[0].user.id,
                        slack_label: slackDisplay(suggestions[0].user),
                        auto_matched: true,
                      });
                    }
                    if (e.key === "Escape") {
                      setSuggestIdx(null);
                    }
                  }}
                />
                {r.auto_matched && (
                  <span
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-[0.14em] text-ink-faint pointer-events-none"
                    aria-label="auto-matched from Slack"
                  >
                    auto
                  </span>
                )}
                {showDropdown && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-hairline bg-canvas shadow-soft">
                    {suggestions.map(({ user, score }) => (
                      <button
                        key={user.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          update(i, {
                            slack_user_id: user.id,
                            slack_label: slackDisplay(user),
                            auto_matched: false,
                          });
                          setSuggestIdx(null);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-ink-soft hover:bg-surface transition-colors"
                      >
                        <span className="truncate">{slackDisplay(user)}</span>
                        <span className="mono text-[10px] text-ink-faint">
                          {user.id} · {score}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => removeRow(i)}
                className="text-xs text-ink-faint hover:text-ink transition-colors px-1"
                aria-label="Remove row"
                tabIndex={-1}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="mb-8">
        <GhostButton onClick={addRow}>+ Add member</GhostButton>
      </div>

      <StepFooter>
        <PrimaryButton onClick={save} disabled={nonEmptyCount === 0}>
          Save {nonEmptyCount} {nonEmptyCount === 1 ? "member" : "members"}
        </PrimaryButton>
        <span className="text-xs text-ink-faint">
          Tab to accept the suggestion · Esc to clear
        </span>
      </StepFooter>
    </div>
  );
}
