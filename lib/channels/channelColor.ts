/**
 * Cor determinística por canal.
 *
 * Mesma chave (channel id) → mesma cor, em TODA renderização e em TODO cliente.
 * Hash simples (djb2) sobre o id e módulo sobre o tamanho da paleta — não precisa
 * de crypto porque o objetivo é só espalhar visualmente, não esconder nada.
 *
 * A paleta foi escolhida para ler bem no tema claro E escuro do produto: cada
 * cor tem fundo claro suficiente pro badge vazado e borda saturada pra ler
 * rápido qual canal.
 *
 * Como aplicar:
 *   const { bg, border, text } = channelColor(channel.id);
 *   <span className={cn("rounded border", bg, border, text)}>...</span>
 */
export interface ChannelColor {
  /** Fundo do badge (transparente na saturação). */
  bg: string;
  /** Cor da borda (saturada, identifica o canal). */
  border: string;
  /** Cor do texto dentro do badge. */
  text: string;
}

const PALETTE: ChannelColor[] = [
  { bg: "bg-blue-50", border: "border-blue-500", text: "text-blue-700" },
  { bg: "bg-emerald-50", border: "border-emerald-500", text: "text-emerald-700" },
  { bg: "bg-violet-50", border: "border-violet-500", text: "text-violet-700" },
  { bg: "bg-amber-50", border: "border-amber-500", text: "text-amber-700" },
  { bg: "bg-rose-50", border: "border-rose-500", text: "text-rose-700" },
  { bg: "bg-cyan-50", border: "border-cyan-500", text: "text-cyan-700" },
  { bg: "bg-indigo-50", border: "border-indigo-500", text: "text-indigo-700" },
  { bg: "bg-teal-50", border: "border-teal-500", text: "text-teal-700" },
];

const FALLBACK: ChannelColor = {
  bg: "bg-slate-50",
  border: "border-slate-400",
  text: "text-slate-700",
};

export function channelColor(channelId: string | null | undefined): ChannelColor {
  if (!channelId) return FALLBACK;
  // djb2 — curto, sem dependência, distribui bem para ids curtos.
  let hash = 5381;
  for (let i = 0; i < channelId.length; i++) {
    hash = ((hash << 5) + hash + channelId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx] ?? FALLBACK;
}
