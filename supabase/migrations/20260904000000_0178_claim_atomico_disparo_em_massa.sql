-- ============================================================================
-- 0178 — CLAIM ATÔMICO DO DISPARO EM MASSA (fim do envio duplicado/triplicado)
--
-- O QUE ACONTECEU (medido em produção, campanha "Clínicas IA v2", 03/09/2026):
-- o contato "m2067" recebeu 3 variações DIFERENTES da mesma mensagem, uma atrás
-- da outra. Cruzando os timestamps reais de `bulk_broadcast_contacts` com o
-- histórico de mensagens da conversa: dois desses três envios saíram com 6
-- segundos de intervalo, contra um throttle mínimo CONFIGURADO de 45 segundos
-- na campanha. Throttle não falhou — o mesmo contato foi processado por DUAS
-- invocações do cron ao mesmo tempo, cada uma ignorando o throttle da outra
-- porque nenhuma sabia que a outra existia.
--
-- RAIZ DO BUG (em app/api/v1/cron/broadcast-dispatcher/route.ts, antes deste
-- commit): pra cada rodada, o worker fazia
--   1. SELECT ... WHERE status = 'pending' LIMIT batchSize     (não trava nada)
--   2. for (contato of contatos) { UPDATE status='queued'; enviar; sleep(45-90s) }
-- entre o SELECT e o primeiro UPDATE da rodada podem se passar vários minutos
-- (batchSize=6 × até 90s de sleep = até 9min por rodada), enquanto o cron
-- dispara a cada 1min (docstring do route.ts). Ou seja: por construção, quase
-- toda invocação nova começa ENQUANTO a anterior ainda está no meio do loop.
-- A invocação nova faz o mesmo SELECT status='pending' — que ainda não viu
-- nenhum UPDATE da invocação anterior pros contatos que ela já está processando
-- — e pega OS MESMOS contatos. Resultado: 2 ou 3 invocações mandam mensagem
-- pro mesmo lead, cada uma com uma variação sorteada diferente. É concorrência
-- clássica de fila sem claim atômico — SELECT e UPDATE são duas operações
-- separadas, e entre elas não existe nenhum trava.
--
-- BÔNUS medido no mesmo incidente: o painel mostrava "7 Enviados" enquanto 18
-- mensagens de fato saíram pra 12 contatos (7 receberam 1, 4 receberam 2, 1
-- recebeu 3) — 11 incrementos de `sent_count` sumiram. Raiz: o worker lia
-- `bc.sent_count` UMA VEZ no início da rodada e escrevia
-- `sent_count = (bc.sent_count ?? 0) + totalSent + 1` a cada envio — clássico
-- lost update: duas invocações (ou duas voltas do mesmo loop com o mesmo `bc`
-- congelado em memória) leem o mesmo valor de partida e uma escrita apaga a
-- outra. Além disso `failed_count` nunca era gravado no banco — só existia
-- como variável local `totalFailed`, que morre no fim de cada invocação.
--
-- A SOLUÇÃO: duas funções que fazem em UM ÚNICO statement SQL o que antes era
-- feito em vários passos separados do JavaScript, fechando toda janela onde
-- uma segunda invocação concorrente poderia enxergar o estado "de antes":
--
--   1. claim_pending_bulk_broadcast_contacts — substitui o SELECT + UPDATE por
--      um único UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED). Mesmo
--      padrão (mesmo motivo) de fn_claim_due_followup_enrollments (migração
--      0146): o `for update skip locked` fica isolado numa CTE própria
--      (`travados`), separada da CTE que materializa os candidatos (`fila`) —
--      Postgres não aceita FOR UPDATE junto de LIMIT/ORDER BY de forma segura
--      pra esse fim — e a condição de claim (`status = 'pending'`) é REPETIDA
--      no WHERE do UPDATE final. Essa repetição não é cosmética: sem ela, duas
--      conexões concorrentes materializam a MESMA lista de candidatos antes de
--      qualquer lock existir; a segunda espera o lock da primeira, e quando ele
--      sai o Postgres (READ COMMITTED) reavalia só o WHERE do UPDATE — se esse
--      WHERE não checasse `status = 'pending'` de novo, a segunda conexão
--      gravaria por cima dos mesmos contatos que a primeira acabou de marcar
--      'queued'. Foi exatamente essa lição, já documentada e medida (5 em 5
--      claims duplicados) na migração 0146 — aplicamos o mesmo remédio aqui.
--
--   2. increment_bulk_broadcast_counters — substitui "ler sent_count uma vez
--      em JS, somar em memória, escrever de volta" por um único
--      `UPDATE ... SET sent_count = sent_count + delta`. Postgres serializa
--      escritas concorrentes na MESMA linha (a segunda transação espera a
--      primeira liberar o lock da linha e enxerga o valor já incrementado) —
--      não existe mais "ler, somar, gravar" em JavaScript pra perder update.
--      De quebra, passa a persistir `failed_count`, que antes nunca era salvo.
--
-- Nenhuma coluna nova é necessária: o próprio `status` da linha (pending →
-- queued) já funciona como trava — uma vez que uma linha vira 'queued' dentro
-- da mesma transação atômica que a reclamou, nenhuma outra invocação volta a
-- enxergá-la como 'pending'.
-- ============================================================================

