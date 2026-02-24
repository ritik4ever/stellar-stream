import {
  STELLAR_ACCOUNT_REGEX,
  assetCodeSchema,
  createStreamPayloadSchema,
  stellarAccountIdSchema,
  totalAmountSchema,
} from "../../../backend/src/validation/schemas";

export function isStellarAccount(value: string): boolean {
  return STELLAR_ACCOUNT_REGEX.test(value.trim());
}

export interface FieldErrors {
  sender?: string;
  recipient?: string;
  assetCode?: string;
  totalAmount?: string;
  durationHours?: string;
  startInMinutes?: string;
}

export interface FormValues {
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: string;
  durationHours: string;
  startInMinutes: string;
}

export function validateForm(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};

  // --- Sender ---
  const senderTrimmed = values.sender.trim();
  if (!senderTrimmed) {
    errors.sender = "Sender account is required.";
  } else {
    const senderResult = stellarAccountIdSchema.safeParse(senderTrimmed);
    if (!senderResult.success) {
      errors.sender = senderResult.error.issues[0]?.message;
    }
  }

  // --- Recipient ---
  const recipientTrimmed = values.recipient.trim();
  if (!recipientTrimmed) {
    errors.recipient = "Recipient account is required.";
  } else {
    const recipientResult = stellarAccountIdSchema.safeParse(recipientTrimmed);
    if (!recipientResult.success) {
      errors.recipient = recipientResult.error.issues[0]?.message;
    }
  }

  const sameAccountCheck = createStreamPayloadSchema.safeParse({
    sender: senderTrimmed,
    recipient: recipientTrimmed,
    assetCode: values.assetCode,
    totalAmount: values.totalAmount,
    durationSeconds: 3600,
  });
  if (!sameAccountCheck.success) {
    const recipientIssue = sameAccountCheck.error.issues.find(
      (issue) => issue.path.join(".") === "recipient",
    );
    if (recipientIssue) {
      errors.recipient = recipientIssue.message;
    }
  }

  // --- Asset code ---
  const assetTrimmed = values.assetCode.trim();
  if (!assetTrimmed) {
    errors.assetCode = "Asset code is required.";
  } else {
    const assetResult = assetCodeSchema.safeParse(assetTrimmed);
    if (!assetResult.success) {
      errors.assetCode = assetResult.error.issues[0]?.message;
    }
  }

  // --- Total amount ---
  const amountRaw = values.totalAmount.trim();
  if (amountRaw === "") {
    errors.totalAmount = "Total amount is required.";
  } else {
    const amountResult = totalAmountSchema.safeParse(amountRaw);
    if (!amountResult.success) {
      errors.totalAmount = amountResult.error.issues[0]?.message;
    }
  }

  // --- Duration ---
  const durationNum = Number(values.durationHours);
  if (values.durationHours === "" || isNaN(durationNum)) {
    errors.durationHours = "Duration is required.";
  } else if (!Number.isInteger(durationNum) || durationNum < 1) {
    errors.durationHours = "Duration must be a whole number of hours, minimum 1.";
  }

  // --- Start in minutes (optional, 0 = start immediately) ---
  const startNum = Number(values.startInMinutes);
  if (values.startInMinutes === "" || isNaN(startNum)) {
    errors.startInMinutes = "Enter 0 to start immediately, or a positive number of minutes.";
  } else if (!Number.isInteger(startNum) || startNum < 0) {
    errors.startInMinutes = "Must be 0 or a positive whole number.";
  }

  return errors;
}

/** Returns true only when there are zero error keys. */
export function isFormValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
