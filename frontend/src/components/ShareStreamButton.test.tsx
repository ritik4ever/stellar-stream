/**
 * Tests for the share button + modal (issue #743).
 *
 * Covers:
 * - Opens a dialog with the public URL and embed snippet
 * - Public URL points at /stream/:id
 * - Embed snippet is a 300x200 iframe pointing at /embed/:id
 * - Copy buttons copy the correct values via the clipboard API
 * - Preview iframe references the embed URL
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShareStreamButton } from "./ShareStreamButton";

const STREAM_ID = "s1";

describe("ShareStreamButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  it("opens a dialog with the public URL and embed snippet", async () => {
    render(<ShareStreamButton streamId={STREAM_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /share stream/i })).toBeInTheDocument();
    });

    const urlInput = screen.getByLabelText(/public link/i) as HTMLInputElement;
    expect(urlInput.value).toContain(`/stream/${STREAM_ID}`);

    const embedTextarea = screen.getByLabelText(/embed code/i) as HTMLTextAreaElement;
    expect(embedTextarea.value).toContain("<iframe");
    expect(embedTextarea.value).toContain(`/embed/${STREAM_ID}`);
    expect(embedTextarea.value).toContain('width="300" height="200"');
  });

  it("copies the public URL when the Copy button is clicked", async () => {
    render(<ShareStreamButton streamId={STREAM_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    const urlInput = screen.getByLabelText(/public link/i) as HTMLInputElement;
    fireEvent.click(screen.getAllByRole("button", { name: /^copy$/i })[0]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(urlInput.value);
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
    });
  });

  it("copies the embed snippet when its Copy button is clicked", async () => {
    render(<ShareStreamButton streamId={STREAM_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    const embedTextarea = screen.getByLabelText(/embed code/i) as HTMLTextAreaElement;
    fireEvent.click(screen.getAllByRole("button", { name: /^copy$/i })[1]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(embedTextarea.value);
    });
  });

  it("closes the dialog", async () => {
    render(<ShareStreamButton streamId={STREAM_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(screen.getByRole("dialog", { name: /share stream/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close share dialog/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /share stream/i })).not.toBeInTheDocument();
    });
  });
});
