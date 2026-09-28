/** Merge only authorized account events. Never replace a newer observation with a delayed snapshot. */
function timestamp(value: unknown): number { return typeof value === 'string' ? Date.parse(value) || 0 : 0 }
function retainNewer(previous: any, next: any): any {
  const device = { ...next }
  if (previous && timestamp(previous.latestPosition?.timestamp) > timestamp(next.latestPosition?.timestamp)) {
    device.latestPosition = previous.latestPosition
    device.lastLocationAt = previous.lastLocationAt
    device.lastReceivedAt = previous.lastReceivedAt
  }
  if (previous && timestamp(previous.lastQuery?.completedAt) > timestamp(next.lastQuery?.completedAt)) device.lastQuery = previous.lastQuery
  return device
}
export function applyFindHubUpdate(snapshot: any, event: any, instanceId: string): any {
  if (event?.event === 'snapshot') {
    if (event.data?.instanceId !== instanceId) return snapshot
    const next = event.data
    return { ...next, devices: (next.devices || []).map((d: any) => retainNewer(snapshot?.instanceId === instanceId ? snapshot.devices?.find((old: any) => old.id === d.id) : null, d)) }
  }
  if (!snapshot || event?.instanceId !== instanceId) return snapshot
  const data = event.data || {}
  if (event.event === 'connection.update') snapshot.connected = data.state === 'open'
  if (Array.isArray(data.devices)) snapshot.devices = data.devices.map((device: any) => {
    const old = snapshot.devices.find((item: any) => item.id === device.id)
    return retainNewer(old, { ...old, ...device })
  })
  if (data.settings) snapshot.settings = data.settings
  if (data.traccarState && snapshot.traccar) snapshot.traccar.state = data.traccarState
  const device = snapshot.devices.find((item: any) => item.id === (data.device?.id || data.deviceId))
  if (device) {
    if (typeof data.enabled === 'boolean') device.trackingEnabled = data.enabled
    if (data.timeoutMs) device.locationTimeoutMs = data.timeoutMs
    if (Number.isInteger(data.intervalSeconds) && data.intervalSeconds >= 0) device.trackingIntervalSeconds = data.intervalSeconds
    if (data.providerStatus) device.providerStatus = data.providerStatus
    if (data.code) device.lastErrorCode = data.code
    if (data.query && timestamp(data.query.completedAt) >= timestamp(device.lastQuery?.completedAt)) device.lastQuery = data.query
    if (
      data.reconciliation &&
      timestamp(data.reconciliation.completedAt || data.reconciliation.startedAt) >=
        timestamp(device.reconciliation?.completedAt || device.reconciliation?.startedAt)
    ) device.reconciliation = data.reconciliation
    const position = data.location
    if (position && Number.isFinite(position.latitude) && Math.abs(position.latitude) <= 90 &&
        Number.isFinite(position.longitude) && Math.abs(position.longitude) <= 180 && timestamp(position.timestamp) > 0 &&
        (!device.latestPosition || timestamp(position.timestamp) >= timestamp(device.latestPosition.timestamp))) {
      device.latestPosition = position; device.lastLocationAt = position.timestamp
      if (timestamp(event.at) >= timestamp(device.lastReceivedAt)) device.lastReceivedAt = event.at
      device.lastErrorCode = null
    }
  }
  snapshot.counts.devices = snapshot.devices.length
  snapshot.counts.tracking = snapshot.devices.filter((item: any) => item.trackingEnabled).length
  return snapshot
}
