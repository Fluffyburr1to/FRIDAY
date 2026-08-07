/**
 * @friday/config — the public surface.
 *
 * This is the ONLY file other packages may import from, and this package is
 * the ONLY one permitted to read `process.env`.
 *
 * It holds Keychain *references* — never credential values. A stolen
 * configuration file yields the names of Keychain entries and nothing else.
 *
 * See: README.md · docs/01-bible/33-deployment-strategy.md
 */

export { DEFAULT_CONFIG_FILENAME, defaultConfigFile, readConfigFile } from './config-file.js'
export { type DeepPartialConfig, expandPath } from './defaults.js'
export { ENV_VARIABLES, type EnvSource, type EnvVariable, readEnvironment } from './env.js'
export { type LoadOptions, loadConfig } from './load.js'
export {
  type Environment,
  EnvironmentSchema,
  type FridayConfig,
  FridayConfigSchema,
} from './schema.js'
