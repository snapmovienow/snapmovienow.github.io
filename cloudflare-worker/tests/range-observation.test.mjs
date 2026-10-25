import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_BYTES, MAX_HEADER_CHARS, parseRange, parseContentRange, sanitizeObservation, classifyObservation} from '../src/range-observation.mjs';

const base = extra => ({caseKey:'synthetic', method:'GET', outgoingMethod:'GET', phase:'initial', transport:'mock', incomingRange:'bytes=10-19', outgoingRange:'bytes=10-19', status:416, contentRange:'bytes */100', ...extra});
const trusted = {sameResource:true, sameRepresentation:true, independentControl:true};
const success = extra => base({status:206, contentRange:'bytes 10-19/100', contentLength:'10', validatedBody:true, ...extra});
const classify = (extra, control, comparison) => classifyObservation(base(extra), control, comparison);

test('GET 416 alone is a hypothesis, never an attribution', () => {
  const result = classify();
  assert.equal(result.classification, 'hypothesis');
  assert.equal(result.reason, 'rejection_despite_satisfiable_reported_bounds');
  assert.equal(result.definitiveCause, false);assert.equal(result.comparableControl, false);
});

test('unexpected GET forwarding changes are demonstrable internal inconsistencies', () => {
  for (const outgoingRange of ['bytes=20-29', undefined]) {
    const result = classify({outgoingRange});
    assert.equal(result.classification, 'internal_inconsistency');assert.equal(result.reason, 'unexpected_get_range');
  }
  assert.equal(classify({outgoingMethod:'HEAD'}).reason, 'unexpected_method');
});

test('intentional HEAD to GET bytes=0-0 is not blamed on the relay', () => {
  for (const incomingRange of [undefined, 'bytes=9999-', 'bytes=-20']) {
    const result = classify({method:'HEAD', incomingRange, outgoingRange:'bytes=0-0'});
    assert.equal(result.forwarding, 'expected_head_probe');assert.equal(result.classification, 'hypothesis');
  }
  assert.equal(classify({method:'HEAD', outgoingRange:'bytes=1-1'}).classification, 'internal_inconsistency');
  assert.equal(classify({method:'HEAD', outgoingRange:'bytes=0-0', contentRange:'bytes */0'}).reason, 'request_unsatisfiable_for_reported_size');
});

test('suffixes, open-ended ranges and multiple ranges use reported size, not error-body length', () => {
  const cases = [
    ['bytes=-20',100,true],['bytes=-0',100,false],['bytes=-1000',1,true],
    ['bytes=100-',100,false],['bytes=99-',100,true],
    ['bytes=100-200, 0-0',100,true],['bytes=100-200,200-300',100,false]
  ];
  for (const [range,total,possible] of cases) {
    const result = classify({incomingRange:range, outgoingRange:range, contentRange:`bytes */${total}`, contentLength:'1'});
    assert.equal(result.reason, possible ? 'rejection_despite_satisfiable_reported_bounds' : 'request_unsatisfiable_for_reported_size');
  }
  assert.equal(classify({contentRange:undefined, contentLength:'100'}).classification, 'insufficient_evidence');
});

test('resume requires its own bounded context; initial Range equality is not required', () => {
  const result = classify({phase:'resume', outgoingRange:'bytes=13-19', resumeStart:10, resumeLength:10, resumeReceived:3, originalTotal:100});
  assert.equal(result.forwarding, 'consistent_resume');assert.equal(result.classification, 'hypothesis');
  assert.equal(classify({phase:'resume'}).classification, 'insufficient_evidence');
  assert.equal(classify({phase:'resume', resumeStart:MAX_BYTES, resumeLength:2, resumeReceived:1, originalTotal:MAX_BYTES}).reason, 'invalid_resume_context');
});

test('independent comparable control supports only a discrepancy hypothesis', () => {
  const result = classify({}, success(), trusted);
  assert.equal(result.reason, 'relay_path_disagrees_with_control');assert.equal(result.classification, 'hypothesis');
  assert.equal(result.comparableControl, true);assert.equal(result.definitiveCause, false);
  assert.equal(classify({}, base(), trusted).reason, 'rejection_reproduced_in_independent_control');
});

test('missing, non-independent, different-range and unvalidated controls cannot attribute origin or relay', () => {
  const inputs = [
    [success(), undefined], [success(), {...trusted, independentControl:false}],
    [success(), {...trusted, sameResource:false}], [success(), {...trusted, sameRepresentation:false}],
    [success({incomingRange:'bytes=0-9', outgoingRange:'bytes=0-9', contentRange:'bytes 0-9/100'}), trusted],
    [success({validatedBody:false}), trusted], [success({contentLength:'9'}), trusted],
    [success({status:200, contentRange:undefined, contentLength:'100'}), trusted],
    [success({contentRange:'bytes 11-20/100'}), trusted]
  ];
  for (const [control, comparison] of inputs) {
    const result = classify({}, control, comparison);
    assert.equal(result.comparableControl, false);assert.equal(result.reason, 'rejection_despite_satisfiable_reported_bounds');
  }
});

