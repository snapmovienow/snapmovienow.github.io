import segmentModule from './apple-segment-codec.wasm';
import {convertWithModule} from './codec-runtime.mjs';
export function convertSegment(input, options) {
  return convertWithModule(segmentModule,input,options);
}
