package com.snaptvnow.smspuente;
import org.json.*;import java.net.*;import java.io.*;
final class Transport {
 static class Failure extends IOException {final int status;Failure(int status,String message){super(message);this.status=status;}}
 static JSONObject send(Vault v,JSONObject body,boolean pair)throws Exception{
  body.put("deviceId",v.id());HttpURLConnection c=(HttpURLConnection)new URL(Vault.API).openConnection();c.setInstanceFollowRedirects(false);c.setRequestMethod("POST");c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");if(!pair)c.setRequestProperty("Authorization","Bearer "+v.token());
  try{byte[] bytes=body.toString().getBytes("UTF-8");c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}int status=c.getResponseCode();InputStream stream=status>=200&&status<300?c.getInputStream():c.getErrorStream();ByteArrayOutputStream buffer=new ByteArrayOutputStream();if(stream!=null)try(InputStream in=stream){byte[] chunk=new byte[1024];int n;while((n=in.read(chunk))!=-1){buffer.write(chunk,0,n);if(buffer.size()>12000)throw new IOException("Respuesta demasiado grande");}}
   JSONObject result;try{result=new JSONObject(new String(buffer.toByteArray(),"UTF-8"));}catch(Exception e){throw new IOException("Servidor sin respuesta válida ("+status+")");}
   if(status==401){v.p.edit().putBoolean("paired",false).putBoolean("enabled",false).apply();throw new IOException("Teléfono desconectado: genera un nuevo código en el panel.");}
   if(status<200||status>=300||!result.optBoolean("ok"))throw new Failure(status,result.optString("message","Entrega no confirmada ("+status+")"));return result;
  }finally{c.disconnect();}
 }
}
