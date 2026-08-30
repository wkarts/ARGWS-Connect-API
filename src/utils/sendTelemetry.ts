import { configService, Telemetry } from '@config/env.config';
import axios from 'axios';
import { randomUUID } from 'crypto';
import fs from 'fs';

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

export interface TelemetryData {
  route: string;
  apiVersion: string;
  timestamp: string;
}

type TelemetryEvent = {
  event_id: string;
  schema: string;
  schema_version: number;
  timestamp: string;
  payload: TelemetryData & {
    product: 'ARGWS Connect API';
  };
};

/**
 * ARGWS Connect API telemetry adapter.
 *
 * The call sites are intentionally preserved to avoid a broad refactor of the
 * application. Only the transport was replaced. There is no fallback to any
 * third-party/upstream telemetry endpoint.
 *
 * Modes:
 * - agent: POSTs to the local ARGWS LICENSYS Agent /v1/telemetry endpoint.
 * - direct: POSTs to ARGWS LICENSYS /api/v1/telemetry/batch using an activation token.
 */
export const sendTelemetry = async (route: string): Promise<void> => {
  const telemetryConfig = configService.get<Telemetry>('TELEMETRY');

  if (!telemetryConfig.ENABLED || route === '/') {
    return;
  }

  const timestamp = new Date().toISOString();
  const event: TelemetryEvent = {
    event_id: randomUUID(),
    schema: telemetryConfig.SCHEMA,
    schema_version: telemetryConfig.SCHEMA_VERSION,
    timestamp,
    payload: {
      product: 'ARGWS Connect API',
      route,
      apiVersion: `${packageJson.version}`,
      timestamp,
    },
  };

  try {
    if (telemetryConfig.MODE === 'direct') {
      if (!telemetryConfig.URL || !telemetryConfig.ACTIVATION_TOKEN) {
        return;
      }

      await axios.post(
        telemetryConfig.URL,
        {
          activation_token: telemetryConfig.ACTIVATION_TOKEN,
          events: [event],
        },
        { timeout: telemetryConfig.TIMEOUT_MS },
      );
      return;
    }

    if (!telemetryConfig.URL) {
      return;
    }

    const headers: Record<string, string> = {};
    if (telemetryConfig.AGENT_TOKEN) {
      headers['X-LICENSYS-Agent-Token'] = telemetryConfig.AGENT_TOKEN;
    }

    await axios.post(
      telemetryConfig.URL,
      { events: [event] },
      {
        headers,
        timeout: telemetryConfig.TIMEOUT_MS,
      },
    );
  } catch {
    // Telemetry is best-effort and must never affect API availability.
  }
};
