import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  scValToNative,
} from "@stellar/stellar-sdk";
import { recordEvent } from "./eventHistory";

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
    const latestLedger = await rpcServer.getLatestLedger();
    const currentLedger = latestLedger.sequence;

    if (lastProcessedLedger === 0) {
      // First run - start from recent history (last 100 ledgers)
      lastProcessedLedger = Math.max(1, currentLedger - 100);
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

    for (const event of events.events || []) {
      await processEvent(event);
    }

    lastProcessedLedger = currentLedger;
  } catch (err) {
    console.error("Failed to index events:", err);
  }
}

async function processEvent(event: rpc.Api.EventResponse): Promise<void> {
  try {
    const topic = event.topic.map((t: any) => scValToNative(t));
    const value = scValToNative(event.value);

    // Event topics are [contract_symbol, event_name]
    if (topic.length < 2) return;

    const eventName = topic[1];
    const timestamp = Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000);

    switch (eventName) {
      case "Created":
        recordEvent(
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
        recordEvent(
          value.stream_id.toString(),
          "claimed",
          timestamp,
          value.recipient,
          value.amount,
        );
        break;

      case "Canceled":
        recordEvent(
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
