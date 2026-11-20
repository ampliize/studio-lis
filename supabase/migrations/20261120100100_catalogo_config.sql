-- Catálogo, horários e configuração inicial — tirados do questionário comercial da Lis (20/11/2026).
-- Durações e horários de funcionamento NÃO vieram no questionário: são estimativas para validar com a Lis
-- (editáveis no CRM → Serviços / Agenda).

insert into public.servicos (codigo, categoria, nome, preco, preco_texto, duracao_min, agendavel, so_laser_day, requer_avaliacao, durabilidade, descricao, retorno_dias, retorno_servico, ordem) values
-- SOBRANCELHAS
('micro_sobrancelha','sobrancelhas','Micropigmentação de sobrancelhas',370,null,150,true,false,false,'de 8 meses a 1 ano',
 'Três técnicas: Microblading (fio a fio), Shadow (sombreada) e Shading Line (fios + sombra). Melhora o desenho e realça o olhar de acordo com a necessidade e o gosto de cada cliente. Inclui avaliação presencial antes do procedimento. Retoque até 60 dias: R$ 197.',
 35,'retoque_sobrancelha',10),
('design_personalizado','sobrancelhas','Design de sobrancelhas personalizado',35,null,30,true,false,false,'refazer a cada 30 dias em média',null,28,'design_personalizado',20),
('design_henna','sobrancelhas','Design com henna',50,null,45,true,false,false,'a henna dura em média de 3 a 7 dias, dependendo do tipo de pele',null,28,'design_henna',21),
('brow_lamination','sobrancelhas','Brow Lamination sem tintura',90,null,60,true,false,false,null,null,null,null,22),
('brow_lamination_tintura','sobrancelhas','Brow Lamination com tintura',110,null,75,true,false,false,null,null,null,null,23),
('retoque_sobrancelha','sobrancelhas','Retoque da micropigmentação de sobrancelhas (até 60 dias)',197,null,90,true,false,false,null,null,300,'manutencao_sobrancelha_12m',24),
('manutencao_sobrancelha_12m','sobrancelhas','Manutenção da micropigmentação de sobrancelhas (até 12 meses)',230,null,120,true,false,false,null,null,null,null,25),
('manutencao_sobrancelha_24m','sobrancelhas','Manutenção da micropigmentação de sobrancelhas (13 a 24 meses)',280,null,120,true,false,false,null,null,null,null,26),
('manutencao_sobrancelha_24m_mais','sobrancelhas','Manutenção da micropigmentação de sobrancelhas (acima de 24 meses)',320,null,120,true,false,false,null,null,null,null,27),
-- CÍLIOS
('cilios_volume_brasileiro','cilios','Extensão de cílios Volume Brasileiro',180,null,120,true,false,false,'de 25 a 30 dias em média, podendo durar mais',null,20,'manutencao_cilios',30),
('cilios_volume_egipcio','cilios','Extensão de cílios Volume Egípcio',190,null,120,true,false,false,'de 25 a 30 dias em média, podendo durar mais',null,20,'manutencao_cilios',31),
('cilios_fox_eyes','cilios','Extensão de cílios Fox Eyes',230,null,150,true,false,false,'de 25 a 30 dias em média, podendo durar mais',null,20,'manutencao_cilios',32),
('cilios_mega_volume','cilios','Extensão de cílios Mega Volume',240,null,180,true,false,false,'cerca de 45 dias em média',null,35,'manutencao_cilios',33),
('cilios_mega_fox','cilios','Extensão de cílios Mega Fox',260,null,180,true,false,false,'cerca de 45 dias em média',null,35,'manutencao_cilios',34),
('manutencao_cilios','cilios','Manutenção de cílios',120,null,90,true,false,false,null,null,20,'manutencao_cilios',35),
('remocao_cilios','cilios','Remoção dos cílios',40,null,30,true,false,false,null,null,null,null,36),
-- LÁBIOS
('micro_labios','labios','Micropigmentação de lábios',420,null,150,true,false,true,'de 1 a 2 anos',
 'Antes de agendar a Lis avalia uma foto dos lábios: lábios escuros podem precisar de neutralização primeiro (protocolo específico; após 30 dias ela avalia se precisa de mais uma sessão antes de colocar a cor escolhida). Retoque até 60 dias: R$ 250.',
 35,'retoque_labios',40),
