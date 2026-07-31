# Bulk Selection Visual Guide

## UI Components

### Table with Selection Checkboxes
```
┌─────────────────────────────────────────────────────────────────┐
│ Live Streams                                    [Export CSV]     │
├─────────────────────────────────────────────────────────────────┤
│ [✓] │ ID  │ Route      │ Asset │ Progress │ Status    │ Actions│
├─────┼─────┼────────────┼───────┼──────────┼───────────┼────────┤
│ [✓] │ v 1 │ SENDER...  │ 1000  │ ████ 40% │ active    │ Cancel │
│     │     │ RECIPIENT..│ USDC  │          │           │        │
├─────┼─────┼────────────┼───────┼──────────┼───────────┼────────┤
│ [✓] │ v 2 │ SENDER...  │ 500   │ ██ 20%   │ scheduled │ Edit   │
│     │     │ RECIPIENT..│ XLM   │          │           │ Cancel │
├─────┼─────┼────────────┼───────┼──────────┼───────────┼────────┤
│     │ v 3 │ SENDER...  │ 2000  │ ████████ │ completed │ Cancel │
│     │     │ RECIPIENT..│ USDC  │   100%   │           │ (disabled)
└─────────────────────────────────────────────────────────────────┘
```

**Key Points:**
- Checkbox in header selects/deselects all eligible streams
- Only active and scheduled streams show checkboxes
- Completed and canceled streams have no checkbox

### Floating Action Bar (Bottom of Screen)
```
                    ┌─────────────────────────────────┐
                    │  2 streams selected             │
                    │  [Cancel 2 Streams]             │
                    └─────────────────────────────────┘
```

**During Cancellation:**
```
                    ┌─────────────────────────────────┐
                    │  2 streams selected             │
                    │  [Canceling 1/2...]  (disabled) │
                    └─────────────────────────────────┘
```

## User Interaction Flow

### Scenario 1: Select All and Cancel
1. User clicks header checkbox
2. All active/scheduled streams get selected
3. Floating action bar appears at bottom
4. User clicks "Cancel X Streams"
5. Button shows progress: "Canceling 1/5...", "Canceling 2/5...", etc.
6. After completion:
   - Selection cleared
   - Action bar disappears
   - Table refreshes automatically

### Scenario 2: Manual Selection
1. User clicks individual checkboxes
2. Action bar appears after first selection
3. Count updates: "1 stream selected", "2 streams selected", etc.
4. When all eligible streams selected, header checkbox auto-checks
5. User can deselect individual streams or use header to deselect all

### Scenario 3: Selection with Filtering
1. User selects 5 streams
2. User applies filter that removes 2 of those streams
3. Selection automatically cleaned up to only show 3 selected
4. Action bar updates count accordingly

### Scenario 4: Keyboard-Driven Selection
1. User clicks anywhere inside the table to give it focus context
2. User presses **Ctrl/Cmd + A** — all eligible streams are selected, action bar appears
3. User presses **Delete** — focus moves to the "Cancel X Streams" button (no action taken yet)
4. User presses **Enter** — bulk cancellation begins
5. Alternatively, pressing **Escape** at any point before confirming clears the selection and dismisses the action bar

## State Management

### Selection State
```typescript
// Set-based for O(1) lookup
const [selectedStreamIds, setSelectedStreamIds] = useState<Set<string>>(new Set());

// Example state:
// Set { "stream-1", "stream-3", "stream-7" }
```

### Bulk Cancellation State
```typescript
const [isBulkCanceling, setIsBulkCanceling] = useState(false);
const [bulkCancelProgress, setBulkCancelProgress] = useState({ 
  current: 0, 
  total: 0 
});

// During operation:
// { current: 3, total: 10 }
```

## Sequential Execution Flow

```
User clicks "Cancel 5 Streams"
         ↓
    Set isBulkCanceling = true
         ↓
    Loop through selected IDs:
         ↓
    ┌─────────────────────┐
    │ Cancel stream 1     │ → Success ✓
    └─────────────────────┘
         ↓
    Update progress: 1/5
         ↓
    ┌─────────────────────┐
    │ Cancel stream 2     │ → Success ✓
    └─────────────────────┘
         ↓
    Update progress: 2/5
         ↓
    ┌─────────────────────┐
    │ Cancel stream 3     │ → Failed ✗ (logged, continue)
    └─────────────────────┘
         ↓
    Update progress: 3/5
         ↓
    ... continue for all streams
         ↓
    Clear selection
         ↓
    Refresh table
         ↓
    Set isBulkCanceling = false
         ↓
    Action bar disappears
```

## CSS Classes

### Bulk Action Bar
- `.bulk-action-bar` - Container with fixed positioning
- `.bulk-action-bar__content` - Inner content with dark background
- `.bulk-action-bar__count` - Text showing selection count
- `.bulk-action-bar__button` - Red cancel button

### Animations
- `@keyframes bulk-action-slide-up` - Smooth entrance animation

### Responsive Breakpoints
- Desktop: Centered, min-width 320px
- Mobile (<768px): Full width with padding

## Accessibility Features

### ARIA Labels
```html
<!-- Header checkbox -->
<input 
  type="checkbox" 
  aria-label="Select all streams"
/>

<!-- Row checkbox -->
<input 
  type="checkbox" 
  aria-label="Select stream 123"
/>
```

### Keyboard Navigation
- Tab through checkboxes
- Space to toggle selection
- Tab to action bar button
- Enter to execute bulk cancel
- **Ctrl/Cmd + A**: Select or deselect all eligible (active/scheduled) streams at once
- **Escape**: Clear the current selection entirely
- **Delete / Backspace**: When streams are selected, moves focus to the "Cancel X Streams" button rather than canceling immediately — requires an explicit Enter/click to confirm

### Screen Reader Announcements
- "2 streams selected"
- "Canceling 3 of 10"
- Button disabled state announced

## Edge Cases Handled

1. **No Selectable Streams**: Header checkbox hidden
2. **All Streams Completed**: No checkboxes shown
3. **Filter Changes**: Selection auto-cleaned
4. **API Failures**: Logged, operation continues
5. **Rapid Clicking**: Button disabled during operation
6. **Empty Selection**: Action bar hidden
7. **Single Stream**: Proper singular text ("1 stream selected")
