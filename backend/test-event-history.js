// Simple test script to verify event history functionality
// Run with: node test-event-history.js

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'streams.db');

console.log('Testing Event History Implementation\n');
console.log('=====================================\n');

try {
  const db = new Database(DB_PATH);
  
  // Check if tables exist
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('✓ Database tables:', tables.map(t => t.name).join(', '));
  
  // Check stream_events table schema
  const schema = db.prepare("PRAGMA table_info(stream_events)").all();
  console.log('\n✓ stream_events table columns:');
  schema.forEach(col => {
    console.log(`  - ${col.name} (${col.type})`);
  });
  
  // Check indexes
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='stream_events'").all();
  console.log('\n✓ Indexes:', indexes.map(i => i.name).join(', '));
  
  // Count existing events
  const eventCount = db.prepare("SELECT COUNT(*) as count FROM stream_events").get();
  console.log(`\n✓ Total events in database: ${eventCount.count}`);
  
  // Show sample events if any exist
  if (eventCount.count > 0) {
    const sampleEvents = db.prepare("SELECT * FROM stream_events ORDER BY timestamp DESC LIMIT 5").all();
    console.log('\n✓ Sample events:');
    sampleEvents.forEach(event => {
      console.log(`  - [${event.event_type}] Stream ${event.stream_id} at ${new Date(event.timestamp * 1000).toISOString()}`);
    });
  }
  
  db.close();
  
  console.log('\n=====================================');
  console.log('✓ All checks passed!');
  console.log('\nEvent history system is ready to use.');
  console.log('Start the backend server and create/cancel streams to see events.');
  
} catch (error) {
  console.error('✗ Error:', error.message);
  console.log('\nMake sure to run the backend at least once to initialize the database.');
  process.exit(1);
}
