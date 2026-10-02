import { runProviderSettingsCommand } from './providerSettingsCommand.mts';
try {
  console.log(JSON.stringify(await runProviderSettingsCommand(process.argv.slice(2)), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PROVIDER_SETTINGS_COMMAND_FAILED');
  process.exitCode = 1;
}
