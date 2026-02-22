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
                required: ["sender", "recipient", "assetCode", "totalAmount", "durationSeconds"],
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
            Error: {
                type: "object",
                properties: {
                    error: {
                        type: "string",
                        example: "Stream not found.",
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
                                        service: { type: "string", example: "stellar-stream-backend" },
                                        status: { type: "string", example: "ok" },
                                        timestamp: { type: "string", example: "2024-05-22T10:06:40.000Z" },
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
                                            description: "Total streams matching filters (before pagination).",
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
        "/api/streams/{id}/start-time": {
            patch: {
                summary: "Update start time of a scheduled stream",
                description:
                    "Updates the startAt timestamp of a stream. Only streams with status **scheduled** can be edited. Active, completed, and canceled streams will be rejected with a 422 error.",
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        description: "The unique ID of the stream to update.",
                        schema: {
                            type: "string",
                        },
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["startAt"],
                                properties: {
                                    startAt: {
                                        type: "number",
                                        description: "New start time as a UNIX timestamp in seconds. Must be in the future.",
                                        example: 1716400000,
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": {
                        description: "Start time updated successfully.",
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
                        description: "Missing or invalid startAt value.",
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
                    "422": {
                        description: "Stream is not in scheduled status and cannot be edited.",
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
