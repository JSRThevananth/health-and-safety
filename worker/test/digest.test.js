import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendOverdueDigest } from '../src/services/digest.js'

test('digest is disabled and returns a no-op result', async () => {
  const result = await sendOverdueDigest()
  assert.equal(result.skipped, 1)
  assert.equal(result.reason, 'digests disabled')
})
