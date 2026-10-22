package com.snaptvnow.smspuente;
import android.content.*;import android.provider.Telephony;import android.telephony.SmsMessage;
public class SmsReceiver extends BroadcastReceiver {public void onReceive(Context c,Intent i){if(!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(i.getAction())||!new Vault(c).enabled())return;for(SmsMessage sms:Telephony.Sms.Intents.getMessagesFromIntent(i))if("520".equals(sms.getOriginatingAddress())){SendJob.schedule(c,false);break;}}}
