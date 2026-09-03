# QA operacional — rc.20

Critérios de aceite desta rodada:

- navegação autenticada normal não retorna 429 por contador global compartilhado;
- backup manual não responde erro após disparar tarefa e a grade se atualiza sem recarregar a página;
- relatório filtra por empresa/cliente/situação/período e gera PDF/XLSX/CSV;
- relatório impresso não inclui menu/controles da aplicação;
- contrato pode ser encerrado/excluído somente por perfil com `contracts.delete`;
- negociação aprovada exibe exatamente o total de parcelas geradas;
- conciliação analisa créditos de `bank_transactions` e não baixa correspondências ambíguas;
- sugestão de conciliação confirmada cria pagamento e atualiza o saldo uma única vez;
- portal público apresenta QR PIX real, linha digitável, boleto PDF público e upload de comprovante;
- download público de boleto não exige JWT;
- restart de WhatsApp não remove sessão nem oferece novo QR enquanto houver identidade vinculada;
- falha/timeout da Evolution não apaga conexão conhecida;
- landing não contém URLs administrativas, demo, nomes de providers ou arquitetura interna;
- landing pode ser desativada no Control Plane;
- planos exibidos na landing são somente planos ativos e públicos;
- confirmações novas usam diálogo interno da aplicação;
- status/legendas visíveis ao tenant ficam em PT-BR.
