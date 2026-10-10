// Shared arithmetic for the administrator and CLI. This does not send requests
// or infer prices, bandwidth billing, codec bitrate or delivered capacity.
const number = (value, name, max, whole = false) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw Error(name);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max || whole && !Number.isInteger(n)) throw Error(name);
  return n;
};
const money = (value, name) => value === undefined || value === null || value === '' ? null : number(value, name, 1e9);

export function calculateCapacity(input) {
  const viewers = number(input.viewers, 'viewers', 100000, true);
  const mbps = number(input.mbps, 'mbps', 100);
  const hours = number(input.hours, 'hours', 744);
  const slots = input.providerSlots == null ? null : number(input.providerSlots, 'providerSlots', 100000, true);
  const available = input.providerAvailable == null ? null : number(input.providerAvailable, 'providerAvailable', 100000, true);
  if (available !== null && (slots === null || available > slots)) throw Error('providerAvailable');
  const provider = money(input.providerCost, 'providerCost'), hosting = money(input.hostingCost, 'hostingCost');
  const viewerHours = viewers * hours, transferGB = viewerHours * mbps * 3600 / 8000;
  const cost = provider === null || hosting === null ? null : provider + hosting;
  return {
    scenario:{viewers,mbps,hours,providerSlots:slots,providerAvailable:available},
    estimatedPeakMbps:viewers * mbps,estimatedTransferGB:transferGB,viewerHours,
    missingProviderSlots:slots === null ? null : Math.max(0, viewers - slots),
    missingAvailableSlots:available === null ? null : Math.max(0, viewers - available),
    costs:{provider,hosting,total:cost,perViewer:cost === null || !viewers ? null : cost / viewers,
      perViewerHour:cost === null || !viewerHours ? null : cost / viewerHours},
    measured:false
  };
}
