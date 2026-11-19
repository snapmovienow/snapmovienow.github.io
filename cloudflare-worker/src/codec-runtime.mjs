// Accepts an already compiled module. Never opens a file, socket or process.
export function convertWithModule(module, tsBytes, {sequence=0,epochMs=0}={}) {
  if (!(tsBytes instanceof Uint8Array) || tsBytes.length < 188 || tsBytes.length > 8*1024*1024)
    throw new RangeError('invalid_apple_segment_size');
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError('invalid_apple_segment_sequence');
  if (!Number.isFinite(epochMs) || epochMs < 0 || epochMs > 4102444800000)
    throw new RangeError('invalid_apple_segment_time');
  let runtime;
  const memory = () => new DataView(runtime.exports.memory.buffer);
  const unavailable = () => 8; // WASI EBADF
  const wasi = {
    environ_sizes_get(count, bytes) { memory().setUint32(count,0,true);memory().setUint32(bytes,0,true);return 0; },
    environ_get() { return 0; },
    clock_time_get(clock, precision, at) { memory().setBigUint64(at,0n,true); return 0; },
    fd_close:unavailable, fd_fdstat_get:unavailable, fd_fdstat_set_flags:unavailable,
    fd_prestat_get:unavailable, fd_prestat_dir_name:unavailable, fd_read:unavailable,
    fd_seek:unavailable, fd_write:unavailable, path_open:unavailable, poll_oneoff:unavailable,
    proc_exit() { throw new Error('apple_segment_codec_exited'); }
  };
  runtime = new WebAssembly.Instance(module,{wasi_snapshot_preview1:wasi});
  const e=runtime.exports;
  e._initialize();
  const ptr=e.reserve_input(tsBytes.length);
  if(!ptr) throw new Error('apple_segment_allocation_failed');
  new Uint8Array(e.memory.buffer,ptr,tsBytes.length).set(tsBytes);
  const status=e.convert(ptr,tsBytes.length,sequence%2147483646,epochMs);
  const diagnostics={packets:e.diagnostic(0), invalid:e.diagnostic(1), firstInvalid:e.diagnostic(2),
                     lastInvalid:e.diagnostic(3), concealedSamples:e.diagnostic(4)};
  if(status) {
    const error=new Error('apple_segment_codec_'+status+'_'+e.error_detail());
    error.diagnostics=diagnostics;
    throw error;
  }
  const at=e.output_pointer(),size=e.output_size(),split=e.init_size();
  if(at<=0||split<16||split>=size||at+size>e.memory.buffer.byteLength) throw new Error('apple_segment_invalid_output');
  const bytes = new Uint8Array(e.memory.buffer,at,size);
  return {init:bytes.slice(0,split),media:bytes.slice(split),heapBytes:e.memory.buffer.byteLength,diagnostics};
}
