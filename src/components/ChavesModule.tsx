import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { KeyRecord, KeyMovement, Profile } from '../types';
import {
  Key,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  UserCheck,
  Shield,
  RotateCcw,
  History,
  LayoutGrid,
  Table as TableIcon,
  X,
  Building2,
  MapPin,
  Tag,
  ArrowRight,
} from 'lucide-react';

interface FormErrors {
  data?: string;
  hora?: string;
  nome?: string;
  matricula?: string;
  [key: string]: string | undefined;
}

// Validação Estrita (Schema Zod-like corporativo com tipagem estrita)
export const validateWithdrawal = (data: {
  data: string;
  hora: string;
  nome: string;
  matricula: string;
}): { isValid: boolean; errors: FormErrors } => {
  const errors: FormErrors = {};

  if (!data.data || !data.data.trim()) {
    errors.data = 'A data de retirada é obrigatória.';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.data.trim())) {
    errors.data = 'Formato de data inválido (AAAA-MM-DD).';
  }

  if (!data.hora || !data.hora.trim()) {
    errors.hora = 'O horário de retirada é obrigatório.';
  } else if (!/^\d{2}:\d{2}$/.test(data.hora.trim())) {
    errors.hora = 'Formato de hora inválido (HH:MM).';
  }

  if (!data.nome || data.nome.trim().length < 3) {
    errors.nome = 'O nome do retirante deve ter pelo menos 3 caracteres.';
  }

  if (!data.matricula || data.matricula.trim().length < 2) {
    errors.matricula = 'A matrícula ou documento de identificação é obrigatório.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const validateReturn = (data: {
  data: string;
  hora: string;
  nome: string;
  matricula: string;
}): { isValid: boolean; errors: FormErrors } => {
  const errors: FormErrors = {};

  if (!data.data || !data.data.trim()) {
    errors.data = 'A data de devolução é obrigatória.';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.data.trim())) {
    errors.data = 'Formato de data inválido (AAAA-MM-DD).';
  }

  if (!data.hora || !data.hora.trim()) {
    errors.hora = 'O horário de devolução é obrigatório.';
  } else if (!/^\d{2}:\d{2}$/.test(data.hora.trim())) {
    errors.hora = 'Formato de hora inválido (HH:MM).';
  }

  if (!data.nome || data.nome.trim().length < 3) {
    errors.nome = 'O nome de quem está devolvendo deve ter pelo menos 3 caracteres.';
  }

  if (!data.matricula || data.matricula.trim().length < 2) {
    errors.matricula = 'A matrícula ou documento é obrigatório.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
};

