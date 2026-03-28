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
            exclusiveMinimum: 0,
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
            enum: ["created", "claimed", "canceled", "start_time_updated"],
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
      Error: {
        type: "object",
        properties: {
          error: {
            type: "string",
            example: "Stream not found.",
          },
          requestId: {
            type: "string",
            example: "req_123456789",
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
    "/api/recipients/{accountId}/streams": {
      get: {
        summary: "Get recipient streams",
        description: "Retrieves all streams for a specific recipient.",
        parameters: [
          {
            name: "accountId",
            in: "path",
            required: true,
            description: "The Stellar account ID of the recipient.",
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "200": {
            description: "A list of streams for the recipient.",
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
