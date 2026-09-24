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
      const now = Math.floor(Date.now() / 1000);
      if (payload.startAt < now + 10) {
        ctx.addIssue({
          code: "custom",
          path: ["startAt"],
          message: "startAt must be at least 10 seconds in the future.",
        });
      }
      const maxFutureTimestamp = now + 365 * 24 * 60 * 60;
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
  const now = Math.floor(Date.now() / 1000);
  if (payload.startAt < now + 10) {
    ctx.addIssue({
      code: "custom",
      path: ["startAt"],
      message: "startAt must be at least 10 seconds in the future.",
    });
  }
  const maxFutureTimestamp = now + 365 * 24 * 60 * 60;
  if (payload.startAt > maxFutureTimestamp) {
    ctx.addIssue({
      code: "custom",
      path: ["startAt"],
      message: "startAt cannot be more than 1 year in the future.",
    });
  }
});

const VALID_EVENT_TYPES = ["created", "claimed", "canceled", "start_time_updated", "paused", "resumed", "completed"] as const;

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

export const listEventsQuerySchema = z.object({
  eventType: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || (VALID_EVENT_TYPES as readonly string[]).includes(value),
      {
        message: `eventType must be one of: ${VALID_EVENT_TYPES.join(", ")}`,
      },
    ),
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
  pageSize: z
    .coerce.number()
    .int("pageSize must be an integer")
    .min(1, "pageSize must be greater than or equal to 1")
    .max(100, "pageSize must be less than or equal to 100")
    .optional(),
  streamId: z
    .string()
    .trim()
    .min(1, "streamId must not be empty if provided")
    .optional(),
  since: z
    .coerce.number()
    .int("since must be an integer")
    .positive("since must be a positive unix timestamp")
    .optional(),
  cursor: z
    .coerce.number()
    .int("cursor must be an integer")
    .optional(),
});

export const recipientAccountIdSchema = z.object({
  accountId: stellarAccountIdSchema,
});

export const senderAccountIdSchema = z.object({
  accountId: stellarAccountIdSchema,
});

export const bulkCancelStreamsSchema = z.object({
  streamIds: z
    .array(streamIdSchema)
    .min(1, "At least one stream ID is required")
    .max(20, "Maximum 20 stream IDs per request"),
  sender: stellarAccountIdSchema,
});

export const bulkCreateStreamsSchema = z.object({
  streams: z
    .array(createStreamPayloadSchema)
    .min(1, "At least one stream config is required")
    .max(20, "Maximum 20 streams per request"),
  sender: stellarAccountIdSchema,
}).superRefine((payload, ctx) => {
  // Verify all streams have the same sender as the request body
  for (const stream of payload.streams) {
    if (stream.sender !== payload.sender) {
      ctx.addIssue({
        code: "custom",
        path: ["streams"],
        message: "All streams must have the same sender as the request body",
      });
      break;
    }
  }
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
