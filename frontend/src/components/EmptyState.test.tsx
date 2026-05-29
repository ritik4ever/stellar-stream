import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EmptyState } from './EmptyState';
import { ListStreamsFilters } from '../services/api';

describe('EmptyState Component', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders EmptyState for empty arrays', () => {
    const filters: ListStreamsFilters = {};
    const onClearFilters = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={false}
      />
    );

    expect(screen.getByText(/no streams yet/i)).toBeInTheDocument();
  });

  it('shows contextual message for active status filter', () => {
    const filters: ListStreamsFilters = { status: 'active' };
    const onClearFilters = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={true}
      />
    );

    expect(screen.getByText(/no active streams/i)).toBeInTheDocument();
  });

  it('shows contextual message for sender filter', () => {
    const filters: ListStreamsFilters = { sender: 'G_SENDER' };
    const onClearFilters = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={true}
      />
    );

    expect(screen.getByText(/no streams from this sender/i)).toBeInTheDocument();
  });

  it('shows contextual message for recipient filter', () => {
    const filters: ListStreamsFilters = { recipient: 'G_RECIPIENT' };
    const onClearFilters = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={true}
      />
    );

    expect(screen.getByText(/no streams to this recipient/i)).toBeInTheDocument();
  });

  it('shows contextual message for asset filter', () => {
    const filters: ListStreamsFilters = { asset: 'USDC' };
    const onClearFilters = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={true}
      />
    );

    expect(screen.getByText(/no streams with asset "USDC"/i)).toBeInTheDocument();
  });

  it('shows contextual message for search query filter', () => {
    const filters: ListStreamsFilters = { q: 'test' };
    const onClearFilters = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={true}
      />
    );

    expect(screen.getByText(/no streams match your search/i)).toBeInTheDocument();
  });

  it('shows Clear Filters button when filters are active', () => {
    const filters: ListStreamsFilters = { status: 'active' };
    const onClearFilters = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={true}
      />
    );

    const clearButton = screen.getByRole('button', { name: /clear filters/i });
    expect(clearButton).toBeInTheDocument();
    fireEvent.click(clearButton);
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('does not show Clear Filters button when no filters are active', () => {
    const filters: ListStreamsFilters = {};
    const onClearFilters = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={false}
      />
    );

    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it('shows Create Stream button when no streams exist at all', () => {
    const filters: ListStreamsFilters = {};
    const onClearFilters = vi.fn();
    const onCreateStream = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={false}
        onCreateStream={onCreateStream}
      />
    );

    const createButton = screen.getByRole('button', { name: /create stream/i });
    expect(createButton).toBeInTheDocument();
    fireEvent.click(createButton);
    expect(onCreateStream).toHaveBeenCalled();
  });

  it('does not show Create Stream button when streams exist', () => {
    const filters: ListStreamsFilters = { status: 'active' };
    const onClearFilters = vi.fn();
    const onCreateStream = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={true}
        onCreateStream={onCreateStream}
      />
    );

    expect(screen.queryByRole('button', { name: /create stream/i })).not.toBeInTheDocument();
  });

  it('shows both buttons when filters are active and no streams exist', () => {
    const filters: ListStreamsFilters = { status: 'active' };
    const onClearFilters = vi.fn();
    const onCreateStream = vi.fn();
    
    render(
      <EmptyState
        filters={filters}
        onClearFilters={onClearFilters}
        hasAnyStreams={false}
        onCreateStream={onCreateStream}
      />
    );

    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create stream/i })).toBeInTheDocument();
  });
});
