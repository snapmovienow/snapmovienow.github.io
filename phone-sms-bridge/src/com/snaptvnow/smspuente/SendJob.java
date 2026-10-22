package com.snaptvnow.smspuente;
import android.app.job.*;import android.content.*;import java.util.concurrent.atomic.AtomicBoolean;import org.json.*;
public class SendJob extends JobService {
 // Jobs can overlap (one-shot + periodic). Serialize scans/deliveries, while
 // retaining a cancellation flag for each job instead of sharing one flag.
 private static final Object deliveryLock=new Object();
 private final java.util.concurrent.ConcurrentHashMap<Integer,AtomicBoolean> runs=new java.util.concurrent.ConcurrentHashMap<>();
 static void schedule(Context c,boolean periodic){Vault v=new Vault(c);if(!v.enabled())return;JobScheduler scheduler=(JobScheduler)c.getSystemService(JOB_SCHEDULER_SERVICE);JobInfo.Builder b=new JobInfo.Builder(periodic?52002:52001,new ComponentName(c,SendJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL);if(periodic)b.setPeriodic(15*60*1000);else b.setMinimumLatency(2000);scheduler.schedule(b.build());}
 static void pause(Context c){JobScheduler s=(JobScheduler)c.getSystemService(JOB_SCHEDULER_SERVICE);s.cancel(52001);s.cancel(52002);}
 public boolean onStartJob(JobParameters params){AtomicBoolean stopped=new AtomicBoolean(false);runs.put(params.getJobId(),stopped);new Thread(()->{boolean retry=false;Vault v=new Vault(this);synchronized(deliveryLock){if(!stopped.get()&&v.enabled()){try(MessageStore store=new MessageStore(this)){
   try{store.scan(this,v);}catch(SecurityException e){v.status("Permisos SMS retirados. Actívalos de nuevo para continuar.");Health.alert(this,"Falta el permiso SMS. Abre la app y revisa los permisos.");Health.ping(this,v);throw e;}
   Health.ping(this,v);JSONObject message;int n=0;while(!stopped.get()&&v.enabled()&&n++<100&&(message=store.first())!=null){String id=message.getString("messageId");store.attempt(id);try{Transport.send(v,message,false);store.sent(id);}catch(Exception e){boolean review=e instanceof Transport.Failure&&(((Transport.Failure)e).status==400||((Transport.Failure)e).status==409||((Transport.Failure)e).status==413||((Transport.Failure)e).status==415);store.failed(id,e.getMessage(),review);if(review){v.status("Un SMS requiere revisión. Abre Mensajes y errores.");continue;}throw e;}}
   Health.ping(this,v);Health.updateAlert(this);retry=store.first()!=null;v.status(retry?"Quedan entregas pendientes; se reintentará.":"Revisión completada. Los SMS entregados esperan tu autorización en el panel.");
  }catch(Exception e){v.status("Pendiente de reintentar: "+e.getMessage());Health.alert(this,"No se confirmó la entrega o la conexión. Los mensajes guardados se conservan. Abre la app para revisar.");retry=v.enabled();}}}runs.remove(params.getJobId(),stopped);if(!stopped.get())jobFinished(params,retry);},"sms-delivery").start();return true;}
 public boolean onStopJob(JobParameters params){AtomicBoolean stopped=runs.remove(params.getJobId());if(stopped!=null)stopped.set(true);return new Vault(this).enabled();}
}
