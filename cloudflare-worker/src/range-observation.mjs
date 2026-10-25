// Pure diagnostic contract. No I/O, raw headers, identity, URLs or validators
// are retained. A classification is not a definitive root-cause attribution.
export const MAX_BYTES = Number.MAX_SAFE_INTEGER;
export const MAX_HEADER_CHARS = 256;
export const MAX_RANGES = 4;
const cases = new Set(['movie_223085', 'movie_231262', 'movie_231252', 'live_8471', 'synthetic']);
const field = (value, key) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};
const choice = (value, allowed, fallback = 'unknown') => allowed.includes(value) ? value : fallback;
const bounded = value => {
  if (typeof value === 'string' && /^\d{1,16}$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_BYTES ? value : null;
};
const safeSum = (a, b) => a <= MAX_BYTES - b ? a + b : null;
const absent = value => value === undefined || value === null || value === '';
const header = value => typeof value === 'string' && value.length <= MAX_HEADER_CHARS && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
const invalid = () => ({kind:'invalid'});

export function parseRange(value) {
  if (absent(value)) return {kind:'absent'};
  const text = header(value), match = text?.match(/^bytes=(.+)$/i);
  if (!match) return invalid();
  const pieces = match[1].split(',');
  if (!pieces.length || pieces.length > MAX_RANGES) return invalid();
  const ranges = [];
  for (const piece of pieces) {
    const entry = piece.trim().match(/^(\d*)-(\d*)$/);
    if (!entry || !entry[1] && !entry[2]) return invalid();
    if (!entry[1]) {
      const length = bounded(entry[2]);
      if (length === null) return invalid();
      ranges.push({kind:'suffix', length});
    } else {
      const start = bounded(entry[1]), end = entry[2] ? bounded(entry[2]) : null;
      if (start === null || entry[2] && end === null || end !== null && end < start) return invalid();
      ranges.push({kind:'bytes', start, end});
    }
  }
  return ranges.length === 1 ? ranges[0] : {kind:'multiple', ranges};
}

export function parseContentRange(value) {
  if (absent(value)) return {kind:'absent'};
  const text = header(value), unsatisfied = text?.match(/^bytes \*\/(\d+)$/i);
  if (unsatisfied) {
    const total = bounded(unsatisfied[1]);
    return total === null ? invalid() : {kind:'unsatisfied', total};
  }
  const match = text?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return invalid();
  const start = bounded(match[1]), end = bounded(match[2]), total = match[3] === '*' ? null : bounded(match[3]);
  if (start === null || end === null || end < start || match[3] !== '*' && (total === null || end >= total)) return invalid();
  return {kind:'satisfied', start, end, total};
}

function size(value) {
  if (absent(value)) return {kind:'absent'};
  const bytes = bounded(value);
  return bytes === null ? invalid() : {kind:'bytes', bytes};
}

export function sanitizeObservation(input) {
  const get = key => field(input, key), status = get('status');
  // Every output property is explicit. Extra input keys are never copied/read.
  return {
    caseKey:cases.has(get('caseKey')) ? get('caseKey') : 'unknown',
    method:choice(get('method'), ['GET','HEAD']),
    outgoingMethod:choice(get('outgoingMethod'), ['GET','HEAD']),
    phase:choice(get('phase'), ['initial','resume']),
    transport:choice(get('transport'), ['hostname','tcp','mock']),
    incomingRange:parseRange(get('incomingRange')),
    outgoingRange:parseRange(get('outgoingRange')),
    status:Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    contentRange:parseContentRange(get('contentRange')),
    contentLength:size(get('contentLength')),
    acceptRanges:choice(get('acceptRanges'), ['bytes','none'], absent(get('acceptRanges')) ? 'absent' : 'unknown'),
    ifRangePresent:typeof get('ifRangePresent') === 'boolean' ? get('ifRangePresent') : null,
    validatedBody:get('validatedBody') === true,
    resumeStart:bounded(get('resumeStart')),
    resumeLength:bounded(get('resumeLength')),
    resumeReceived:bounded(get('resumeReceived')),
    originalTotal:bounded(get('originalTotal'))
  };
}

const sameRange = (a, b) => a.kind !== 'invalid' && b.kind !== 'invalid' && JSON.stringify(a) === JSON.stringify(b);
const zeroProbe = range => range.kind === 'bytes' && range.start === 0 && range.end === 0;

function forwardingCheck(observation) {
  const o = observation;
  if (o.method === 'unknown' || o.outgoingMethod === 'unknown' || o.phase === 'unknown') return 'incomplete';
  if (o.outgoingMethod !== 'GET') return 'unexpected_method';
  if (o.phase === 'resume') {
    const {resumeStart:start, resumeLength:length, resumeReceived:received, originalTotal:total} = o;
    if ([start,length,received,total].includes(null)) return 'incomplete';
    const next = safeSum(start, received), after = safeSum(start, length);
    if (length === 0 || received >= length || after === null || after > total || next === null) return 'invalid_resume_context';
    return sameRange(o.outgoingRange, {kind:'bytes', start:next, end:after - 1}) ? 'consistent_resume' : 'unexpected_resume_range';
  }
  if (o.method === 'HEAD') return zeroProbe(o.outgoingRange) ? 'expected_head_probe' : 'unexpected_head_probe';
  if (o.incomingRange.kind === 'invalid' || o.outgoingRange.kind === 'invalid') return 'incomplete';
  return sameRange(o.incomingRange, o.outgoingRange) ? 'unchanged_get_range' : 'unexpected_get_range';
}

function satisfiable(range, total) {
  if (range.kind === 'bytes') return total > 0 && range.start < total;
  if (range.kind === 'suffix') return total > 0 && range.length > 0;
  if (range.kind === 'multiple') return range.ranges.some(item => satisfiable(item, total));
  return null;
}

function representationSize(o) {
  if (o.status === 416 && o.contentRange.kind === 'unsatisfied' || o.status === 206 && o.contentRange.kind === 'satisfied') return o.contentRange.total;
  // Content-Length on a 416 describes the ERROR body, never the media size.
  if (o.status === 200 && o.contentLength.kind === 'bytes') return o.contentLength.bytes;
  return null;
}

function controlHonoredRange(o) {
  if (!o.validatedBody) return false;
  const range = o.outgoingRange, response = o.contentRange;
  if (range.kind === 'absent') return o.status === 200;
  if (o.status !== 206 || response.kind !== 'satisfied' || response.total === null || !satisfiable(range, response.total)) return false;
  // Multipart bodies need a separate part-by-part verifier; headers alone do
  // not establish a comparable successful control.
  if (!['bytes','suffix'].includes(range.kind)) return false;
  const start = range.kind === 'suffix' ? Math.max(0, response.total - range.length) : range.start;
  const end = range.kind === 'suffix' || range.end === null ? response.total - 1 : Math.min(range.end, response.total - 1);
  const length = end - start + 1;
  return response.start === start && response.end === end && (o.contentLength.kind === 'absent' || o.contentLength.kind === 'bytes' && o.contentLength.bytes === length);
}

export function classifyObservation(input, controlInput, comparisonInput) {
  const observation = sanitizeObservation(input), forwarding = forwardingCheck(observation);
  const comparison = {
    sameResource:field(comparisonInput, 'sameResource') === true,
    sameRepresentation:field(comparisonInput, 'sameRepresentation') === true,
    independentControl:field(comparisonInput, 'independentControl') === true
  };
  const control = controlInput === undefined ? null : sanitizeObservation(controlInput);
  const output = (classification, reason, comparableControl = false) => ({
    classification, reason, definitiveCause:false, forwarding, comparableControl,
    observation, control, comparison
  });
  if (['unexpected_method','invalid_resume_context','unexpected_resume_range','unexpected_head_probe','unexpected_get_range'].includes(forwarding)) {
    return output('internal_inconsistency', forwarding);
  }
  if (forwarding === 'incomplete') return output('insufficient_evidence', 'forwarding_evidence_incomplete');
  if (observation.status !== 416) return output('insufficient_evidence', 'no_initial_416_observed');
  const total = representationSize(observation);
  if (control && comparison.sameResource) {
    const otherTotal = representationSize(control);
    if (total !== null && otherTotal !== null && total !== otherTotal) return output('hypothesis', 'representation_size_changed');
  }
  const comparable = control && comparison.sameResource && comparison.sameRepresentation && comparison.independentControl &&
    observation.caseKey !== 'unknown' && control.caseKey === observation.caseKey && control.outgoingMethod === observation.outgoingMethod && control.phase === observation.phase &&
    sameRange(control.outgoingRange, observation.outgoingRange) &&
    ['expected_head_probe','unchanged_get_range','consistent_resume'].includes(forwardingCheck(control));
  if (comparable && total !== null && representationSize(control) === total) {
    if (control.status === 416) return output('hypothesis', 'rejection_reproduced_in_independent_control', true);
    if (controlHonoredRange(control)) return output('hypothesis', 'relay_path_disagrees_with_control', true);
  }
  if (observation.contentRange.kind !== 'unsatisfied') return output('insufficient_evidence', 'missing_valid_416_representation_size');
  const possible = satisfiable(observation.outgoingRange, total);
  if (possible === null) return output('insufficient_evidence', 'missing_usable_requested_range');
  return output('hypothesis', possible ? 'rejection_despite_satisfiable_reported_bounds' : 'request_unsatisfiable_for_reported_size');
}