-- ── claim_pending_bulk_broadcast_contacts ───────────────────────────────────
-- Reclama até p_limit contatos 'pending' de UM broadcast, atomicamente, e já
-- marca status='queued' antes de devolver — chamado pelo worker no lugar do
-- antigo SELECT status='pending' solto.
create or replace function public.claim_pending_bulk_broadcast_contacts(
  p_broadcast_id uuid,
  p_limit int
)
returns setof public.bulk_broadcast_contacts
language sql
security definer
set search_path = public
as $$
  with fila as (
    select id
      from bulk_broadcast_contacts
     where broadcast_id = p_broadcast_id
       and status = 'pending'
     order by created_at
     limit p_limit
  ),
  travados as (
    select id from bulk_broadcast_contacts
     where id in (select id from fila)
     for update skip locked
  )
  update bulk_broadcast_contacts c
     set status = 'queued'
   where c.id in (select id from travados)
     -- Repetida de propósito (não é redundante com a CTE `fila` acima) — ver
     -- explicação longa no cabeçalho desta migração e o precedente da 0146.
     and c.status = 'pending'
  returning c.*;
$$;

revoke execute on function public.claim_pending_bulk_broadcast_contacts(uuid, int)
  from public, anon, authenticated;

comment on function public.claim_pending_bulk_broadcast_contacts(uuid, int) is
  'Reclama atomicamente até p_limit contatos pending de um broadcast (SELECT FOR UPDATE SKIP LOCKED + UPDATE num único statement) e já marca queued. Evita duas invocações concorrentes do cron pegarem o mesmo contato — causa raiz do envio duplicado/triplicado medido em 03/09/2026.';

-- ── increment_bulk_broadcast_counters ───────────────────────────────────────
-- Incrementa sent_count/sent_today/failed_count de UM broadcast atomicamente.
-- Chamado pelo worker a cada envio (sucesso ou falha) no lugar do antigo
-- "ler bc.sent_count uma vez em JS e somar em memória".
create or replace function public.increment_bulk_broadcast_counters(
  p_broadcast_id uuid,
  p_sent_delta int default 0,
  p_failed_delta int default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  update bulk_broadcasts
     set sent_count = sent_count + p_sent_delta,
         sent_today = sent_today + p_sent_delta,
         failed_count = failed_count + p_failed_delta
   where id = p_broadcast_id;
$$;

revoke execute on function public.increment_bulk_broadcast_counters(uuid, int, int)
  from public, anon, authenticated;

comment on function public.increment_bulk_broadcast_counters(uuid, int, int) is
  'Incrementa sent_count/sent_today/failed_count de um broadcast num único UPDATE atômico. Corrige o "7 Enviados" no painel vs 18 mensagens reais medido em 03/09/2026 (lost update de contador lido uma vez em JS) e passa a persistir failed_count, que antes nunca era gravado.';
