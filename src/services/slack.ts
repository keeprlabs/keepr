// Slack — BYO-app model. User pastes a bot token (xoxb-...) from their own
// Slack app in their own workspace. We never distribute a Slack client.

import { fetch } from "@tauri-apps/plugin-http";
import { SECRET_KEYS, getSecret } from "./secrets";
import { getFetchCursor, setFetchCursor } from "./db";
import { throwIfAborted, isAbortError } from "../lib/abort";

async function slack<T = any>(
  method: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal
): Promise<T> {
  const token = await getSecret(SECRET_KEYS.slackBot);
  if (!token) throw new Error("No Slack bot token");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const res = await fetch(`https://slack.com/api/${method}?${qs.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal,
  });
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") || "60";
    throw new Error(
      `Slack rate limited (retry after ${retryAfter}s). ` +
      "If using a distributed app, Slack limits conversations.history to 1 req/min. " +
      "Use a BYO Slack app (internal to your workspace) to avoid this limit."
    );
  }
  if (!res.ok) throw new Error(`Slack ${method}: HTTP ${res.status}`);
  const data = (await res.json()) as any;
  if (!data.ok) {
    if (data.error === "ratelimited") {
      throw new Error(
        "Slack rate limited. " +
        "If using a distributed app, Slack limits conversations.history to 1 req/min. " +
        "Use a BYO Slack app (internal to your workspace) to avoid this limit."
      );
    }
    throw new Error(`Slack ${method}: ${data.error}`);
  }
  return data as T;
}

export async function authTest(): Promise<{ team: string; user: string; team_id: string }> {
  return slack("auth.test");
}

export interface SlackChannel {
  id: string;
  name: string;
  is_member?: boolean;
  is_archived?: boolean;
}

export async function listPublicChannels(): Promise<SlackChannel[]> {
  const all: SlackChannel[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const data: any = await slack("conversations.list", {
      exclude_archived: "true",
      types: "public_channel",
      limit: 200,
      cursor,
    });
    all.push(...(data.channels || []));
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return all;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string };
  is_bot?: boolean;
  deleted?: boolean;
}

export async function listUsers(): Promise<SlackUser[]> {
  const all: SlackUser[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const data: any = await slack("users.list", { limit: 200, cursor });
    all.push(...(data.members || []));
    cursor = data.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return all.filter((u) => !u.deleted && !u.is_bot);
}

export interface FetchedMessage {
  source_id: string;
  url: string;
  user: string | null;
  text: string;
  ts: string;
  thread_ts: string | null;
  channel_id: string;
  channel_name: string;
  replies?: FetchedMessage[];
}

export async function fetchChannelHistory(
  channel: { id: string; name: string },
  sinceIso: string,
  teamDomain: string,
  opts: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<FetchedMessage[]> {
  const cacheKey = `channel:${channel.id}`;
  const cursor = opts.forceRefresh ? null : await getFetchCursor("slack", cacheKey);
  const effectiveSince = cursor && cursor > sinceIso ? cursor : sinceIso;
  const oldest = String(new Date(effectiveSince).getTime() / 1000);

  const out: FetchedMessage[] = [];
  let slackCursor: string | undefined;

  for (let page = 0; page < 10; page++) {
    // Cancel check between pagination pages.
    throwIfAborted(opts.signal);

    const data: any = await slack(
      "conversations.history",
      {
        channel: channel.id,
        oldest,
        limit: 200,
        cursor: slackCursor,
      },
      opts.signal
    );
    for (const m of data.messages || []) {
      if (m.subtype === "bot_message" || m.bot_id) continue;
      if (out.length >= 500) break; // hard cap
      const tsForUrl = (m.ts as string).replace(".", "");
      const url = `https://${teamDomain}.slack.com/archives/${channel.id}/p${tsForUrl}`;
      const msg: FetchedMessage = {
        source_id: `${channel.id}:${m.ts}`,
        url,
        user: m.user ?? null,
        text: m.text ?? "",
        ts: m.ts,
        thread_ts: m.thread_ts ?? null,
        channel_id: channel.id,
        channel_name: channel.name,
      };

      // Pull thread replies when this message started a thread.
      if (m.thread_ts && m.reply_count && m.thread_ts === m.ts) {
        try {
          const rdata: any = await slack(
            "conversations.replies",
            {
              channel: channel.id,
              ts: m.ts,
              limit: 50,
            },
            opts.signal
          );
          msg.replies = (rdata.messages || [])
            .slice(1)
            .filter((r: any) => !r.bot_id)
            .map((r: any) => ({
              source_id: `${channel.id}:${r.ts}`,
              url: `https://${teamDomain}.slack.com/archives/${channel.id}/p${(r.ts as string).replace(".", "")}?thread_ts=${m.ts}`,
              user: r.user ?? null,
              text: r.text ?? "",
              ts: r.ts,
              thread_ts: m.ts,
              channel_id: channel.id,
              channel_name: channel.name,
            }));
        } catch (err) {
          // Re-throw cancellation; swallow anything else (partial thread
          // is acceptable, a real replies API error for one message
          // shouldn't fail the whole channel fetch).
          if (isAbortError(err)) throw err;
        }
      }

      out.push(msg);
    }
    slackCursor = data.response_metadata?.next_cursor;
    if (!slackCursor || !data.has_more || out.length >= 500) break;
    // Gentle backoff between pages.
    await new Promise((r) => setTimeout(r, 120));
  }

  await setFetchCursor("slack", cacheKey, new Date().toISOString());
  return out;
}
