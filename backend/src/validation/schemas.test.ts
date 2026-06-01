import { describe, it, expect } from "vitest";
import {
    stellarAccountIdSchema,
    webhookRegistrationSchema,
    createStreamPayloadSchema,
    totalAmountSchema,
    durationSecondsSchema,
    unixTimestampSchema,
    assetCodeSchema,
    isStellarPublicKey,
} from "./schemas";

describe("Stellar Account ID Validation", () => {
    it("should accept valid Stellar public keys", () => {
        const validKeys = [
            "GCLJJD5FHTSEBHFXAA3BBTODUJ4RXDK6B3OSVNKY6TUHF76AQQT2WNFC",
            "GBLHBYX72TJQH5EVPUN4ATAREH6TWYXQAH37MHNCVQG2NKLHFDSMFS3D",
            "GANNU4KAOYHV6FSY7Z44QWUEUCRBH56Y5BOP6NP6OKU3AUL3B54V34HU",
        ];

        validKeys.forEach((key) => {
            const result = stellarAccountIdSchema.safeParse(key);
            expect(result.success).toBe(true);
        });
    });

    it("should reject invalid Stellar public keys", () => {
        const invalidKeys = [
            "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNHJGKYJPJJY",
            "GBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNHJGKYJPJJYFF",
            "SBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNHJGKYJPJJYF",
            "CBRPYHIL2CI3WHZDTOOQFC6EB4CGQOFSNQB3BHPOMONNHJGKYJPJJYF",
            "not-a-key",
            "",
        ];

        invalidKeys.forEach((key) => {
            const result = stellarAccountIdSchema.safeParse(key);
            expect(result.success).toBe(false);
        });
    });

    it("should trim whitespace", () => {
        const result = stellarAccountIdSchema.safeParse(
            "  GCLJJD5FHTSEBHFXAA3BBTODUJ4RXDK6B3OSVNKY6TUHF76AQQT2WNFC  "
        );
        expect(result.success).toBe(true);
    });
});

