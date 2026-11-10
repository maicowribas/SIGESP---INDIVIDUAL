# Plano de Implementação: Otimização de Protocolo, Brasão Metálico e Redesign Vibrante do Dashboard

Melhorias de desempenho no registro de ocorrências (geração e reserva instantânea do protocolo, eliminação de travamento do botão de salvar), modernização corporativa da identidade visual com brasão vetorial metálico na barra lateral e redesign executivo do Dashboard com paleta de cores vibrante e cartões informativos de alta fidelidade.

---

### Decisões Confirmadas pelo Usuário (Fase 1)
- **Escudo do SIGESP**: Brasão vetorial com gradiente metálico, estrela de segurança e acabamento institucional de alto nível na barra lateral.
- **Design do Dashboard**: Paleta corporativa vibrante (azul safira, esmeralda, âmbar e violeta) com cartões coloridos, gradientes suaves e visualização analítica expandida.
- **Protocolo & Botão de Salvar**: Pré-reserva instantânea no milissegundo 0 sem bloqueio de interface, confirmação assíncrona em segundo plano e destravamento automático e infalível do botão de submissão.

---

## 1. Visão Geral & Conceito

1. **Protocolo Instantâneo & Desbloqueio Infalível do Botão de Salvar**:
   - **Carregamento Imediato (0 ms)**: Ao clicar em "Nova Ocorrência", o protocolo é calculado deterministicamente no milissegundo 0 através do sequencial verificado em memória (`gerarProximoId`), atribuído de imediato aos campos do formulário e confirmado sem bloquear a abertura da tela.
   - **Reserva Assíncrona Não-Bloqueante**: A comunicação com o arquivo/endpoint de reservas de protocolo roda em segundo plano. O formulário fica 100% liberado para digitação imediata.
   - **Blindagem do Botão de Salvar**:
     - Eliminação de esperas síncronas bloqueantes (`await _openOccRegPromise`) no submit.
     - Mecanismo *watchdog* de auto-recuperação (timeout máximo de 3,5s que destrava o botão em caso de qualquer oscilação).
     - Destravamento imediato do botão em qualquer validação incorreta ou digitação subsequente no formulário.

2. **Brasão Metálico do SIGESP na Barra Lateral**:
   - Substituição do emoji `🛡️ SIGESP` por um componente SVG vetorial de alta definição:
     - Escudo chanfrado com gradientes metálicos platinados e reflexo de luz.
     - Campo interno azul marinho profundo com estrela de segurança de 5 pontas em dourado polido.
     - Tipografia "SIGESP" com acabamento monoespelhado e subtítulo institucional "Segurança Integrada".

3. **Dashboard Executivo & Vibrante**:
   - **Grade de KPIs de Alto Impacto** com cartões coloridos em gradientes suaves e semânticos:
     - 🔷 **Total de Ocorrências**: Gradiente Azul Cobalto (`#2563eb` -> `#1d4ed8`), contagem geral e indicador de volume.
     - 🔶 **Pendentes de Validação**: Gradiente Âmbar Dourado (`#f59e0b` -> `#d97706`), foco prioritário para supervisão e liderança.
     - 🟣 **Em Apuração**: Gradiente Violeta Real (`#7c3aed` -> `#6d28d9`), gestão ativa de investigações e relatórios.
     - 🟢 **Encerradas**: Gradiente Esmeralda (`#059669` -> `#047857`), índice de resolução concluída.
     - 💠 **Controle de Chaves & Frota**: Gradiente Ciano/Teal (`#0284c7` -> `#0369a1`), status de chaves retiradas e laudos de fumaça preta.
   - **Visualizações Gráficas e Analíticas**:
     - *Evolução Mensal*: Barras com gradiente vertical vibrante, valores destacados em `tabular-nums` e tooltips contextuais.
     - *Top Unidades*: Barras de distribuição horizontal com indicadores de criticidade e métricas de registros.
     - *Distribuição por Natureza*: Categorização visual por tipos mais recorrentes (Patrimonial, Acesso, Danos, etc.).
     - *Indicador de Eficiência Resolutiva*: Taxa percentual de conclusão e métricas de tempo de resposta.

---

