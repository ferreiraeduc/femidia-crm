"use client";

import { useState, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Broadcast {
  id: string;
  name: string;
  message_text: string;
  message_variants: string[] | null;
  channel_session_ids: string[] | null;
  status: "draft" | "running" | "paused" | "completed" | "failed";
  total_contacts: number;
  sent_count: number;
  failed_count: number;
  answered_count: number;
  daily_limit: number;
  throttle_min_ms: number;
  throttle_max_ms: number;
  sent_today: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface Channel {
  id: string;
  phone_number?: string;
  display_name?: string;
  status?: string;
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
    const rawLine = lines[i];
    if (!rawLine) continue;
    const line = rawLine.trim();
    const parts = line.split(/[;,]/);
    let phone = "";

    const firstCol = parts[0];
    if (i === 0 && firstCol && /[a-zA-ZÀ-ÿ]/.test(firstCol)) continue;

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
      results.push({ phone_number: phone, line: i + 1, valid: false, error: "Telefone muito curto" });
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
  const [variants, setVariants] = useState<string[]>([""]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [csvText, setCsvText] = useState("");
  const [parsedContacts, setParsedContacts] = useState<ParsedContact[]>([]);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [throttleMin, setThrottleMin] = useState(8);
  const [throttleMax, setThrottleMax] = useState(20);

  // Listar broadcasts
  const { data: broadcasts, isLoading: loadingList } = useQuery({
    queryKey: ["broadcasts"],
    queryFn: async (): Promise<Broadcast[]> => {
      const res = await fetch("/api/v1/bulk-broadcasts");
      const json = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 10000, // Atualiza a cada 10s (progresso em tempo real)
  });

  // Listar canais WhatsApp
  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async (): Promise<Channel[]> => {
      const res = await fetch("/api/v1/channel-sessions");
      const json = await res.json();
      return json.data ?? [];
    },
  });

  // Criar broadcast
  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      message_text: string;
      message_variants: string[];
      channel_session_id: string;
      channel_session_ids: string[];
      contacts: { phone_number: string }[];
      daily_limit: number;
      throttle_min_ms: number;
      throttle_max_ms: number;
    }) => {
      const res = await fetch("/api/v1/bulk-broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "Erro ao criar");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Campanha criada! Clique em Iniciar quando estiver pronto.");
      queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
      setStep("list");
      resetForm();
    },
  });

  // Iniciar
  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/bulk-broadcasts/${id}/start`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error?.message ?? "Erro ao iniciar");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Disparo iniciado!");
      queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });

  // Pausar
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
      setParsedContacts(parseCSV(text));
    };
    reader.readAsText(file);
  }, []);

  const resetForm = () => {
    setName("");
    setVariants([""]);
    setSelectedChannels([]);
    setCsvText("");
    setParsedContacts([]);
    setDailyLimit(100);
    setThrottleMin(8);
    setThrottleMax(20);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const validContacts = parsedContacts.filter((c) => c.valid);
  const invalidContacts = parsedContacts.filter((c) => !c.valid);
  const nonEmptyVariants = variants.filter((v) => v.trim().length > 0);

  const handleCreate = () => {
    if (!name.trim()) return toast.error("Dê um nome à campanha");
    if (nonEmptyVariants.length === 0) return toast.error("Escreva pelo menos uma variação de mensagem");
    if (selectedChannels.length === 0) return toast.error("Selecione pelo menos um número de disparo");
    if (validContacts.length === 0) return toast.error("Nenhum contato válido no CSV");

    createMutation.mutate({
      name: name.trim(),
      message_text: nonEmptyVariants[0]!, // primeira variação como fallback
      message_variants: nonEmptyVariants,
      channel_session_id: selectedChannels[0]!, // primeiro canal como fallback
      channel_session_ids: selectedChannels,
      contacts: validContacts.map((c) => ({ phone_number: c.phone_number })),
      daily_limit: dailyLimit,
      throttle_min_ms: throttleMin * 1000,
      throttle_max_ms: throttleMax * 1000,
    });
  };

  const toggleChannel = (id: string) => {
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "draft": return "bg-slate-100 text-slate-700";
      case "running": return "bg-emerald-100 text-emerald-700 animate-pulse";
      case "paused": return "bg-yellow-100 text-yellow-700";
      case "completed": return "bg-blue-100 text-blue-700";
      case "failed": return "bg-red-100 text-red-700";
      default: return "bg-slate-100 text-slate-600";
    }
  };

  const statusLabel = (s: string) => {
    switch (s) {
      case "draft": return "Rascunho";
      case "running": return "⚡ Enviando";
      case "paused": return "⏸ Pausado";
      case "completed": return "✓ Concluído";
      case "failed": return "✗ Falhou";
      default: return s;
    }
  };

  // ── TELA DE CRIAÇÃO ──────────────────────────────────────────────────────

  if (step === "create") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <button onClick={() => { setStep("list"); resetForm(); }} className="mb-4 text-sm text-slate-500 hover:text-slate-700">
          ← Voltar
        </button>

        <h1 className="text-2xl font-bold mb-2">Nova campanha de disparo</h1>
        <p className="text-sm text-slate-500 mb-6">Configure o spinning de copy, rotação de números e timer.</p>

        {/* Nome */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Nome da campanha</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Prospecção Clínicas - Agosto 2026"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        {/* Variações de mensagem (spinning) */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            Variações de mensagem ({nonEmptyVariants.length} ativa{nonEmptyVariants.length !== 1 ? "s" : ""})
            <span className="ml-2 font-normal text-slate-400">O sistema sorteia uma diferente pra cada lead</span>
          </label>
          {variants.map((v, i) => (
            <div key={i} className="mb-3 relative">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-slate-500">Variação {i + 1}</span>
                {variants.length > 1 && (
                  <button onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}
                    className="text-xs text-red-400 hover:text-red-600">remover</button>
                )}
              </div>
              <textarea value={v} onChange={(e) => { const nv = [...variants]; nv[i] = e.target.value; setVariants(nv); }}
                rows={4} placeholder="Ex: Oi, tudo bem? Aqui é o Ruan da Femidia IA..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          ))}
          <button onClick={() => setVariants([...variants, ""])}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
            + Adicionar variação
          </button>
        </div>

        {/* Números de disparo (rotação) */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            Números de disparo ({selectedChannels.length} selecionado{selectedChannels.length !== 1 ? "s" : ""})
            <span className="ml-2 font-normal text-slate-400">O sistema alterna entre eles automaticamente</span>
          </label>
          <div className="space-y-2">
            {channels?.map((ch) => (
              <label key={ch.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedChannels.includes(ch.id) ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300"}`}>
                <input type="checkbox" checked={selectedChannels.includes(ch.id)}
                  onChange={() => toggleChannel(ch.id)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <div>
                  <div className="text-sm font-medium">{ch.display_name ?? ch.phone_number ?? ch.id}</div>
                  {ch.phone_number && ch.display_name && (
                    <div className="text-xs text-slate-500">{ch.phone_number}</div>
                  )}
                </div>
                {ch.status === "WORKING" && <span className="ml-auto text-xs text-emerald-600">● Online</span>}
              </label>
            ))}
          </div>
          {(!channels || channels.length === 0) && (
            <p className="text-sm text-slate-500 mt-2">Nenhum canal conectado. Vá em Canais → WhatsApp pra conectar um número.</p>
          )}
        </div>

        {/* Configuração de ritmo */}
        <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-medium text-sm mb-3">⚙ Ritmo de envio (anti-ban)</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Limite diário</label>
              <input type="number" value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))}
                min={10} max={1000}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
              <p className="text-xs text-slate-400 mt-1">{Math.ceil(validContacts.length / dailyLimit)} dias pra terminar</p>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Timer mín (seg)</label>
              <input type="number" value={throttleMin} onChange={(e) => setThrottleMin(Number(e.target.value))}
                min={5} max={60}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Timer máx (seg)</label>
              <input type="number" value={throttleMax} onChange={(e) => setThrottleMax(Number(e.target.value))}
                min={10} max={120}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
          </div>
        </div>

        {/* CSV */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Lista de contatos (CSV)</label>
          <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleFileUpload}
            className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100" />
        </div>

        {/* Preview */}
        {parsedContacts.length > 0 && (
          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex gap-4 text-sm mb-2">
              <span className="text-emerald-600 font-medium">✓ {validContacts.length} válidos</span>
              {invalidContacts.length > 0 && <span className="text-red-600">✗ {invalidContacts.length} inválidos</span>}
            </div>
            <div className="text-xs text-slate-500">
              Com {selectedChannels.length} número{selectedChannels.length !== 1 ? "s" : ""} e limite de {dailyLimit}/dia → {" "}
              <strong>~{Math.ceil(validContacts.length / dailyLimit)} dias</strong> pra concluir
            </div>
          </div>
        )}

        {/* Botões */}
        <div className="flex gap-3">
          <button onClick={handleCreate} disabled={createMutation.isPending || validContacts.length === 0}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {createMutation.isPending ? "Criando…" : `Criar campanha (${validContacts.length} contatos)`}
          </button>
          <button onClick={() => { setStep("list"); resetForm(); }}
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ── TELA DE LISTAGEM + MÉTRICAS ──────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Disparo em massa</h1>
          <p className="text-sm text-slate-500">Spinning de copy + rotação de números + timer randômico anti-ban.</p>
        </div>
        <button onClick={() => setStep("create")}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          + Nova campanha
        </button>
      </div>

      {loadingList ? (
        <div className="text-center py-12 text-slate-400">Carregando…</div>
      ) : !broadcasts || broadcasts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500 mb-3">Nenhuma campanha ainda.</p>
          <button onClick={() => setStep("create")} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            Criar primeira campanha →
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {broadcasts.map((bc) => {
            const responseRate = bc.sent_count > 0 ? ((bc.answered_count / bc.sent_count) * 100).toFixed(1) : "0.0";
            const progress = bc.total_contacts > 0 ? ((bc.sent_count / bc.total_contacts) * 100).toFixed(0) : "0";

            return (
              <div key={bc.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">{bc.name}</h3>
                    <p className="text-xs text-slate-500">
                      Criado em {new Date(bc.created_at).toLocaleDateString("pt-BR")}
                      {bc.started_at && ` · Iniciado ${new Date(bc.started_at).toLocaleDateString("pt-BR")}`}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusColor(bc.status)}`}>
                    {statusLabel(bc.status)}
                  </span>
                </div>

                {/* Barra de progresso */}
                <div className="w-full bg-slate-100 rounded-full h-2 mb-4">
                  <div className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }} />
                </div>

                {/* Métricas */}
                <div className="grid grid-cols-5 gap-3 text-center mb-4">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <div className="text-lg font-bold text-slate-800">{bc.total_contacts}</div>
                    <div className="text-xs text-slate-500">Total</div>
                  </div>
                  <div className="rounded-lg bg-emerald-50 p-2">
                    <div className="text-lg font-bold text-emerald-700">{bc.sent_count}</div>
                    <div className="text-xs text-slate-500">Enviados</div>
                  </div>
                  <div className="rounded-lg bg-blue-50 p-2">
                    <div className="text-lg font-bold text-blue-700">{bc.answered_count}</div>
                    <div className="text-xs text-slate-500">Responderam</div>
                  </div>
                  <div className="rounded-lg bg-purple-50 p-2">
                    <div className="text-lg font-bold text-purple-700">{responseRate}%</div>
                    <div className="text-xs text-slate-500">Taxa resposta</div>
                  </div>
                  <div className="rounded-lg bg-red-50 p-2">
                    <div className="text-lg font-bold text-red-600">{bc.failed_count}</div>
                    <div className="text-xs text-slate-500">Falhas</div>
                  </div>
                </div>

                {/* Info de ritmo */}
                <div className="text-xs text-slate-400 mb-3">
                  {bc.sent_today ?? 0}/{bc.daily_limit ?? 100} hoje ·{" "}
                  Timer {(bc.throttle_min_ms ?? 8000) / 1000}–{(bc.throttle_max_ms ?? 20000) / 1000}s ·{" "}
                  {(bc.message_variants as string[] | null)?.length ?? 1} variações ·{" "}
                  {(bc.channel_session_ids as string[] | null)?.length ?? 1} números
                </div>

                {/* Ações */}
                <div className="flex gap-2">
                  {(bc.status === "draft" || bc.status === "paused") && (
                    <button onClick={() => startMutation.mutate(bc.id)} disabled={startMutation.isPending}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      ▶ {bc.status === "paused" ? "Retomar" : "Iniciar disparo"}
                    </button>
                  )}
                  {bc.status === "running" && (
                    <button onClick={() => pauseMutation.mutate(bc.id)} disabled={pauseMutation.isPending}
                      className="rounded-lg bg-yellow-500 px-4 py-2 text-xs font-medium text-white hover:bg-yellow-600 disabled:opacity-50">
                      ⏸ Pausar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
