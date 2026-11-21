export interface AriaElementDescriptor {
  id: string;
  role: 'button' | 'dialog' | 'status' | 'progressbar' | 'region' | 'table';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaLive?: 'off' | 'polite' | 'assertive';
  ariaValueNow?: number;
  ariaValueMin?: number;
  ariaValueMax?: number;
  tabIndex?: number;
}

export interface AriaAuditFinding {
  elementId: string;
  code: 'MISSING_ACCESSIBLE_NAME' | 'INVALID_PROGRESS_RANGE' | 'MISSING_DIALOG_LABEL' | 'NON_FOCUSABLE_INTERACTIVE';
  message: string;
}

export function auditAriaElementDescriptor(descriptor: AriaElementDescriptor): AriaAuditFinding[] {
  const findings: AriaAuditFinding[] = [];
  const hasName = Boolean(
    (descriptor.ariaLabel && descriptor.ariaLabel.trim().length > 0) ||
      (descriptor.ariaLabelledBy && descriptor.ariaLabelledBy.trim().length > 0),
  );

  if ((descriptor.role === 'button' || descriptor.role === 'region') && !hasName) {
    findings.push({
      elementId: descriptor.id,
      code: 'MISSING_ACCESSIBLE_NAME',
      message: `Interactive or landmark element "${descriptor.id}" with role="${descriptor.role}" requires aria-label or aria-labelledby.`,
    });
  }

  if (descriptor.role === 'dialog' && !hasName) {
    findings.push({
      elementId: descriptor.id,
      code: 'MISSING_DIALOG_LABEL',
      message: `Dialog "${descriptor.id}" must declare an accessible title via aria-label or aria-labelledby.`,
    });
  }

  if (descriptor.role === 'progressbar') {
    const min = descriptor.ariaValueMin ?? 0;
    const max = descriptor.ariaValueMax ?? 100;
    const now = descriptor.ariaValueNow ?? min;
    if (min >= max || now < min || now > max) {
      findings.push({
        elementId: descriptor.id,
        code: 'INVALID_PROGRESS_RANGE',
        message: `Progressbar "${descriptor.id}" has out-of-bounds range (${now} not within [${min}, ${max}]).`,
      });
    }
  }

  if (descriptor.role === 'button' && typeof descriptor.tabIndex === 'number' && descriptor.tabIndex < -1) {
    findings.push({
      elementId: descriptor.id,
      code: 'NON_FOCUSABLE_INTERACTIVE',
      message: `Button "${descriptor.id}" uses invalid tabIndex ${descriptor.tabIndex}.`,
    });
  }

  return findings;
}

export function buildStreamStatusAriaAnnouncement(params: {
  streamId: string;
  status: 'active' | 'paused' | 'cancelled' | 'completed';
  streamedPercent: number;
}): { role: 'status'; ariaLive: 'polite' | 'assertive'; text: string } {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(params.streamedPercent) ? params.streamedPercent : 0));
  const urgent = params.status === 'cancelled';
  return {
    role: 'status',
    ariaLive: urgent ? 'assertive' : 'polite',
    text: `Stream ${params.streamId} is ${params.status} (${clamped.toFixed(1)}% streamed).`,
  };
}
