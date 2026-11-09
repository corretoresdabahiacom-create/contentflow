import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { limitations, limitationsById } from './data';
import { LimitationsList } from './LimitationsList';

describe('LimitationsList', () => {
  it('renderiza todas as limitações por padrão', () => {
    render(<LimitationsList />);
    for (const l of limitations)
      expect(screen.getByRole('heading', { name: l.title })).toBeInTheDocument();
  });

  it('filtra por status', async () => {
    render(<LimitationsList />);
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por status'), 'limited');
    expect(
      screen.queryByRole('heading', { name: 'Renderização de vídeo' }),
    ).not.toBeInTheDocument();
    for (const l of limitations.filter((x) => x.status === 'limited')) {
      expect(screen.getByRole('heading', { name: l.title })).toBeInTheDocument();
    }
  });

  it('busca por termo', async () => {
    render(<LimitationsList />);
    await userEvent.type(screen.getByLabelText('Buscar limitação'), 'vídeo');
    expect(screen.getByRole('heading', { name: 'Renderização de vídeo' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Push' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Notificações push' })).not.toBeInTheDocument();
  });

  it('cada limitação tem âncora estável', () => {
    render(<LimitationsList />);
    for (const l of limitations)
      expect(document.getElementById(`limitacao-${l.id}`)).toBeInTheDocument();
  });

  it('ids e referências "related" são consistentes e alternativas nunca vazias', () => {
    for (const l of limitations) {
      expect(l.alternatives.length).toBeGreaterThan(0);
      for (const r of l.related ?? []) expect(limitationsById[r], `${l.id} -> ${r}`).toBeDefined();
    }
    expect(new Set(limitations.map((l) => l.id)).size).toBe(limitations.length);
  });

  it('nenhuma quota ficou como <preencher>', () => {
    for (const l of limitations)
      for (const q of l.quotas ?? []) expect(q.value).not.toContain('<preencher>');
  });
});
