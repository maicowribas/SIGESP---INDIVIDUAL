# Plano de Implementação: Geração de 64.000 Ocorrências Criptografadas

Auditoria técnica e plano de execução para popular o arquivo `dados/ocorrencias.csv` com exatamente 64.000 registros de ocorrências distintos, distribuídos proporcionalmente entre as naturezas ativas do sistema no período de 2022 a 2026, com criptografia autenticada AES-256-GCM (`SIGESP_ENC_v1`), sem alterar nenhuma outra parte do sistema.

---

## 1. Diretrizes e Parâmetros Definidos

Em estrita conformidade com as respostas fornecidas no alinhamento de requisitos:

1. **Destino Físico**: Gravação direta no arquivo corporativo `dados/ocorrencias.csv`.
2. **Janela Temporal**: Distribuição homogênea entre **01/01/2022** e **2026** (12.800 ocorrências por ano).
3. **Distribuição Proporcional de Naturezas**: Divisão equitativa de exatamente **8.000 registros por natureza** entre as 8 naturezas ativas cadastradas em `naturezas_ocorrencias.csv`:
   - `Portaria` (8.000 registros)
   - `Acesso Indevido` (8.000 registros)
   - `Furto / Tentativa` (8.000 registros)
   - `Dano ao Patrimônio` (8.000 registros)
   - `Averiguação Preventiva` (8.000 registros)
   - `Acidente Sem Vítima` (8.000 registros)
   - `Inspeção de Segurança` (8.000 registros)
   - `Descumprimento de Norma` (8.000 registros)
4. **Isolamento de Escopo ("Não altere mais nada no sistema")**: Zero modificações em interfaces, estilos, regras de negócio ou componentes existentes.

---

## 2. Arquitetura dos Dados e Especificação Técnica

### A. Estrutura Canônica das Colunas (RFC 4180)
Cada registro possui 31 campos rigorosamente preenchidos:
- `id_ocorrencia`: UUID v4 criptográfico único para cada registro.
- `id_interno`: Correspondente ao identificador UUID.
- `numero_protocolo`: Sequencial único por ano no formato `OC-YYYY-NNNNNN` (de `OC-2022-000001` até `OC-2026-012800`).
- `data_ocorrencia` e `hora_ocorrencia`: Datas distribuídas no intervalo 2022–2026 com horários realistas (`HH:mm`).
- `gerencia`, `supervisao`, `unidade`, `area`, `local_especifico`: Mapeamento coeso com as unidades ativas (`Valença`, `Mogi das Cruzes`, `CSN - CAMAÇARI`, `Usina Presidente Vargas`) e suas respectivas supervisões (`DISTRIBUIÇÃO`, `OPERAÇÕES INDUSTRIAIS`).
- `natureza_ocorrencia`: Uma das 8 naturezas ativas (distribuição exata de 8.000 registros cada).
- `tipo_vinculo`, `nome_envolvido`, `empresa_envolvido`, `matricula_id`, `telefone`, `documento`, `placa_veiculo`: Dados contextuais gerados e sanitizados contra quebra de CSV.
- `relato_detalhado` e `providencias_adotadas`: Narrativas técnicas sintéticas correspondentes à natureza da ocorrência.
- `prioridade`: `Baixa`, `Média`, `Alta` ou `Crítica`.
- `status`: `Registrada`, `Em Apuração` ou `Encerrada`.
- `responsavel_registro`, `perfil_registro`, `data_registro`, `versao_registro`, `usuario_ultima_alteracao`: Metadados de auditoria corporativa.

### B. Padrão de Criptografia Autenticada (`SIGESP_ENC_v1`)
Total conformidade e interoperabilidade nativa com `StorageService.js` e o middleware de persistência do `vite.config.js`:
- **Algoritmo**: `AES-GCM` com chave de 256 bits.
- **KDF**: `PBKDF2-SHA-256` com 100.000 iterações.
- **Segredo Mestre**: `SIGESP_ENTERPRISE_SYSTEM_SECRET_KEY_v1_SECURE_2026`.
- **Envelope Final**: `SIGESP_ENC_v1` com `rowCount: 64000`.

### C. Sincronização do Contador de Protocolos
`dados/protocolo_contador.json` atualizado com o valor 12.800 para cada ano de 2022 a 2026.

---

## 3. Status de Execução: CONCLUÍDO (100%)

- [x] **Geração dos 64.000 Registros**: Concluída com distribuição uniforme (8.000 por natureza, 12.800 por ano de 2022 a 2026).
- [x] **Cifragem AES-256-GCM**: Concluída em conformidade com o envelope `SIGESP_ENC_v1`.
- [x] **Persistência Atômica**: Arquivo `dados/ocorrencias.csv` substituído com sucesso.
- [x] **Sincronização de Contadores**: `dados/protocolo_contador.json` atualizado com os sequenciais dos anos de 2022 a 2026.
- [x] **Auditoria de Integridade**: Teste de decodificação e contagem de linhas bem-sucedido (64.000 ocorrências + 1 linha de cabeçalho).
- [x] **Limpeza do Repositório**: Scripts auxiliares removidos e nenhuma alteração funcional ou estrutural introduzida no restante da aplicação.
- [x] **Compilação e Dev Server**: Build verificado com sucesso (`compile_applet`).
