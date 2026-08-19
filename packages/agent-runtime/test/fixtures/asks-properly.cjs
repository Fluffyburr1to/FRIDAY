// A well-behaved agent: it asks, and does what it is told.
module.exports = function agent({ input, ask }) {
  return ask({
    capability: 'diagnostics.run',
    action: 'diagnostics.self-check.run',
    resource: 'diagnostics:self-check/all',
    because: 'to confirm the record is intact',
  }).then((outcome) => ({ saw: outcome.kind, input }))
}
