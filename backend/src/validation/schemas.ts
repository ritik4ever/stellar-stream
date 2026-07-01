import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { validateWebhookUrl } from "../services/webhookUrl";

export const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
export const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
export const STREAM_ID_REGEX = /^[1-9]\d*$/;

export function isStellarPublicKey(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value);
}

export const streamIdSchema = z
  .string()
  .trim()
  .regex(STREAM_ID_REGEX, "Stream ID must be a positive integer.");

export const stellarAccountIdSchema = z
  .string()
  .trim()
  .min(1, "Account ID is required.")
  .refine(isStellarPublicKey, "must be a valid Stellar account ID");

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
  .positive("Amount must be greater than zero.")
  .refine(
    (value) => {
      const decimalStr = value.toString().split(".")[1];
      return !decimalStr || decimalStr.length <= 7;
    },
    "Amount cannot have more than 7 decimal places."
  );

export const durationSecondsSchema = z.coerce
  .number()
  .int("durationSeconds must be a whole number of seconds.")
  .min(1, "durationSeconds must be at least 1 second.");

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
    cliffSeconds: z.coerce.number().int().nonnegative().optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.sender === payload.recipient) {
      ctx.addIssue({
        code: "custom",
        path: ["recipient"],
        message: "Recipient must differ from the sender account.",
      });
    }
    if (payload.startAt !== undefined) {
      const maxFutureTimestamp = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      if (payload.startAt > maxFutureTimestamp) {
        ctx.addIssue({
          code: "custom",
          path: ["startAt"],
          message: "startAt cannot be more than 1 year in the future.",
        });
      }
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
}).superRefine((payload, ctx) => {
  const maxFutureTimestamp = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  if (payload.startAt > maxFutureTimestamp) {
    ctx.addIssue({
      code: "custom",
      path: ["startAt"],
      message: "startAt cannot be more than 1 year in the future.",
    });
  }
});

const VALID_EVENT_TYPES = ["created", "claimed", "canceled", "start_time_updated", "paused", "resumed"] as const;

export const webhookRegistrationSchema = z.object({
  url: z
    .string()
    .url("url must be a valid URL")
    .superRefine((url, ctx) => {
      const validation = validateWebhookUrl(url);
      if (!validation.valid) {
        ctx.addIssue({
          code: "custom",
          message: validation.reason ?? "url is not allowed",
        });
      }
    }),
  events: z
    .array(z.string())
    .min(1, "events must be a non-empty array")
    .refine(
      (events) => events.every((e) => (VALID_EVENT_TYPES as readonly string[]).includes(e)),
      {
        message: `events must only contain: ${VALID_EVENT_TYPES.join(", ")}`,
      },
    ),
  secret: z
    .string()
    .min(16, "secret must be at least 16 characters if provided")
    .optional(),
});

/**
 * Accepts a date-range bound as either a UNIX timestamp in seconds
 * (e.g. "1700000000") or an ISO-8601 date/datetime (e.g. "2026-07-01"),
 * normalising to UNIX seconds to match `stream_events.timestamp`.
 */
export const eventDateBoundSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    if (/^\d+$/.test(value)) {
      return Number(value);
    }
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      ctx.addIssue({
        code: "custom",
        message:
          "must be a UNIX timestamp in seconds or an ISO-8601 date (e.g. 2026-07-01).",
      });
      return z.NEVER;
    }
    return Math.floor(ms / 1000);
  });

export const listEventsQuerySchema = z
  .object({
    eventType: z
      .string()
      .optional()
      .refine(
        (value) => value === undefined || (VALID_EVENT_TYPES as readonly string[]).includes(value),
        {
          message: `eventType must be one of: ${VALID_EVENT_TYPES.join(", ")}`,
        },
      ),
    streamId: streamIdSchema.optional(),
    actor: stellarAccountIdSchema.optional(),
    from: eventDateBoundSchema.optional(),
    to: eventDateBoundSchema.optional(),
    page: z
      .coerce.number()
      .int("page must be an integer")
      .min(1, "page must be greater than or equal to 1")
      .optional(),
    limit: z
      .coerce.number()
      .int("limit must be an integer")
      .min(1, "limit must be greater than or equal to 1")
      .max(100, "limit must be less than or equal to 100")
      .optional(),
    cursor: z
      .coerce.number()
      .int("cursor must be an integer")
      .optional(),
  })
  .superRefine((query, ctx) => {
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must be earlier than or equal to to.",
      });
    }
  });

export const recipientAccountIdSchema = z.object({
  accountId: stellarAccountIdSchema,
});

export const senderAccountIdSchema = z.object({
  accountId: stellarAccountIdSchema,
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
