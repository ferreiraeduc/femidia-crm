/**
 * POST /api/v1/cron/broadcast-dispatcher — Cron 1×/min.
 *
 * Processa broadcasts ativos com:
 * - Spinning de copy (sorteia variação pra cada lead)
 * - Rotação de números (alterna entre canais a cada envio)
 * - Timer randômico (8-20s padrão, configurável)
 * - Limite diário (respeita daily_limit, reseta à meia-noite)
 * - AQUECIMENTO (warm-up) por idade do chip: cada canal tem um teto de envios/dia
 *   calculado pela sua idade (number_activated_at + degraus 20→50→100→200→livre).
 *   O daily_limit da campanha é teto ADICIONAL — nunca supera o warm-up. Canal que
 *   bateu seu cap de hoje sai da rotação até a meia-noite local.
 *
 * Auth: INTERNAL_CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";
import { resolveWahaChatId } from "@/lib/waha/send";
import { warmupCapFor } from "@/lib/agent-engine/pacing/engine";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/**
 * Teto de warm-up de HOJE para um chip, pela idade do número.
 * Reusa `warmupCapFor` (fonte única da regra) — não duplicamos os degraus aqui.
 * Sem `number_activated_at` conhecido → idade 0 (o degrau mais conservador).
 * `null` do warmupCapFor = número formado (sem cap de warm-up).
 */
function warmupCapForChannel(
  numberActivatedAt: string | null,
  warmupSteps: { minAgeDays: number; cap: number | null }[],
): number {
  const activated = numberActivatedAt ? new Date(numberActivatedAt) : null;
  const ageDays = activated
    ? Math.max(0, Math.floor((Date.now() - activated.getTime()) / DAY_MS))
    : 0;
  const cap = warmupCapFor(ageDays, warmupSteps);
  return cap ?? Number.POSITIVE_INFINITY;
}

