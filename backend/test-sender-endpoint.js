
const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api';
const VALID_ACCOUNT = 'GBGD3W3A2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2W2';
const INVALID_ACCOUNT = 'invalid_stellar_account';

async function testEndpoint() {
  console.log('Testing /api/senders/:accountId/streams...');

  // Test invalid account
  try {
    await axios.get(`${BASE_URL}/senders/${INVALID_ACCOUNT}/streams`);
  } catch (error) {
    if (error.response && error.response.status === 400) {
      console.log('✅ Invalid account returns 400');
    } else {
      console.error('❌ Invalid account did not return 400', error.message);
    }
  }

  // Test valid account (even if empty)
  try {
    const response = await axios.get(`${BASE_URL}/senders/${VALID_ACCOUNT}/streams`);
    if (response.status === 200 && response.data.hasOwnProperty('data')) {
      console.log('✅ Valid account returns 200 with data');
      console.log('Response shape:', JSON.stringify(response.data, null, 2));
    } else {
      console.error('❌ Valid account did not return 200 or expected shape', response.status);
    }
  } catch (error) {
    console.error('❌ Failed to connect to server. Is it running?', error.message);
  }
}

// Note: This script requires the server to be running.
// If I can't run the server, I'll just trust the code logic as it's straightforward.
// I'll try to run the server in the background and then test.