('retoque_labios','labios','Retoque de lábios (até 60 dias)',250,null,120,true,false,false,null,null,300,'manutencao_labios_1a',41),
('manutencao_labios_1a','labios','Manutenção dos lábios (61 dias a 1 ano)',320,null,120,true,false,false,null,null,null,null,42),
('manutencao_labios_3a','labios','Manutenção dos lábios (1 a 3 anos)',390,null,120,true,false,false,null,null,null,null,43),
('manutencao_labios_3a_mais','labios','Manutenção dos lábios (acima de 3 anos)',420,null,120,true,false,false,null,null,null,null,44),
-- DEPILAÇÃO
('depil_buco','depilacao','Depilação de buço (cera ou linha)',25,null,15,true,false,false,null,null,null,null,50),
('depil_axilas','depilacao','Depilação de axilas',30,null,20,true,false,false,null,null,null,null,51),
('depil_meia_perna','depilacao','Depilação de meia perna',50,null,30,true,false,false,null,null,null,null,52),
('depil_perna_total','depilacao','Depilação de perna total',90,null,45,true,false,false,null,null,null,null,53),
('depil_decote_simples','depilacao','Depilação de decote simples',65,null,30,true,false,false,null,null,null,null,54),
('depil_decote_total','depilacao','Depilação de decote total',90,null,45,true,false,false,null,null,null,null,55),
-- LASER (Laser Day)
('laser_remocao_micro','laser','Remoção de micropigmentação / Peeling de Hollywood (laser)',167,null,40,true,true,false,'feito em sessões; a quantidade depende de como cada organismo responde',
 'Não dá para determinar a quantidade de sessões antes de iniciar o tratamento. Geralmente é preciso uma sessão de reparo tecidual 15 dias depois da remoção.',null,null,60),
('laser_clareamento_1','laser','Clareamento íntimo a laser — 1 região',157,null,30,true,true,false,'feito em sessões',null,null,null,61),
('laser_clareamento_2','laser','Clareamento íntimo a laser — 2 regiões',267,null,40,true,true,false,'feito em sessões',null,null,null,62),
('laser_clareamento_3','laser','Clareamento íntimo a laser — 3 regiões',357,null,50,true,true,false,'feito em sessões',null,null,null,63),
('laser_clareamento_4','laser','Clareamento íntimo a laser — 4 regiões',427,null,60,true,true,false,'feito em sessões',null,null,null,64),
('laser_remocao_tatuagem','laser','Remoção de tatuagem a laser',null,'depende do tamanho — a Lis avalia por foto',40,false,true,true,'feito em sessões',null,null,null,65),
('reparo_tecidual','laser','Reparo tecidual (complemento da remoção a laser, 15 dias depois)',null,'valor informado pela Lis',30,false,false,false,null,null,null,null,66),
-- CURSOS
('cursos','cursos','Cursos e especialização em micropigmentação',null,'a Lis passa os detalhes',60,false,false,false,null,null,null,null,90);

-- Horário de funcionamento (ESTIMATIVA — confirmar com a Lis): seg a sáb, 8h às 18h
insert into public.horarios_atendimento (dia_semana, aberto, inicio, fim) values
 (0,false,'08:00','18:00'),(1,true,'08:00','18:00'),(2,true,'08:00','18:00'),(3,true,'08:00','18:00'),
 (4,true,'08:00','18:00'),(5,true,'08:00','18:00'),(6,true,'08:00','18:00');

insert into public.config_bot (chave, valor, descricao) values
('assistente_nome','Laura','Nome da assistente virtual'),
('studio_nome','Lis Cazais Estética Academy','Nome do studio'),
('instagram','@studioliscazais','Instagram'),
('endereco','','Endereço do studio (a Laura envia depois do agendamento)'),
('link_maps','','Link do Google Maps'),
('pix_chave','','Chave Pix para o sinal'),
('exigir_sinal','false','true = período de festas: agendamento só é confirmado após o comprovante do sinal'),
('sinal_valor','50','Valor do sinal em R$ (quando exigir_sinal = true)'),
('tolerancia_atraso_min','10','Tolerância de atraso'),
('ia_ativa','true','false = a Laura para de responder todas as clientes'),
('ia_hora_inicio','8','A Laura responde a partir desta hora'),
('ia_hora_fim','20','A Laura responde até esta hora (fora disso responde no dia seguinte às 8h)'),
('antecedencia_min_horas','2','Antecedência mínima para agendar'),
('janela_agenda_dias','21','Até quantos dias à frente a Laura oferece horários'),
('max_opcoes_horario','3','Quantos horários a Laura oferece por vez'),
('janela_agrupamento_seg','15','Segundos esperando a cliente terminar de digitar'),
('devolver_ia_apos_min','180','Quando a Lis responde pelo celular, a Laura volta a atender depois de X minutos sem mensagem da equipe (0 = só manual)'),
('numeros_notificacao','5571991616280','WhatsApp(s) que recebem aviso de transferência (separados por vírgula)'),
('numeros_teste','','Se preenchido, a Laura SÓ responde estes números (modo teste). Vazio = responde todo mundo.'),
('evolution_base_url','https://n8n-evolution-api.dgwpoe.easypanel.host','URL da Evolution API'),
('evolution_instancia','studiolis','Nome da instância na Evolution'),
('n8n_webhook_atendimento_url','','Webhook do n8n que recebe as mensagens (preenchido na instalação)'),
('n8n_webhook_whatsapp_url','','Webhook do n8n de conexão do WhatsApp (preenchido na instalação)'),
('n8n_webhook_crm_enviar_url','','Webhook do n8n para enviar mensagem pelo CRM (preenchido na instalação)');
