"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ExternalLink, MessageSquare, Send, Trash2, User } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "model";
  text: string;
  ts: string;
  citations?: Array<{ uri: string; title: string }>;
}

interface ChatThread {
  messages: ChatMessage[];
  updatedAt: string;
}

interface Props {
  teamId: number;
  leagueId: number;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

const SUGGESTIONS = [
  "Should I captain Salah or Haaland?",
  "Is the -4 hit worth it this week?",
  "What's my best differential vs the closest rival?",
  "Which chip should I play next?",
];

// Render plain text with paragraphs + auto-link any URLs. Bold **like this**
// becomes <strong>. No external markdown lib — keeps the bundle small.
function renderText(text: string) {
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((para, i) => (
    <p key={i} className="mb-2 last:mb-0 whitespace-pre-wrap leading-relaxed">
      {renderInline(para)}
    </p>
  ));
}

function renderInline(text: string): React.ReactNode {
  // Split on **bold**, [text](url), and bare URLs.
  const parts: Array<{ kind: "text" | "bold" | "link"; value: string; href?: string }> = [];
  const re = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    if (m[1]) {
      parts.push({ kind: "bold", value: m[1].slice(2, -2) });
    } else if (m[2]) {
      const inner = m[2];
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(inner);
      if (linkMatch) parts.push({ kind: "link", value: linkMatch[1], href: linkMatch[2] });
    } else if (m[3]) {
      parts.push({ kind: "link", value: m[3], href: m[3] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts.map((p, i) => {
    if (p.kind === "bold") return <strong key={i}>{p.value}</strong>;
    if (p.kind === "link") {
      return (
        <a
          key={i}
          href={p.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {p.value}
        </a>
      );
    }
    return <span key={i}>{p.value}</span>;
  });
}

export function ChatPanel({ teamId, leagueId }: Props) {
  const [input, setInput] = useState("");
  const queryClient = useQueryClient();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const threadQuery = useQuery({
    queryKey: ["chat", teamId, leagueId],
    queryFn: () => fetchJson<{ thread: ChatThread }>(`/api/chat?teamId=${teamId}&leagueId=${leagueId}`),
  });

  const sendMutation = useMutation({
    mutationFn: async (message: string) =>
      fetchJson<{ reply: ChatMessage; thread: ChatThread }>(`/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId, leagueId, message }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["chat", teamId, leagueId], { thread: data.thread });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clearMutation = useMutation({
    mutationFn: async () =>
      fetchJson<{ ok: true }>(`/api/chat?teamId=${teamId}&leagueId=${leagueId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.setQueryData(["chat", teamId, leagueId], { thread: { messages: [], updatedAt: new Date().toISOString() } });
      toast.success("Chat cleared");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const messages = threadQuery.data?.thread.messages ?? [];

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sendMutation.isPending]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    setInput("");
    // Optimistic append.
    const optimistic: ChatThread = {
      messages: [...messages, { role: "user", text: trimmed, ts: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    };
    queryClient.setQueryData(["chat", teamId, leagueId], { thread: optimistic });
    sendMutation.mutate(trimmed);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-primary" /> Co-pilot chat
          </CardTitle>
          <CardDescription>
            Ask follow-ups about captain picks, hits, chips, what-ifs. Grounded in your squad + rivals above.
          </CardDescription>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
            className="h-8 px-2 text-xs"
          >
            <Trash2 className="mr-1 h-3 w-3" /> Clear
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          ref={scrollerRef}
          className="max-h-[60vh] min-h-[18rem] space-y-3 overflow-y-auto rounded-md border bg-muted/20 p-3"
        >
          {threadQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : messages.length === 0 ? (
            <EmptyState onPick={submit} />
          ) : (
            messages.map((m, i) => <Bubble key={`${m.ts}-${i}`} msg={m} />)
          )}
          {sendMutation.isPending && (
            <div className="flex items-center gap-2 rounded-md bg-card/80 p-3 text-xs text-muted-foreground">
              <Bot className="h-3.5 w-3.5 animate-pulse text-primary" />
              Thinking…
            </div>
          )}
        </div>

        {sendMutation.error && (
          <Alert variant="destructive">
            <AlertTitle>Chat failed</AlertTitle>
            <AlertDescription>{(sendMutation.error as Error).message}</AlertDescription>
          </Alert>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            placeholder="Ask the co-pilot anything about this team…"
            rows={2}
            disabled={sendMutation.isPending}
            className={cn(
              "flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm shadow-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          />
          <Button type="submit" size="sm" disabled={!input.trim() || sendMutation.isPending}>
            <Send className="h-4 w-4" />
            <span className="ml-1.5 hidden sm:inline">Send</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-500",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-md border px-3 py-2 text-sm shadow-sm",
          isUser ? "bg-primary/5" : "bg-card",
        )}
      >
        {renderText(msg.text)}
        {!isUser && msg.citations && msg.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
            {msg.citations.slice(0, 6).map((c, i) => (
              <a
                key={i}
                href={c.uri}
                target="_blank"
                rel="noopener noreferrer"
                title={c.title}
                className="inline-flex items-center gap-1"
              >
                <Badge variant="outline" className="text-[10px]">
                  <ExternalLink className="mr-1 h-2.5 w-2.5" />
                  {c.title.length > 32 ? c.title.slice(0, 32) + "…" : c.title || "source"}
                </Badge>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Bot className="h-4 w-4 text-emerald-500" />
        Ready when you are. Try one of these:
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-full border bg-card px-3 py-1 text-xs text-foreground hover:bg-muted"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
