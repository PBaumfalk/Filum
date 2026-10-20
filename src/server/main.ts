import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createLogger } from './lib/log.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

async function main() {
  const app = await createApp(config, log);
  await app.publicServer.listen({ port: config.publicPort, host: config.host });
  await app.adminServer.listen({ port: config.adminPort, host: config.host });
  app.start();
  log.info(
    { version: config.version, publicPort: config.publicPort, adminPort: config.adminPort, appUrl: config.appUrl, dataDir: config.dataDir },
    'Filum läuft',
  );

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'Filum wird beendet');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
    } catch (err) {
      log.error({ err }, 'Fehler beim Beenden');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, `Filum konnte nicht starten: ${(err as Error).message}`);
  process.exit(1);
});