export const ChavesModule: React.FC = () => {
  const {
    user,
    page,
    setPage,
    keys,
    hasProfile,
    authorizedUnits,
    saveKeyRecord,
    logAudit,
    setMessage,
  } = useApp();

  // Controle de Abas e Permissões (RBAC)
  // Aba 1: Cadastro de Chaves -> Restrito EXCLUSIVAMENTE para Líder, Supervisor e Admin
  // Aba 2: Cautela de Chaves -> Liberado para Operador, Líder, Supervisor e Admin
  const canManage = user ? hasProfile(user, 'Administrador', 'Supervisor', 'Líder') : false;
  const initialTab = page === 'chaves-cadastro' && canManage ? 'cadastro' : 'cautela';
  const [activeTab, setActiveTab] = useState<'cautela' | 'cadastro'>(initialTab);

  // Filtros e Visualização
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'livre' | 'retirada'>('todos');
  const [unitFilter, setUnitFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Modais de Ação
  const [withdrawTarget, setWithdrawTarget] = useState<KeyRecord | null>(null);
  const [returnTarget, setReturnTarget] = useState<KeyRecord | null>(null);
  const [historyTarget, setHistoryTarget] = useState<KeyRecord | null>(null);
  const [editingKey, setEditingKey] = useState<KeyRecord | null>(null);

  // Estados dos Formulários dos Modais
  const [withdrawForm, setWithdrawForm] = useState({
    data: new Date().toISOString().slice(0, 10),
    hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    nome: '',
    matricula: '',
    observacoes: '',
  });

  const [returnForm, setReturnForm] = useState({
    data: new Date().toISOString().slice(0, 10),
    hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    nome: '',
    matricula: '',
    observacoes: '',
  });

  const [errors, setErrors] = useState<FormErrors>({});

  // Filtragem e Normalização
  const filteredKeys = useMemo(() => {
    return keys.filter((k) => {
      const isLivre = String(k.status).toLowerCase() === 'livre' || String(k.status).toLowerCase() === 'disponível';
      if (statusFilter === 'livre' && !isLivre) return false;
      if (statusFilter === 'retirada' && isLivre) return false;
      if (unitFilter && k.unidade !== unitFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchCode = k.codigo.toLowerCase().includes(q);
        const matchDesc = k.descricao.toLowerCase().includes(q);
        const matchSetor = k.setor.toLowerCase().includes(q);
        const matchUnit = k.unidade.toLowerCase().includes(q);
        if (!matchCode && !matchDesc && !matchSetor && !matchUnit) return false;
      }
      return true;
    });
  }, [keys, statusFilter, unitFilter, searchQuery]);

  const kpis = useMemo(() => {
    const total = keys.length;
    const livres = keys.filter(
      (k) => String(k.status).toLowerCase() === 'livre' || String(k.status).toLowerCase() === 'disponível'
    ).length;
    const retiradas = total - livres;
    const taxa = total > 0 ? Math.round((livres / total) * 100) : 100;
    return { total, livres, retiradas, taxa };
  }, [keys]);

  // Abertura do Modal de Retirada
  const handleOpenWithdraw = (key: KeyRecord) => {
    setWithdrawTarget(key);
    setErrors({});
    const now = new Date();
    setWithdrawForm({
      data: now.toISOString().slice(0, 10),
      hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      nome: '',
      matricula: '',
      observacoes: '',
    });
  };

  // Submissão da Retirada
  const handleConfirmWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawTarget || !user) return;

    const validation = validateWithdrawal(withdrawForm);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    const updatedKey: KeyRecord = {
      ...withdrawTarget,
      status: 'Retirada',
      observacoes: withdrawForm.observacoes ? `Retirada: ${withdrawForm.observacoes}` : withdrawTarget.observacoes,
      data_atualizacao: new Date().toISOString(),
      usuario_ultima_alteracao: user.login,
      versao_registro: String((+withdrawTarget.versao_registro || 0) + 1),
    };

    await saveKeyRecord(updatedKey);
    logAudit(
      'CHAVES',
      'CHAVE_RETIRADA',
      withdrawTarget.id_chave,
      withdrawTarget.codigo,
      `Retirada por ${withdrawForm.nome} (${withdrawForm.matricula}) em ${withdrawForm.data} às ${withdrawForm.hora}`
    );

    setMessage(`Chave ${withdrawTarget.codigo} retirada com sucesso.`);
    setWithdrawTarget(null);
  };

  // Abertura do Modal de Devolução
  const handleOpenReturn = (key: KeyRecord) => {
    setReturnTarget(key);
    setErrors({});
    const now = new Date();
    setReturnForm({
      data: now.toISOString().slice(0, 10),
      hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      nome: '',
      matricula: '',
      observacoes: '',
    });
  };

  // Submissão da Devolução
  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget || !user) return;

    const validation = validateReturn(returnForm);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    const updatedKey: KeyRecord = {
      ...returnTarget,
      status: 'Livre',
      observacoes: returnForm.observacoes ? `Devolução: ${returnForm.observacoes}` : returnTarget.observacoes,
      data_atualizacao: new Date().toISOString(),
      usuario_ultima_alteracao: user.login,
      versao_registro: String((+returnTarget.versao_registro || 0) + 1),
    };

    await saveKeyRecord(updatedKey);
    logAudit(
      'CHAVES',
      'CHAVE_DEVOLVIDA',
      returnTarget.id_chave,
      returnTarget.codigo,
      `Devolvida por ${returnForm.nome} (${returnForm.matricula}) em ${returnForm.data} às ${returnForm.hora}`
    );

    setMessage(`Chave ${returnTarget.codigo} devolvida ao claviculário com sucesso.`);
    setReturnTarget(null);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Cabeçalho Corporativo e Seletor de Abas */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-2xl shadow-xs">
              🔑
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">
                Controle de Chaves & Claviculário
              </h1>
              <p className="text-xs md:text-sm text-slate-500 mt-0.5">
                Gestão rigorosa de cautelas, retiradas, devoluções e custódia patrimonial
              </p>
            </div>
          </div>

          {canManage && activeTab === 'cautela' && (
            <button
              type="button"
              onClick={() => setActiveTab('cadastro')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Cadastrar Chave</span>
            </button>
          )}
        </div>

        {/* Submenu de Duas Abas com RBAC */}
        <div className="flex items-center gap-2 pt-4">
          <button
            type="button"
            onClick={() => setActiveTab('cautela')}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all min-h-[44px] ${
              activeTab === 'cautela'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Aba 2: Cautela de Chaves</span>
            <span
              className={`px-2 py-0.5 text-xs rounded-full ${
                activeTab === 'cautela' ? 'bg-blue-800 text-blue-100' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {keys.length}
            </span>
          </button>

          {/* Aba 1: Restrita para Líder, Supervisor e Admin */}
          {canManage ? (
            <button
              type="button"
              onClick={() => setActiveTab('cadastro')}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all min-h-[44px] ${
                activeTab === 'cadastro'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Aba 1: Cadastro de Chaves</span>
              <span className="text-[11px] font-medium opacity-80">(Gestão)</span>
            </button>
          ) : (
            <div
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-400 font-medium cursor-not-allowed"
              title="Cadastro restrito para Líder, Supervisor e Administrador"
            >
              <span className="opacity-70">🔒 Cadastro Restrito</span>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total de Chaves</span>
          <div className="text-2xl font-black text-slate-900 mt-1">{kpis.total}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs bg-emerald-50/20">
          <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Livres no Claviculário
          </span>
          <div className="text-2xl font-black text-emerald-700 mt-1">{kpis.livres}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-xs bg-rose-50/20">
          <span className="text-xs font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            Retiradas em Posse
          </span>
          <div className="text-2xl font-black text-rose-700 mt-1">{kpis.retiradas}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-xs bg-blue-50/20">
          <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">Disponibilidade</span>
          <div className="text-2xl font-black text-blue-700 mt-1">{kpis.taxa}%</div>
        </div>
      </div>

      {/* ABA 2: CAUTELA DE CHAVES */}
      {activeTab === 'cautela' && (
        <div className="space-y-4">
          {/* Barra de Filtros e Busca */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar por código, descrição, setor ou unidade..."
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro por Status */}
              <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setStatusFilter('todos')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'todos' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Todas ({kpis.total})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('livre')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'livre' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Livres ({kpis.livres})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('retirada')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    statusFilter === 'retirada' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Retiradas ({kpis.retiradas})
                </button>
              </div>

              {/* Toggle de Visualização (Cards vs Tabela) */}
              <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Visualização em Cards"
                  className={`p-2 rounded-lg transition-all ${
                    viewMode === 'grid' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  title="Visualização em Tabela"
                  className={`p-2 rounded-lg transition-all ${
                    viewMode === 'table' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500'
                  }`}
                >
                  <TableIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Listagem de Chaves (Grid de Cards) */}
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredKeys.length > 0 ? (
                filteredKeys.map((k) => {
                  const isLivre =
                    String(k.status).toLowerCase() === 'livre' || String(k.status).toLowerCase() === 'disponível';

                  return (
                    <div
                      key={k.id_chave}
                      className={`bg-white rounded-2xl border transition-all shadow-xs flex flex-col justify-between overflow-hidden ${
                        isLivre
                          ? 'border-emerald-200/90 hover:border-emerald-300'
                          : 'border-rose-200/90 hover:border-rose-300 bg-rose-50/10'
                      }`}
                    >
                      <div className="p-5">
                        {/* Header do Card com Código e Badge Dinâmico */}
                        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">🔑</span>
                            <span className="font-extrabold text-base text-slate-900 tracking-tight">
                              {k.codigo}
                            </span>
                          </div>

                          {/* Badge de Status Dinâmico */}
                          {isLivre ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                              Livre
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                              Retirada
                            </span>
                          )}
                        </div>

                        {/* Corpo do Card */}
                        <div className="mt-3.5 space-y-2.5">
                          <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">
                            {k.descricao}
                          </h3>

                          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                            <span className="inline-flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-md">
                              <Building2 className="w-3 h-3 text-slate-400" />
                              {k.unidade}
                            </span>
                            <span className="inline-flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-md">
                              <Tag className="w-3 h-3 text-slate-400" />
                              {k.setor}
                            </span>
                          </div>

                          {/* Banner Informativo de Status */}
                          {isLivre ? (
                            <div className="mt-3 p-3 bg-emerald-50/80 rounded-xl border border-emerald-100 flex items-center gap-2 text-xs text-emerald-800">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>Disponível no claviculário para retirada.</span>
                            </div>
                          ) : (
                            <div className="mt-3 p-3 bg-amber-50 rounded-xl border border-amber-200/80 text-xs text-amber-900 space-y-1">
                              <div className="font-bold flex items-center gap-1.5 text-amber-800">
                                <Clock className="w-3.5 h-3.5" />
                                <span>Posse Operacional Ativa</span>
                              </div>
                              <p className="line-clamp-2 text-slate-700">
                                {k.observacoes || 'Chave em uso pela equipe de campo.'}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Footer do Card com Ações Dinâmicas (Botões Grandes Touch-friendly para Tablets) */}
                      <div className="p-4 bg-slate-50/70 border-t border-slate-100 flex items-center gap-2">
                        {isLivre ? (
                          <button
                            type="button"
                            onClick={() => handleOpenWithdraw(k)}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all min-h-[44px]"
                          >
                            <Key className="w-4 h-4" />
                            <span>Retirar Chave</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenReturn(k)}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all min-h-[44px]"
                          >
                            <RotateCcw className="w-4 h-4" />
                            <span>Devolver Chave</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setHistoryTarget(k)}
                          className="px-3 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all min-h-[44px]"
                          title="Ver Histórico"
                        >
                          Histórico
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="col-span-full py-16 text-center bg-white rounded-2xl border border-slate-200 p-8">
                  <span className="text-4xl">🔍</span>
                  <h3 className="mt-3 font-bold text-slate-800 text-base">Nenhuma chave encontrada</h3>
                  <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                    Não encontramos registros com os filtros aplicados. Tente ajustar os termos de pesquisa.
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Tabela Limpa */
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs font-bold uppercase">
                    <tr>
                      <th className="px-5 py-3.5">Código</th>
                      <th className="px-5 py-3.5">Descrição</th>
                      <th className="px-5 py-3.5">Setor</th>
                      <th className="px-5 py-3.5">Unidade</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredKeys.length > 0 ? (
                      filteredKeys.map((k) => {
                        const isLivre =
                          String(k.status).toLowerCase() === 'livre' ||
                          String(k.status).toLowerCase() === 'disponível';
                        return (
                          <tr key={k.id_chave} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-5 py-3.5 font-extrabold text-slate-900 whitespace-nowrap">
                              {k.codigo}
                            </td>
                            <td className="px-5 py-3.5 font-medium text-slate-800">{k.descricao}</td>
                            <td className="px-5 py-3.5 text-slate-600">{k.setor}</td>
                            <td className="px-5 py-3.5 text-slate-600">{k.unidade}</td>
                            <td className="px-5 py-3.5">
                              {isLivre ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                                  Livre
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                                  Retirada
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                {isLivre ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenWithdraw(k)}
                                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all min-h-[38px]"
                                  >
                                    Retirar Chave
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenReturn(k)}
                                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all min-h-[38px]"
                                  >
                                    Devolver Chave
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setHistoryTarget(k)}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium min-h-[38px]"
                                >
                                  Histórico
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-400">
                          Nenhuma chave cadastrada para exibição.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA 1: CADASTRO DE CHAVES (RBAC: LÍDER, SUPERVISOR, ADMIN) */}
      {activeTab === 'cadastro' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Formulário de Cadastro / Edição */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs lg:col-span-1">
            <h2 className="text-lg font-black text-slate-900 border-b border-slate-100 pb-3 mb-4">
              {editingKey ? 'Editar Chave' : 'Cadastrar Nova Chave'}
            </h2>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const d = Object.fromEntries(new FormData(form));
                if (!d.codigo || !d.descricao || !d.setor || !d.unidade) {
                  alert('Preencha os campos obrigatórios.');
                  return;
                }
                await saveKeyRecord({
                  id_chave: editingKey?.id_chave,
                  codigo: String(d.codigo).trim().toUpperCase(),
                  descricao: String(d.descricao).trim(),
                  setor: String(d.setor).trim(),
                  unidade: String(d.unidade).trim(),
                  status: (d.status as any) || 'Livre',
                  observacoes: String(d.observacoes || '').trim(),
                });
                setEditingKey(null);
                form.reset();
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Código da Chave <span className="text-rose-600">*</span>
                </label>
                <input
                  name="codigo"
                  required
                  defaultValue={editingKey?.codigo || ''}
                  placeholder="Ex: CH-ALMOX-01"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl uppercase font-semibold focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Descrição / Local <span className="text-rose-600">*</span>
                </label>
                <input
                  name="descricao"
                  required
                  defaultValue={editingKey?.descricao || ''}
                  placeholder="Ex: Portão Principal de Entrada"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Setor / Departamento <span className="text-rose-600">*</span>
                </label>
                <input
                  name="setor"
                  required
                  defaultValue={editingKey?.setor || ''}
                  placeholder="Ex: Almoxarifado Central"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Unidade <span className="text-rose-600">*</span>
                </label>
                <select
                  name="unidade"
                  defaultValue={editingKey?.unidade || authorizedUnits[0] || ''}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                >
                  {authorizedUnits.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Status Inicial
                </label>
                <select
                  name="status"
                  defaultValue={editingKey?.status || 'Livre'}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                >
                  <option value="Livre">Livre (Disponível no claviculário)</option>
                  <option value="Retirada">Retirada (Em uso operacional)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Observações
                </label>
                <textarea
                  name="observacoes"
                  rows={2}
                  defaultValue={editingKey?.observacoes || ''}
                  placeholder="Informações adicionais sobre chave cópia ou restrições..."
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors min-h-[44px]"
                >
                  {editingKey ? 'Salvar Alterações' : 'Cadastrar Chave'}
                </button>
                {editingKey && (
                  <button
                    type="button"
                    onClick={() => setEditingKey(null)}
                    className="py-3 px-4 rounded-xl font-medium text-sm border border-slate-200 text-slate-600 hover:bg-slate-100 min-h-[44px]"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Tabela de Acervo */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs lg:col-span-2">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900">
                Acervo de Chaves Cadastradas ({keys.length})
              </h3>
              <span className="text-xs text-slate-500">Gestão Corporativa</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs font-bold uppercase">
                  <tr>
                    <th className="px-5 py-3.5">Código</th>
                    <th className="px-5 py-3.5">Descrição</th>
                    <th className="px-5 py-3.5">Setor</th>
                    <th className="px-5 py-3.5">Unidade</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keys.map((k) => (
                    <tr key={k.id_chave} className="hover:bg-slate-50/80">
                      <td className="px-5 py-3.5 font-extrabold text-slate-900">{k.codigo}</td>
                      <td className="px-5 py-3.5 text-slate-800">{k.descricao}</td>
                      <td className="px-5 py-3.5 text-slate-600">{k.setor}</td>
                      <td className="px-5 py-3.5 text-slate-600">{k.unidade}</td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {k.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEditingKey(k)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-blue-700 text-xs font-bold min-h-[38px]"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: RETIRADA DE CHAVE (CAUTELA) */}
      {withdrawTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header do Modal */}
            <div className="p-5 bg-gradient-to-r from-blue-900 to-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base flex items-center gap-2">
                  <span>🔑</span>
                  <span>Retirar Chave (Cautela Operacional)</span>
                </h3>
                <p className="text-xs text-blue-200 mt-0.5">
                  Preencha os campos obrigatórios do solicitante da chave
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWithdrawTarget(null)}
                className="text-white/80 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sumário da Chave */}
            <div className="p-4 bg-slate-50 border-b border-slate-200/80 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-lg">
                🔑
              </div>
              <div>
                <div className="font-black text-slate-900 text-sm">{withdrawTarget.codigo}</div>
                <div className="text-xs text-slate-600">
                  {withdrawTarget.descricao} · <b>{withdrawTarget.unidade}</b>
                </div>
              </div>
            </div>

            {/* Formulário com Validação Zod */}
            <form onSubmit={handleConfirmWithdraw} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Data da Retirada <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={withdrawForm.data}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, data: e.target.value })}
                    className={`w-full px-3 py-2 text-sm bg-slate-50 border rounded-xl focus:bg-white focus:outline-none ${
                      errors.data ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200'
                    }`}
                  />
                  {errors.data && (
                    <span className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.data}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Hora da Retirada <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={withdrawForm.hora}
                    onChange={(e) => setWithdrawForm({ ...withdrawForm, hora: e.target.value })}
                    className={`w-full px-3 py-2 text-sm bg-slate-50 border rounded-xl focus:bg-white focus:outline-none ${
                      errors.hora ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200'
                    }`}
                  />
                  {errors.hora && (
                    <span className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.hora}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Nome do Solicitante <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nome completo de quem está pegando a chave"
                  value={withdrawForm.nome}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, nome: e.target.value })}
                  className={`w-full px-3.5 py-2.5 text-sm bg-slate-50 border rounded-xl focus:bg-white focus:outline-none ${
                    errors.nome ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200'
                  }`}
                  autoFocus
                />
                {errors.nome && (
                  <span className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.nome}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Matrícula / Documento <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: MT-44812 ou RG/CPF"
                  value={withdrawForm.matricula}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, matricula: e.target.value })}
                  className={`w-full px-3.5 py-2.5 text-sm bg-slate-50 border rounded-xl focus:bg-white focus:outline-none ${
                    errors.matricula ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200'
                  }`}
                />
                {errors.matricula && (
                  <span className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.matricula}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Observações / Finalidade do Uso
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Manutenção preventiva na bomba d'água..."
                  value={withdrawForm.observacoes}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, observacoes: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setWithdrawTarget(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-100 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-xs transition-colors min-h-[44px]"
                >
                  Confirmar Retirada
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: DEVOLUÇÃO DE CHAVE */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header do Modal */}
            <div className="p-5 bg-gradient-to-r from-emerald-900 to-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base flex items-center gap-2">
                  <span>↩️</span>
                  <span>Devolver Chave ao Claviculário</span>
                </h3>
                <p className="text-xs text-emerald-200 mt-0.5">
                  Confirme a devolução física da chave e seu estado de conservação
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="text-white/80 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sumário da Chave */}
            <div className="p-4 bg-slate-50 border-b border-slate-200/80 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-lg">
                ↩️
              </div>
              <div>
                <div className="font-black text-slate-900 text-sm">{returnTarget.codigo}</div>
                <div className="text-xs text-slate-600">
                  {returnTarget.descricao} · <b>{returnTarget.unidade}</b>
                </div>
              </div>
            </div>

            {/* Formulário com Validação Zod */}
            <form onSubmit={handleConfirmReturn} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Data da Devolução <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={returnForm.data}
                    onChange={(e) => setReturnForm({ ...returnForm, data: e.target.value })}
                    className={`w-full px-3 py-2 text-sm bg-slate-50 border rounded-xl focus:bg-white focus:outline-none ${
                      errors.data ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200'
                    }`}
                  />
                  {errors.data && (
                    <span className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.data}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Hora da Devolução <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={returnForm.hora}
                    onChange={(e) => setReturnForm({ ...returnForm, hora: e.target.value })}
                    className={`w-full px-3 py-2 text-sm bg-slate-50 border rounded-xl focus:bg-white focus:outline-none ${
                      errors.hora ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200'
                    }`}
                  />
                  {errors.hora && (
                    <span className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.hora}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Nome de quem está devolvendo <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nome completo de quem entrega a chave"
                  value={returnForm.nome}
                  onChange={(e) => setReturnForm({ ...returnForm, nome: e.target.value })}
                  className={`w-full px-3.5 py-2.5 text-sm bg-slate-50 border rounded-xl focus:bg-white focus:outline-none ${
                    errors.nome ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200'
                  }`}
                  autoFocus
                />
                {errors.nome && (
                  <span className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.nome}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Matrícula / Documento <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: MT-44812 ou RG/CPF"
                  value={returnForm.matricula}
                  onChange={(e) => setReturnForm({ ...returnForm, matricula: e.target.value })}
                  className={`w-full px-3.5 py-2.5 text-sm bg-slate-50 border rounded-xl focus:bg-white focus:outline-none ${
                    errors.matricula ? 'border-rose-500 bg-rose-50/20' : 'border-slate-200'
                  }`}
                />
                {errors.matricula && (
                  <span className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.matricula}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Observações sobre a Devolução / Estado da Chave
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Chave entregue em perfeito estado no armário..."
                  value={returnForm.observacoes}
                  onChange={(e) => setReturnForm({ ...returnForm, observacoes: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-100 min-h-[44px]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-xs transition-colors min-h-[44px]"
                >
                  Confirmar Devolução
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: HISTÓRICO DA CHAVE */}
      {historyTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-slate-900">
                  Histórico de Movimentações · {historyTarget.codigo}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {historyTarget.descricao} ({historyTarget.unidade})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryTarget(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
                <div className="font-bold text-slate-800 mb-1">Status Atual: {historyTarget.status}</div>
                <div>Última alteração por: <b>{historyTarget.usuario_ultima_alteracao}</b></div>
                <div>Data de atualização: {new Date(historyTarget.data_atualizacao).toLocaleString('pt-BR')}</div>
                {historyTarget.observacoes && (
                  <div className="mt-2 text-slate-700 italic">"{historyTarget.observacoes}"</div>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setHistoryTarget(null)}
                className="px-5 py-2 rounded-xl bg-slate-800 text-white font-bold text-sm min-h-[44px]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
