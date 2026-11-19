// SPDX-License-Identifier: LGPL-2.1-or-later
// One bounded conversion per fresh WASM instance. All inputs/outputs are memory buffers.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "libavcodec/avcodec.h"
#include "libavformat/avformat.h"
#include "libavutil/opt.h"
#include "libavutil/intreadwrite.h"
#include "libavutil/mathematics.h"

#define MAX_INPUT (8*1024*1024)
#define MAX_SECONDS 24
#define EXPORT __attribute__((visibility("default")))
typedef struct { const uint8_t *at, *end; } Reader;
static uint8_t *out_data;
static int out_len;
static int media_offset;
static int err_detail;
static int input_width, input_height;
static int64_t first_sample;

static int read_buffer(void *ctx, uint8_t *dest, int count) {
    Reader *r = ctx;
    int available = r->end - r->at;
    if (available <= 0) return AVERROR_EOF;
    if (count > available) count = available;
    memcpy(dest, r->at, count);
    r->at += count;
    return count;
}

EXPORT uint8_t *reserve_input(unsigned size) {
    return size && size <= MAX_INPUT ? av_mallocz(size + AV_INPUT_BUFFER_PADDING_SIZE) : NULL;
}

static int drain_encoder(AVCodecContext *enc, AVFormatContext *mp4, AVStream *audio,
                         AVPacket *p, int64_t start, int64_t end) {
    for (;;) {
        int ret = avcodec_receive_packet(enc, p);
        if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF) return 0;
        if (ret < 0) return ret;
        // AAC emits one priming packet. Only publish frames assigned to this segment's grid.
        if (p->pts >= start && p->pts < end) {
            p->stream_index = audio->index;
            p->duration = enc->frame_size;
            av_packet_rescale_ts(p, enc->time_base, audio->time_base);
            ret = av_write_frame(mp4, p);
        }
        av_packet_unref(p);
        if (ret < 0) return ret;
    }
}

#define TRY(code,expr) do { int rc=(expr); if(rc<0) {err_detail=rc;return code;} } while(0)

// MPEG-TS audio and video use the same 33-bit 90 kHz clock, which wraps every
// 26 h 30 m. A signed, server-derived segment time selects the same extended clock
// on either side of a wrap even when the two fragments are converted independently.
static int64_t unwrap90(int64_t timestamp, int64_t reference) {
    const int64_t cycle = INT64_C(1) << 33;
    int64_t value = timestamp & (cycle-1);
    if (reference < 0) return value;
    int64_t delta = reference - value;
    int64_t turns = delta >= 0 ? (delta + cycle/2)/cycle : -((-delta + cycle/2)/cycle);
    return value + turns*cycle;
}

