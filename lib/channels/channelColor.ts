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
  { bg: "bg-blue-600", border: "border-blue-700", text: "text-white" },
  { bg: "bg-emerald-600", border: "border-emerald-700", text: "text-white" },
  { bg: "bg-violet-600", border: "border-violet-700", text: "text-white" },
  { bg: "bg-amber-600", border: "border-amber-700", text: "text-white" },
  { bg: "bg-rose-600", border: "border-rose-700", text: "text-white" },
  { bg: "bg-cyan-600", border: "border-cyan-700", text: "text-white" },
  { bg: "bg-indigo-600", border: "border-indigo-700", text: "text-white" },
  { bg: "bg-teal-600", border: "border-teal-700", text: "text-white" },
];

const FALLBACK: ChannelColor = {
  bg: "bg-slate-600",
  border: "border-slate-700",
  text: "text-white",
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
