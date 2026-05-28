import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CreateStreamForm } from '../components/CreateStreamForm';

const VALID_ADDRESS_1 = 'GBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6';
const VALID_ADDRESS_2 = 'GDBX5ZID6H4G365G7O4W6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E6U4E';

describe('CreateStreamForm Component', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders all required form fields', () => {
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={VALID_ADDRESS_1} />);
    
    expect(screen.getByLabelText(/Sender Account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Recipient Account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Asset Code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Total Amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Duration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Start In/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Stream/i })).toBeInTheDocument();
  });

  it('enables submit button and calls onCreate when form is valid', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<CreateStreamForm onCreate={onCreate} walletAddress={VALID_ADDRESS_1} />);

    // Fill out the form
    await user.clear(screen.getByLabelText(/Sender Account/i));
    await user.type(screen.getByLabelText(/Sender Account/i), VALID_ADDRESS_1);
    
    await user.clear(screen.getByLabelText(/Recipient Account/i));
    await user.type(screen.getByLabelText(/Recipient Account/i), VALID_ADDRESS_2);
    
    await user.clear(screen.getByLabelText(/Total Amount/i));
    await user.type(screen.getByLabelText(/Total Amount/i), '100');
    
    await user.clear(screen.getByLabelText(/Duration/i));
    await user.type(screen.getByLabelText(/Duration/i), '60');

    const submitButton = screen.getByRole('button', { name: /Create Stream/i });
    expect(submitButton).not.toBeDisabled();
    
    await user.click(submitButton);

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        sender: VALID_ADDRESS_1,
        recipient: VALID_ADDRESS_2,
        totalAmount: 100,
        durationSeconds: 3600, // 60 minutes * 60
      }));
    });
  });

  it('shows error and disables submit when duration is less than 1 minute (60s)', async () => {
    const user = userEvent.setup();
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={VALID_ADDRESS_1} />);

    const durationInput = screen.getByLabelText(/Duration/i);
    await user.clear(durationInput);
    await user.type(durationInput, '0');
    await user.tab(); // trigger blur

    const submitButton = screen.getByRole('button', { name: /Create Stream/i });

    // Button is already disabled because form is invalid
    expect(submitButton).toBeDisabled();
    expect(screen.getByText(/Duration must be at least 1 minute/i)).toBeInTheDocument();
  });

  it('shows error when total amount is 0 or negative', async () => {
    const user = userEvent.setup();
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={VALID_ADDRESS_1} />);

    const amountInput = screen.getByLabelText(/Total Amount/i);
    await user.clear(amountInput);
    await user.type(amountInput, '0');
    
    const submitButton = screen.getByRole('button', { name: /Create Stream/i });

    // Button is already disabled because form is invalid
    expect(submitButton).toBeDisabled();
    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
  });

  it('shows error for invalid Stellar address format', async () => {
    const user = userEvent.setup();
    render(<CreateStreamForm onCreate={vi.fn()} walletAddress={VALID_ADDRESS_1} />);

    const senderInput = screen.getByLabelText(/Sender Account/i);
    await user.clear(senderInput);
    await user.type(senderInput, 'INVALID_ADDRESS');
    
    const submitButton = screen.getByRole('button', { name: /Create Stream/i });

    // Button is already disabled because sender address is invalid
    expect(submitButton).toBeDisabled();
    expect(screen.getByText(/valid Stellar account ID/i)).toBeInTheDocument();
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup();
    // Create a promise that we can control
    let resolveSubmit: (value: void | PromiseLike<void>) => void;
    const onCreate = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveSubmit = resolve;
    }));
    
    render(<CreateStreamForm onCreate={onCreate} walletAddress={VALID_ADDRESS_1} />);

    // Fill valid data
    await user.clear(screen.getByLabelText(/Sender Account/i));
    await user.type(screen.getByLabelText(/Sender Account/i), VALID_ADDRESS_1);
    await user.clear(screen.getByLabelText(/Recipient Account/i));
    await user.type(screen.getByLabelText(/Recipient Account/i), VALID_ADDRESS_2);

    const submitButton = screen.getByRole('button', { name: /Create Stream/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveTextContent(/Creating…/i);
      expect(submitButton).toHaveAttribute('aria-busy', 'true');
    });

    // Finish submission
    await waitFor(() => {
      if (resolveSubmit) resolveSubmit();
    });

    await waitFor(() => {
      expect(submitButton).not.toHaveTextContent(/Creating…/i);
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('displays API error message when submission fails', async () => {
    render(
      <CreateStreamForm 
        onCreate={vi.fn()} 
        walletAddress={VALID_ADDRESS_1} 
        apiError="Network request failed" 
      />
    );

    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    expect(screen.getByText(/Could not reach the StellarStream API/i)).toBeInTheDocument();
  });
});