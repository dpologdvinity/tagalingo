/** Shared frame for the login and sign-up screens. */
import Link from "next/link";
import { Logo } from "@/components/tala";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-8">
      <Link href="/" className="self-start" aria-label="Tagalingo home">
        <Logo />
      </Link>
      <div className="flex flex-1 flex-col justify-center py-10">{children}</div>
    </main>
  );
}
