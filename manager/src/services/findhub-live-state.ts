/** Merge only known account events. A delayed upstream report cannot move the map backwards in time. */
export function applyFindHubUpdate(snapshot: any, event: any, instanceId: string): any {
  if (event?.event === 'snapshot') return event.data?.instanceId === instanceId ? event.data : snapshot
  if (!snapshot || event?.instanceId !== instanceId) return snapshot
  const data = event.data || {}
  if (event.event === 'connection.update') snapshot.connected = data.state === 'open'
  if (Array.isArray(data.devices)) snapshot.devices = data.devices.map((device: any) => ({ ...snapshot.devices.find((old: any) => old.id === device.id), ...device }))
  if (data.settings) snapshot.settings = data.settings
  if (data.traccarState && snapshot.traccar) snapshot.traccar.state = data.traccarState
  const device = snapshot.devices.find((item: any) => item.id === (data.device?.id || data.deviceId))
  if (device) {
    if (typeof data.enabled === 'boolean') device.trackingEnabled = data.enabled
    if (data.timeoutMs) device.locationTimeoutMs = data.timeoutMs
    if (data.intervalSeconds) device.trackingIntervalSeconds = data.intervalSeconds
    if (data.providerStatus) device.providerStatus = data.providerStatus
    if (data.code) device.lastErrorCode = data.code
    const position = data.location
    if (position && Number.isFinite(position.latitude) && Number.isFinite(position.longitude) && Number.isFinite(Date.parse(position.timestamp)) &&
        (!device.latestPosition || Date.parse(position.timestamp) >= Date.parse(device.latestPosition.timestamp))) {
      device.latestPosition = position; device.lastLocationAt = position.timestamp; device.lastReceivedAt = event.at; device.lastErrorCode = null
    }
  }
  snapshot.counts.devices = snapshot.devices.length
  snapshot.counts.tracking = snapshot.devices.filter((item: any) => item.trackingEnabled).length
  return snapshot
}
