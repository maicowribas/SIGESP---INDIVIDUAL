import React from 'react';
import { useApp } from '../context/AppContext';
import { RefreshCw, UserCheck } from 'lucide-react';

export const Topbar: React.FC = () => {
  const { user, hasProfile, setMessage } = useApp();

  if (!user) return null;

  const isOperator = hasProfile(user, 'Operador');

  const handleRefresh = () => {
    setMessage('Dados atualizados.');
    setTimeout(() => setMessage(''), 3000);
  };

  return (
    <header className="topbar">
      <div className="flex items-center gap-2">
        <UserCheck className="w-5 h-5 text-blue-600" />
        <span className="font-semibold text-slate-800">
          {user.nome} <span className="text-slate-400 font-normal">·</span>{' '}
          <span className="inline-block bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wide">
            {user.perfil}
          </span>
        </span>
      </div>

      {!isOperator && (
        <button
          type="button"
          onClick={handleRefresh}
          className="btn flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 shadow-sm"
          title="Recarregar dados"
        >
          <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
          <span>Atualizar</span>
        </button>
      )}
    </header>
  );
};
