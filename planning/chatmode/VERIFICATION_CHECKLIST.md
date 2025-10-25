# Tool Calling System - Verification Checklist

This checklist will help you verify that the LLM Tools Registry is working correctly using the demo Calculator tool.

## Prerequisites

✅ **Demo Tool Created**: `app/plugins/examples/demo-calculator-tool.client.ts`
✅ **Development Server Running**: `bun run dev`
✅ **Browser DevTools Open**: For viewing console logs

---

## 1. Tool Registration Verification

### Steps:
1. Start the dev server: `bun run dev`
2. Open the app in your browser
3. Open browser DevTools Console (F12 → Console tab)

### Expected Results:
- [ ] Console shows: `[Demo Plugin] Calculator tool registered successfully`
- [ ] No errors in console during registration

**Status**: ⬜ Pass / ⬜ Fail

**Notes**:
```
_______________________________________________
```

---

## 2. UI Toggle Appearance

### Steps:
1. Navigate to any chat page
2. Click the **Settings button** (sliders icon) in the chat input area
3. Look for the Calculator tool in the settings popover

### Expected Results:
- [ ] "Calculator" toggle appears in the settings popover
- [ ] Calculator icon (pixelarticons:calculator) displays next to toggle
- [ ] Description text shows: "Let the AI perform arithmetic calculations"
- [ ] Toggle is **ON by default** (green/enabled state)
- [ ] Toggle is positioned between "Enable thinking" and "System prompts"

**Status**: ⬜ Pass / ⬜ Fail

**Screenshot Location** (optional):
```
_______________________________________________
```

---

## 3. Toggle Interaction

### Steps:
1. With settings popover open, click the Calculator toggle to **disable** it
2. Close the popover
3. Reopen the settings popover
4. Toggle it back **on**

### Expected Results:
- [ ] Toggle responds to clicks (switches on/off)
- [ ] Toggle state persists when closing/reopening popover
- [ ] Console shows localStorage updates (optional check)
- [ ] No errors in console during toggle

**Status**: ⬜ Pass / ⬜ Fail

**Notes**:
```
_______________________________________________
```

---

## 4. Tool Calling - Basic Math

### Steps:
1. Ensure Calculator toggle is **enabled**
2. In the chat input, type: **"What is 156 plus 244?"**
3. Send the message
4. Watch the DevTools Console for tool execution logs

### Expected Results:
- [ ] Console shows: `[Calculator Tool] Executing:` with operation details
- [ ] Console shows: `[Calculator Tool] Result: Calculation complete: 156 add 244 = 400`
- [ ] Assistant's response includes the calculated result (400)
- [ ] Response is natural language incorporating the tool result
- [ ] Message thread shows both user message and assistant response

**Status**: ⬜ Pass / ⬜ Fail

**Assistant Response**:
```
_______________________________________________
```

---

## 5. Tool Calling - Different Operations

### Test Cases:

#### A. Subtraction
**Prompt**: "What is 1000 minus 237?"
- [ ] Tool called with `operation: "subtract"`
- [ ] Correct result: 763
- [ ] Natural language response

#### B. Multiplication
**Prompt**: "Calculate 25 times 16"
- [ ] Tool called with `operation: "multiply"`
- [ ] Correct result: 400
- [ ] Natural language response

#### C. Division
**Prompt**: "Divide 144 by 12"
- [ ] Tool called with `operation: "divide"`
- [ ] Correct result: 12
- [ ] Natural language response

**Status**: ⬜ Pass / ⬜ Fail

**Notes**:
```
_______________________________________________
```

---

## 6. Error Handling - Division by Zero

### Steps:
1. Ask: **"What is 100 divided by 0?"**
2. Observe console and response

