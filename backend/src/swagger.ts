export const swaggerDocument = {
  openapi: "3.0.0",
  info: {
    title: "StellarStream API",
    version: "1.0.0",
    description: "API for managing money streams on the Stellar network",
  },
  servers: [
    {
      url: "http://localhost:3001",
      description: "Local development server",
    },
  ],
  components: {
    schemas: {
      StreamInput: {
        type: "object",
        required: [
          "sender",
          "recipient",
          "assetCode",
          "totalAmount",
          "durationSeconds",
        ],
        properties: {
          sender: {
            type: "string",
            description: "Public key of the sender.",
            example: "GC7Y4M77LNYKYF4K4V5A737W3G3L3T7XQWZJZL4R64Z43W3T7XZQK2L4",
          },
          recipient: {
            type: "string",
            description: "Public key of the recipient.",
            example: "GB4Z3ZK3X24Z3T7XZQK2L4R64Z43W3T7XZQK2L4R64Z43W3T7XZQK2L4",
          },
          assetCode: {
            type: "string",
            description: "Asset code (2-12 characters).",
            example: "USDC",
            minLength: 2,
            maxLength: 12,
          },
          totalAmount: {
            type: "number",
            description: "Total amount to stream.",
            example: 1000,
            minimum: 0,
            exclusiveMinimum: true,
          },
          durationSeconds: {
            type: "number",
            description: "Duration of the stream in seconds (minimum 60).",
            example: 3600,
            minimum: 60,
          },
          startAt: {
            type: "number",
            description: "Optional start time as a UNIX timestamp in seconds.",
            example: 1716382000,
          },
        },
      },
      Stream: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Unique identifier for the stream.",
            example: "uuid-v4-string",
          },
          sender: {
            type: "string",
            example: "GC7Y4M77LNYKYF4K4V5A737W3G3L3T7XQWZJZL4R64Z43W3T7XZQK2L4",
          },
          recipient: {
            type: "string",
            example: "GB4Z3ZK3X24Z3T7XZQK2L4R64Z43W3T7XZQK2L4R64Z43W3T7XZQK2L4",
          },
          assetCode: {
            type: "string",
            example: "USDC",
          },
          totalAmount: {
            type: "number",
            example: 1000,
          },
          durationSeconds: {
            type: "number",
            example: 3600,
          },
          startAt: {
            type: "number",
            example: 1716382000,
          },
          createdAt: {
            type: "number",
            example: 1716378400,
          },
          status: {
            type: "string",
            enum: ["active", "cancelled", "completed"],
            example: "active",
          },
          progress: {
            type: "number",
            description: "Amount streamed so far.",
            example: 250,
          },
        },
      },
      StreamWithProgress: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Unique identifier for the stream.",
            example: "uuid-v4-string",
          },
          sender: {
            type: "string",
            example: "GC7Y4M77LNYKYF4K4V5A737W3G3L3T7XQWZJZL4R64Z43W3T7XZQK2L4",
          },
          recipient: {
            type: "string",
            example: "GB4Z3ZK3X24Z3T7XZQK2L4R64Z43W3T7XZQK2L4R64Z43W3T7XZQK2L4",
          },
          assetCode: {
            type: "string",
            example: "USDC",
          },
          totalAmount: {
            type: "number",
            example: 1000,
          },
          durationSeconds: {
            type: "number",
            example: 3600,
          },
          startAt: {
            type: "number",
            example: 1716382000,
          },
          createdAt: {
            type: "number",
            example: 1716378400,
          },
          canceledAt: {
            type: "number",
            example: 1716385600,
          },
          completedAt: {
            type: "number",
            example: 1716389200,
          },
          refundedAmount: {
            type: "number",
            example: 500,
          },
          pausedAt: {
            type: "number",
            example: 1716384000,
          },
          pausedDuration: {
            type: "number",
            example: 300,
          },
          progress: {
            $ref: "#/components/schemas/StreamProgress",
          },
        },
      },
      StreamProgress: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["scheduled", "active", "completed", "canceled"],
            example: "active",
          },
          ratePerSecond: {
            type: "number",
            description: "Amount streamed per second.",
            example: 0.277778,
          },
          elapsedSeconds: {
            type: "number",
            description: "Seconds elapsed since stream started.",
            example: 900,
          },
          vestedAmount: {
            type: "number",
            description: "Amount vested so far.",
            example: 250,
          },
          remainingAmount: {
            type: "number",
            description: "Amount remaining to be streamed.",
            example: 750,
          },
          percentComplete: {
            type: "number",
            description: "Percentage of stream completed.",
            example: 25,
          },
        },
      },
      StreamEvent: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "Unique event identifier.",
            example: 1,
          },
          streamId: {
            type: "string",
            description: "ID of the stream this event belongs to.",
            example: "1",
          },
          eventType: {
            type: "string",
            enum: ["created", "claimed", "canceled", "start_time_updated", "paused", "resumed", "completed"],
            example: "created",
          },
          timestamp: {
            type: "number",
            description: "UNIX timestamp when the event occurred.",
            example: 1716378400,
          },
          actor: {
            type: "string",
            description: "Account that triggered the event.",
            example: "GC7Y4M77LNYKYF4K4V5A737W3G3L3T7XQWZJZL4R64Z43W3T7XZQK2L4",
          },
          amount: {
            type: "number",
            description: "Amount associated with the event (if applicable).",
            example: 1000,
          },
          metadata: {
            type: "object",
            description: "Additional event metadata.",
            example: {
              recipient:
                "GB4Z3ZK3X24Z3T7XZQK2L4R64Z43W3T7XZQK2L4R64Z43W3T7XZQK2L4",
              assetCode: "USDC",
              durationSeconds: 3600,
            },
          },
        },
      },
      StreamSnapshot: {
        type: "object",
        properties: {
          stream: {
            type: "object",
            description: "Stream data with progress information.",
            properties: {
              id: {
                type: "string",
                description: "Unique identifier for the stream.",
                example: "1",
              },
              sender: {
                type: "string",
                example:
                  "GC7Y4M77LNYKYF4K4V5A737W3G3L3T7XQWZJZL4R64Z43W3T7XZQK2L4",
              },
              recipient: {
                type: "string",
                example:
                  "GB4Z3ZK3X24Z3T7XZQK2L4R64Z43W3T7XZQK2L4R64Z43W3T7XZQK2L4",
              },
              assetCode: {
                type: "string",
                example: "USDC",
              },
              totalAmount: {
                type: "number",
                example: 1000,
              },
              durationSeconds: {
                type: "number",
                example: 3600,
              },
              startAt: {
                type: "number",
                example: 1716382000,
              },
              createdAt: {
                type: "number",
                example: 1716378400,
              },
              canceledAt: {
                type: "number",
                example: 1716385600,
              },
              completedAt: {
                type: "number",
                example: 1716385600,
              },
              progress: {
                $ref: "#/components/schemas/StreamProgress",
              },
            },
          },
          history: {
            type: "array",
            description: "Chronological history of stream events.",
            items: {
              $ref: "#/components/schemas/StreamEvent",
            },
          },
        },
      },
      GlobalStats: {
        type: "object",
        properties: {
          total: {
            type: "integer",
            description: "Total number of streams.",
            example: 42,
          },
          active: {
            type: "integer",
            description: "Streams currently streaming (started, not paused, not yet ended or canceled).",
            example: 10,
          },
          scheduled: {
            type: "integer",
            description: "Streams that are scheduled but haven't started yet.",
            example: 5,
          },
          paused: {
            type: "integer",
            description: "Streams that are currently paused.",
            example: 3,
          },
          completed: {
            type: "integer",
            description: "Streams that have fully completed.",
            example: 20,
          },
          canceled: {
            type: "integer",
            description: "Streams that were canceled.",
            example: 4,
          },
          totalVested: {
            type: "number",
            description: "Total tokens vested across all active and completed streams.",
            example: 98432.5,
          },
          totalAmount: {
            type: "number",
            description: "Total amount of tokens committed across all streams.",
            example: 150000,
          },
          uniqueSenders: {
            type: "integer",
            description: "Number of distinct sender accounts.",
            example: 18,
          },
          uniqueRecipients: {
            type: "integer",
            description: "Number of distinct recipient accounts.",
            example: 31,
          },
          localStreamCount: {
            type: "integer",
            description: "Total streams known to the local database.",
            example: 42,
          },
          onChainStreamCount: {
            type: "integer",
            nullable: true,
            description: "Canonical stream count read from the on-chain NextStreamId. Null when the Soroban RPC is unavailable.",
            example: 42,
          },
        },
      },
      StreamMetrics: {
        type: "object",
        properties: {
          total_streams: {
            type: "integer",
            description: "Total number of streams in the database.",
            example: 42,
          },
          active_streams: {
            type: "integer",
            description: "Streams currently streaming (started, not paused, not yet ended or canceled).",
            example: 10,
          },
          total_vested_usdc: {
            type: "number",
            description: "Total USDC vested across active and completed streams.",
            example: 5000.5,
          },
          total_vested_xlm: {
            type: "number",
            description: "Total XLM vested across active and completed streams.",
            example: 1200.25,
          },
          streams_completed_today: {
            type: "integer",
            description: "Number of streams completed since UTC midnight today.",
            example: 3,
          },
        },
      },
      Error: {
        type: "object",
        required: ["error", "statusCode"],
        properties: {
          error: {
            type: "string",
            example: "Stream not found.",
          },
          statusCode: {
            type: "integer",
            example: 404,
          },
          requestId: {
            type: "string",
            example: "req_123456789",
          },
          code: {
            type: "string",
            example: "NOT_FOUND",
          },
          details: {
            type: "array",
            items: {
              type: "object",
              required: ["field", "message"],
              properties: {
                field: {
                  type: "string",
                  example: "startAt",
                },
                message: {
                  type: "string",
                  example: "startAt must be in the future.",
                },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    "/api/health": {
      get: {
        summary: "Check API Health",
        description: "Returns the health status of the API.",
        responses: {
          "200": {
            description: "API is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    service: {
                      type: "string",
                      example: "stellar-stream-backend",
                    },
                    status: { type: "string", example: "ok" },
                    timestamp: {
                      type: "string",
                      example: "2024-05-22T10:06:40.000Z",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        summary: "Refresh JWT",
        description:
          "Accepts a still-valid Bearer JWT and returns a new token with a fresh 24h expiry. " +
          "Use this to avoid forcing users to re-sign a Stellar challenge transaction every day.",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "New JWT issued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: {
                      type: "string",
                      description: "New JWT valid for 24 hours.",
                      example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    },
                  },
                },
              },
            },
          },
          "401": {
            description: "Missing, invalid, or expired token",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Invalid or expired authorization token." },
                    code: { type: "string", example: "UNAUTHORIZED" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/assets": {
      get: {
        summary: "List allowed assets",
        description: "Returns the normalized list of allowed asset codes.",
        responses: {
          "200": {
            description: "Allowed assets list.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "string",
                        example: "USDC",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/stats": {
      get: {
        summary: "Get aggregate stream statistics",
        description:
          "Returns aggregate statistics across all streams. " +
          "Result is cached for 30 seconds. Useful for admin dashboards and monitoring.",
        responses: {
          "200": {
            description: "Aggregate stream statistics.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      $ref: "#/components/schemas/GlobalStats",
                    },
                  },
                },
              },
            },
          },
          "500": {
            description: "Failed to compute stats.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/metrics": {
      get: {
        summary: "Get aggregated stream metrics",
        description:
          "Returns aggregated stream metrics including counts and vested amounts by asset. " +
          "Result is cached for 60 seconds. Requires a valid admin JWT (Bearer token).",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Aggregated stream metrics.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      $ref: "#/components/schemas/StreamMetrics",
                    },
                  },
                },
              },
            },
          },
          "401": {
            description: "Missing, invalid, or expired JWT.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "500": {
            description: "Failed to compute metrics.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/streams": {
      get: {
        summary: "List all streams",
        description:
          "Retrieves streams with optional filtering by status/sender/recipient and optional pagination.",
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            description: "Filter by stream status.",
            schema: {
              type: "string",
              enum: ["scheduled", "active", "completed", "canceled"],
            },
          },
          {
            name: "sender",
            in: "query",
            required: false,
            description: "Exact sender account ID match.",
            schema: {
              type: "string",
            },
          },
          {
            name: "recipient",
            in: "query",
            required: false,
            description: "Exact recipient account ID match.",
            schema: {
              type: "string",
            },
          },
          {
            name: "asset",
            in: "query",
            required: false,
            description: "Exact asset code match.",
            schema: {
              type: "string",
            },
          },
          {
            name: "assetCode",
            in: "query",
            required: false,
            description: "Filter by one or more asset codes (comma-separated). Case-insensitive. Example: ?assetCode=USDC,XLM",
            schema: {
              type: "string",
            },
          },
          {
            name: "q",
            in: "query",
            required: false,
            description: "General search term. Searches across stream ID, sender, recipient, and asset code (case-insensitive). Combines with other filters.",
            schema: {
              type: "string",
            },
          },
          {
            name: "page",
            in: "query",
            required: false,
            description:
              "Page number (>=1). Pagination is enabled when either page or limit is provided.",
            schema: {
              type: "integer",
              minimum: 1,
            },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description:
              "Page size (1..100). Defaults to 20 in pagination mode.",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
            },
          },
          {
            name: "sort",
            in: "query",
            required: false,
            description:
              "Field to sort by. Defaults to createdAt.",
            schema: {
              type: "string",
              enum: ["totalAmount", "startAt", "createdAt", "durationSeconds"],
            },
          },
          {
            name: "order",
            in: "query",
            required: false,
            description:
              "Sort direction. Defaults to desc.",
            schema: {
              type: "string",
              enum: ["asc", "desc"],
            },
          },
        ],
        responses: {
          "200": {
            description: "A list of streams with pagination metadata.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/Stream",
                      },
                    },
                    total: {
                      type: "number",
                      description:
                        "Total streams matching filters (before pagination).",
                      example: 42,
                    },
                    page: {
                      type: "number",
                      description: "Applied page number.",
                      example: 1,
                    },
                    limit: {
                      type: "number",
                      description: "Applied page size.",
                      example: 20,
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid query parameter.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a new stream",
        description: "Creates a new stream with the given inputs.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/StreamInput",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Stream created successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      $ref: "#/components/schemas/Stream",
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid input.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "500": {
            description: "Server error during creation.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/streams/{id}": {
      get: {
        summary: "Get a specific stream",
        description: "Retrieves a stream by its unique ID.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The unique ID of the stream.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Stream data.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      $ref: "#/components/schemas/Stream",
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "Stream not found.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/streams/{id}/claimable": {
      get: {
        summary: "Get real-time claimable amount",
        description: "Retrieves the current real-time claimable amount for a stream using Soroban contract simulation. Returns 0 if paused, canceled, or before the cliff.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The unique ID of the stream.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Real-time claimable amount and query context.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    streamId: { type: "string", example: "1" },
                    claimableAmount: { type: "number", example: 450.123456 },
                    assetCode: { type: "string", example: "USDC" },
                    at: { type: "integer", description: "Ledger timestamp at which query was simulated", example: 1716812160 },
                  },
                },
              },
            },
          },
          "404": {
            description: "Stream not found.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "500": {
            description: "Failed to simulate claimable amount.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/recipients/{accountId}/streams": {
      get: {
        summary: "Get recipient streams",
        description: "Retrieves all streams for a specific recipient with optional filtering, search, and pagination.",
        parameters: [
          {
            name: "accountId",
            in: "path",
            required: true,
            description: "The Stellar account ID of the recipient (starts with G, exactly 56 characters).",
            schema: {
              type: "string",
              pattern: "^G[A-Z2-7]{55}$",
            },
          },
          {
            name: "status",
            in: "query",
            required: false,
            description: "Filter by stream status.",
            schema: {
              type: "string",
              enum: ["scheduled", "active", "completed", "canceled"],
            },
          },
          {
            name: "sender",
            in: "query",
            required: false,
            description: "Filter by sender account ID (case-insensitive).",
            schema: {
              type: "string",
            },
          },
          {
            name: "asset",
            in: "query",
            required: false,
            description: "Filter by asset code (case-insensitive).",
            schema: {
              type: "string",
            },
          },
          {
            name: "q",
            in: "query",
            required: false,
            description: "Search term for stream ID, sender, recipient, or asset code (case-insensitive partial match).",
            schema: {
              type: "string",
            },
          },
          {
            name: "page",
            in: "query",
            required: false,
            description: "Page number for pagination (defaults to 1).",
            schema: {
              type: "integer",
              minimum: 1,
            },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Number of items per page (defaults to 20, max 100). If both page and limit are omitted, all results are returned.",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
            },
          },
        ],
        responses: {
          "200": {
            description: "A paginated list of streams for the recipient with progress data.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/Stream",
                      },
                    },
                    total: {
                      type: "integer",
                      description: "Total number of streams matching the filters (before pagination).",
                    },
                    page: {
                      type: "integer",
                      description: "Current page number.",
                    },
                    limit: {
                      type: "integer",
                      description: "Number of items per page.",
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid request.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/senders/{accountId}/streams": {
      get: {
        summary: "Get sender streams",
        description: "Retrieves all streams for a specific sender with optional filtering and pagination.",
        parameters: [
          {
            name: "accountId",
            in: "path",
            required: true,
            description: "The Stellar account ID of the sender.",
            schema: {
              type: "string",
            },
          },
          {
            name: "status",
            in: "query",
            required: false,
            description: "Filter by stream status.",
            schema: {
              type: "string",
              enum: ["scheduled", "active", "completed", "canceled"],
            },
          },
          {
            name: "page",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
            },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
            },
          },
        ],
        responses: {
          "200": {
            description: "A list of streams for the sender with pagination metadata.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/Stream",
                      },
                    },
                    total: {
                      type: "number",
                      example: 10,
                    },
                    page: {
                      type: "number",
                      example: 1,
                    },
                    limit: {
                      type: "number",
                      example: 20,
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid input or account ID.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/streams/sender/{address}": {
      get: {
        summary: "List streams by sender address",
        description:
          "Returns all streams where the given Stellar account is the sender. " +
          "Supports the same pagination, filtering, and search parameters as GET /api/streams. " +
          "Results are cached for 5 seconds per address.",
        parameters: [
          {
            name: "address",
            in: "path",
            required: true,
            description:
              "Stellar account address of the sender. Must be a valid Ed25519 public key " +
              "starting with 'G' and exactly 56 characters long (e.g. GABC...XYZ).",
            schema: {
              type: "string",
              pattern: "^G[A-Z2-7]{55}$",
              example: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            },
          },
          {
            name: "status",
            in: "query",
            required: false,
            description: "Filter by stream status.",
            schema: {
              type: "string",
              enum: ["scheduled", "active", "completed", "canceled"],
            },
          },
          {
            name: "recipient",
            in: "query",
            required: false,
            description: "Filter by recipient account ID (case-insensitive).",
            schema: { type: "string" },
          },
          {
            name: "asset",
            in: "query",
            required: false,
            description: "Filter by asset code (case-insensitive exact match).",
            schema: { type: "string" },
          },
          {
            name: "assetCode",
            in: "query",
            required: false,
            description:
              "Filter by one or more asset codes (comma-separated, case-insensitive). Example: ?assetCode=USDC,XLM",
            schema: { type: "string" },
          },
          {
            name: "q",
            in: "query",
            required: false,
            description:
              "Search term across stream ID, sender, recipient, and asset code (case-insensitive).",
            schema: { type: "string" },
          },
          {
            name: "minAmount",
            in: "query",
            required: false,
            description: "Filter streams with totalAmount >= minAmount.",
            schema: { type: "number", minimum: 0 },
          },
          {
            name: "maxAmount",
            in: "query",
            required: false,
            description: "Filter streams with totalAmount <= maxAmount.",
            schema: { type: "number", minimum: 0 },
          },
          {
            name: "page",
            in: "query",
            required: false,
            description: "Page number (>=1). Pagination is enabled when either page or limit is provided.",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Page size (1..100). Defaults to 20 in pagination mode.",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": {
            description: "Paginated list of streams for the sender.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Stream" },
                    },
                    total: { type: "integer", example: 5 },
                    page: { type: "integer", example: 1 },
                    limit: { type: "integer", example: 20 },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid Stellar address format or query parameter.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/streams/recipient/{address}": {
      get: {
        summary: "List streams by recipient address",
        description:
          "Returns all streams where the given Stellar account is the recipient. " +
          "Supports the same pagination, filtering, and search parameters as GET /api/streams. " +
          "Results are cached for 5 seconds per address.",
        parameters: [
          {
            name: "address",
            in: "path",
            required: true,
            description:
              "Stellar account address of the recipient. Must be a valid Ed25519 public key " +
              "starting with 'G' and exactly 56 characters long (e.g. GABC...XYZ).",
            schema: {
              type: "string",
              pattern: "^G[A-Z2-7]{55}$",
              example: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            },
          },
          {
            name: "status",
            in: "query",
            required: false,
            description: "Filter by stream status.",
            schema: {
              type: "string",
              enum: ["scheduled", "active", "completed", "canceled"],
            },
          },
          {
            name: "sender",
            in: "query",
            required: false,
            description: "Filter by sender account ID (case-insensitive).",
            schema: { type: "string" },
          },
          {
            name: "asset",
            in: "query",
            required: false,
            description: "Filter by asset code (case-insensitive exact match).",
            schema: { type: "string" },
          },
          {
            name: "assetCode",
            in: "query",
            required: false,
            description:
              "Filter by one or more asset codes (comma-separated, case-insensitive). Example: ?assetCode=USDC,XLM",
            schema: { type: "string" },
          },
          {
            name: "q",
            in: "query",
            required: false,
            description:
              "Search term across stream ID, sender, recipient, and asset code (case-insensitive).",
            schema: { type: "string" },
          },
          {
            name: "minAmount",
            in: "query",
            required: false,
            description: "Filter streams with totalAmount >= minAmount.",
            schema: { type: "number", minimum: 0 },
          },
          {
            name: "maxAmount",
            in: "query",
            required: false,
            description: "Filter streams with totalAmount <= maxAmount.",
            schema: { type: "number", minimum: 0 },
          },
          {
            name: "page",
            in: "query",
            required: false,
            description: "Page number (>=1). Pagination is enabled when either page or limit is provided.",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Page size (1..100). Defaults to 20 in pagination mode.",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          "200": {
            description: "Paginated list of streams for the recipient.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Stream" },
                    },
                    total: { type: "integer", example: 3 },
                    page: { type: "integer", example: 1 },
                    limit: { type: "integer", example: 20 },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid Stellar address format or query parameter.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/streams/{id}/cancel": {
      post: {
        summary: "Cancel a Stream",
        description: "Cancels an active stream by its ID.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The unique ID of the stream to cancel.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Stream cancelled successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      $ref: "#/components/schemas/Stream",
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "Stream not found.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "500": {
            description: "Failed to cancel stream.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/streams/{id}/reconcile": {
      post: {
        summary: "Reconcile stream with on-chain state",
        description:
          "Forces an immediate Soroban get_stream call to sync the local SQLite record with the on-chain state. " +
          "Useful when a transaction (claim, cancel) has been submitted but the indexer hasn't polled yet. " +
          "Rate limited to 5 calls per stream per minute.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The unique ID of the stream to reconcile.",
            schema: {
              type: "string",
            },
          },
        ],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Stream reconciled successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      $ref: "#/components/schemas/StreamWithProgress",
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "Stream not found on-chain.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "429": {
            description: "Rate limit exceeded (5 calls per stream per minute).",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "500": {
            description: "Failed to reconcile stream.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/streams/{id}/mark-complete": {
      post: {
        summary: "Manually complete a stream",
        description:
          "Marks a fully-vested stream as completed. Only the sender can call this when vestedAmount >= totalAmount.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The unique ID of the stream to mark as complete.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Stream completed successfully.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      $ref: "#/components/schemas/Stream",
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Stream is not fully vested, already completed, or already canceled.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "404": {
            description: "Stream not found.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
          "500": {
            description: "Failed to mark stream complete.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/streams/{id}/history": {
      get: {
        summary: "Get Stream History",
        description:
          "Retrieves the complete event history for a specific stream.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The unique ID of the stream.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Stream event history.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/StreamEvent",
                      },
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "Stream not found.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/streams/{id}/history/summary": {
      get: {
        summary: "Get stream event count summary",
        description: "Returns aggregated event counts per type for a stream. Useful for dashboard badges. Uses a single GROUP BY query; missing event types return 0.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The unique ID of the stream.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Event count summary.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      required: ["created", "claimed", "canceled", "start_time_updated", "paused", "resumed", "completed"],
                      properties: {
                        created: { type: "integer", example: 1 },
                        claimed: { type: "integer", example: 3 },
                        canceled: { type: "integer", example: 0 },
                        start_time_updated: { type: "integer", example: 1 },
                        paused: { type: "integer", example: 0 },
                        resumed: { type: "integer", example: 0 },
                        completed: { type: "integer", example: 1 },
                      },
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "Stream not found.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/streams/{id}/snapshot": {
      get: {
        summary: "Get Stream Snapshot",
        description:
          "Retrieves a complete snapshot of a stream including its data, progress, and history in one payload.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The unique ID of the stream.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "Complete stream snapshot.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      $ref: "#/components/schemas/StreamSnapshot",
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "Stream not found.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/events": {
      get: {
        summary: "List All Events",
        description:
          "Retrieves all stream events across all streams with pagination and optional filtering by event type, stream ID, and timestamp.",
        parameters: [
          {
            name: "page",
            in: "query",
            required: false,
            description: "Page number (default: 1).",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            required: false,
            description: "Number of events per page (default: 20, max: 100).",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Alias for pageSize. If both are provided, pageSize takes precedence.",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          {
            name: "eventType",
            in: "query",
            required: false,
            description: "Filter by event type: created, claimed, canceled, paused, resumed, start_time_updated, completed.",
            schema: {
              type: "string",
              enum: ["created", "claimed", "canceled", "paused", "resumed", "start_time_updated", "completed"],
            },
          },
          {
            name: "streamId",
            in: "query",
            required: false,
            description: "Filter by stream ID.",
            schema: { type: "string" },
          },
          {
            name: "since",
            in: "query",
            required: false,
            description: "Filter to events after this unix timestamp (in seconds).",
            schema: { type: "integer" },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Cursor for cursor-based pagination (event ID).",
            schema: { type: "integer" },
          },
        ],
        responses: {
          "200": {
            description: "Paginated list of events.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/StreamEvent",
                      },
                    },
                    total: {
                      type: "integer",
                      description: "Total number of events matching the filters.",
                    },
                    page: {
                      type: "integer",
                      description: "Current page number.",
                    },
                    pageSize: {
                      type: "integer",
                      description: "Number of events per page.",
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Validation error — invalid query parameters.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/Error",
                },
              },
            },
          },
        },
      },
    },
    "/api/open-issues": {
      get: {
        summary: "Get Open Issues",
        description: "Retrieves a list of open issues.",
        responses: {
          "200": {
            description: "List of open issues.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        description: "Issue details",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
