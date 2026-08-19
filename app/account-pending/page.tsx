import Link from "next/link";
import { emailDeSuporte } from "@/lib/branding/saida";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata = {
  title: "Conta em análise",
};

export default function AccountPendingPage() {
  const suporte = emailDeSuporte();
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold">Conta em análise</h1>
        <p className="text-sm text-muted-foreground">
          Sua conta foi criada com sucesso e está aguardando aprovação do
          administrador. Você receberá um e-mail assim que o acesso for
          liberado.
        </p>
        {suporte && (
          <p className="text-sm text-muted-foreground">
            Dúvidas? Entre em contato com{" "}
            <a
              href={`mailto:${suporte}`}
              className="underline underline-offset-4 hover:text-foreground transition-colors"
            >
              {suporte}
            </a>
            .
          </p>
        )}
        <div className="pt-2">
          <Button asChild variant="outline">
            <Link href="/login">Voltar ao login</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}
