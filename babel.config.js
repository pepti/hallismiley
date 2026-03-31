/* eslint-env node */
// Used only by Jest to transpile ESM-only dependencies (lucia, oslo, etc.)
// to CommonJS so they can be require()'d in the CJS test environment.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
  ],
};
