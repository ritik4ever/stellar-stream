const fetch = require('node-fetch');

async function test() {
  const accountId = "GA72D2O6OZW7S3YDK7GXYRTYZ6A2MUB2PGLF5H5B7Z2ZCYQIFZ6Q7N4R";
  
  console.log("1. Requesting challenge without token");
  const failRes = await fetch("http://localhost:3001/api/streams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: accountId })
  });
  console.log("FAIL RES:", failRes.status, await failRes.json());
  
  console.log("2. Generating challenge...");
  const chRes = await fetch(`http://localhost:3001/api/auth/challenge?accountId=${accountId}`);
  const { transaction } = await chRes.json();
  console.log("Challenge:", transaction.substring(0, 30) + "...");
  
}

test().catch(console.error);
