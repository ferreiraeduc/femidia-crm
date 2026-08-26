-- ============================================================================
-- 0176 — DISPARO EM MASSA (BULK BROADCAST)
--
-- O problema: o usuário precisa enviar uma mensagem de texto para 2.300 leads
-- de uma planilha CSV externa, com throttle anti-banimento, e quando o lead
-- responder, enviar automaticamente o contato da IA.
--
-- A solução: duas tabelas (bulk_broadcasts + bulk_broadcast_contacts) que
-- enfileiram contatos pra envio via job_queue, com o worker existente
-- (broadcast-dispatcher) processando cada um. O throttle/pacing já é
-- coberto pelo before-send.ts existente — não duplicamos aqui.
-- ============================================================================

-- ── Tabela de campanhas de disparo ──────────────────────────────────────────
create table if not exists public.bulk_broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  message_text text not null,
  channel_session_id uuid not null references public.channel_sessions(id),
  status text not null default 'draft'
    check (status in ('draft', 'running', 'paused', 'completed', 'failed')),
  total_contacts integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  answered_count integer not null default 0,
  created_by_user_id uuid not null references auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: isolation por organização
alter table public.bulk_broadcasts enable row level security;

create policy "tenant_isolation_bulk_broadcasts_all" on public.bulk_broadcasts
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- Index pra queries por org
create index if not exists idx_bulk_broadcasts_org_created
  on public.bulk_broadcasts (organization_id, created_at desc);

-- ── Tabela de contatos dentro de uma campanha ───────────────────────────────
create table if not exists public.bulk_broadcast_contacts (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.bulk_broadcasts(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_number text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'sent', 'delivered', 'failed', 'answered')),
  sent_at timestamptz,
  answered_at timestamptz,
  message_id uuid references public.messages(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now()
);

-- RLS: isolation por organização
alter table public.bulk_broadcast_contacts enable row level security;

create policy "tenant_isolation_bulk_broadcast_contacts_all" on public.bulk_broadcast_contacts
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- Index pra worker: buscar pending por broadcast
create index if not exists idx_bulk_broadcast_contacts_status
  on public.bulk_broadcast_contacts (broadcast_id, status)
  where status in ('pending', 'queued');

-- Index pra detectar resposta: buscar sent sem answered
create index if not exists idx_bulk_broadcast_contacts_sent
  on public.bulk_broadcast_contacts (organization_id, status, phone_number)
  where status = 'sent';

-- ── Adicionar 'bulk_broadcast_turn' ao CHECK de job_queue.kind ──────────────
-- (se o CHECK existir — o vocabulário de job_queue pode ser aberto)
-- Não mexemos no CHECK existente para não quebrar clones.
-- O kind novo é aceito silenciosamente (vocabulário aberto no job_queue).

-- ── Trigger de updated_at ───────────────────────────────────────────────────
create or replace function public.fn_bulk_broadcasts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bulk_broadcasts_updated_at on public.bulk_broadcasts;
create trigger trg_bulk_broadcasts_updated_at
  before update on public.bulk_broadcasts
  for each row execute function public.fn_bulk_broadcasts_updated_at();

-- ── Grants ──────────────────────────────────────────────────────────────────
-- authenticated pode ler/escrever (RLS controla org)
grant select, insert, update on public.bulk_broadcasts to authenticated;
grant select, insert, update, delete on public.bulk_broadcast_contacts to authenticated;

-- ── Comentários ─────────────────────────────────────────────────────────────
comment on table public.bulk_broadcasts is
  'Campanhas de disparo em massa de mensagens WhatsApp. Cada broadcast representa um envio programado.';
comment on table public.bulk_broadcast_contacts is
  'Contatos dentro de uma campanha de disparo. Cada linha é um destinatário com seu status de envio.';
comment on column public.bulk_broadcasts.status is
  'draft=criado, running=disparando, paused=pausado, completed=todos enviados, failed=erro fatal';
comment on column public.bulk_broadcast_contacts.status is
  'pending=na fila, queued=enfileirado, sent=enviado, delivered=entregue, failed=falhou, answered=lead respondeu';
