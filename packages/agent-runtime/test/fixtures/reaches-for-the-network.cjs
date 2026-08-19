// An agent that tries to reach the world directly rather than asking for it.
//
// ★ It must fail at every one. This fixture is the point of the isolation
// test: it reports what actually happened, so the test asserts observed
// refusals rather than the absence of success.
module.exports = function agent() {
  const attempts = []

  /** Runs one attempt and records how it was refused. */
  function tried(name, attempt) {
    try {
      attempt()
      attempts.push(`${name} worked`)
    } catch (cause) {
      attempts.push(`${name}: ${cause.constructor.name}`)
    }
  }

  tried('fetch', () => {
    const reached = fetch('https://example.com')
    return reached
  })
  tried('net', () => require('node:net'))
  tried('fs', () => require('node:fs'))
  tried('child_process', () => require('node:child_process'))

  attempts.push(`env keys: ${Object.keys(process.env).length}`)

  return { attempts }
}
