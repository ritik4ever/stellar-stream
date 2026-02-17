export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
  complexity: "Trivial" | "Medium" | "High";
  points: 100 | 150 | 200;
}

export const openIssues: OpenIssue[] = [
  {
    id: "soroban-onchain-persistence",
    title: "Persist stream lifecycle on Soroban mainnet/testnet",
    labels: ["stellar-wave", "enhancement", "soroban"],
    summary: "Move stream creation and cancellation from in-memory API storage to on-chain contract calls.",
    complexity: "High",
    points: 200,
  },
  {
    id: "freighter-wallet-signing",
    title: "Add Freighter wallet signing flow",
    labels: ["stellar-wave", "enhancement", "frontend", "wallet"],
    summary: "Connect sender accounts and sign stream transactions directly from the UI.",
    complexity: "Medium",
    points: 150,
  },
  {
    id: "claim-with-token-transfer",
    title: "Enable token transfer claims in contract",
    labels: ["stellar-wave", "enhancement", "smart-contract"],
    summary: "Integrate token transfer client in `claim` and transfer vested balances to recipients.",
    complexity: "High",
    points: 200,
  },
  {
    id: "indexer-history",
    title: "Stream activity history with indexer",
    labels: ["stellar-wave", "enhancement", "backend", "analytics"],
    summary: "Track events for stream created, canceled, and claimed using a lightweight indexer service.",
    complexity: "Medium",
    points: 150,
  },
  {
    id: "ui-form-validation-polish",
    title: "Improve form validation and wallet address checks",
    labels: ["good first issue", "frontend", "stellar-wave"],
    summary: "Add client-side Stellar address validation and friendlier field errors.",
    complexity: "Trivial",
    points: 100,
  },
];
