# SenderDashboard Component Structure

## Component Layout

```
┌─────────────────────────────────────────────────────────────┐
│                    SenderDashboard                          │
│                                                               │
│  Header: "Sender Dashboard"    [Create Stream Button] ──┐  │
│  Subtitle: "View your outgoing streams..."                  │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ STATS CARDS SECTION                                 │   │
│  │                                                      │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │   │
│  │  │ Streams  │ │  Total   │ │  Active  │ │Complet │ │   │
│  │  │ Created  │ │  Amount  │ │ Streams  │ │ /Cancel│ │   │
│  │  │    5     │ │   3000   │ │    3     │ │   2    │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ASSET BREAKDOWN CARDS                              │   │
│  │                                                      │   │
│  │  ┌──────────┐ ┌──────────┐                         │   │
│  │  │Total USDC│ │ Total XLM│                         │   │
│  │  │  2500    │ │   500    │                         │   │
│  │  └──────────┘ └──────────┘                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ STREAMS BY STATUS - BAR CHART                       │   │
│  │                                                      │   │
│  │       ▓                                             │   │
│  │       ▓      ▓   ▓                                 │   │
│  │  ┌────┼──────┼───┼──┬───┐                         │   │
│  │  │Sch│Active│Pau│Com│Can│                         │   │
│  │  └────┴──────┴───┴───┴───┘                         │   │
│  │   1     2     1   1   1                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ QUICK ACTIONS                                       │   │
│  │                                                      │   │
│  │  [Bulk Cancel (2)]  ◄─ When streams selected      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ RECENT ACTIVITY                                     │   │
│  │                                                      │   │
│  │  • Stream paused                     Nov 24, 10:55 │   │
│  │    Stream: str...m1                                │   │
│  │                                                      │   │
│  │  • Stream resumed                    Nov 23, 09:30 │   │
│  │    Stream: str...m1                                │   │
│  │                                                      │   │
│  │  • Claimed 500 USDC                  Nov 22, 14:20 │   │
│  │    Stream: str...m1                                │   │
│  │                                                      │   │
│  │  • Stream created (1000 USDC)        Nov 21, 11:00 │   │
│  │    Stream: str...m1                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ACTIVE & SCHEDULED STREAMS TABLE                    │   │
│  │                                                      │   │
│  │ ☐ To     Asset Total Status Progress Actions       │   │
│  │ ☑ Gre... USDC  1000 Active    50%  ✏️ Cancel      │   │
│  │ ☐ Gre... USDC   500 Schedul   0%   Edit  Cancel    │   │
│  │                                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ HISTORY - COMPLETED STREAMS TABLE                   │   │
│  │                                                      │   │
│  │ To     Asset Total  Status                          │   │
│  │ Gre... USDC  1000   Completed                       │   │
│  │ Gre... USDC   500   Canceled                        │   │
│  │                                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Component Hierarchy

```
SenderDashboard
├── State Management
│   ├── streams: Stream[]
│   ├── events: StreamEvent[]
│   ├── loading: boolean
│   ├── eventsLoading: boolean
│   ├── error: string | null
│   ├── showCreateForm: boolean
│   ├── createError: string | null
│   └── selectedStreamForBulkCancel: Set<string>
│
├── Effects
│   ├── useEffect (data loading)
│   │   ├── Fetch streams (listStreams)
│   │   ├── Fetch events (getSenderEvents)
│   │   └── Polling interval (5 seconds)
│   │
│   └── useMemo (calculations)
│       ├── stats (totalStreams, totalAmount, activeStreams, etc.)
│       └── chartData (streams by status)
│
├── Event Handlers
│   ├── handleCreate: Create stream
│   ├── handleCancel: Single stream cancel
│   └── handleBulkCancel: Multiple stream cancel
│
└── Render Sections
    ├── Connection Status
    ├── Loading State
    ├── Error State
    ├── Empty State
    └── Main Dashboard
        ├── Stats Cards
        ├── Asset Breakdown
        ├── Bar Chart (Streams by Status)
        ├── Quick Actions
        ├── Recent Activity Feed
        ├── Active & Scheduled Table (with checkboxes)
        └── History Table
```

## Data Flow

```
1. Component Mount
   └─► Fetch streams (sender-filtered)
       └─► Calculate stats & chart data
           └─► Display stats cards & chart

2. Events Load (Async)
   └─► Fetch all stream histories
       └─► Aggregate & sort by timestamp
           └─► Display recent activity feed

3. User Selects Streams
   └─► Update selectedStreamForBulkCancel
       └─► Show "Bulk Cancel" button
           └─► User confirms
               └─► Cancel all selected
                   └─► Refresh streams & events

4. Polling (Every 5s)
   └─► Refresh streams
       └─► Refresh events
           └─► Update stats & chart
```

## Key Features Summary

### 1. Analytics Cards (4 + n)
- ✅ Total Streams Created
- ✅ Total Amount Streamed  
- ✅ Active Streams Count
- ✅ Completed/Canceled Count
- ✅ Per-Asset Totals (dynamic)

### 2. Visualization
- ✅ Bar Chart: Streams by Status
- ✅ Color-coded by status
- ✅ Responsive design
- ✅ Only renders when data exists

### 3. Activity Feed
- ✅ Last 10 events aggregated
- ✅ Sorted by timestamp (newest first)
- ✅ Human-readable formatting
- ✅ Event type descriptions

### 4. Bulk Operations
- ✅ Stream selection (individual + all)
- ✅ Bulk cancel with confirmation
- ✅ Selection counter in button
- ✅ Clears selection after action

### 5. Stream Management
- ✅ Create new streams
- ✅ Single stream cancel
- ✅ Edit scheduled stream start time
- ✅ View stream progress

## Test Coverage (14 tests)

### Stats Cards (2 tests)
- ✓ Display correct counts and totals
- ✓ Show asset breakdown

### Bar Chart (1 test)
- ✓ Render with all status categories

### Activity Feed (2 tests)
- ✓ Display events with descriptions
- ✓ Aggregate from multiple streams

### Bulk Cancel (3 tests)
- ✓ Show button when streams selected
- ✓ Allow individual selection/deselection
- ✓ Select all with header checkbox

### Baseline Features (6 tests)
- ✓ Render with mocked streams
- ✓ Handle empty state
- ✓ Show create form
- ✓ Handle API errors
- ✓ Show wallet connection prompt
- ✓ Toggle create form from header

## API Integration

### Endpoints Used
- `GET /api/streams?sender=SENDER_ADDRESS`
  - Filters streams by sender
  - Returns paginated results
  
- `GET /api/streams/:streamId/history`
  - Retrieves event history for stream
  - Returns all events for stream
  
### Helper Function
- `getSenderEvents(senderAddress, limit=10)`
  - Aggregates events from all sender's streams
  - Sorts by timestamp (newest first)
  - Handles failures gracefully
  - Returns limited set (default 10)

## Performance Considerations

1. **Parallel Loading**: Events load async, don't block dashboard
2. **Smart Polling**: 5-second interval refreshes both streams and events
3. **Memoization**: Stats and chart data use useMemo for optimization
4. **Silent Failures**: Individual stream fetch failures don't break display
5. **Efficient Updates**: Only re-renders when state changes

## Accessibility Features

1. **ARIA Labels**: Proper labels on all interactive elements
2. **Semantic HTML**: Proper heading hierarchy and table markup
3. **Keyboard Navigation**: Checkboxes and buttons are keyboard accessible
4. **Status Updates**: Events and activity clearly indicate what happened
5. **Error Messages**: Clear, user-visible error handling
