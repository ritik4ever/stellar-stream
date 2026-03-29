import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  scValToNative,
} from "@stellar/stellar-sdk";
import { recordEventWithDb } from "./eventHistory";
import { getDb } from "./db";

let rpcServer: rpc.Server | null = null;
let contractId: string | null = null;
let networkPassphrase: string = Networks.TESTNET;
let lastProcessedLedger = 0;
let indexerInterval: NodeJS.Timeout | null = null;

export function initIndexer(
  rpcUrl: string,
  contractIdParam: string,
  networkPass?: string,
): void {
  rpcServer = new rpc.Server(rpcUrl);
  contractId = contractIdParam;
  if (networkPass) {
    networkPassphrase = networkPass;
  }
}

export function startIndexer(intervalMs = 10000): void {
  if (indexerInterval) {
    return;
  }

  console.log(`Starting event indexer with ${intervalMs}ms interval`);
  indexerInterval = setInterval(() => {
    indexEvents().catch((err) => {
      console.error("Indexer error:", err);
    });
  }, intervalMs);

  // Run immediately on start
  indexEvents().catch((err) => {
    console.error("Initial indexer error:", err);
  });
}

export function stopIndexer(): void {
  if (indexerInterval) {
    clearInterval(indexerInterval);
    indexerInterval = null;
    console.log("Event indexer stopped");
  }
}

async function indexEvents(): Promise<void> {
  if (!rpcServer || !contractId) {
    return;
  }

  try {
    const db = getDb();
    const latestLedger = await rpcServer.getLatestLedger();
    const currentLedger = latestLedger.sequence;

    if (lastProcessedLedger === 0) {
      // First run - attempt to load last processed ledger from database
      const row = db
        .prepare("SELECT last_ledger FROM indexer_cursor WHERE id = ?")
        .get(contractId) as { last_ledger: number } | undefined;

      if (row) {
        lastProcessedLedger = row.last_ledger;
      } else {
        // Fallback: start from recent history (last 100 ledgers)
        lastProcessedLedger = Math.max(1, currentLedger - 100);
      }
    }

    if (currentLedger <= lastProcessedLedger) {
      return;
    }

    // Fetch events from last processed to current
    const events = await rpcServer.getEvents({
      startLedger: lastProcessedLedger + 1,
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
        },
      ],
    });

    // Use a transaction to ensure events and cursor are updated atomically.
    // This prevents duplicate events if the process crashes mid-batch.
    db.transaction(() => {
      for (const event of events.events || []) {
        processEvent(db, event);
      }

      lastProcessedLedger = currentLedger;
      db.prepare(
        "INSERT INTO indexer_cursor (id, last_ledger) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET last_ledger = excluded.last_ledger",
      ).run(contractId, lastProcessedLedger);
    })();
  } catch (err) {
    console.error("Failed to index events:", err);
  }
}

/**
 * Processes a single contract event and records it in history.
 * Note: This is now synchronous to support database transactions.
 */
function processEvent(db: any, event: rpc.Api.EventResponse): void {
  try {
    const topic = event.topic.map((t: any) => scValToNative(t));
    const value = scValToNative(event.value);

    // Event topics are [contract_symbol, event_name]
    if (topic.length < 2) return;

    const eventName = topic[1];
    const timestamp = Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000);

    switch (eventName) {
      case "Created":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "created",
          timestamp,
          value.sender,
          value.total_amount,
          {
            recipient: value.recipient,
            token: value.token,
            startTime: value.start_time,
            endTime: value.end_time,
          },
        );
        break;

      case "Claimed":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "claimed",
          timestamp,
          value.recipient,
          value.amount,
        );
        break;

      case "Canceled":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "canceled",
          timestamp,
          value.sender,
        );
        break;
    }
  } catch (err) {
    console.error("Failed to process event:", err);
  }
}
