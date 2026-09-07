from pathlib import Path

path = Path('src/api/services/monitor.service.ts')
text = path.read_text()
old = """        if (typeof current?.purgeProviderState === 'function') {
          await current.purgeProviderState();
        }

        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);
"""
new = """        if (typeof current?.purgeProviderState === 'function') {
          try {
            await current.purgeProviderState();
          } catch (error) {
            this.logger.error({ localError: 'purgeProviderState', instanceName, error });
          }
        }

        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);
"""
if old not in text:
    raise SystemExit('expected instance cleanup block not found')
path.write_text(text.replace(old, new, 1))
print('Instance cleanup hardening applied.')
