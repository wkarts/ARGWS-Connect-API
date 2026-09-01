type MetricName =
  | 'connect_meta_compat_requests_total'
  | 'connect_meta_compat_messages_sent_total'
  | 'connect_meta_compat_webhooks_total'
  | 'connect_meta_compat_webhook_failures_total'
  | 'connect_meta_compat_media_requests_total';

const names: MetricName[] = [
  'connect_meta_compat_requests_total',
  'connect_meta_compat_messages_sent_total',
  'connect_meta_compat_webhooks_total',
  'connect_meta_compat_webhook_failures_total',
  'connect_meta_compat_media_requests_total',
];

class MetaCloudMetrics {
  private readonly counters = new Map<MetricName, number>(names.map((name) => [name, 0]));

  public increment(name: MetricName, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + amount);
  }

  public prometheusLines(): string[] {
    return names.flatMap((name) => [`# TYPE ${name} counter`, `${name} ${this.counters.get(name) || 0}`]);
  }
}

export const metaCloudMetrics = new MetaCloudMetrics();
