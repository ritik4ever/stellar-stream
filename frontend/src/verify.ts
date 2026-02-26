import { getAuthChallenge, verifyAuthToken } from "./services/auth";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

async function verify() {
  const account = Keypair.random();
  console.log("Account:", account.publicKey());

  console.log("Fetching challenge...");
  const challenge = await getAuthChallenge(account.publicKey());
  console.log("Got challenge");

  const tx = TransactionBuilder.fromXDR(challenge, Networks.TESTNET);
  tx.sign(account);

  const signedXdr = tx.toXDR();
  console.log("Verifying token...");
  const token = await verifyAuthToken(signedXdr);
  console.log("Got Token:", token);

  console.log("Attempting POST /api/streams WITHOUT token...");
  const failRes = await fetch("http://localhost:3001/api/streams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: account.publicKey() }),
  });
  console.log("FAIL RES:", failRes.status, await failRes.json());

  console.log("Attempting POST /api/streams WITH token...");
  const successRes = await fetch("http://localhost:3001/api/streams", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      sender: account.publicKey(),
      recipient: account.publicKey(),
      assetCode: "USDC",
      totalAmount: 100,
      durationSeconds: 3600,
    }),
  });

  console.log("SUCCESS RES:", successRes.status, await successRes.json());
}

verify().catch(console.error);
