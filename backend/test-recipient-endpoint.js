/**
 * Test script for the recipient streams endpoint
 * Run with: node test-recipient-endpoint.js
 */

const BASE_URL = "http://localhost:3001/api";

async function testRecipientEndpoint() {
  console.log("Testing recipient streams endpoint...\n");

  // Test 1: Valid Stellar account ID
  console.log("Test 1: Valid Stellar account ID");
  const validAccountId = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  try {
    const response = await fetch(
      `${BASE_URL}/recipients/${validAccountId}/streams`
    );
    const data = await response.json();
    console.log(`✓ Status: ${response.status}`);
    console.log(`✓ Response:`, JSON.stringify(data, null, 2));
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 2: Invalid account ID (too short)
  console.log("Test 2: Invalid account ID (too short)");
  const invalidAccountId = "GABC123";
  try {
    const response = await fetch(
      `${BASE_URL}/recipients/${invalidAccountId}/streams`
    );
    const data = await response.json();
    console.log(`✓ Status: ${response.status} (expected 400)`);
    console.log(`✓ Response:`, JSON.stringify(data, null, 2));
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 3: Invalid account ID (wrong prefix)
  console.log("Test 3: Invalid account ID (wrong prefix)");
  const wrongPrefixId = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  try {
    const response = await fetch(
      `${BASE_URL}/recipients/${wrongPrefixId}/streams`
    );
    const data = await response.json();
    console.log(`✓ Status: ${response.status} (expected 400)`);
    console.log(`✓ Response:`, JSON.stringify(data, null, 2));
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 4: Compare with old filtering approach
  console.log("Test 4: Compare with old filtering approach");
  const testAccountId = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  try {
    const newEndpoint = await fetch(
      `${BASE_URL}/recipients/${testAccountId}/streams`
    );
    const newData = await newEndpoint.json();

    const oldEndpoint = await fetch(
      `${BASE_URL}/streams?recipient=${testAccountId}`
    );
    const oldData = await oldEndpoint.json();

    console.log(`✓ New endpoint returned ${newData.data.length} streams`);
    console.log(`✓ Old endpoint returned ${oldData.data.length} streams`);
    console.log(
      `✓ Results match: ${newData.data.length === oldData.data.length}`
    );
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n✅ All tests completed!");
}

testRecipientEndpoint().catch(console.error);
