import {
  STELLAR_ACCOUNT_REGEX,
  assetCodeSchema,
  createStreamPayloadSchema,
  stellarAccountIdSchema,
  totalAmountSchema,
} from "../validation/schemas";

/**
 * Validates if a string is a properly formatted Stellar account ID.
 * @param value - The account ID string to validate.
 * @returns True if valid, false otherwise.
 */
export function isStellarAccount(value: string): boolean {
  return STELLAR_ACCOUNT_REGEX.test(value.trim());
}

/**
 * Represents validation errors for each field in the stream creation form.
 */
export interface FieldErrors {
  sender?: string;
  recipient?: string;
  assetCode?: string;
  totalAmount?: string;
  durationMinutes?: string;
  startInMinutes?: string;
  cliffDays?: string;
}

/**
 * Represents the raw string values from the stream creation form.
 */
export interface FormValues {
  streamType: string;
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: string;
  durationMinutes: string;
  startInMinutes: string;
  cliffDays: string;
}

/**
 * Validates the stream creation form values against business rules and schemas.
 * @param values - The form values to validate.
 * @returns An object containing error messages for any invalid fields.
 */
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
    } else if (recipientTrimmed === senderTrimmed) {
      errors.recipient = "Recipient cannot be the same as sender.";
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
  const durationNum = Number(values.durationMinutes);
  if (values.durationMinutes === "" || isNaN(durationNum)) {
    errors.durationMinutes = "Duration is required.";
  } else if (!Number.isInteger(durationNum) || durationNum < 1) {
    errors.durationMinutes = "Duration must be at least 1 minute.";
  }

  // --- Start in minutes (optional, 0 = start immediately) ---
  const startNum = Number(values.startInMinutes);
  if (values.startInMinutes === "" || isNaN(startNum)) {
    errors.startInMinutes = "Enter 0 to start immediately, or a positive number of minutes.";
  } else if (!Number.isInteger(startNum) || startNum < 0) {
    errors.startInMinutes = "Must be 0 or a positive whole number.";
  }

  // --- Cliff period (optional, defaults to 0) ---
  const cliffDaysStr = values.cliffDays?.trim() ?? "";
  if (cliffDaysStr !== "" && cliffDaysStr !== "0") {
    const cliffNum = Number(cliffDaysStr);
    if (isNaN(cliffNum) || cliffNum < 0) {
      errors.cliffDays = "Cliff must be 0 or a positive number.";
    } else {
      const cliffSeconds = cliffNum * 86400;
      const durationSeconds = durationNum * 60;
      if (!isNaN(durationNum) && durationNum >= 1 && cliffSeconds >= durationSeconds) {
        errors.cliffDays = "Cliff must be less than the stream duration.";
      }
    }
  }

  return errors;
}

/** Returns true only when there are zero error keys. */
export function isFormValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
