package com.snaptvnow.smspuente;
import android.content.*;import android.database.*;import android.database.sqlite.*;import android.net.Uri;import org.json.*;
final class MessageStore extends SQLiteOpenHelper {
 MessageStore(Context c){super(c,"sms_bridge.db",null,1);}public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE events(id TEXT PRIMARY KEY,raw TEXT NOT NULL,received INTEGER NOT NULL,day TEXT NOT NULL,status TEXT NOT NULL)");}public void onUpgrade(SQLiteDatabase db,int a,int b){}
 void scan(Context context,Vault v)throws Exception{
  long cursor=v.p.getLong("cursor",0),since=v.p.getLong("since",System.currentTimeMillis());int count=0;
  try(Cursor rows=context.getContentResolver().query(Uri.parse("content://sms/inbox"),new String[]{"_id","address","body","date"},"address=? AND _id>? AND date>=?",new String[]{"520",Long.toString(cursor),Long.toString(since)},"_id ASC")){
   if(rows==null)throw new Exception("No se pudo leer la bandeja SMS");while(rows.moveToNext()&&count++<200){long id=rows.getLong(0),time=rows.getLong(3);String source=rows.getString(1),body=rows.getString(2);if("520".equals(source)&&body!=null&&body.length()<=2000&&body.trim().matches("(?is)^BofA:.*sent you \\$.*")){ContentValues values=new ContentValues();values.put("id","sms:"+id);values.put("raw",body);values.put("received",time);values.put("day",Vault.day(time));values.put("status","pending");getWritableDatabase().insertWithOnConflict("events",null,values,SQLiteDatabase.CONFLICT_IGNORE);}cursor=id;v.p.edit().putLong("cursor",cursor).commit();}
  }
 }
 JSONObject first()throws Exception{try(Cursor r=getReadableDatabase().rawQuery("SELECT id,raw,received,day FROM events WHERE status='pending' ORDER BY received,id LIMIT 1",null)){if(!r.moveToFirst())return null;return new JSONObject().put("action","receive").put("source","520").put("messageId",r.getString(0)).put("sms",r.getString(1)).put("receivedAt",r.getLong(2)).put("paymentDate",r.getString(3));}}
 void failed(String id){ContentValues values=new ContentValues();values.put("status","review");getWritableDatabase().update("events",values,"id=?",new String[]{id});}
 void sent(String id){ContentValues values=new ContentValues();values.put("status","sent");getWritableDatabase().update("events",values,"id=?",new String[]{id});}
 String counts(){try(Cursor r=getReadableDatabase().rawQuery("SELECT COUNT(*),SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),SUM(CASE WHEN status='review' THEN 1 ELSE 0 END) FROM events",null)){r.moveToFirst();return "SMS de 520 detectados: "+r.getInt(0)+" · Pendientes de entregar: "+r.getInt(1)+" · Requieren revisión: "+r.getInt(2);}}
}
