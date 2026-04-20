---
status: partial
phase: 03-tokopedia-checkout
source: [03-VERIFICATION.md]
started: 2026-04-20T08:35:00Z
updated: 2026-04-20T08:35:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end checkout
expected: Run buy_on_tokopedia with a real product URL and virtual card, verify full session state progression through all 10 steps to success.
result: [pending]

### 2. 3DS OTP flow
expected: If 3DS triggers during checkout, confirm session pauses with need_input/otp and submit_input resumes it.
result: [pending]

### 3. Minimum transaction threshold
expected: Attempt checkout with a product below ~Rp50,000, confirm clear error about card payment unavailability.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
