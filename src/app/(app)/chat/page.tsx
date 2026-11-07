import type { Metadata } from "next";
import { selectChatTutor } from "@/lib/chat/tutor";
import { requireUser } from "@/server/session";
import { ChatRoom } from "./chat-room";

export const metadata: Metadata = { title: "Chat with Tala" };

export default async function ChatPage() {
  await requireUser();
  const offline = selectChatTutor().name === "stub";
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-4xl">Chat with Tala</h1>
        <p className="mt-1 text-ink-soft">
          Practise a real conversation. Write in Tagalog; Tala answers, reads her replies aloud and points out small
          mistakes.
          {offline && " (Offline mode: Tala knows the basics, like greetings, names, food and goodbyes.)"}
        </p>
      </header>
      <ChatRoom />
    </div>
  );
}