EXPORT int convert(uint8_t *data, unsigned size, unsigned sequence, double epoch_ms) {
    if (!data || size < 188 || size > MAX_INPUT) return 1;
    // Epoch values only disambiguate the wrap cycle. Never synthesize packet PTS from wall time.
    if (epoch_ms < 0 || epoch_ms > 4102444800000.0 || epoch_ms != epoch_ms) return 1;
    const int64_t epoch90 = epoch_ms > 0 ? (int64_t)(epoch_ms*90.0) : -1;
    av_log_set_level(AV_LOG_QUIET);
    av_max_alloc(16*1024*1024);
    Reader reader={data,data+size};
    AVFormatContext *input=avformat_alloc_context(), *output=NULL;
    if (!input) return 2;
    input->pb=avio_alloc_context(av_malloc(32768),32768,0,&reader,read_buffer,NULL,NULL);
    if (!input->pb || !input->pb->buffer) return 2;
    input->flags|=AVFMT_FLAG_CUSTOM_IO;
    input->probesize=512*1024;
    input->max_analyze_duration=1800000;
    input->max_streams=32;
    TRY(3,avformat_open_input(&input,NULL,av_find_input_format("mpegts"),NULL));
    TRY(4,avformat_find_stream_info(input,NULL));
    AVStream *in_v=NULL,*in_a=NULL;
    for (unsigned i=0;i<input->nb_streams;i++) {
        AVStream *s=input->streams[i];
        if (!in_v && s->codecpar->codec_id==AV_CODEC_ID_H264) in_v=s;
        if (!in_a && s->codecpar->codec_id==AV_CODEC_ID_MP2) in_a=s;
    }
    if (!in_v || !in_a) return 5;
    input_width=in_v->codecpar->width;
    input_height=in_v->codecpar->height;
    if (!input_width || !input_height || in_v->codecpar->extradata_size < 4) return 6;
    const int channels=in_a->codecpar->ch_layout.nb_channels;
    const int rate=in_a->codecpar->sample_rate;
    if (channels < 1 || channels > 2 || (rate!=48000 && rate!=44100 && rate!=32000)) return 7;
    AVCodecContext *decoder=avcodec_alloc_context3(avcodec_find_decoder_by_name("mp2float"));
    AVCodecContext *encoder=avcodec_alloc_context3(avcodec_find_encoder(AV_CODEC_ID_AAC));
    if(!decoder || !encoder) return 2;
    TRY(8,avcodec_parameters_to_context(decoder,in_a->codecpar));
    TRY(9,avcodec_open2(decoder,NULL,NULL));
    encoder->sample_fmt=AV_SAMPLE_FMT_FLTP;
    encoder->sample_rate=rate;
    av_channel_layout_default(&encoder->ch_layout,channels);
    encoder->time_base=(AVRational){1,rate};
    encoder->bit_rate=(channels==1?64000:128000);
    encoder->flags|=AV_CODEC_FLAG_GLOBAL_HEADER;
    TRY(10,av_opt_set(encoder->priv_data,"aac_coder","fast",0));
    TRY(10,avcodec_open2(encoder,NULL,NULL));
    if(encoder->frame_size!=1024) return 10;
    TRY(11,avformat_alloc_output_context2(&output,NULL,"mp4",NULL));
    AVStream *video=avformat_new_stream(output,NULL),*audio=avformat_new_stream(output,NULL);
    if(!audio || !video) return 2;
    TRY(12,avcodec_parameters_copy(video->codecpar,in_v->codecpar));
    // A trailing Annex B padding byte occasionally varies between identical PPS packets.
    // Discard only padding following the last RBSP stop bit before constructing avcC.
    while(video->codecpar->extradata_size>4 && video->codecpar->extradata[video->codecpar->extradata_size-1]==0)
        video->codecpar->extradata_size--;
    video->codecpar->codec_tag=0;
    video->time_base=(AVRational){1,90000};
    video->avg_frame_rate=in_v->avg_frame_rate;
    TRY(13,avcodec_parameters_from_context(audio->codecpar,encoder));
    audio->time_base=encoder->time_base;
    output->avoid_negative_ts=AVFMT_AVOID_NEG_TS_DISABLED;
    TRY(14,avio_open_dyn_buf(&output->pb));
    output->flags|=AVFMT_FLAG_CUSTOM_IO;
    AVDictionary *opts=NULL;
    av_dict_set(&opts,"movflags","empty_moov+default_base_moof+frag_custom+frag_discont+skip_trailer",0);
    av_dict_set(&opts,"use_editlist","0",0);
    av_dict_set(&opts,"video_track_timescale","90000",0);
    av_dict_set_int(&opts,"fragment_index",1+(sequence%2147483646u),0);
    TRY(15,avformat_write_header(output,&opts));
    avio_flush(output->pb);
    media_offset=avio_tell(output->pb);
    AVPacket *pkt=av_packet_alloc(),*packed=av_packet_alloc();
    AVFrame *pcm=av_frame_alloc(),*aac_frame=av_frame_alloc();
    unsigned max_samples=MAX_SECONDS*rate, used=0, video_count=0;
    float *floats[2]={0};
    for(int c=0;c<channels;c++) floats[c]=av_malloc_array(max_samples,sizeof(float));
    if(!pkt||!packed||!pcm||!aac_frame||!floats[0]||!floats[channels-1]) return 2;
    int64_t start=AV_NOPTS_VALUE;
    int read_ret;
    while((read_ret=av_read_frame(input,pkt))>=0) {
        if(pkt->stream_index==in_v->index) {
            if (pkt->pts == AV_NOPTS_VALUE || pkt->dts == AV_NOPTS_VALUE) return 16;
            av_packet_rescale_ts(pkt,in_v->time_base,video->time_base);
            pkt->dts = unwrap90(pkt->dts,epoch90);
            pkt->pts = unwrap90(pkt->pts,pkt->dts);
            pkt->stream_index=video->index;
            TRY(17,av_write_frame(output,pkt));
            if(++video_count>MAX_SECONDS*120) return 18;
        } else if(pkt->stream_index==in_a->index) {
            if(start==AV_NOPTS_VALUE) {
                if(pkt->pts==AV_NOPTS_VALUE) return 19;
                int64_t raw90=av_rescale_q(pkt->pts,in_a->time_base,(AVRational){1,90000});
                start=av_rescale_q(unwrap90(raw90,epoch90),(AVRational){1,90000},encoder->time_base);
            }
            TRY(20,avcodec_send_packet(decoder,pkt));
            int dret;
            while((dret=avcodec_receive_frame(decoder,pcm))>=0) {
                if(pcm->format!=AV_SAMPLE_FMT_FLTP || pcm->sample_rate!=rate ||
                   pcm->ch_layout.nb_channels!=channels || pcm->nb_samples<=0 ||
                   pcm->nb_samples>(int)(max_samples-used)) return 21;
                for(int c=0;c<channels;c++) memcpy(floats[c]+used,pcm->extended_data[c],pcm->nb_samples*sizeof(float));
                used+=pcm->nb_samples;
                av_frame_unref(pcm);
            }
            if(dret!=AVERROR(EAGAIN) && dret!=AVERROR_EOF) return 22;
        }
        av_packet_unref(pkt);
    }
    if(read_ret!=AVERROR_EOF || !video_count || used<1024 || start==AV_NOPTS_VALUE) return 23;
    // Round the original absolute audio start and end to the nearest AAC frame boundary.
    // This keeps adjacent fragments contiguous without accumulating encoder delay or drift.
    // Resample the small rounding difference across this fragment, retaining its two endpoints.
    int64_t grid_start=((start+512)/1024)*1024,grid_end=((start+used+512)/1024)*1024;
    uint32_t total=grid_end-grid_start;
    if(!total || total>max_samples+1024) return 24;
    first_sample=grid_start;
    aac_frame->format=AV_SAMPLE_FMT_FLTP;
    aac_frame->sample_rate=rate;
    aac_frame->nb_samples=1024;
    av_channel_layout_default(&aac_frame->ch_layout,channels);
    TRY(25,av_frame_get_buffer(aac_frame,0));
    double step=(double)(used-1)/(total-1);
    for(uint32_t n=0;n<total;n+=1024) {
        TRY(26,av_frame_make_writable(aac_frame));
        for(int c=0;c<channels;c++) {
            float *dest=(float*)aac_frame->extended_data[c];
            for(unsigned j=0;j<1024;j++) {
                double pos=(n+j)*step;
                unsigned k=(unsigned)pos;
                dest[j]=k>=used-1?floats[c][used-1]:floats[c][k]+(pos-k)*(floats[c][k+1]-floats[c][k]);
            }
        }
        aac_frame->pts=grid_start+n;
        TRY(27,avcodec_send_frame(encoder,aac_frame));
        TRY(28,drain_encoder(encoder,output,audio,packed,grid_start,grid_end));
    }
    TRY(29,avcodec_send_frame(encoder,NULL));
    TRY(30,drain_encoder(encoder,output,audio,packed,grid_start,grid_end));
    TRY(31,av_write_frame(output,NULL));
    TRY(32,av_write_trailer(output));
    out_len=avio_close_dyn_buf(output->pb,&out_data);
    return out_len>media_offset && out_len<(int)(MAX_INPUT+1024*1024)?0:33;
}
EXPORT int output_pointer(void){return (int)(uintptr_t)out_data;}
EXPORT int output_size(void){return out_len;}
EXPORT int init_size(void){return media_offset;}
EXPORT int error_detail(void){return err_detail;}
