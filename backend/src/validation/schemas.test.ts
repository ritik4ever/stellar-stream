import { describe, it, expect } from "vitest";
import {
    stellarAccountIdSchema,
    webhookRegistrationSchema,
    isStellarPublicKey,
    createStreamPayloadSchema,
    totalAmountSchema,
    durationSecondsSchema,
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
            events: ["created", "claimed", "canceled", "start_time_updated", "paused", "resumed"],
        };

        const result = webhookRegistrationSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });
});

describe("Create Stream Payload Schema", () => {
    const validBasePayload = {
        sender: "GCLJJD5FHTSEBHFXAA3BBTODUJ4RXDK6B3OSVNKY6TUHF76AQQT2WNFC",
        recipient: "GBLHBYX72TJQH5EVPUN4ATAREH6TWYXQAH37MHNCVQG2NKLHFDSMFS3D",
        assetCode: "USDC",
        totalAmount: 100,
        durationSeconds: 3600,
    };

    it("should accept valid stream creation payload", () => {
        const result = createStreamPayloadSchema.safeParse(validBasePayload);
        expect(result.success).toBe(true);
    });

    it("should accept stream with startAt in the future", () => {
        const payload = {
            ...validBasePayload,
            startAt: Math.floor(Date.now() / 1000) + 3600,
        };

        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    it("should reject startAt in the past", () => {
        const payload = {
            ...validBasePayload,
            startAt: Math.floor(Date.now() / 1000) - 100,
        };

        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toContain("startAt");
        expect(result.error?.issues[0].message).toContain("10 seconds in the future");
    });

    it("should reject startAt less than 10 seconds in the future", () => {
        const payload = {
            ...validBasePayload,
            startAt: Math.floor(Date.now() / 1000) + 5,
        };

        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toContain("startAt");
        expect(result.error?.issues[0].message).toContain("10 seconds in the future");
    });

    it("should accept startAt exactly 10 seconds in the future", () => {
        const payload = {
            ...validBasePayload,
            startAt: Math.floor(Date.now() / 1000) + 10,
        };

        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    it("should reject durationSeconds = 0", () => {
        const payload = { ...validBasePayload, durationSeconds: 0 };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toContain("durationSeconds");
    });

    it("should accept durationSeconds = 1 (minimum valid)", () => {
        const payload = { ...validBasePayload, durationSeconds: 1 };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    it("should reject totalAmount with more than 7 decimal places", () => {
        const payload = { ...validBasePayload, totalAmount: 1.12345678 };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toContain("7 decimal places");
    });

    it("should accept totalAmount with exactly 7 decimal places", () => {
        const payload = { ...validBasePayload, totalAmount: 1.1234567 };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    it("should reject recipient same as sender", () => {
        const payload = { ...validBasePayload, recipient: validBasePayload.sender };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toContain("recipient");
        expect(result.error?.issues[0].message).toContain("differ");
    });

    it("should reject startAt more than 1 year in future", () => {
        const payload = {
            ...validBasePayload,
            startAt: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) + 1,
        };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toContain("startAt");
        expect(result.error?.issues[0].message).toContain("1 year");
    });

    it("should accept startAt exactly 1 year in future", () => {
        const payload = {
            ...validBasePayload,
            startAt: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60),
        };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });

    it("should reject negative totalAmount", () => {
        const payload = { ...validBasePayload, totalAmount: -100 };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it("should reject zero totalAmount", () => {
        const payload = { ...validBasePayload, totalAmount: 0 };
        const result = createStreamPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
        const { sender, ...payloadWithoutSender } = validBasePayload;
        const result = createStreamPayloadSchema.safeParse(payloadWithoutSender);
        expect(result.success).toBe(false);
    });
});

describe("Total Amount Schema", () => {
    it("should reject amount with more than 7 decimal places", () => {
        const result = totalAmountSchema.safeParse(1.12345678);
        expect(result.success).toBe(false);
    });

    it("should accept amount with exactly 7 decimal places", () => {
        const result = totalAmountSchema.safeParse(1.1234567);
        expect(result.success).toBe(true);
    });

    it("should accept integer amounts", () => {
        const result = totalAmountSchema.safeParse(100);
        expect(result.success).toBe(true);
    });

    it("should reject non-positive amounts", () => {
        const result = totalAmountSchema.safeParse(0);
        expect(result.success).toBe(false);
        const result2 = totalAmountSchema.safeParse(-1);
        expect(result2.success).toBe(false);
    });

    it("should accept string numbers", () => {
        const result = totalAmountSchema.safeParse("123.45");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toBe(123.45);
        }
    });
});

describe("Duration Seconds Schema", () => {
    it("should reject zero durationSeconds", () => {
        const result = durationSecondsSchema.safeParse(0);
        expect(result.success).toBe(false);
    });

    it("should reject durations below 60 seconds", () => {
        const result = durationSecondsSchema.safeParse(59);
        expect(result.success).toBe(false);
    });

    it("should accept 60 seconds as minimum valid duration", () => {
        const result = durationSecondsSchema.safeParse(60);
        expect(result.success).toBe(true);
    });

    it("should accept standard durations", () => {
        const result = durationSecondsSchema.safeParse(3600);
        expect(result.success).toBe(true);
    });

    it("should reject non-integer durations", () => {
        const result = durationSecondsSchema.safeParse(1.5);
        expect(result.success).toBe(false);
    });

    it("should reject negative durations", () => {
        const result = durationSecondsSchema.safeParse(-100);
        expect(result.success).toBe(false);
    });

    it("should accept string numbers", () => {
        const result = durationSecondsSchema.safeParse("3600");
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toBe(3600);
        }
    });
});