function verifyCronSecret(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  return accepted.length > 0 && accepted.includes(token);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const waha = getWahaClient();

  if (!waha) {
    return NextResponse.json({ skipped: true, reason: "waha_not_configured" });
  }

  // 1. Buscar broadcasts ativos
  const { data: broadcasts } = await admin
    .from("bulk_broadcasts")
    .select("*")
    .eq("status", "running")
    .limit(3);

  if (!broadcasts || broadcasts.length === 0) {
    return NextResponse.json({ processed: 0, reason: "no_active_broadcasts" });
  }

  let totalSent = 0;
  let totalFailed = 0;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  for (const bc of broadcasts) {
    // Resetar contagem diária se mudou o dia
    if (bc.last_send_date !== today) {
      await admin
        .from("bulk_broadcasts")
        .update({ sent_today: 0, last_send_date: today })
        .eq("id", bc.id);
      bc.sent_today = 0;
    }

    // Checar limite diário
    const dailyLimit = bc.daily_limit ?? 100;
    if (bc.sent_today >= dailyLimit) {
      continue; // Limite atingido hoje, pula pro próximo broadcast
    }

    const remaining = dailyLimit - (bc.sent_today ?? 0);

    // Variações de mensagem (spinning)
    const variants: string[] = bc.message_variants && (bc.message_variants as string[]).length > 0
      ? (bc.message_variants as string[])
      : [bc.message_text]; // fallback pra mensagem única

    // Canais pra rotação
    const channelIds: string[] = bc.channel_session_ids && (bc.channel_session_ids as string[]).length > 0
      ? (bc.channel_session_ids as string[])
      : [bc.channel_session_id]; // fallback pra canal único

    // Resolver session names + knobs de warm-up dos canais
    const { data: channels } = await admin
      .from("channel_sessions")
      .select("id, waha_session_name")
      .in("id", channelIds);

    if (!channels || channels.length === 0) continue;

    // Buscar number_activated_at dos channel_knobs (pra warm-up por chip)
    const { data: knobRows } = await admin
      .from("channel_knobs")
      .select("channel_session_id, number_activated_at, warmup_daily_caps")
      .in("channel_session_id", channelIds);

    const knobMap = new Map(
      (knobRows ?? []).map((k) => [k.channel_session_id, k]),
    );

    // Contar quantos cada canal JÁ mandou hoje (broadcast + qualquer outro envio não conta —
    // o warm-up do broadcast é independente, mas como esses chips são exclusivos de disparo,
    // contamos só os envios de broadcast deste canal hoje)
    const { data: sentTodayRows } = await admin
      .from("bulk_broadcast_contacts")
      .select("sent_by_channel_id")
      .eq("status", "sent")
      .in("sent_by_channel_id", channelIds)
      .gte("sent_at", `${today}T00:00:00.000Z`);

    const channelSentToday = new Map<string, number>();
    for (const row of sentTodayRows ?? []) {
      if (row.sent_by_channel_id) {
        channelSentToday.set(
          row.sent_by_channel_id,
          (channelSentToday.get(row.sent_by_channel_id) ?? 0) + 1,
        );
      }
    }

    // Filtrar canais que AINDA têm quota de warm-up (não bateram o teto do dia)
    const warmupSteps = PACING_DEFAULTS.warmupDailyCaps;
    const availableChannels = channels.filter((ch) => {
      const knob = knobMap.get(ch.id);
      const cap = warmupCapForChannel(
        knob?.number_activated_at ?? null,
        (knob?.warmup_daily_caps as { minAgeDays: number; cap: number | null }[] | null) ?? warmupSteps,
      );
      const sent = channelSentToday.get(ch.id) ?? 0;
      return sent < cap;
    });

    if (availableChannels.length === 0) continue; // Todos os chips bateram warm-up, espera amanhã

    // Throttle config
    const throttleMin = bc.throttle_min_ms ?? 8000;
    const throttleMax = bc.throttle_max_ms ?? 20000;

    // Quantos enviar nesta rodada (mínimo entre remaining e batch calculado pelo timer)
    // Com timer de 8-20s, em 55s de cron cabe ~3-6 mensagens
    const batchSize = Math.min(remaining, 6);

    // Buscar contatos pending
    const { data: contacts } = await admin
      .from("bulk_broadcast_contacts")
      .select("id, phone_number")
      .eq("broadcast_id", bc.id)
      .eq("status", "pending")
      .limit(batchSize)
      .order("created_at", { ascending: true });

    if (!contacts || contacts.length === 0) {
      // Todos enviados — marcar como completed
      await admin
        .from("bulk_broadcasts")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", bc.id);
      continue;
    }

    // Cap de warm-up de cada canal disponível (pra não estourar dentro da rodada)
    const channelCap = new Map<string, number>();
    for (const ch of availableChannels) {
      const knob = knobMap.get(ch.id);
      channelCap.set(
        ch.id,
        warmupCapForChannel(
          knob?.number_activated_at ?? null,
          (knob?.warmup_daily_caps as { minAgeDays: number; cap: number | null }[] | null) ?? warmupSteps,
        ),
      );
    }

    // Contador pra rotação de canais (round-robin) — só entre os disponíveis
    let channelIndex = (bc.sent_count ?? 0) % availableChannels.length;

    for (const contact of contacts) {
      // Sortear variação (spinning)
      const variantIdx = randomBetween(0, variants.length - 1);
      const messageText = variants[variantIdx] ?? variants[0];

      // Selecionar próximo canal que ainda tem quota de warm-up (rotação round-robin)
      let channel: (typeof availableChannels)[number] | undefined;
      for (let tries = 0; tries < availableChannels.length; tries++) {
        const candidate = availableChannels[channelIndex % availableChannels.length];
        channelIndex++;
        if (!candidate) continue;
        const cap = channelCap.get(candidate.id) ?? Number.POSITIVE_INFINITY;
        const sent = channelSentToday.get(candidate.id) ?? 0;
        if (sent < cap) {
          channel = candidate;
          break;
        }
      }
      if (!channel) break; // Todos os chips bateram o warm-up nesta rodada

      const chatId = resolveWahaChatId({
        isGroup: false,
        groupChatId: null,
        phoneNumber: contact.phone_number,
        waIdentity: null,
        waLid: null,
      });

      if (!chatId) {
        await admin
          .from("bulk_broadcast_contacts")
          .update({ status: "failed", error_message: "phone_number_invalid" })
          .eq("id", contact.id);
        totalFailed++;
        continue;
      }

      try {
        // Marcar como queued
        await admin
          .from("bulk_broadcast_contacts")
          .update({ status: "queued" })
          .eq("id", contact.id);

        // Enviar via WAHA
        await waha.sendMessage(
          channel.waha_session_name as string,
          chatId,
          messageText as string,
        );

        // Marcar como sent + tracking
        await admin
          .from("bulk_broadcast_contacts")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            variant_index: variantIdx,
            sent_by_channel_id: channel.id,
          })
          .eq("id", contact.id);

        // Contabilizar envio deste chip hoje (pra respeitar warm-up dentro da rodada)
        channelSentToday.set(channel.id, (channelSentToday.get(channel.id) ?? 0) + 1);

        // Incrementar contadores
        await admin
          .from("bulk_broadcasts")
          .update({
            sent_count: (bc.sent_count ?? 0) + totalSent + 1,
            sent_today: (bc.sent_today ?? 0) + totalSent + 1,
          })
          .eq("id", bc.id);

        totalSent++;

        // Timer randômico entre envios
        const waitMs = randomBetween(throttleMin, throttleMax);
        await sleep(waitMs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown_error";
        await admin
          .from("bulk_broadcast_contacts")
          .update({ status: "failed", error_message: msg })
          .eq("id", contact.id);
        totalFailed++;
      }
    }
  }

  return NextResponse.json({ processed: totalSent + totalFailed, sent: totalSent, failed: totalFailed });
}
