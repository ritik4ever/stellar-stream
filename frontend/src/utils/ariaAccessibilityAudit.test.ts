import {
  auditAriaElementDescriptor,
  buildStreamStatusAriaAnnouncement,
} from './ariaAccessibilityAudit';

describe('ariaAccessibilityAudit (#760)', () => {
  it('flags interactive buttons and dialogs missing accessible names', () => {
    const btnFindings = auditAriaElementDescriptor({ id: 'pause-btn', role: 'button' });
    expect(btnFindings).toHaveLength(1);
    expect(btnFindings[0].code).toBe('MISSING_ACCESSIBLE_NAME');

    const dlgFindings = auditAriaElementDescriptor({ id: 'cancel-modal', role: 'dialog' });
    expect(dlgFindings).toHaveLength(1);
    expect(dlgFindings[0].code).toBe('MISSING_DIALOG_LABEL');
  });

  it('passes valid progressbar descriptors and flags out-of-range values', () => {
    expect(
      auditAriaElementDescriptor({
        id: 'stream-progress',
        role: 'progressbar',
        ariaLabel: 'Stream completion',
        ariaValueMin: 0,
        ariaValueMax: 100,
        ariaValueNow: 65,
      }),
    ).toEqual([]);

    const bad = auditAriaElementDescriptor({
      id: 'stream-progress-bad',
      role: 'progressbar',
      ariaValueMin: 0,
      ariaValueMax: 100,
      ariaValueNow: 140,
    });
    expect(bad).toHaveLength(1);
    expect(bad[0].code).toBe('INVALID_PROGRESS_RANGE');
  });

  it('builds polite and assertive live-region announcements for stream statuses', () => {
    const activeMsg = buildStreamStatusAriaAnnouncement({
      streamId: 'STR-42',
      status: 'active',
      streamedPercent: 48.25,
    });
    expect(activeMsg.ariaLive).toBe('polite');
    expect(activeMsg.text).toBe('Stream STR-42 is active (48.3% streamed).');

    const cancelledMsg = buildStreamStatusAriaAnnouncement({
      streamId: 'STR-42',
      status: 'cancelled',
      streamedPercent: 120,
    });
    expect(cancelledMsg.ariaLive).toBe('assertive');
    expect(cancelledMsg.text).toBe('Stream STR-42 is cancelled (100.0% streamed).');
  });
});