test('changed representation sizes override a claimed matching representation', () => {
  const result = classify({contentRange:'bytes */10'}, success(), trusted);
  assert.equal(result.reason, 'representation_size_changed');assert.equal(result.comparableControl, false);
});

test('unknown case keys and inappropriate Content-Range forms cannot establish comparable evidence', () => {
  for (const [extra,control] of [
    [{caseKey:'unrecognized'}, success({caseKey:'unrecognized'})],
    [{contentRange:'bytes 10-19/100'}, base({contentRange:'bytes 10-19/100'})],
    [{contentRange:undefined}, base({contentRange:undefined})]
  ]) {
    const result = classify(extra, control, trusted);
    assert.equal(result.comparableControl, false);
    assert.ok(!['relay_path_disagrees_with_control','rejection_reproduced_in_independent_control'].includes(result.reason));
  }
});

test('comparable suffix and HEAD controls work; multipart success needs a dedicated verifier', () => {
  const suffix = {incomingRange:'bytes=-10', outgoingRange:'bytes=-10'};
  assert.equal(classify(suffix, success({...suffix, contentRange:'bytes 90-99/100'}), trusted).reason, 'relay_path_disagrees_with_control');
  const head = {method:'HEAD', incomingRange:undefined, outgoingRange:'bytes=0-0'};
  assert.equal(classify(head, success({...head, contentRange:'bytes 0-0/100', contentLength:1}), trusted).reason, 'relay_path_disagrees_with_control');
  const multi = {incomingRange:'bytes=0-0,10-10', outgoingRange:'bytes=0-0,10-10'};
  assert.equal(classify(multi, success({...multi, contentRange:undefined}), trusted).comparableControl, false);
});

test('strict field allowlist excludes secrets, URLs, raw headers and validator values at every level', () => {
  const secret = 'sensitive-value-never-retain';
  const raw = base({url:'https://private.invalid/'+secret, username:secret, password:secret, cookie:secret, Authorization:secret, etag:secret, lastModified:secret, ifRange:secret, headers:{authorization:secret}, caseKey:secret});
  Object.defineProperty(raw, 'credentials', {get(){throw Error('must not read excluded fields')}});
  const result = classifyObservation(raw, raw, {...trusted, headers:{cookie:secret}, validator:secret});
  assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes('private.invalid'));
  assert.deepEqual(Object.keys(result.observation), ['caseKey','method','outgoingMethod','phase','transport','incomingRange','outgoingRange','status','contentRange','contentLength','acceptRanges','ifRangePresent','validatedBody','resumeStart','resumeLength','resumeReceived','originalTotal']);
  assert.deepEqual(Object.keys(result.comparison), ['sameResource','sameRepresentation','independentControl']);
});

test('malicious data in allowed fields is reduced to bounded enums or invalid markers', () => {
  const secret = 'https://private.invalid/username/password?token=secret';
  const result = sanitizeObservation(Object.fromEntries(['caseKey','method','outgoingMethod','phase','transport','incomingRange','outgoingRange','status','contentRange','contentLength','acceptRanges','ifRangePresent','validatedBody','resumeStart','resumeLength','resumeReceived','originalTotal'].map(key=>[key,secret])));
  assert.ok(!JSON.stringify(result).includes(secret));assert.equal(result.validatedBody, false);
  assert.deepEqual(result.incomingRange,{kind:'invalid'});assert.deepEqual(result.contentLength,{kind:'invalid'});
});

test('unsafe sizes, huge headers, injection, excess ranges and malformed syntax are rejected', () => {
  for (const value of [MAX_BYTES+1, Infinity, -1, 1.5, '9'.repeat(100), '1e6']) assert.equal(sanitizeObservation({contentLength:value}).contentLength.kind,'invalid');
  for (const value of ['bytes=9-1','bytes=-','bytes=0-1\r\nAuthorization: secret','bytes=0-1,2-3,4-5,6-7,8-9','x'.repeat(MAX_HEADER_CHARS+1),`bytes=${MAX_BYTES+1}-`]) assert.equal(parseRange(value).kind,'invalid');
  for (const value of ['bytes */'+(MAX_BYTES+1),'bytes 0-10/10','bytes 2-1/10','bytes */secret']) assert.equal(parseContentRange(value).kind,'invalid');
  assert.equal(parseRange(`bytes=${MAX_BYTES}-`).start, MAX_BYTES);assert.equal(parseContentRange(`bytes */${MAX_BYTES}`).total, MAX_BYTES);
});

test('missing, non-object and accessor inputs do not throw or fabricate evidence', () => {
  for (const value of [null, undefined, [], 'secret', 42]) assert.equal(classifyObservation(value).classification,'insufficient_evidence');
  const input = {};Object.defineProperty(input,'incomingRange',{get(){throw Error('do not invoke accessors')}});
  assert.equal(sanitizeObservation(input).incomingRange.kind,'absent');
});

test('classifier does not mutate supplied observations or trust inherited values', () => {
  const input = Object.freeze(base()), before = JSON.stringify(input);classifyObservation(input);assert.equal(JSON.stringify(input), before);
  assert.equal(sanitizeObservation(Object.create(base())).status, null);
});
