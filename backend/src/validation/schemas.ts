import { z } from "zod";

export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
export const STREAM_ID_REGEX = /^[1-9]\d*$/;

export const streamIdSchema = z
  .string()
  .trim()
  .regex(STREAM_ID_REGEX, "Stream ID must be a positive integer.");

export const stellarAccountIdSchema = z
  .string()
  .trim()
  .min(1, "Account ID is required.")
  .regex(
    STELLAR_ACCOUNT_REGEX,
    "Must be a valid Stellar account ID (starts with G and is exactly 56 characters).",
  );

export const assetCodeSchema = z
  .string()
  .trim()
  .min(1, "Asset code is required.")
  .regex(
    ASSET_CODE_REGEX,
    "Asset code must be 1–12 alphanumeric characters (e.g. USDC, XLM).",
  )
  .transform((value) => value.toUpperCase());

export const totalAmountSchema = z.coerce
  .number()
  .finite("Total amount must be a valid number.")
  .positive("Amount must be greater than zero.");

export const durationSecondsSchema = z.coerce
  .number()
  .int("durationSeconds must be a whole number of seconds.")
  .min(60, "durationSeconds must be at least 60 seconds.");

export const unixTimestampSchema = z.coerce
  .number()
  .int("startAt must be a valid UNIX timestamp in seconds.")
  .positive("startAt must be a valid UNIX timestamp in seconds.");

export const createStreamPayloadSchema = z
  .object({
    sender: stellarAccountIdSchema,
    recipient: stellarAccountIdSchema,
    assetCode: assetCodeSchema,
    totalAmount: totalAmountSchema,
    durationSeconds: durationSecondsSchema,
    startAt: unixTimestampSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.sender === payload.recipient) {
      ctx.addIssue({
        code: "custom",
        path: ["recipient"],
        message: "Recipient must differ from the sender account.",
      });
    }
  });

export function createStreamPayloadWithAllowedAssetsSchema(
  allowedAssets: string[],
) {
  const allowed = allowedAssets.map((asset) => asset.trim().toUpperCase());

  return createStreamPayloadSchema.superRefine((payload, ctx) => {
    if (!allowed.includes(payload.assetCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["assetCode"],
        message: `Asset "${payload.assetCode}" is not supported. Allowed assets: ${allowed.join(", ")}.`,
      });
    }
  });
}

export const updateStreamStartAtSchema = z.object({
  startAt: unixTimestampSchema,
});

export type CreateStreamPayload = z.infer<typeof createStreamPayloadSchema>;

export type ValidationIssue = {
  field: string;
  message: string;
};

export function zodIssuesToValidationIssues(issues: z.ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "body",
    message: issue.message,
  }));
}

export function zodIssuesToErrorMessage(issues: z.ZodIssue[]): string {
  return zodIssuesToValidationIssues(issues)
    .map(({ field, message }) => `${field}: ${message}`)
    .join("; ");
}