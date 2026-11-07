"use client";
/**
 * Chat with Tala: type in Tagalog, get a reply with audio and a translation you can reveal,
 * plus a gentle correction and a suggested next line.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { chatAction } from "@/app/actions/chat";
import { CHAT_LIMITS } from "@/lib/chat/history";
import type { ChatReply, ChatTurn } from "@/lib/chat/tutor";
import { SpeakButton } from "@/components/speak-button";
import { Tala } from "@/components/tala";
import { Button } from "@/components/ui";

type Message = ChatTurn & { reply?: ChatReply; correction?: string };

const OPENING: Message = {
  role: "tala",
  text: "Kumusta! Ako si Tala. Ano ang pangalan mo?",
  reply: {
    text: "Kumusta! Ako si Tala. Ano ang pangalan mo?",
    translation: "Hi! I'm Tala. What's your name?",
    hint: "Ako si …",
  },
};

function TalaBubble({ reply }: { reply: ChatReply }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex items-end gap-2">
      <Tala size={36} />
      <div className="max-w-[85%] rounded-3xl rounded-bl-md border-2 border-line bg-surface px-4 py-3">
        <p lang="tl" className="flex flex-wrap items-center gap-2 text-lg font-bold">
          {reply.text} <SpeakButton text={reply.text} size="sm" />
        </p>
        {shown ? (
          <p className="text-ink-soft">{reply.translation}</p>
        ) : (
          <button type="button" onClick={() => setShown(true)} className="text-sm font-bold text-lagoon underline">
            Show translation
          </button>
        )}
      </div>
    </div>
  );
}

export function ChatRoom() {
  const [messages, setMessages] = useState<Message[]>([OPENING]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const lastHint = [...messages].reverse().find((m) => m.reply?.hint)?.reply?.hint;

  // Block body on purpose: scrollIntoView() returns a Promise in newer browsers, and an effect
  // must return nothing (or a cleanup function).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  const send = (text: string) => {
    const clean = text.trim().slice(0, CHAT_LIMITS.learnerChars);
    if (!clean || pending) return;
    const next: Message[] = [...messages, { role: "learner", text: clean }];
    setMessages(next);
    setDraft("");
    setError(null);
    start(async () => {
      // Only recent turns matter to Tala, and sending fewer keeps long chats working.
      const recent = next.slice(-CHAT_LIMITS.contextTurns).map(({ role, text: t }) => ({ role, text: t }));
      const r = await chatAction(recent);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setMessages((cur) => {
        const copy = [...cur];
        // Attach any correction to the learner's message it refers to.
        if (r.reply.correction) copy[copy.length - 1] = { ...copy[copy.length - 1], correction: r.reply.correction };
        return [...copy, { role: "tala", text: r.reply.text, reply: r.reply }];
      });
    });
  };

  return (
    <div className="flex min-h-[60vh] flex-col rounded-3xl border-2 border-line bg-seaglass">
      <ol className="flex-1 space-y-4 p-4" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i}>
            {m.role === "tala" && m.reply ? (
              <TalaBubble reply={m.reply} />
            ) : (
              <div className="flex flex-col items-end gap-1">
                <p
                  lang="tl"
                  className="max-w-[85%] rounded-3xl rounded-br-md bg-lagoon-bright px-4 py-3 text-lg font-bold text-white"
                >
                  {m.text}
                </p>
                {m.correction && (
                  <p className="max-w-[85%] rounded-2xl bg-mango-soft px-3 py-2 text-sm">
                    <strong>Tip:</strong> {m.correction}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
        {pending && (
          <li className="flex items-end gap-2 text-ink-soft">
            <Tala size={36} mood="sleepy" /> Tala is typing…
          </li>
        )}
      </ol>
      <div ref={endRef} />
      {error && (
        <p role="alert" className="mx-4 mb-2 rounded-2xl bg-gumamela-soft px-4 py-2 font-bold text-gumamela">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="space-y-2 border-t-2 border-line bg-surface p-3"
      >
        {lastHint && (
          <button
            type="button"
            onClick={() => (lastHint.includes("…") ? setDraft(lastHint.replace("…", "")) : send(lastHint))}
            className="rounded-full border-2 border-line px-3 py-1 text-sm font-bold text-lagoon"
          >
            Try: <span lang="tl">{lastHint}</span>
          </button>
        )}
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="sr-only">Message in Tagalog</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={CHAT_LIMITS.learnerChars}
              lang="tl"
              autoComplete="off"
              placeholder="Type in Tagalog…"
              className="w-full rounded-2xl border-2 border-line px-4 py-3 outline-none focus:border-lagoon-bright"
            />
          </label>
          <Button type="submit" disabled={!draft.trim() || pending}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
