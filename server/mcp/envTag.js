// Every MCP tool response carries `_environment` so the model (and the admin
// reading the transcript) can always tell WHICH store answered — TEST and PROD
// are separate connectors with identical tool names.
function env() {
  return (process.env.APP_ENV || 'production') === 'test' ? 'test' : 'production';
}

function tag(payload) {
  return { _environment: env(), ...payload };
}

module.exports = { env, tag };