## 2. Experiência do Usuário & Design Visual

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ 🛡️ [BRASÃO METÁLICO SIGESP]                                                             │
│    Segurança Integrada                                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  DASHBOARD EXECUTIVO                                       [Período: Últimos 6 Meses]   │
│                                                                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐         │
│  │ 🔷 TOTAL GERAL │  │ 🔶 PENDENTES   │  │ 🟣 EM APURAÇÃO │  │ 🟢 ENCERRADAS  │         │
│  │ 128 Registros  │  │ 4 Aguardando   │  │ 12 Ativas      │  │ 112 Concluídas │         │
│  │ 📈 +8% no mês  │  │ ⚡ Ação rápida │  │ 🔍 Em análise  │  │ 🎯 87.5% taxa  │         │
│  └────────────────┘  └────────────────┘  └────────────────┘  └────────────────┘         │
│                                                                                         │
│  ┌──────────────────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │ 📊 Evolução Operacional de Ocorrências       │  │ 🏢 Top Unidades com Registros    │ │
│  │    [Barras verticais em gradiente cobalto]   │  │    1. Unidade Central   [████ 42]│ │
│  │    Jan   Fev   Mar   Abr   Mai   Jun         │  │    2. Portaria Sul      [███  28]│ │
│  │    [18]  [24]  [15]  [31]  [22]  [18]        │  │    3. Terminal Carga    [██   16]│ │
│  └──────────────────────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                                         │
│  ┌──────────────────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │ 🏷️ Ocorrências por Natureza                  │  │ 🌿 Monitoramento Ambiental       │ │
│  │    • Dano Patrimonial: 35%                   │  │    Laudos Fumaça Preta:          │ │
│  │    • Acesso Indevido: 28%                    │  │    🟢 94% Aprovados              │ │
│  │    • Averiguação Preventiva: 22%             │  │    🔴 6% Reprovados              │ │
│  └──────────────────────────────────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Arquitetura Técnica & Decisões Críticas

1. **Geração Instantânea e Concorrência de Protocolos**:
   - `openOccurrenceRegistration` não bloqueia mais a renderização com `await`. Atribui `instantProto` de imediato e dispara `ensureActiveProtocolReservation` em segundo plano de forma silenciosa.
   - O badge de protocolo no cabeçalho do formulário exibe imediatamente o protocolo ativo sem o estado indefinido "Reservando protocolo...".
2. **Watchdog e Liberação Total do Botão Salvar**:
   - Adicionado temporizador watchdog de 3.500 ms que garante a reativação de `submitButton` e o reset de `S.submitting = false` mesmo se houver latência na rede ou erro na cadeia assíncrona.
   - Adicionado listener de input no formulário `occForm` que restaura imediatamente o estado do botão caso o operador altere qualquer campo.
3. **Escudo Vetorial SVG Personalizado**:
   - Criação da função `renderSigespBrandShield()` em `app.js` e estilização refinada em `style.css` com suporte a temas e dimensões proporcionais na barra lateral.
4. **Dashboard Corporativo de Alta Fidelidade**:
   - Modularização das seções de métricas, gráficos e painel ambiental em `dashboardPage()` em `app.js`.
   - Adição de classes em `style.css` para cartões com gradientes coloridos (`.dash-kpi-blue`, `.dash-kpi-amber`, `.dash-kpi-purple`, `.dash-kpi-green`, `.dash-kpi-teal`), efeitos de hover suaves e visualização tabular.

---

## 4. Plano de Execução

1. **Protocolo & Botão Salvar (`app.js`)**:
   - Refatorar `openOccurrenceRegistration` e `ensureActiveProtocolReservation` para fluxo não-bloqueante.
   - Implementar watchdog de auto-destravamento do botão e listeners de digitação em `saveOcc`.
2. **Novo Brasão Vetorial do SIGESP (`app.js` & `style.css`)**:
   - Implementar `renderSigespBrandShield()` e atualizar a marca no topo do `<aside class="sidebar">`.
   - Definir os gradientes e sombras vetoriais no SVG.
3. **Redesign do Dashboard (`app.js` & `style.css`)**:
   - Reconstruir `dashboardPage()` com a nova grade de 4 KPIs principais coloridos + cartões de controle operacional.
   - Implementar barras com gradiente vibrante no gráfico de evolução e métricas de distribuição por natureza.
   - Estilizar os novos cartões e gráficos no `style.css`.
4. **Verificação & Testes**:
   - Testar tempo de resposta na abertura da tela "Nova Ocorrência".
   - Testar salvamento e garantia de ausência de travamento do botão.
   - Validar responsividade do novo escudo e contraste no Dashboard.
   - Executar `compile_applet` e reiniciar dev server.
