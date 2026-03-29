/**
 * Test script for improved recipient endpoint
 * Tests filtering, search, and pagination capabilities
 */

const BASE_URL = "http://localhost:3001";

// Test account IDs (valid Stellar format)
const RECIPIENT_ID = "GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const SENDER_ID = "GCYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";

async function testRecipientEndpoint() {
  console.log("🧪 Testing Improved Recipient Endpoint\n");

  // Test 1: Basic recipient streams fetch
  console.log("Test 1: Fetch all streams for recipient");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status}`);
    console.log(`   Total streams: ${data.total}`);
    console.log(`   Page: ${data.page}, Limit: ${data.limit}`);
    console.log(`   Returned: ${data.data.length} streams\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 2: Filter by status
  console.log("Test 2: Filter by status=active");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams?status=active`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status}`);
    console.log(`   Active streams: ${data.total}`);
    console.log(`   All have status 'active': ${data.data.every(s => s.progress.status === 'active')}\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 3: Filter by sender
  console.log("Test 3: Filter by sender");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams?sender=${SENDER_ID}`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status}`);
    console.log(`   Streams from sender: ${data.total}\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 4: Filter by asset
  console.log("Test 4: Filter by asset=USDC");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams?asset=USDC`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status}`);
    console.log(`   USDC streams: ${data.total}\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 5: Search functionality
  console.log("Test 5: Search with q parameter");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams?q=test`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status}`);
    console.log(`   Search results: ${data.total}\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 6: Pagination
  console.log("Test 6: Pagination (page=1, limit=5)");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams?page=1&limit=5`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status}`);
    console.log(`   Total: ${data.total}, Page: ${data.page}, Limit: ${data.limit}`);
    console.log(`   Returned: ${data.data.length} streams\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 7: Combined filters
  console.log("Test 7: Combined filters (status + asset + pagination)");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams?status=active&asset=USDC&page=1&limit=10`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status}`);
    console.log(`   Filtered results: ${data.total}\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 8: Invalid account ID
  console.log("Test 8: Invalid account ID (should return 400)");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/INVALID_ID/streams`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status} (expected 400)`);
    console.log(`   Error: ${data.error}\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 9: Invalid status filter
  console.log("Test 9: Invalid status filter (should return 400)");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams?status=invalid`
    );
    const data = await response.json();
    console.log(`✅ Status: ${response.status} (expected 400)`);
    console.log(`   Error: ${data.error}\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  // Test 10: Verify progress data is included
  console.log("Test 10: Verify progress data is included");
  try {
    const response = await fetch(
      `${BASE_URL}/api/recipients/${RECIPIENT_ID}/streams?limit=1`
    );
    const data = await response.json();
    if (data.data.length > 0) {
      const stream = data.data[0];
      const hasProgress = stream.progress && 
        'status' in stream.progress && 
        'vestedAmount' in stream.progress &&
        'remainingAmount' in stream.progress;
      console.log(`✅ Progress data included: ${hasProgress}`);
      if (hasProgress) {
        console.log(`   Status: ${stream.progress.status}`);
        console.log(`   Vested: ${stream.progress.vestedAmount}`);
        console.log(`   Remaining: ${stream.progress.remainingAmount}\n`);
      }
    } else {
      console.log(`⚠️  No streams found to verify progress data\n`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }

  console.log("✨ Testing complete!");
}

testRecipientEndpoint().catch(console.error);