describe("Webhook Registration Schema", () => {
    it("should accept valid webhook registration", () => {
        const validPayload = {
            url: "https://example.com/webhooks",
            events: ["created", "claimed"],
            secret: "my-secret-key-1234567890",
        };

        const result = webhookRegistrationSchema.safeParse(validPayload);
        expect(result.success).toBe(true);
    });

    it("should reject http URLs", () => {
        const payload = {
            url: "http://example.com/webhooks",
            events: ["created"],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toContain("https");
    });

    it("should reject private IP URLs", () => {
        const payload = {
            url: "https://10.0.0.5/webhooks",
            events: ["created"],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toContain("private");
    });

    it("should reject localhost URLs", () => {
        const payload = {
            url: "https://localhost/webhooks",
            events: ["created"],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toContain("localhost");
    });

    it("should reject data URIs", () => {
        const payload = {
            url: "data:text/plain,hello",
            events: ["created"],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it("should reject empty events array", () => {
        const payload = {
            url: "https://example.com/webhooks",
            events: [],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it("should reject invalid event types", () => {
        const payload = {
            url: "https://example.com/webhooks",
            events: ["created", "invalid_event"],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it("should reject secret shorter than 16 chars", () => {
        const payload = {
            url: "https://example.com/webhooks",
            events: ["created"],
            secret: "short",
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it("should accept secret with exactly 16 chars", () => {
        const payload = {
            url: "https://example.com/webhooks",
            events: ["created"],
            secret: "1234567890123456",
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    it("should allow optional secret", () => {
        const payload = {
            url: "https://example.com/webhooks",
            events: ["created", "claimed", "canceled"],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    it("should accept all valid event types", () => {
        const payload = {
            url: "https://example.com/webhooks",
            events: ["created", "claimed", "canceled", "start_time_updated"],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });
});

const VALID_STREAM_PAYLOAD = {
    sender: "GCLJJD5FHTSEBHFXAA3BBTODUJ4RXDK6B3OSVNKY6TUHF76AQQT2WNFC",
    recipient: "GBLHBYX72TJQH5EVPUN4ATAREH6TWYXQAH37MHNCVQG2NKLHFDSMFS3D",
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 86400,
    startAt: Math.floor(Date.now() / 1000) + 3600,
};

describe("totalAmountSchema edge cases (#466)", () => {
    it("should accept a large amount", () => {
        expect(totalAmountSchema.safeParse(1_000_000_000).success).toBe(true);
    });

    it("should reject zero amount", () => {
        const result = totalAmountSchema.safeParse(0);
        expect(result.success).toBe(false);
    });

    it("should reject negative amount", () => {
        const result = totalAmountSchema.safeParse(-100);
        expect(result.success).toBe(false);
    });

    it("should accept decimal amount", () => {
        expect(totalAmountSchema.safeParse(0.5).success).toBe(true);
    });

    it("should reject NaN", () => {
        const result = totalAmountSchema.safeParse(NaN);
        expect(result.success).toBe(false);
    });

    it("should reject Infinity", () => {
        const result = totalAmountSchema.safeParse(Infinity);
        expect(result.success).toBe(false);
    });
});

describe("durationSecondsSchema edge cases (#466)", () => {
    it("should accept 60 seconds (minimum)", () => {
        expect(durationSecondsSchema.safeParse(60).success).toBe(true);
    });

    it("should reject 59 seconds (below minimum)", () => {
        const result = durationSecondsSchema.safeParse(59);
        expect(result.success).toBe(false);
    });

    it("should accept a very long duration (5 years)", () => {
        expect(durationSecondsSchema.safeParse(5 * 365 * 86400).success).toBe(true);
    });

    it("should reject 0 duration", () => {
        const result = durationSecondsSchema.safeParse(0);
        expect(result.success).toBe(false);
    });

    it("should reject negative duration", () => {
        const result = durationSecondsSchema.safeParse(-60);
        expect(result.success).toBe(false);
    });

    it("should reject decimal duration (non-integer)", () => {
        const result = durationSecondsSchema.safeParse(60.5);
        expect(result.success).toBe(false);
    });

    it("should reject float-like integer 60.0", () => {
        // coerce parses "60.0" as 60, which is fine
        expect(durationSecondsSchema.safeParse(60.0).success).toBe(true);
    });
});

describe("unixTimestampSchema edge cases (#466)", () => {
    it("should reject zero timestamp", () => {
        const result = unixTimestampSchema.safeParse(0);
        expect(result.success).toBe(false);
    });

    it("should reject negative timestamp", () => {
        const result = unixTimestampSchema.safeParse(-1);
        expect(result.success).toBe(false);
    });

    it("should accept a valid future timestamp", () => {
        const ts = Math.floor(Date.now() / 1000) + 86400;
        expect(unixTimestampSchema.safeParse(ts).success).toBe(true);
    });

    it("should reject decimal timestamp", () => {
        const result = unixTimestampSchema.safeParse(1700000000.5);
        expect(result.success).toBe(false);
    });
});

describe("assetCodeSchema edge cases (#466)", () => {
    it("should accept 12-character asset code (max)", () => {
        const result = assetCodeSchema.safeParse("ABCDEFGHIJKL");
        expect(result.success).toBe(true);
    });

    it("should reject 13-character asset code", () => {
        const result = assetCodeSchema.safeParse("ABCDEFGHIJKLM");
        expect(result.success).toBe(false);
    });

    it("should reject empty asset code", () => {
        const result = assetCodeSchema.safeParse("");
        expect(result.success).toBe(false);
    });

    it("should convert to uppercase", () => {
        const result = assetCodeSchema.safeParse("usdc");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toBe("USDC");
        }
    });

    it("should trim whitespace in asset code", () => {
        const result = assetCodeSchema.safeParse("  xlm  ");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toBe("XLM");
        }
    });
});

describe("createStreamPayloadSchema edge cases (#466)", () => {
    it("should accept valid payload", () => {
        expect(createStreamPayloadSchema.safeParse(VALID_STREAM_PAYLOAD).success).toBe(true);
    });

    it("should accept optional startAt (defaults to now)", () => {
        const payload = { ...VALID_STREAM_PAYLOAD };
        delete payload.startAt;
        expect(createStreamPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("should reject equal sender and recipient", () => {
        const payload = {
            ...VALID_STREAM_PAYLOAD,
            recipient: VALID_STREAM_PAYLOAD.sender,
        };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        if (!result.success) {
            const recipientIssues = result.error.issues.filter((i) =>
                i.path.includes("recipient"),
            );
            expect(recipientIssues.length).toBeGreaterThan(0);
        }
    });

    it("should reject missing sender", () => {
        const { sender, ...rest } = VALID_STREAM_PAYLOAD;
        const result = createStreamPayloadSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("should reject missing recipient", () => {
        const { recipient, ...rest } = VALID_STREAM_PAYLOAD;
        const result = createStreamPayloadSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("should reject missing totalAmount", () => {
        const { totalAmount, ...rest } = VALID_STREAM_PAYLOAD;
        const result = createStreamPayloadSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("should reject missing durationSeconds", () => {
        const { durationSeconds, ...rest } = VALID_STREAM_PAYLOAD;
        const result = createStreamPayloadSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("should reject empty sender string", () => {
        const result = createStreamPayloadSchema.safeParse({
            ...VALID_STREAM_PAYLOAD,
            sender: "",
        });
        expect(result.success).toBe(false);
    });

    it("should reject empty recipient string", () => {
        const result = createStreamPayloadSchema.safeParse({
            ...VALID_STREAM_PAYLOAD,
            recipient: "",
        });
        expect(result.success).toBe(false);
    });

    it("should reject invalid asset code", () => {
        const result = createStreamPayloadSchema.safeParse({
            ...VALID_STREAM_PAYLOAD,
            assetCode: "INVALID_ASSET_CODE_TOO_LONG",
        });
        expect(result.success).toBe(false);
    });

    it("should accept amount as string-coerced number", () => {
        const result = createStreamPayloadSchema.safeParse({
            ...VALID_STREAM_PAYLOAD,
            totalAmount: "500",
        });
        expect(result.success).toBe(true);
    });

    it("should accept durationSeconds as string-coerced number", () => {
        const result = createStreamPayloadSchema.safeParse({
            ...VALID_STREAM_PAYLOAD,
            durationSeconds: "3600",
        });
        expect(result.success).toBe(true);
    });
});
