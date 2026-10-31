import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Shield,
  LayoutDashboard,
  FileText,
  Clock,
  CheckCircle,
  Leaf,
  Key,
  BarChart3,
  Users,
  History,
  Settings,
  LogOut,
  ChevronDown,
  PlusCircle,
  Truck,
  ClipboardList,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const {
    user,
    page,
    setPage,
    occurrencesMenuOpen,
    setOccurrencesMenuOpen,
    environmentMenuOpen,
    setEnvironmentMenuOpen,
    hasProfile,
    canManageUsers,
    logout,
    pendingOccurrences,
    setEditingOccurrence,
    setExistingPhotos,
    setNewPhotos,
  } = useApp();

  const [keysMenuOpen, setKeysMenuOpen] = useState(false);

  if (!user) return null;

  const isOperator = hasProfile(user, 'Operador');
  const isLeader = hasProfile(user, 'Líder');
  const canManageKeys = hasProfile(user, 'Administrador', 'Supervisor', 'Líder');
  const occActive = ['occ-register', 'occ-history', 'occ-validation', 'ocorrencias'].includes(page);
  const envActive = ['inspecao-veicular', 'hist-inspecoes'].includes(page);
  const keysActive = ['chaves', 'chaves-cautela', 'chaves-cadastro'].includes(page);
  const pendingCount = pendingOccurrences.filter(
    (x) => String(x.status_validacao || '').trim() === 'Pendente de validação'
  ).length;

  const handleNav = (targetPage: any) => {
    setEditingOccurrence(targetPage === 'occ-register' ? {} : null);
    if (targetPage === 'occ-register') {
      setExistingPhotos([]);
      setNewPhotos([]);
    }
    setPage(targetPage);
  };

  return (
    <aside className="sidebar">
      <div className="brand flex items-center gap-2">
        <Shield className="w-6 h-6 text-blue-400" />
        <span>SIGESP</span>
      </div>

      <nav className="menu">
        {/* Dashboard (hidden for Operador) */}
        {!isOperator && (
          <button
            className={`menu-btn flex items-center gap-2.5 ${page === 'dashboard' ? 'active' : ''}`}
            onClick={() => handleNav('dashboard')}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Dashboard</span>
          </button>
        )}

        {/* Ocorrências Section */}
        <div>
          <button
            className={`menu-btn menu-parent w-full flex items-center justify-between ${
              occActive ? 'active' : ''
            }`}
            onClick={() => setOccurrencesMenuOpen(!occurrencesMenuOpen)}
          >
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4" />
              <span>Ocorrências</span>
            </div>
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                occurrencesMenuOpen || occActive ? 'rotate-180' : ''
              }`}
            />
          </button>

          {(occurrencesMenuOpen || occActive) && (
            <div className="submenu open">
              <button
                className={`submenu-btn ${page === 'occ-register' ? 'active' : ''}`}
                onClick={() => handleNav('occ-register')}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Registrar Ocorrência</span>
              </button>

              {!isOperator && (
                <button
                  className={`submenu-btn ${['occ-history', 'ocorrencias'].includes(page) ? 'active' : ''}`}
                  onClick={() => handleNav('occ-history')}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Histórico</span>
                </button>
              )}

              {!isOperator && (
                <button
                  className={`submenu-btn justify-between ${page === 'occ-validation' ? 'active' : ''}`}
                  onClick={() => handleNav('occ-validation')}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Validação</span>
                  </div>
                  {pendingCount > 0 && (
                    <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {pendingCount}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Meio Ambiente (Fumaça Preta) */}
        <div>
          <button
            className={`menu-btn menu-parent w-full flex items-center justify-between ${
              envActive ? 'active' : ''
            }`}
            onClick={() => setEnvironmentMenuOpen(!environmentMenuOpen)}
          >
            <div className="flex items-center gap-2.5">
              <Leaf className="w-4 h-4" />
              <span>Meio Ambiente</span>
            </div>
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                environmentMenuOpen || envActive ? 'rotate-180' : ''
              }`}
            />
          </button>

          {(environmentMenuOpen || envActive) && (
            <div className="submenu open">
              <button
                className={`submenu-btn ${page === 'inspecao-veicular' ? 'active' : ''}`}
                onClick={() => handleNav('inspecao-veicular')}
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Inspeção Veicular</span>
              </button>
              <button
                className={`submenu-btn ${page === 'hist-inspecoes' ? 'active' : ''}`}
                onClick={() => handleNav('hist-inspecoes')}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Histórico Inspeções</span>
              </button>
            </div>
          )}
        </div>

        {/* Chaves Submenu (RBAC) */}
        <div>
          <button
            className={`menu-btn menu-parent w-full flex items-center justify-between ${
              keysActive ? 'active' : ''
            }`}
            onClick={() => setKeysMenuOpen(!keysMenuOpen)}
          >
            <div className="flex items-center gap-2.5">
              <Key className="w-4 h-4" />
              <span>Chaves</span>
            </div>
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                keysMenuOpen || keysActive ? 'rotate-180' : ''
              }`}
            />
          </button>

          {(keysMenuOpen || keysActive) && (
            <div className="submenu open">
              {/* Aba 1: Cadastro de Chaves - Acesso restrito EXCLUSIVAMENTE para Líder, Supervisor e Admin */}
              {canManageKeys && (
                <button
                  className={`submenu-btn ${page === 'chaves-cadastro' ? 'active' : ''}`}
                  onClick={() => handleNav('chaves-cadastro')}
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span>Cadastro de Chaves</span>
                </button>
              )}

              {/* Aba 2: Cautela de Chaves - Acesso liberado para Operador, Líder, Supervisor e Admin */}
              <button
                className={`submenu-btn ${['chaves', 'chaves-cautela'].includes(page) ? 'active' : ''}`}
                onClick={() => handleNav('chaves-cautela')}
              >
                <Key className="w-3.5 h-3.5" />
                <span>Cautela de Chaves</span>
              </button>
            </div>
          )}
        </div>

        {/* Relatórios */}
        {!isOperator && (
          <button
            className={`menu-btn flex items-center gap-2.5 ${page === 'relatorios' ? 'active' : ''}`}
            onClick={() => handleNav('relatorios')}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Relatórios</span>
          </button>
        )}

        {/* Usuários (Admin / Supervisor) */}
        {canManageUsers(user) && !isLeader && !isOperator && (
          <button
            className={`menu-btn flex items-center gap-2.5 ${page === 'usuarios' ? 'active' : ''}`}
            onClick={() => handleNav('usuarios')}
          >
            <Users className="w-4 h-4" />
            <span>Usuários</span>
          </button>
        )}

        {/* Auditoria */}
        {!isOperator && (
          <button
            className={`menu-btn flex items-center gap-2.5 ${page === 'auditoria' ? 'active' : ''}`}
            onClick={() => handleNav('auditoria')}
          >
            <History className="w-4 h-4" />
            <span>Auditoria</span>
          </button>
        )}

        {/* Configurações */}
        {!isOperator && (
          <button
            className={`menu-btn flex items-center gap-2.5 ${page === 'configuracoes' ? 'active' : ''}`}
            onClick={() => handleNav('configuracoes')}
          >
            <Settings className="w-4 h-4" />
            <span>Configurações</span>
          </button>
        )}

        {/* Logout */}
        <button
          className="menu-btn flex items-center gap-2.5 text-red-300 hover:text-red-100 hover:bg-red-900/40 mt-4"
          onClick={logout}
        >
          <LogOut className="w-4 h-4" />
          <span>Sair</span>
        </button>
      </nav>
    </aside>
  );
};
