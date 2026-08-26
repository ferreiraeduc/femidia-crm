"use client";

import { useState, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Broadcast {
  id: string;
  name: string;
  message_text: string;
  status: "draft" | "running" | "paused" | "completed" | "failed";
  total_contacts: number;
  sent_count: number;
  failed_count: number;
  answered_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface ParsedContact {
  phone_number: string;
  line: number;
  valid: boolean;
  error?: string;
}

function parseCSV(text: string): ParsedContact[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const results: ParsedContact[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // Tenta extrair telefone de diferentes formatos:
    // só número, CSV com header, "nome;telefone", etc.
    const parts = line.split(/[;,]/);
    let phone = "";

    // Se tem header (primeira linha contém texto), pula
    if (i === 0 && parts[0] && /[a-zA-ZÀ-ÿ]/.test(parts[0])) continue;

    // Procura por algo que pareça telefone em qualquer coluna
    for (const part of parts) {
      const cleaned = part.replace(/\D/g, "");
      if (cleaned.length >= 8 && cleaned.length <= 15) {
        phone = cleaned;
        break;
      }
    }

    if (!phone) {
      results.push({ phone_number: "", line: i + 1, valid: false, error: "Telefone não encontrado" });
    } else if (phone.length < 10) {
      results.push({ phone_number: phone, line: i + 1, valid: false, error: "Telefone muito curto (mínimo 10 dígitos com DDD)" });
    } else {
      results.push({ phone_number: phone, line: i + 1, valid: true });
    }
  }

  return results;
}

export function BroadcastClient() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"list" | "create">("list");
  const [name, setName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [parsedContacts, setParsedContacts] = useState<ParsedContact[]>([]);

  // Listar broadcasts
  const { data: broadcasts, isLoading: loadingList } = useQuery({
    queryKey: ["broadcasts"],
    queryFn: async (): Promise<Broadcast[]> => {
      const res = await fetch("/api/v1/bulk-broadcasts");
      const json = await res.json();
      return json.data ?? [];
    },
  });

  // Listar canais WhatsApp
  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await fetch("/api/v1/channels");
      const json = await res.json();
      return json.data ?? [];
    },
  });

  // Criar broadcast
  const createMutation = useMutation({
    mutationFn: async (data: { name: string; message_text: string; channel_session_id: string; contacts: { phone_number: string }[] }) => {
      const res = await fetch("/api/v1/bulk-broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "Erro ao criar");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Campanha criada!");
      queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
      setStep("list");
      resetForm();
    },
  });

  // Iniciar broadcast
  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/bulk-broadcasts/${id}/start`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "Erro ao iniciar");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Disparo iniciado! As mensagens estão sendo enviadas.");
      queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });

  // Pausar broadcast
  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/bulk-broadcasts/${id}/pause`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "Erro ao pausar");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Campanha pausada.");
      queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      const parsed = parseCSV(text);
      setParsedContacts(parsed);
    };
    reader.readAsText(file);
  }, []);

  const resetForm = () => {
    setName("");
    setMessageText("");
    setSessionId("");
    setCsvText("");
    setParsedContacts([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const validContacts = parsedContacts.filter((c) => c.valid);
  const invalidContacts = parsedContacts.filter((c) => !c.valid);

  const handleCreate = () => {
    if (!name.trim()) return toast.error("Dê um nome à campanha");
    if (!messageText.trim()) return toast.error("Escreva a mensagem");
    if (!sessionId) return toast.error("Selecione o canal WhatsApp");
    if (validContacts.length === 0) return toast.error("Nenhum contato válido no CSV");

    createMutation.mutate({
      name: name.trim(),
      message_text: messageText.trim(),
      channel_session_id: sessionId,
      contacts: validContacts.map((c) => ({ phone_number: c.phone_number })),
    });
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "draft": return "bg-slate-100 text-slate-700";
      case "running": return "bg-emerald-100 text-emerald-700";
      case "paused": return "bg-yellow-100 text-yellow-700";
      case "completed": return "bg-blue-100 text-blue-700";
      case "failed": return "bg-red-100 text-red-700";
      default: return "bg-slate-100 text-slate-600";
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case "draft": return "Rascunho";
      case "running": return "Enviando";
      case "paused": return "Pausado";
      case "completed": return "Concluído";
      case "failed": return "Falhou";
      default: return s;
    }
  };

  // ── TELA DE CRIAÇÃO ──────────────────────────────────────────────────────

  if (step === "create") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <button
          onClick={() => { setStep("list"); resetForm(); }}
          className="mb-4 text-sm text-slate-500 hover:text-slate-700"
        >
          ← Voltar
        </button>

        <h1 className="text-2xl font-bold mb-6">Nova campanha de disparo</h1>

        {/* 1. Nome */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Nome da campanha</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Divulgação IA - Agosto 2026"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* 2. Canal WhatsApp */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Canal de envio (número WhatsApp)</label>
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Selecione um canal…</option>
            {channels?.map((ch: { id: string; phone_number?: string; display_name?: string }) => (
              <option key={ch.id} value={ch.id}>
                {ch.display_name ?? ch.phone_number ?? ch.id}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Mensagem */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Mensagem a enviar</label>
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            rows={6}
            placeholder="Ex: Olá! Estamos testando uma IA que atende no WhatsApp. Quer experimentar? Basta mandar um oi aqui que o assistente vai te atender! 😊"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-slate-500">{messageText.length}/4096 caracteres</p>
        </div>

        {/* 4. CSV */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            Lista de contatos (CSV)
            <span className="ml-2 font-normal text-slate-400">Uma coluna com telefone por linha</span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            onChange={handleFileUpload}
            className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </div>

        {/* Preview dos contatos */}
        {parsedContacts.length > 0 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="font-medium mb-2">Preview da importação</h3>
            <div className="flex gap-4 text-sm mb-3">
              <span className="text-emerald-600">✓ {validContacts.length} válidos</span>
              {invalidContacts.length > 0 && (
                <span className="text-red-600">✗ {invalidContacts.length} inválidos</span>
              )}
            </div>
            {invalidContacts.length > 0 && (
              <div className="text-xs text-red-500 max-h-24 overflow-y-auto">
                {invalidContacts.slice(0, 10).map((c, i) => (
                  <div key={i}>Linha {c.line}: {c.error}</div>
                ))}
                {invalidContacts.length > 10 && <div>…e mais {invalidContacts.length - 10}</div>}
              </div>
            )}
          </div>
        )}

        {/* Botões */}
        <div className="flex gap-3">
          <button
            onClick={handleCreate}
            disabled={createMutation.isPending || validContacts.length === 0}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Criando…" : `Criar campanha (${validContacts.length} contatos)`}
          </button>
          <button
            onClick={() => { setStep("list"); resetForm(); }}
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ── TELA DE LISTAGEM ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Disparo em massa</h1>
          <p className="text-sm text-slate-500">Envie mensagens WhatsApp para listas de contatos com throttle anti-ban.</p>
        </div>
        <button
          onClick={() => setStep("create")}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Nova campanha
        </button>
      </div>

      {loadingList ? (
        <div className="text-center py-12 text-slate-400">Carregando…</div>
      ) : !broadcasts || broadcasts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500 mb-3">Nenhuma campanha ainda.</p>
          <button
            onClick={() => setStep("create")}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Criar primeira campanha →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {broadcasts.map((bc) => (
            <div key={bc.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">{bc.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {bc.total_contacts} contatos · Criado em {new Date(bc.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusColor(bc.status)}`}>
                  {statusLabel(bc.status)}
                </span>
              </div>

              {/* Barras de progresso */}
              <div className="mt-3 grid grid-cols-4 gap-4 text-center text-xs">
                <div>
                  <div className="font-bold text-slate-800">{bc.sent_count}</div>
                  <div className="text-slate-500">Enviados</div>
                </div>
                <div>
                  <div className="font-bold text-emerald-600">{bc.answered_count}</div>
                  <div className="text-slate-500">Responderam</div>
                </div>
                <div>
                  <div className="font-bold text-red-600">{bc.failed_count}</div>
                  <div className="text-slate-500">Falhas</div>
                </div>
                <div>
                  <div className="font-bold text-slate-600">{bc.total_contacts - bc.sent_count - bc.failed_count}</div>
                  <div className="text-slate-500">Pendentes</div>
                </div>
              </div>

              {/* Ações */}
              <div className="mt-3 flex gap-2">
                {bc.status === "draft" && (
                  <button
                    onClick={() => startMutation.mutate(bc.id)}
                    disabled={startMutation.isPending}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    ▶ Iniciar disparo
                  </button>
                )}
                {bc.status === "running" && (
                  <button
                    onClick={() => pauseMutation.mutate(bc.id)}
                    disabled={pauseMutation.isPending}
                    className="rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-600 disabled:opacity-50"
                  >
                    ⏸ Pausar
                  </button>
                )}
                {bc.status === "paused" && (
                  <button
                    onClick={() => startMutation.mutate(bc.id)}
                    disabled={startMutation.isPending}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    ▶ Retomar
                  </button>
                )}
              </div>

              {/* Preview da mensagem */}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                  Ver mensagem
                </summary>
                <p className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-600 whitespace-pre-wrap">
                  {bc.message_text}
                </p>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