### Expected Results:
- [ ] Tool is called with divide operation
- [ ] Error is caught: "Cannot divide by zero"
- [ ] Console shows error handling
- [ ] Assistant explains the error gracefully (doesn't crash)
- [ ] Conversation can continue normally

**Status**: ⬜ Pass / ⬜ Fail

**Assistant Response**:
```
_______________________________________________
```

---

## 7. Tool Disabled Behavior

### Steps:
1. Open settings popover
2. **Disable** the Calculator toggle
3. Ask: **"What is 50 plus 50?"**

### Expected Results:
- [ ] Calculator toggle shows as OFF/disabled
- [ ] Tool is NOT called (no console logs from Calculator Tool)
- [ ] Assistant attempts to answer WITHOUT using the tool
- [ ] Assistant may calculate manually or refuse if unable
- [ ] No errors occur

**Status**: ⬜ Pass / ⬜ Fail

**Assistant Response**:
```
_______________________________________________
```

---

## 8. Persistence Across Page Reload

### Steps:
1. Open settings, ensure Calculator is **enabled**
2. **Reload the page** (F5 or Cmd+R)
3. Reopen settings popover

### Expected Results:
- [ ] Calculator tool reappears in settings
- [ ] Toggle state is preserved (still enabled)
- [ ] Console shows tool re-registered after reload
- [ ] Tool works immediately (no need to re-enable)

**Status**: ⬜ Pass / ⬜ Fail

**Notes**:
```
_______________________________________________
```

---

## 9. Streaming Safety

### Steps:
1. Ask a question that will trigger calculator
2. While the assistant is **streaming its response**, try to open settings
3. Try to interact with the Calculator toggle

### Expected Results:
- [ ] Settings button may be disabled during streaming (depends on implementation)
- [ ] If settings open, toggle appears **disabled/grayed out**
- [ ] Cannot change toggle state while streaming
- [ ] Toggle becomes interactive again after streaming completes

**Status**: ⬜ Pass / ⬜ Fail

**Notes**:
```
_______________________________________________
```

---

## 10. Multiple Tool Calls in One Conversation

### Steps:
1. Ask: **"Calculate 10 + 5, then multiply that result by 3"**
2. Observe console for multiple tool calls

### Expected Results:
- [ ] Tool is called at least once (possibly twice if model breaks it down)
- [ ] Assistant uses tool result(s) to answer
- [ ] Response is coherent and includes final answer (45)
- [ ] No infinite loops (max 10 iterations enforced)

**Status**: ⬜ Pass / ⬜ Fail

**Assistant Response**:
```
_______________________________________________
```

---

## 11. Tool Unregistration (HMR Test)

### Steps:
1. With dev server running, edit the tool file slightly (add a comment)
2. Save the file to trigger Hot Module Replacement
3. Check console logs

### Expected Results:
- [ ] Console shows: `[Demo Plugin] Cleaning up calculator tool`
- [ ] Console shows: `[Demo Plugin] Calculator tool registered successfully` (re-registration)
- [ ] Tool continues to work after HMR
- [ ] No duplicate tools in settings

**Status**: ⬜ Pass / ⬜ Fail

**Notes**:
```
_______________________________________________
```

---

## 12. IndexedDB Message Storage

### Steps:
1. After having a conversation with tool calls
2. Open DevTools → Application → IndexedDB → `or3-db` → `messages`
3. Find the messages from your conversation

### Expected Results:
- [ ] User message is stored
- [ ] Assistant message with tool call is stored
- [ ] Tool result message is stored (role: "tool")
- [ ] Messages have correct `threadId`
- [ ] Tool call metadata is in message `data` field

**Status**: ⬜ Pass / ⬜ Fail

**Notes**:
```
_______________________________________________
```

---

## Summary

### Overall Results

| Test Section | Status |
|--------------|--------|
| 1. Registration | ⬜ |
| 2. UI Appearance | ⬜ |
| 3. Toggle Interaction | ⬜ |
| 4. Basic Calling | ⬜ |
| 5. Multiple Operations | ⬜ |
| 6. Error Handling | ⬜ |
| 7. Disabled Behavior | ⬜ |
| 8. Persistence | ⬜ |
| 9. Streaming Safety | ⬜ |
| 10. Multiple Calls | ⬜ |
| 11. HMR/Cleanup | ⬜ |
| 12. Database Storage | ⬜ |

**Total Passed**: _____ / 12

---

## Issues Found

**Issue #1**:
```
Description: _______________________________
Severity: [ ] Critical / [ ] Major / [ ] Minor
Steps to Reproduce: ________________________
Expected: __________________________________
Actual: ____________________________________
```

**Issue #2**:
```
Description: _______________________________
Severity: [ ] Critical / [ ] Major / [ ] Minor
Steps to Reproduce: ________________________
Expected: __________________________________
Actual: ____________________________________
```

---

## Additional Notes

```
Add any observations, suggestions, or additional testing notes here:

_________________________________________________
_________________________________________________
_________________________________________________
```

---

## Quick Test Commands

For quick manual testing in the chat:

```
✅ "What is 156 plus 244?"
✅ "Calculate 50 times 8"  
✅ "What is 1000 minus 237?"
✅ "Divide 144 by 12"
❌ "What is 100 divided by 0?" (should error gracefully)
🔄 "Calculate 10 + 5, then multiply that by 3"
```

---

**Tested By**: _______________
**Date**: _______________
**Build/Commit**: _______________
