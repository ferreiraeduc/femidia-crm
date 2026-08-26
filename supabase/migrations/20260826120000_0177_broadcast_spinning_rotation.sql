-- ============================================================================
-- 0177 — SPINNING DE COPY + ROTAÇÃO DE NÚMEROS NO BROADCAST
--
-- Adiciona suporte a múltiplas variações de mensagem (spinning) e múltiplos
-- canais de envio (rotação de números) na feature de disparo em massa.
-- ============================================================================

-- Múltiplas mensagens pra spinning
alter table public.bulk_broadcasts
  add column if not exists message_variants jsonb default '[]';

-- Múltiplos canais pra rotação (array de UUIDs)
alter table public.bulk_broadcasts
  add column if not exists channel_session_ids text[] default '{}';

-- Timer randômico (min/max em milissegundos)
alter table public.bulk_broadcasts
  add column if not exists throttle_min_ms integer not null default 8000;
alter table public.bulk_broadcasts
  add column if not exists throttle_max_ms integer not null default 20000;

-- Limite diário (progressão)
alter table public.bulk_broadcasts
  add column if not exists daily_limit integer not null default 100;

-- Tracking: qual variação foi enviada pra cada contato (pra métricas A/B)
alter table public.bulk_broadcast_contacts
  add column if not exists variant_index integer;

-- Tracking: qual canal enviou (pra métricas de rotação)
alter table public.bulk_broadcast_contacts
  add column if not exists sent_by_channel_id uuid references public.channel_sessions(id);

-- Contagem de envios por dia (pra respeitar daily_limit)
alter table public.bulk_broadcasts
  add column if not exists sent_today integer not null default 0;
alter table public.bulk_broadcasts
  add column if not exists last_send_date date;

-- Comentários
comment on column public.bulk_broadcasts.message_variants is
  'Array de variações de mensagem pro spinning de copy. Ex: ["Oi, tudo bem?...", "Fala, doutor(a)..."]';
comment on column public.bulk_broadcasts.channel_session_ids is
  'Array de UUIDs de channel_sessions pra rotação de números. O dispatcher alterna entre eles.';
comment on column public.bulk_broadcasts.throttle_min_ms is
  'Intervalo MÍNIMO entre envios em ms (default 8s). Timer real = random entre min e max.';
comment on column public.bulk_broadcasts.throttle_max_ms is
  'Intervalo MÁXIMO entre envios em ms (default 20s). Timer real = random entre min e max.';
comment on column public.bulk_broadcasts.daily_limit is
  'Máximo de envios por dia (progressão manual). Default 100.';
comment on column public.bulk_broadcast_contacts.variant_index is
  'Índice da variação de mensagem usada (0-based). Pra métricas de A/B.';
comment on column public.bulk_broadcast_contacts.sent_by_channel_id is
  'Qual canal/número enviou esta mensagem. Pra métricas de rotação.';
