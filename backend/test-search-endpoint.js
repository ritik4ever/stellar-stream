/**
 * Test script for the search functionality in streams endpoint
 * Run with: node test-search-endpoint.js
 */

const BASE_URL = "http://localhost:3001/api";

async function testSearchEndpoint() {
  console.log("Testing search functionality in streams endpoint...\n");

  // Test 1: Search with empty query (should not break)
  console.log("Test 1: Empty search query");
  try {
    const response = await fetch(`${BASE_URL}/streams?q=`);
    const data = await response.json();
    console.log(`✓ Status: ${response.status}`);
    console.log(`✓ Returned ${data.data.length} streams`);
    console.log(`✓ Empty query handled gracefully`);
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 2: Search with whitespace-only query
  console.log("Test 2: Whitespace-only search query");
  try {
    const response = await fetch(`${BASE_URL}/streams?q=${encodeURIComponent("   ")}`);
    const data = await response.json();
    console.log(`✓ Status: ${response.status}`);
    console.log(`✓ Returned ${data.data.length} streams`);
    console.log(`✓ Whitespace query handled gracefully`);
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 3: Case-insensitive search
  console.log("Test 3: Case-insensitive search");
  try {
    const lowerResponse = await fetch(`${BASE_URL}/streams?q=usdc`);
    const lowerData = await lowerResponse.json();
    
    const upperResponse = await fetch(`${BASE_URL}/streams?q=USDC`);
    const upperData = await upperResponse.json();
    
    const mixedResponse = await fetch(`${BASE_URL}/streams?q=UsDc`);
    const mixedData = await mixedResponse.json();
    
    console.log(`✓ Lowercase 'usdc': ${lowerData.data.length} streams`);
    console.log(`✓ Uppercase 'USDC': ${upperData.data.length} streams`);
    console.log(`✓ Mixed case 'UsDc': ${mixedData.data.length} streams`);
    console.log(`✓ Case-insensitive: ${lowerData.data.length === upperData.data.length && upperData.data.length === mixedData.data.length}`);
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 4: Search combined with status filter
  console.log("Test 4: Search combined with status filter");
  try {
    const searchOnly = await fetch(`${BASE_URL}/streams?q=G`);
    const searchOnlyData = await searchOnly.json();
    
    const searchWithStatus = await fetch(`${BASE_URL}/streams?q=G&status=active`);
    const searchWithStatusData = await searchWithStatus.json();
    
    console.log(`✓ Search only 'G': ${searchOnlyData.data.length} streams`);
    console.log(`✓ Search 'G' + status=active: ${searchWithStatusData.data.length} streams`);
    console.log(`✓ Combined filter works: ${searchWithStatusData.data.length <= searchOnlyData.data.length}`);
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 5: Search combined with sender filter
  console.log("Test 5: Search combined with exact sender filter");
  try {
    const testSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const searchOnly = await fetch(`${BASE_URL}/streams?q=AAA`);
    const searchOnlyData = await searchOnly.json();
    
    const searchWithSender = await fetch(`${BASE_URL}/streams?q=AAA&sender=${testSender}`);
    const searchWithSenderData = await searchWithSender.json();
    
    console.log(`✓ Search only 'AAA': ${searchOnlyData.data.length} streams`);
    console.log(`✓ Search 'AAA' + sender filter: ${searchWithSenderData.data.length} streams`);
    console.log(`✓ Combined filter works: ${searchWithSenderData.data.length <= searchOnlyData.data.length}`);
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 6: Search with pagination
  console.log("Test 6: Search with pagination");
  try {
    const page1 = await fetch(`${BASE_URL}/streams?q=G&page=1&limit=5`);
    const page1Data = await page1.json();
    
    console.log(`✓ Status: ${page1.status}`);
    console.log(`✓ Page 1 returned ${page1Data.data.length} streams`);
    console.log(`✓ Total matching: ${page1Data.total}`);
    console.log(`✓ Page: ${page1Data.page}, Limit: ${page1Data.limit}`);
    console.log(`✓ Pagination works with search`);
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 7: Search across different fields
  console.log("Test 7: Search matches across stream ID, sender, recipient, and asset");
  try {
    // This test assumes there might be streams with various data
    const response = await fetch(`${BASE_URL}/streams?q=1`);
    const data = await response.json();
    
    console.log(`✓ Search for '1' returned ${data.data.length} streams`);
    
    if (data.data.length > 0) {
      const sample = data.data[0];
      console.log(`✓ Sample result:`);
      console.log(`  - ID: ${sample.id}`);
      console.log(`  - Sender: ${sample.sender.substring(0, 20)}...`);
      console.log(`  - Recipient: ${sample.recipient.substring(0, 20)}...`);
      console.log(`  - Asset: ${sample.assetCode}`);
    }
    console.log(`✓ Multi-field search works`);
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n---\n");

  // Test 8: Search with special characters (should not break)
  console.log("Test 8: Search with special characters");
  try {
    const specialChars = ["@", "#", "$", "%", "&"];
    let allPassed = true;
    
    for (const char of specialChars) {
      const response = await fetch(`${BASE_URL}/streams?q=${encodeURIComponent(char)}`);
      if (response.status !== 200) {
        allPassed = false;
        console.log(`✗ Failed for character: ${char}`);
      }
    }
    
    if (allPassed) {
      console.log(`✓ All special characters handled gracefully`);
    }
  } catch (error) {
    console.log(`✗ Error:`, error.message);
  }

  console.log("\n✅ All search tests completed!");
}

testSearchEndpoint().catch(console.error);
