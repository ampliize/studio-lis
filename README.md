# Studio Lis Cazais — Assistente "Laura" no WhatsApp + CRM

A Laura atende as clientes do Studio Lis Cazais (Lis Cazais Estética Academy) pelo WhatsApp **71 99161-6280**, das 8h às 20h:
apresenta-se como assistente da Lis, segue o roteiro de cada procedimento do questionário, passa valores, envia fotos de trabalhos,
**agenda na agenda própria do CRM** e passa para a Lis quando precisa de avaliação humana.

Mesmo padrão dos outros clientes (Reginaldo / Cabelos by Karol): **Supabase + n8n + Evolution API + CRM Next.js na Vercel**.

| Peça | Onde |
|---|---|
| Banco | Supabase `neeffqfzbvxqxfwoftbl` (migrations em [`supabase/migrations`](supabase/migrations)) |
| Agente e automações | n8n `n8n-n8n.dgwpoe.easypanel.host`, workflows `LIS · …` (código em [`n8n/`](n8n), IDs em [`n8n/ids.json`](n8n/ids.json)) |
| Prompt da Laura | [`agente/prompt-laura.md`](agente/prompt-laura.md) |
| CRM | [`crm/`](crm) → Vercel, projeto `crm-studio-lis` |
| WhatsApp | Evolution `n8n-evolution-api.dgwpoe.easypanel.host`, instância `studiolis` |

## O que a Laura faz

- **Roteiros do questionário**: micro de sobrancelhas (4 perguntas → fotos das 3 técnicas → técnica → dúvidas → valor → agendar),
  micro labial (pede foto → passa para a Lis avaliar neutralização), cílios, design/henna, brow lamination, depilação, laser (Laser Day), cursos.
- **Agenda própria**: horários livres reais por duração do serviço, combos (vários serviços seguidos), Laser Day com vagas,
  bloqueios manuais, antecedência mínima, 1 horário futuro por cliente, trava contra dois agendamentos no mesmo horário.
- **Sinal (período de festas)**: com `exigir_sinal = true` o horário fica "aguardando sinal", a Laura manda Pix + política; comprovante → Lis confirma no CRM.
- **Contraindicações**: gestante/lactante, problemas nos olhos, oncológica (passa para a Lis), diabetes, queloide.
- **Passa para a Lis** (pausa a Laura e avisa no WhatsApp): foto de micro antiga, lábios, tatuagem, remarcar/cancelar, comprovante, cursos, desconto, saúde, reclamação.
- **Se a Lis responder pelo celular**, a Laura pausa naquela conversa e volta sozinha após 3 h sem mensagem dela (ou pelo botão no CRM).
- **Rotinas a cada 10 min**: responde quem escreveu fora do horário (às 8h), follow-up de quem sumiu (dia seguinte, 3, 7 e 14 dias, com foto),
  lembrete na véspera, **lembrete de manutenção/retoque** (cílios ~20 dias, design ~28, retoque da micro ~35, manutenção anual ~10 meses) e aniversário.
- Transcreve áudios. Responde só por texto (voz fica para a fase 2).

## Instalação — o que falta (precisa de você)

1. **Criar 2 credenciais no n8n** (Credentials → New → *Header Auth*) e selecionar nos nós dos workflows `LIS · …` (os nós estão marcados com credencial pendente):
   - **LIS Supabase** — Name: `x-lis-token` · Value: resultado de `select valor from private.segredos where chave = 'n8n_token';` no SQL Editor do Supabase da Lis.
   - **LIS Evolution** — Name: `apikey` · Value: API key global da Evolution (a mesma usada na credencial "Evolution Reginaldo").
   - OpenAI: os nós já estão com "OpenAI account"; troque por uma chave própria da Lis se for cobrar separado.
2. **Publicar (ativar)** os 8 workflows `LIS · …`.
3. **CRM** → Configurações → *Gerar QR Code* e ler com o celular 71 99161-6280 (WhatsApp → Aparelhos conectados).
4. **Modo teste**: em Configurações, `numeros_teste` = seu número (ex.: `5571999999999`) → a Laura só responde esse número. Esvazie para liberar.
5. **Preencher no CRM** (Configurações / Serviços): endereço, link do Maps, chave Pix, fotos das técnicas/cílios/laser, vídeo "como chegar",
   **horário de funcionamento** e **duração de cada serviço** (estão estimados — o questionário não trouxe).

## Login do CRM

Usuária criada: `lis@studioliscazais.com` (senha entregue no chat). Para adicionar outra pessoa: crie o usuário em Supabase → Authentication
e rode `insert into public.equipe (email, nome) values ('email@...', 'Nome');` — só quem está em `equipe` vê dados.

## Pendências para validar com a Lis

- Duração real de cada procedimento e horário de funcionamento (hoje: seg–sáb 8h–18h).
- Endereço, Maps, chave Pix, valor do sinal (hoje R$ 50) e quando ligar o sinal.
- Preço do reparo tecidual e valores de combo promocional (hoje: soma da tabela; desconto → Lis).
- Datas dos próximos Laser Days (CRM → Agenda).
- Base de clientes antigas do app Minha Agenda (exportar e importar para ativar os lembretes de manutenção).
- O app Minha Agenda continua sendo usado pela Lis: horários que ela ocupar lá precisam ser **bloqueados no CRM** (Agenda → Bloquear horários).

## Segurança

Nenhum segredo no repositório (é público). As funções do agente no Supabase só respondem com o header `x-lis-token` (credencial do n8n);
o CRM usa login + RLS restrito à tabela `equipe`; a chave da Evolution fica só no n8n.
