# Quick Test Guide - Calculator Tool

## 🚀 Getting Started (5 minutes)

### 1. Start Dev Server
```bash
bun run dev
```

### 2. Open Browser
- Navigate to: `http://localhost:3000`
- Open DevTools (F12 or Cmd+Option+I)
- Go to Console tab

### 3. Look for Registration
You should see in console:
```
[Demo Plugin] Calculator tool registered successfully
```

---

## 🎯 Quick Tests

### Test 1: UI Check (30 seconds)
1. Go to any chat page
2. Click the **settings button** (sliders icon) in chat input
3. **Look for**: "Calculator" toggle with calculator icon
4. **Verify**: Toggle is ON (enabled) by default

✅ **Pass if**: Calculator appears in settings with icon and description

---

### Test 2: Basic Tool Call (1 minute)
1. Type: **"What is 156 plus 244?"**
2. Send message
3. Watch console for:
   ```
   [Calculator Tool] Executing: {operation: "add", a: 156, b: 244}
   [Calculator Tool] Result: Calculation complete: 156 add 244 = 400
   ```

✅ **Pass if**: Tool executes and AI responds with "400"

---

### Test 3: Toggle On/Off (1 minute)
1. Open settings, **disable** Calculator
2. Ask: **"What is 50 plus 50?"**
3. **Verify**: No calculator console logs appear
4. AI answers WITHOUT using the tool

✅ **Pass if**: Tool doesn't execute when disabled

---

### Test 4: Persistence (30 seconds)
1. Ensure Calculator is **enabled**
2. **Reload page** (F5)
3. Open settings again

✅ **Pass if**: Calculator toggle is still enabled after reload

---

### Test 5: Error Handling (1 minute)
1. Ask: **"What is 100 divided by 0?"**
2. Watch console for error
3. **Verify**: AI handles error gracefully

✅ **Pass if**: No app crash, AI explains the error

---

## 🐛 Common Issues

### Issue: Tool not appearing in UI
**Solution**: 
- Check console for registration message
- Ensure dev server restarted after adding plugin
- Clear browser cache and reload

### Issue: Tool not being called
**Solution**:
- Verify toggle is enabled in settings
- Check model supports function calling (try GPT-4 or Claude)
- Look for errors in console

### Issue: Console shows errors
**Solution**:
- Check browser console for specific error
- Verify OpenRouter API key is configured
- Try clearing localStorage: `localStorage.clear()`

---

## 📋 Test Prompts Cheat Sheet

Copy/paste these into chat:

```
✅ Basic Addition
"What is 156 plus 244?"

✅ Subtraction  
"What is 1000 minus 237?"

✅ Multiplication
"Calculate 25 times 16"

✅ Division
"Divide 144 by 12"

❌ Error Case
"What is 100 divided by 0?"

🔄 Multiple Operations
"Calculate 10 + 5, then multiply that by 3"

🧪 Complex
"I have 15 apples and buy 23 more. Then I give away 8. How many do I have?"
```

---

## ✅ Success Criteria

Your implementation is working if:

- [x] Calculator tool appears in settings UI
- [x] Toggle can be enabled/disabled
- [x] Tool is called when asking math questions
- [x] Console logs show tool execution
- [x] AI incorporates tool results in responses
- [x] Toggle state persists across page reloads
- [x] Tool can be disabled to prevent calls
- [x] Errors are handled gracefully

---

## 🎓 Next Steps

Once basic functionality works:

1. **Test edge cases** from VERIFICATION_CHECKLIST.md
2. **Try creating your own tool** (weather, time, etc.)
3. **Test with different AI models**
4. **Check IndexedDB** to see message storage
5. **Review console logs** for any warnings

---

## 📝 Notes Space

Quick observations:
```
_________________________________________________
_________________________________________________
_________________________________________________
```

---

**File Location**: `planning/chatmode/QUICK_TEST_GUIDE.md`
**Related Files**:
- Tool: `app/plugins/examples/demo-calculator-tool.client.ts`
- Checklist: `planning/chatmode/VERIFICATION_CHECKLIST.md`
