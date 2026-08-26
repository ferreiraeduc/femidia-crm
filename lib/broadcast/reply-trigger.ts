/**
 * Broadcast Reply Trigger — quando um lead que recebeu mensagem de broadcast
 * RESPONDE qualquer coisa, envia automaticamente o cartão de contato da IA.
 *
 * Chamado pelo ingest de mensagens inbound (lib/waha/ingest.ts) ou como efeito
 * pós-entrada. Verifica se o telefone do remetente está em algum broadcast ativo
 * com status 'sent' e, se sim, envia o vCard do número da IA.
 *
 * O número da IA é lido da channel_session associada ao broadcast.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";
import { wahaContactPayload } from "@/lib/waha/contact-card";

export interface BroadcastReplyInput {
  organizationId: string;
  /** Telefone do lead que respondeu (normalizado, só dígitos). */
  phoneNumber: string;
  /** waha_session_name de onde a mensagem chegou. */
  sessionName: string;
  /** chatId do lead (ex: 5511999999999@c.us). */
  chatId: string;
}

/**
 * Verifica se este lead respondeu a um broadcast e, se sim, envia o cartão
 * de contato da IA automaticamente. Retorna true se enviou, false se não.
 */
export async function handleBroadcastReply(input: BroadcastReplyInput): Promise<boolean> {
  const { organizationId, phoneNumber, sessionName, chatId } = input;

  const admin = createAdminClient();
  const waha = getWahaClient();
  if (!waha) return false;

  // Buscar se esse telefone está em algum broadcast com status 'sent' (ainda não respondeu)
  const normalizedPhone = phoneNumber.replace(/\D/g, "");

  const { data: broadcastContact } = await admin
    .from("bulk_broadcast_contacts")
    .select("id, broadcast_id")
    .eq("organization_id", organizationId)
    .eq("phone_number", normalizedPhone)
    .eq("status", "sent")
    .limit(1)
    .single();

  if (!broadcastContact) return false;

  // Buscar os dados do broadcast pra saber o channel_session (número da IA)
  const { data: broadcast } = await admin
    .from("bulk_broadcasts")
    .select("channel_session_id")
    .eq("id", broadcastContact.broadcast_id)
    .single();

  if (!broadcast) return false;

  // Buscar o número da IA (o canal associado ao broadcast)
  const { data: aiSession } = await admin
    .from("channel_sessions")
    .select("waha_session_name, phone_number, display_name")
    .eq("id", broadcast.channel_session_id)
    .single();

  if (!aiSession || !aiSession.phone_number) return false;

  // Montar e enviar o cartão de contato da IA
  const contactPayload = wahaContactPayload(
    aiSession.display_name || "Assistente IA",
    aiSession.phone_number,
  );

  try {
    await waha.sendContactVcard(sessionName, chatId, [contactPayload]);

    // Marcar como respondido
    await admin
      .from("bulk_broadcast_contacts")
      .update({ status: "answered", answered_at: new Date().toISOString() })
      .eq("id", broadcastContact.id);

    // Incrementar answered_count no broadcast
    await admin.rpc("fn_increment_broadcast_answered", {
      p_broadcast_id: broadcastContact.broadcast_id,
    });

    return true;
  } catch {
    // Falha no envio do vCard — não bloqueia o fluxo
    return false;
  }
}
