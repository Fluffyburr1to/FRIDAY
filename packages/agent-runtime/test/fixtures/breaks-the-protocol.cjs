// An agent that posts something the runtime cannot read as a request.
module.exports = function agent({ ask }) {
  return ask({ nonsense: true }).then(() => ({}))
}
