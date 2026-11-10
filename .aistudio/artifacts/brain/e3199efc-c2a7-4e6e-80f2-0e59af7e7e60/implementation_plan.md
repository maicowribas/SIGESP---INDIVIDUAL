# Plano de Correção: Sincronização em Tempo Real de Ocorrências Pendentes e Notificações de Validação

Correção e blindagem do pipeline de persistência, detecção de arquivos e sincronização em segundo plano (*smartPollSync*) para que ocorrências registradas por operadores emitam notificações instantâneas e apareçam de imediato na tela de "Validação de Ocorrências" da supervisão.

---

### Diagnóstico da Causa Raiz

1. **Invalidação Incompleta de Handles no Modo Pasta Nativa (`storageService.js`)**:
   - Ao conectar a pasta compartilhada, `_scanAndIndexNativeDirectory(dir)` cria o mapa inicial `this._nativeFilesMap`.
   - Quando um operador registra uma ocorrência, o arquivo individual (`ocorrencia_OC_2026_XXXXXX.csv`) é gravado em disco, porém o handle não era injetado em `this._nativeFilesMap` e o cache `this._nativeHandlesCache` não era descartado.
   - Em sessões concorrentes (ex: aba do supervisor monitorando a mesma pasta), `_listNativeOccurrenceFileHandles` consultava apenas o `this._nativeFilesMap` antigo estático, ignorando novas ocorrências surgidas na pasta física de dados.
   - Por conseguinte, `getFileStat('ocorrencias.csv')` calculava tamanho e mtime idênticos aos anteriores, fazendo `fetchFreshOccurrencesCsv({ onlyIfChanged: true })` retornar `null`.
2. **Supressão do Ciclo de Notificações e Fila Pendente (`app.js`)**:
   - Com `rawText === null`, o `smartPollSync` não identificava os registros em `newlyAdded`, nunca disparava o toast `🔔 Nova ocorrência aguardando validação!` e não atualizava `S.pending`.
   - O módulo de validação (`pendingValidationPage`) dependia de um recarregamento forçado da página (F5) para indexar os arquivos recém-criados.

---

## 1. Visão Geral da Solução

Garantir reatividade ponta-a-ponta entre o salvamento do operador e a tela do supervisor/administrador:

```
┌────────────────────────┐         Grava arquivo físico         ┌───────────────────────────────┐
│ Operador (Sessão 1)    │ ───────────────────────────────────> │ Pasta de Dados (dados/)       │
│ Registra ocorrência    │                                      │ ocorrencia_OC_2026_00000X.csv │
└────────────────────────┘                                      └───────────────────────────────┘
                                                                                │
                                                                                │ Polling / Detecção ativa
                                                                                ▼
┌────────────────────────┐         Reatividade e Alerta         ┌───────────────────────────────┐
│ Supervisor (Sessão 2)  │ <─────────────────────────────────── │ SmartPoll & StorageService    │
│ • Notificação Toast 🔔 │                                      │ • Re-indexação com TTL curto  │
│ • Linha na Validação   │                                      │ • Reconhecimento de novo hash │
└────────────────────────┘                                      └───────────────────────────────┘
```

---

## 2. Decisões Técnicas e Arquitetura

1. **Re-indexação Dinâmica e TTL no Storage Nativo (`storageService.js`)**:
   - Atualizar `writeRawFile`: ao salvar qualquer arquivo de ocorrência (`isIndividualOccurrenceFileName`), atualizar imediatamente `this._nativeFilesMap.set(fileName, fh)` e zerar `this._nativeHandlesCache = null`, `_lastKnownBatchSig = ''` e `_rawFileCache.delete('ocorrencias.csv')`.
   - Em `_listNativeOccurrenceFileHandles(dir)`: implementar expiração de cache (TTL de 2,5 segundos) ou opção `{ force: true }` para re-varrer `dir.entries()` ou `dir.values()`, garantindo que arquivos adicionados por outros operadores na pasta física de dados sejam detectados imediatamente no próximo ciclo de polling.
   - Em `invalidateCache(fileName)`: garantir descarte completo de `this._nativeHandlesCache` e `_lastKnownBatchSig`.
2. **Aperfeiçoamento da Detecção no `smartPollSync` (`app.js`)**:
   - Na checagem de `fetchFreshRawCsv('ocorrencias.csv')`: ao detectar novas ocorrências pendentes (`newPending.length > 0`), disparar a notificação visual com prioridade para perfis autorizados (`canValidateOccurrence(S.user)`: Administrador, Supervisor, Líder):
     ```javascript
     showToast('🔔 Nova ocorrência aguardando validação!', 'success', 'Fila de Validação');
     ```
   - Atualizar reativamente `S.occ` e `S.pending = filteredPendingOccurrences()`.
   - Se o supervisor já estiver na tela de Validação de Ocorrências (`S.page === 'occ-validation'`), acionar `render()` imediatamente sem fechar modais ou interromper a digitação.
3. **Segurança e Escopo RBAC Preservados**:
   - Manter as checagens rígidas de escopo por unidade (`canViewOccurrence`, `canAccessUnit`) e a integridade de criptografia AES-256-GCM em todos os envelopes de dados.

---

## 3. Plano de Execução

1. **Atualizar `storageService.js`**:
   - Implementar re-escaneamento resiliente com TTL em `_listNativeOccurrenceFileHandles`.
   - Atualizar `writeRawFile` e `appendSingleRecord` para registrar novos file handles imediatamente e invalidar os caches de lote.
   - Ajustar `fetchFreshOccurrencesCsv` para detectar adições e remoções de arquivos individuais.
2. **Ajustar `app.js`**:
   - Aprimorar o bloco de sincronização de ocorrências em `smartPollSync`, assegurando que `newlyAdded` com `isPendingOccurrence` dispare a notificação toast e atualize a tabela do módulo `occ-validation`.
   - Assegurar que ao salvar uma ocorrência com perfil Operador, o status otimista e o registro persistido entrem diretamente em `S.pending` e reflitam no badge do menu.
3. **Validação e Testes**:
   - Simular criação de ocorrência por operador e verificar a recepção no supervisor.
   - Testar detecção de novos arquivos adicionados diretamente na pasta física `dados/`.
   - Executar `compile_applet` e `lint_applet` para confirmar ausência de erros e integridade do dev server.
