/**
 * POST /api/v1/cron/broadcast-dispatcher — Cron 1×/min. Processa lote de contatos
 * pendentes em broadcasts ativos (status = 'running'). Envia uma mensagem de texto
 * via WAHA para cada contato, respeitando throttle (5s/msg — regra de campanha).
 *
 * Lógica:
 *  1. Busca broadcasts com status = 'running'
 *  2. Para cada, pega N contatos com status = 'pending' (batch de 10 por rodada)
 *  3. Para cada contato: resolve chatId, envia via WAHA, marca status
 *  4. Ao terminar todos os pending, marca broadcast como 'completed'
 *
 * Throttle: 1 msg / 5s (regra do CLAUDE.md pra campanha = 12 msgs/min).
 * Uma rodada de cron (1 min) = até 12 msgs. 2.300 contatos ÷ 12 = ~192 minutos (~3h).
 *
 * Auth: INTERNAL_CRON_SECRET (mesmo padrão dos demais crons).
 */
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";
import { resolveWahaChatId } from "@/lib/waha/send";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 12; // 12 msgs/min = throttle de campanha (1 msg/5s)
const THROTTLE_MS = 5000; // 5s entre cada envio (regra anti-ban para campanha)

function verifyCronSecret(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "");
  const expected = env.INTERNAL_CRON_SECRET || env.INTERNAL_SECRET;
  return token === expected;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    .select("id, organization_id, message_text, channel_session_id")
    .eq("status", "running")
    .limit(5); // Processar no máximo 5 campanhas por rodada

  if (!broadcasts || broadcasts.length === 0) {
    return NextResponse.json({ processed: 0, reason: "no_active_broadcasts" });
  }

  let totalSent = 0;
  let totalFailed = 0;

  for (const bc of broadcasts) {
    // 2. Pegar sessão WAHA
    const { data: session } = await admin
      .from("channel_sessions")
      .select("waha_session_name")
      .eq("id", bc.channel_session_id)
      .single();

    if (!session) continue;

    // 3. Pegar batch de contatos pending
    const { data: contacts } = await admin
      .from("bulk_broadcast_contacts")
      .select("id, phone_number")
      .eq("broadcast_id", bc.id)
      .eq("status", "pending")
      .limit(BATCH_SIZE)
      .order("created_at", { ascending: true });

    if (!contacts || contacts.length === 0) {
      // Todos enviados — marcar como completed
      await admin
        .from("bulk_broadcasts")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", bc.id);
      continue;
    }

    // 4. Enviar cada contato com throttle
    for (const contact of contacts) {
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
        // Marcar como sending pra não pegar de novo
        await admin
          .from("bulk_broadcast_contacts")
          .update({ status: "queued" })
          .eq("id", contact.id);

        // Enviar via WAHA
        await waha.sendMessage(session.waha_session_name, chatId, bc.message_text);

        // Marcar como sent
        await admin
          .from("bulk_broadcast_contacts")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", contact.id);

        // Incrementar contador
        await admin.rpc("fn_increment_broadcast_sent", { p_broadcast_id: bc.id });

        totalSent++;

        // Throttle — esperar 5s entre cada envio
        if (totalSent < contacts.length) {
          await sleep(THROTTLE_MS);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown_error";
        await admin
          .from("bulk_broadcast_contacts")
          .update({ status: "failed", error_message: msg })
          .eq("id", contact.id);

        // Incrementar failed
        await admin
          .from("bulk_broadcasts")
          .update({ failed_count: bc.id }) // será incremento via SQL
          .eq("id", bc.id);

        totalFailed++;
      }
    }
  }

  return NextResponse.json({ processed: totalSent + totalFailed, sent: totalSent, failed: totalFailed });
}
