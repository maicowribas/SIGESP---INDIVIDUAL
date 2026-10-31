SIGESP HTML COMPLETO - EXPORTAÇÃO PDF CORPORATIVA

No Histórico de Ocorrências, use o ícone de documento à direita de Editar.
O PDF é gerado localmente e baixado automaticamente com o protocolo no nome.

Recursos do PDF:
- A4 retrato, cabeçalho institucional e seções corporativas
- Identificação, dados, relato, análise, providências e observações
- Rastreabilidade e QR Code
- Fotos em grade, mantendo proporção
- Documentos referenciados quando existirem no campo de anexos
- Rodapé com emissão e Página X de Y
- Modal de progresso e confirmação

Bibliotecas locais, sem internet: jsPDF 2.5.2 e QRCode.js 1.0.0.

Cadastros mestres:
- Administradores gerenciam Supervisões, Unidades e Naturezas de Ocorrência em Configurações.
- Os cadastros são persistidos em supervisoes_unidades.csv e naturezas_ocorrencias.csv na pasta de dados.
- Na primeira conexão, Supervisões e Unidades legadas são migradas somente se o arquivo unificado ainda não existir; os CSVs legados são mantidos.
- Usuários guardam IDs estáveis para o vínculo de Supervisão e Unidades. Renomes preservam aliases para reconhecer ocorrências históricas.
- Inativar um cadastro impede novos usos sem remover ocorrências, vínculos ou referências existentes.
