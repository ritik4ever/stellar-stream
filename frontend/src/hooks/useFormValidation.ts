/**
 * Stellar account IDs are base32-encoded Ed25519 public keys.
 * A valid public key starts with 'G', is exactly 56 characters long,
 * and uses the Stellar base32 alphabet (A-Z, 2-7).
 */
export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;

export function isStellarAccount(value: string): boolean {
  return STELLAR_ACCOUNT_REGEX.test(value.trim());
}

/** Asset codes: 1-12 alphanumeric chars per SEP-0001 / Stellar docs */
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;

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
  } else if (!isStellarAccount(senderTrimmed)) {
    errors.sender =
      "Must be a valid Stellar account ID (starts with G, exactly 56 characters, alphanumeric).";
  }

  // --- Recipient ---
  const recipientTrimmed = values.recipient.trim();
  if (!recipientTrimmed) {
    errors.recipient = "Recipient account is required.";
  } else if (!isStellarAccount(recipientTrimmed)) {
    errors.recipient =
      "Must be a valid Stellar account ID (starts with G, exactly 56 characters, alphanumeric).";
  }

  if (
    senderTrimmed &&
    recipientTrimmed &&
    isStellarAccount(senderTrimmed) &&
    isStellarAccount(recipientTrimmed) &&
    senderTrimmed === recipientTrimmed
  ) {
    errors.recipient = "Recipient must differ from the sender account.";
  }

  // --- Asset code ---
  const assetTrimmed = values.assetCode.trim();
  if (!assetTrimmed) {
    errors.assetCode = "Asset code is required.";
  } else if (!ASSET_CODE_REGEX.test(assetTrimmed)) {
    errors.assetCode = "Asset code must be 1–12 alphanumeric characters (e.g. USDC, XLM).";
  }

  // --- Total amount ---
  const amountNum = Number(values.totalAmount);
  if (values.totalAmount === "" || isNaN(amountNum)) {
    errors.totalAmount = "Total amount is required.";
  } else if (amountNum <= 0) {
    errors.totalAmount = "Amount must be greater than zero.";
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
