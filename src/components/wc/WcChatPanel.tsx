"use client";

// WC26 chat: SSE-streamed Gemini replies with the live digest + the user's
// squad as context. Thread held client-side (localStorage) so it works
// without any server store.

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getOrCreateUid } from "@/lib/wc/squad/storage";
import type { WcSquadState } from "@/lib/wc/squad/types";

interface ChatMsg {
  role: "user" | "model";
  text: string;
  citations?: Array<{ uri: string; title: string }>;
}

const THREAD_KEY = "wc26:chat";

function loadThread(): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(THREAD_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveThread(msgs: ChatMsg[]) {
  try {
    window.localStorage.setItem(THREAD_KEY, JSON.stringify(msgs.slice(-30)));
  } catch {
    // ignore
  }
}

const SUGGESTIONS = [
  "Who should I captain this round and when should I move the armband?",
  "Any injury doubts in my squad I should act on?",
  "Best <5% owned differentials for a Scouting Bonus?",
  "When should I play my Wildcard?",
];

export function WcChatPanel({ squad }: { squad: WcSquadState }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const local = loadThread();
    setMessages(local);
    // Local storage empty (new device / cleared browser) — rehydrate from the
    // server mirror.
    if (local.length === 0) {
      fetch(`/api/wc/chat?uid=${encodeURIComponent(getOrCreateUid())}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (Array.isArray(body?.thread) && body.thread.length > 0) {
            setMessages(body.thread);
            saveThread(body.thread);
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput("");
    const history = messages.map(({ role, text }) => ({ role, text }));
    const withUser: ChatMsg[] = [...messages, { role: "user", text: message }];
    setMessages([...withUser, { role: "model", text: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/wc/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, squad, uid: getOrCreateUid() }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let citations: ChatMsg["citations"];

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const line = evt.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "delta") {
              reply += data.text;
              setMessages([...withUser, { role: "model", text: reply }]);
            } else if (data.type === "done") {
              citations = data.citations;
            } else if (data.type === "error") {
              throw new Error(data.message);
            }
          } catch (err) {
            if (err instanceof SyntaxError) continue;
            throw err;
          }
        }
      }
      const final: ChatMsg[] = [...withUser, { role: "model", text: reply || "(no reply)", citations }];
      setMessages(final);
      saveThread(final);
    } catch (err) {
      const final: ChatMsg[] = [
        ...withUser,
        { role: "model", text: `⚠ ${err instanceof Error ? err.message : "Something went wrong"}` },
      ];
      setMessages(final);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex h-[70vh] flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="font-display text-sm font-bold uppercase">Fantasy co-pilot</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setMessages([]);
            saveThread([]);
            fetch(`/api/wc/chat?uid=${encodeURIComponent(getOrCreateUid())}`, { method: "DELETE" }).catch(() => {});
          }}
          disabled={messages.length === 0}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="space-y-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Ask anything — answers use your squad, the live round state, and fresh web search.
            </p>
            <div className="mx-auto flex max-w-sm flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-lg border bg-background px-3 py-1.5 text-left text-xs text-muted-foreground hover:border-fut-gold/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                m.role === "user" ? "bg-fut-gold/15 text-foreground" : "bg-muted/60",
              )}
            >
              {m.text || (streaming && i === messages.length - 1 ? "…" : "")}
              {m.citations && m.citations.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-border/50 pt-1.5">
                  {m.citations.slice(0, 4).map((c, j) => (
                    <a
                      key={j}
                      href={c.uri}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 truncate text-[10px] text-fut-gold hover:underline"
                    >
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      {c.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={streaming ? "Thinking…" : "Ask your co-pilot…"}
          disabled={streaming}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        />
        <Button type="submit" size="sm" disabled={streaming || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
