import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StreamsTable } from '../components/StreamsTable'; 
import { Stream } from '../types/stream'; 

const mockStreams: Stream[] = [
  {
    id: '1',
    sender: 'G_SENDER',
    recipient: 'G_RECIPIENT123',
    assetCode: 'USDC',
    totalAmount: 100,
    durationSeconds: 3600,
    startAt: 1670000000,
    createdAt: 1670000000,
    progress: { status: 'active', vestedAmount: 20, remainingAmount: 80, percentComplete: 20 }
  } as unknown as Stream
];

describe('StreamsTable Component', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders table data when streams are passed', () => {
    render(
      <StreamsTable 
        streams={mockStreams} 
        filters={{ status: 'active', sender: '', recipient: '' }}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn()}
        onEditStartTime={vi.fn()}
      />
    );
    
    // Checking for text elements populated by the array map
    expect(screen.getByTitle('G_RECIPIENT123')).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
  });

  it('renders an empty state nicely', () => {
    render(
      <StreamsTable 
        streams={[]} 
        filters={{ status: 'active', sender: '', recipient: '' }}
        onFiltersChange={vi.fn()}
        onCancel={vi.fn()}
        onEditStartTime={vi.fn()}
      />
    );
    // You can modify this string query based on what you actually render for 0 items
    expect(screen.queryByTitle('G_RECIPIENT123')).not.toBeInTheDocument();
  });
});