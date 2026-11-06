# Plano de Implementação: Login Case-Insensitive e Redesign Corporativo de Usuários

Modernização da tela de Usuários com layout em cards/tabela inspirado no módulo de Chaves, abertura de formulário em modal popup com abas e autenticação com indiferença a maiúsculas/minúsculas no campo de login.

---

### Decisões do Usuário & Requisitos Confirmados
- **Login Case-Insensitive**: O login do usuário é autenticado de forma indiferente se digitado em maiúsculas ou minúsculas (`login.trim().toLowerCase()`), preservando o hash de senha PBKDF2/SHA-256 intacto.
- **Formato da Tela de Usuários**: Grade de cards corporativos moderna com alternância dinâmica para visualização em tabela (idêntico à experiência de Chaves).
- **Formulário de Criação/Edição**: Modal popup corporativo com abas (`Dados Pessoais & Acesso`, `Escopo & Lotação`, `Permissões & Segurança`), substituindo a coluna lateral fixa que comprimia a tabela.

---

## 1. Visão Geral & Conceito

A tela de Usuários passará a seguir o mesmo padrão estético e de usabilidade de alta densidade inaugurado no módulo de Chaves:
- **KPIs de Gestão de Acesso**: Acervo total de usuários, usuários ativos, usuários bloqueados e distribuição por perfil (Administradores, Supervisores, Operadores).
- **Barra de Ferramentas & Filtros**: Busca em tempo real (nome, login, matrícula, e-mail), filtro por perfil, filtro por status (Ativo/Inativo) e alternador de visualização (`🗂️ Cards` / `📑 Tabela`).
- **Cards de Usuário Corporativos**:
  - Avatar gerado com as iniciais do nome e cor semântica do perfil.
  - Indicador de status claro (Ativo / Inativo).
  - Identificação de login com tipografia monoespelhada (`tabular-nums`).
  - Lotação e escopo operacional (Supervisão e Unidades vinculadas).
  - Botões de ação rápida organizados: `✏️ Editar`, `🔑 Alterar Senha`, `🔒/🔓 Alternar Status` e `🗑️ Remover`.
- **Modal de Usuário em Abas**:
  - Aba 1: Identificação (Nome completo, Login único, Status, Senha inicial se novo).
  - Aba 2: Lotação Operacional (Supervisão responsável e Unidades autorizadas com seleção granular).
  - Aba 3: Perfil de Acesso & Auditoria (Perfil com resumo das permissões corporativas associadas).

---

## 2. Experiência do Usuário & Design Visual

```
┌────────────────────────────────────────────────────────────────────────┐
│ Gestão de Usuários e Permissões                  [+ Novo Usuário]     │
├────────────────────────────────────────────────────────────────────────┤
│ [👥 Total: 12]  [🟢 Ativos: 11]  [🔒 Bloqueados: 1]  [🏢 Unidades: 8]  │
├────────────────────────────────────────────────────────────────────────┤
│ [🔍 Buscar usuário...] [Perfil: Todos ▼] [Status: Todos ▼] [🗂️ Cards|📑]│
├────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────┐│
│ │ 👤 Carlos Silva [Ativo]│  │ 👤 Marcos Rocha [Ativo]│  │ 👤 Ana Souza ││
│ │ @carlos.silva · Admin │  │ @marcos.op · Operador │  │ @ana.sup     ││
│ │ 📍 Matriz / 4 Unidades│  │ 📍 Portaria Principal │  │ 📍 Supervisão││
│ │ [✏️ Editar] [🔑 Senha] │  │ [✏️ Editar] [🔑 Senha] │  │ [✏️ Editar]  ││
│ └───────────────────────┘  └───────────────────────┘  └──────────────┘│
└────────────────────────────────────────────────────────────────────────┘
```

- **Paleta de Cores**:
  - Administrador: Roxo Corporativo (`#6366f1` / `#e0e7ff`).
  - Supervisor: Azul Petróleo (`#0284c7` / `#e0f2fe`).
  - Operador: Verde Esmeralda (`#059669` / `#ecfdf5`).
  - Status Ativo: Verde militar suave com dot indicador.
  - Status Inativo: Âmbar/Vermelho suave.

---

## 3. Decisões Técnicas & Segurança (SecDevOps)

1. **Login Case-Insensitive**:
   - Comparação normalizada: `user.login.trim().toLowerCase() === d.login.trim().toLowerCase()`.
   - Na criação/validação de duplicidade de login: validação contra logins existentes com `toLowerCase()`, evitando conflitos onde `Admin` e `admin` coexistam.
   - Preservação estrita dos hashes de senha PBKDF2 existentes.
2. **Arquitetura de Estado & Reatividade**:
   - Variáveis de estado `S.userViewMode = 'grid' | 'table'`, `S.userSearchQuery = ''`, `S.userProfileFilter = 'todos'`, `S.userStatusFilter = 'todos'`.
   - Abertura de modal através de `S.userModal = { id_usuario, tab: 'geral', data: {...} }`, liberando 100% da largura útil da tela para os cards de usuários.
3. **Controle de Acesso Baseado em Funções (RBAC)**:
   - Mantém as regras já consolidadas: supervisores só gerenciam usuários de sua respectiva supervisão; administradores gerenciam escopo global; proibição de remover a si próprio ou o último administrador ativo.

---

## 4. Plano de Execução

1. **Autenticação**:
   - Ajustar `login(ev)` em `app.js` para normalizar `d.login.trim().toLowerCase()`.
   - Atualizar a verificação de duplicidade no salvamento de usuários em `saveUser`.
2. **Componentes e Visualização de Usuários**:
   - Implementar `usersPage()` com KPIs, toolbar (busca, filtros e alternador Cards/Tabela) e a grade `users-cards-grid`.
   - Implementar o modal popup com abas `userEditModal()`.
3. **Estilos em `style.css`**:
   - Regras para `.user-card`, `.user-card-header`, `.user-avatar`, `.user-badge-role`, `.user-modal-tabs` e animações de transição.
4. **Verificação & Testes**:
   - Teste de login com maiúsculas/minúsculas.
   - Teste de criação e edição via modal em abas.
   - Teste de alternância entre Cards e Tabela.
   - Compilação (`compile_applet`) e checagem de integridade sintática.
